// Consent-O-Matic のアクション実行（docs/SPEC.md §4）
//
// 未知の type は no-op + debug ログ。例外は各アクションで捕まえ、全体を止めない。
// 対応: click, list, consent, ifcss, waitcss, foreach, hide, wait, ifallowall,
//       ifallownone, runmethod, runrooted, multiclick
// no-op: slide, close（および未知の type）

import type { ComAction, ComConsent, ComMatcher } from '../../shared/types';
import { elementLabel, elementText } from '../normalize';
import type { ComContext } from './tools';
import { comFind, comFindAll, comFindOne } from './tools';

/** click 後に待つ時間（noTimeout のときは待たない） */
const CLICK_SETTLE_MS = 250;
const WAITCSS_RETRIES = 10;
const WAITCSS_WAIT_MS = 250;

/** 実ルールにある matcher の否定フラグ（css / checkbox のみ。未知 type は否定しない） */
function negate(result: boolean, matcher: ComMatcher): boolean {
  return matcher.negated === true ? !result : result;
}

/** matcher の現在状態。未知の type は偽 + debug ログ */
export function matchMatcher(matcher: ComMatcher | undefined, ctx: ComContext): boolean {
  if (!matcher || typeof matcher !== 'object') return false;
  switch (matcher.type) {
    case 'css':
      return negate(comFindOne(matcher, ctx) != null, matcher);
    case 'checkbox': {
      const el = comFindOne(matcher, ctx);
      return negate(!!el && (el as HTMLInputElement).checked === true, matcher);
    }
    case 'url': {
      // 対象ドメインの絞り込み。文字列 or 配列で、location.href の部分一致
      const urls = Array.isArray(matcher.url) ? matcher.url : [matcher.url];
      const href = ctx.doc.location?.href ?? '';
      return urls.some((url) => typeof url === 'string' && url !== '' && href.includes(url));
    }
    case 'onoff': {
      // on / off それぞれの目印を探す。実ルールでは常に onMatcher と offMatcher の両方を持ち、
      // 中身は css matcher と同じ探索設定（{ target, parent? }）。
      const on = comFindOne(matcher.onMatcher, ctx) != null;
      const off = comFindOne(matcher.offMatcher, ctx) != null;
      // 片方だけ一致するのが正常。両方 / どちらも一致しないのは想定外なので記録しておく
      // （Consent-O-Matic 本体に合わせ、両方一致なら on を優先し、どちらも無ければ off 扱い）
      if (on === off) {
        ctx.env.debug(
          on ? 'com: onoff の on と off が両方一致' : 'com: onoff の on も off も見つからない',
          ctx.ruleName,
          matcher,
        );
      }
      return on;
    }
    default:
      ctx.env.debug('com: 未対応の matcher type', ctx.ruleName, matcher.type);
      return false;
  }
}

function clickElement(el: Element, ctx: ComContext): void {
  const text = elementText(el);
  if (text) {
    ctx.lastClickedText = text;
    ctx.lastClickedLabel = elementLabel(el);
  }
  ctx.clickCount++;
  (el as HTMLElement).click?.();
}

function desiredFor(consent: ComConsent, ctx: ComContext): boolean {
  const type = typeof consent.type === 'string' ? consent.type : '';
  const value = ctx.desired[type];
  return typeof value === 'boolean' ? value : ctx.desiredDefault;
}

/**
 * consent の matcher が実際に要素へ解決したか。
 * 望む状態と現状が同じでトグルを押さなかった場合も「カテゴリごとに選んだ」ことに変わりは
 * ないが、matcher が何にも当たらない（＝そのカテゴリの UI がそもそも無い）ときまで
 * granular にすると、実際には拒否ボタンを押しただけのルールが granular になる（M1）。
 */
function matcherResolves(matcher: ComMatcher | undefined, ctx: ComContext): boolean {
  if (!matcher || typeof matcher !== 'object') return false;
  switch (matcher.type) {
    case 'css':
    case 'checkbox':
      return comFindOne(matcher, ctx) != null;
    case 'onoff':
      return comFindOne(matcher.onMatcher, ctx) != null || comFindOne(matcher.offMatcher, ctx) != null;
    default:
      return false;
  }
}

/** consent のアクションを実行し、実際にクリックできたら「カテゴリごとに選んだ」に数える（M1） */
async function applyConsentAction(action: ComAction, ctx: ComContext): Promise<void> {
  const before = ctx.clickCount;
  await executeAction(action, ctx);
  if (ctx.clickCount > before) ctx.consentApplied = true;
}

async function applyConsent(consent: ComConsent, ctx: ComContext): Promise<void> {
  const desired = desiredFor(consent, ctx);
  // 状態を確かめられた（matcher が要素に解決した）なら、押す必要が無くても granular（§14.6）
  if (matcherResolves(consent.matcher, ctx)) ctx.consentApplied = true;

  if (consent.toggleAction) {
    const current = matchMatcher(consent.matcher, ctx);
    if (current !== desired) await applyConsentAction(consent.toggleAction, ctx);
    return;
  }
  if (desired) {
    // matcher があり既に一致していればスキップ
    if (consent.trueAction && (!consent.matcher || !matchMatcher(consent.matcher, ctx))) {
      await applyConsentAction(consent.trueAction, ctx);
    }
    return;
  }
  if (consent.falseAction && (!consent.matcher || matchMatcher(consent.matcher, ctx))) {
    await applyConsentAction(consent.falseAction, ctx);
  }
}

async function waitCss(action: ComAction, ctx: ComContext): Promise<void> {
  const retries = typeof action.retries === 'number' ? action.retries : WAITCSS_RETRIES;
  const waitTime = typeof action.waitTime === 'number' ? action.waitTime : WAITCSS_WAIT_MS;
  const negated = action.negated === true;
  // 実ルールには retries 100 × 250ms（25 秒）のものがあるので、
  // ルールの制限時間と打ち切り要求をループの中でも見る
  for (let i = 0; i <= retries; i++) {
    if (ctx.isCancelled()) return;
    const found = comFindOne(action, ctx) != null;
    if (negated ? !found : found) return;
    if (i === retries) return;
    if (ctx.env.now() >= ctx.deadline) {
      ctx.env.debug('com: waitcss が制限時間を超えたので中断', ctx.ruleName);
      return;
    }
    await ctx.env.sleep(waitTime);
  }
}

/** すべてのカテゴリの望む状態が true か */
function allowsAll(ctx: ComContext): boolean {
  const values = Object.values(ctx.desired);
  if (values.length === 0) return ctx.desiredDefault;
  return values.every((value) => value === true);
}

/** すべてのカテゴリの望む状態が false か（= 何も許可しない） */
function allowsNone(ctx: ComContext): boolean {
  const values = Object.values(ctx.desired);
  if (values.length === 0) return !ctx.desiredDefault;
  return values.every((value) => value === false);
}

export async function executeAction(action: ComAction | undefined, ctx: ComContext): Promise<void> {
  if (!action || typeof action !== 'object') return;
  if (ctx.isCancelled()) {
    ctx.env.debug('com: 打ち切り要求で中断', ctx.ruleName, action.type);
    return;
  }
  if (ctx.env.now() > ctx.deadline) {
    ctx.env.debug('com: 制限時間を超えたので中断', ctx.ruleName, action.type);
    return;
  }

  try {
    switch (action.type) {
      case 'click': {
        const el = comFindOne(action, ctx);
        if (!el) return;
        clickElement(el, ctx);
        if (action.noTimeout !== true) await ctx.env.sleep(CLICK_SETTLE_MS);
        return;
      }
      case 'multiclick': {
        const els = comFindAll(action, ctx);
        for (const el of els) clickElement(el, ctx);
        if (action.noTimeout !== true && els.length > 0) await ctx.env.sleep(CLICK_SETTLE_MS);
        return;
      }
      case 'list': {
        for (const child of action.actions ?? []) await executeAction(child, ctx);
        return;
      }
      case 'consent': {
        for (const consent of action.consents ?? []) {
          if (!consent || typeof consent !== 'object') continue;
          await applyConsent(consent, ctx);
        }
        return;
      }
      case 'ifcss': {
        const found = comFindOne(action, ctx) != null;
        await executeAction(found ? action.trueAction : action.falseAction, ctx);
        return;
      }
      case 'waitcss': {
        await waitCss(action, ctx);
        return;
      }
      case 'foreach': {
        const targets = comFind(action, ctx)
          .map((result) => result.target)
          .filter((el): el is Element => el != null);
        const oldBase = ctx.base;
        for (const target of targets) {
          ctx.base = target;
          await executeAction(action.action, ctx);
        }
        ctx.base = oldBase;
        return;
      }
      case 'hide': {
        // SPEC の cloak（opacity:0 / pointer-events:none）で隠す。
        // display:none にすると displayFilter（offsetHeight）とクリックを壊すため。
        for (const el of comFindAll(action, ctx)) ctx.cloak(el);
        return;
      }
      case 'wait': {
        const waitTime = typeof action.waitTime === 'number' ? action.waitTime : 0;
        await ctx.env.sleep(waitTime);
        return;
      }
      case 'ifallowall': {
        await executeAction(allowsAll(ctx) ? action.trueAction : action.falseAction, ctx);
        return;
      }
      case 'ifallownone': {
        await executeAction(allowsNone(ctx) ? action.trueAction : action.falseAction, ctx);
        return;
      }
      case 'runmethod': {
        if (typeof action.method === 'string') await ctx.runMethod(action.method);
        return;
      }
      case 'runrooted': {
        const oldBase = ctx.base;
        if (action.ignoreOldRoot === true) ctx.base = null;
        const target = comFindOne(action, ctx);
        if (target) {
          ctx.base = target;
          await executeAction(action.action, ctx);
        }
        ctx.base = oldBase;
        return;
      }
      case 'slide':
      case 'close': {
        ctx.env.debug('com: 未対応のアクション（no-op）', ctx.ruleName, action.type);
        return;
      }
      default: {
        ctx.env.debug('com: 未知のアクション（no-op）', ctx.ruleName, action.type);
        return;
      }
    }
  } catch (error) {
    ctx.env.debug('com: アクションで例外', ctx.ruleName, action.type, error);
  }
}
