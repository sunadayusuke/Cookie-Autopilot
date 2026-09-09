// Consent-O-Matic ルールの検出と実行（docs/SPEC.md §4）

import { isCloseWord, isRejectMinimal, isRejectStrong } from '../../shared/phrases';
import type { CategoryKey, ComMatcher, ComRule, Decision } from '../../shared/types';
import { CATEGORY_KEYS } from '../../shared/types';
import type { EngineEnv } from '../env';
import { executeAction, matchMatcher } from './actions';
import type { ComContext } from './tools';
import { comFindAll } from './tools';

export { parseComRules } from './tools';

/** メソッドの実行順。UTILITY / HANDLE_TAB は runmethod から呼ばれる */
export const METHOD_ORDER = ['HIDE_CMP', 'OPEN_OPTIONS', 'DO_CONSENT', 'SAVE_CONSENT'] as const;

/** 実行後に showingMatcher が偽になるのを待つ時間 */
export const SUCCESS_TIMEOUT_MS = 1500;
const SUCCESS_POLL_MS = 100;
/** 1 ルールあたりの実行時間の上限（暴走防止） */
const RULE_BUDGET_MS = 15000;
/** runmethod の入れ子の上限 */
const MAX_METHOD_DEPTH = 5;

/**
 * METHOD_ORDER のどれかに action を持つルールか。
 * `onetrust_banner` のように UTILITY / HANDLE_TAB しか持たないルールは実行しても
 * 必ず失敗し、SUCCESS_TIMEOUT_MS ぶんの時間を捨てるだけなので呼び出し側でスキップする（M3）。
 */
export function hasRunnableMethod(rule: ComRule): boolean {
  const runnable = new Set<string>(METHOD_ORDER);
  return (rule.methods ?? []).some(
    (method) => !!method.action && typeof method.action === 'object' && runnable.has(method.name ?? ''),
  );
}

function asMatchers(value: ComMatcher | ComMatcher[] | undefined): ComMatcher[] {
  if (!value) return [];
  return Array.isArray(value) ? value.filter((m) => !!m && typeof m === 'object') : [value];
}

/**
 * 1 つの matcher 配列の判定。配列内はすべて一致（AND）で扱う。
 * 実ルールには「対象ドメイン（url matcher）＋ css」のように AND 前提のものがあり、
 * OR にすると未対応 matcher を含むルールが誤爆するため。
 */
function matchAll(matchers: ComMatcher[], ctx: ComContext): boolean {
  if (matchers.length === 0) return false;
  return matchers.every((matcher) => matchMatcher(matcher, ctx));
}

/** いずれかの detector で present か */
export function isRulePresent(rule: ComRule, ctx: ComContext): boolean {
  return (rule.detectors ?? []).some((detector) => matchAll(asMatchers(detector.presentMatcher), ctx));
}

/** いずれかの detector で present かつ showing か（showingMatcher 省略時は present と同義） */
export function isRuleShowing(rule: ComRule, ctx: ComContext): boolean {
  return (rule.detectors ?? []).some((detector) => {
    const present = asMatchers(detector.presentMatcher);
    if (!matchAll(present, ctx)) return false;
    const showing = asMatchers(detector.showingMatcher);
    return showing.length === 0 ? true : matchAll(showing, ctx);
  });
}

/** CMP を検出した（present かつ showing）か */
export function detectRule(rule: ComRule, ctx: ComContext): boolean {
  return isRuleShowing(rule, ctx);
}

/** present 要素（HIDE_CMP が無いときの cloak 対象） */
export function presentElements(rule: ComRule, ctx: ComContext): Element[] {
  const out: Element[] = [];
  for (const detector of rule.detectors ?? []) {
    for (const matcher of asMatchers(detector.presentMatcher)) {
      if (matcher.type !== 'css') continue;
      for (const el of comFindAll(matcher, ctx)) if (!out.includes(el)) out.push(el);
    }
  }
  return out;
}

export interface ComRunOptions {
  doc: Document;
  env: EngineEnv;
  mode: 'reject' | 'accept';
  /** 実効の許可カテゴリ（§14.1 の effectiveCategories） */
  allowCategories: readonly CategoryKey[];
  ruleName: string;
  /** このフレームが iframe か（iframeFilter の判定に使う） */
  isSubFrame: boolean;
  cloak(el: Element): void;
  /** 監視窓が切れたなど、実行を打ち切るべきか。省略時は打ち切らない */
  isCancelled?(): boolean;
}

/** カテゴリごとの望む状態。accept モードなら全 true、reject モードは許可カテゴリに従う */
export function desiredCategories(
  mode: 'reject' | 'accept',
  allowCategories: readonly CategoryKey[],
): Record<CategoryKey, boolean> {
  const out = {} as Record<CategoryKey, boolean>;
  for (const category of CATEGORY_KEYS) {
    out[category] = mode === 'accept' ? true : allowCategories.includes(category);
  }
  return out;
}

/** 望む状態が true のカテゴリ（報告用。§14.6 の `allowed`） */
function allowedCategories(desired: Record<string, boolean>): CategoryKey[] {
  return CATEGORY_KEYS.filter((category) => desired[category] === true);
}

export function createComContext(options: ComRunOptions): ComContext {
  const isCancelled = options.isCancelled;
  const ctx: ComContext = {
    doc: options.doc,
    env: options.env,
    isSubFrame: options.isSubFrame,
    base: null,
    desired: desiredCategories(options.mode, options.allowCategories),
    desiredDefault: options.mode === 'accept',
    ruleName: options.ruleName,
    cloak: options.cloak,
    runMethod: async () => undefined,
    lastClickedText: '',
    lastClickedLabel: '',
    clickCount: 0,
    consentApplied: false,
    deadline: options.env.now() + RULE_BUDGET_MS,
    isCancelled: () => isCancelled?.() === true,
  };
  return ctx;
}

export interface ComRunResult {
  ok: boolean;
  /** 押したボタンの正規化済み文言 */
  clickedText?: string;
  /** 押したボタンの表示用ラベル（popup はこちらを出す。H1） */
  clickedLabel?: string;
  /** 何をしたか（§14.6）。分類できないときは付けない */
  decision?: Decision;
  /** decision === 'granular' のときに許可したカテゴリ */
  allowed?: CategoryKey[];
}

/**
 * consent エントリを通らなかったルールの decision（§14.6）。
 * 押したボタンの文言で分類する。許可語・分類できない文言には decision を付けない
 * （同梱ルールには「閉じるだけ」「許可を押すだけ」のものがあり、一律 reject-all にすると
 * popup が事実と逆の報告をしてしまう。H2）。
 */
function decisionForClick(clickedText: string, mode: 'reject' | 'accept'): Decision | undefined {
  if (clickedText === '') return undefined;
  if (isRejectStrong(clickedText) || isRejectMinimal(clickedText)) {
    // accept モードは fixtures 専用なので reject-all は付けない
    return mode === 'reject' ? 'reject-all' : undefined;
  }
  if (isCloseWord(clickedText)) return 'dismissed';
  return undefined;
}

/**
 * ルールを 1 度実行する。HIDE_CMP → OPEN_OPTIONS → DO_CONSENT → SAVE_CONSENT の順。
 * 実行後 SUCCESS_TIMEOUT_MS 以内に showing が偽になれば成功。
 */
export async function runRule(rule: ComRule, options: ComRunOptions): Promise<ComRunResult> {
  const ctx = createComContext(options);
  const methods = rule.methods ?? [];
  let depth = 0;

  const runNamed = async (name: string): Promise<void> => {
    if (depth >= MAX_METHOD_DEPTH) {
      ctx.env.debug('com: runmethod の入れ子が深すぎる', ctx.ruleName, name);
      return;
    }
    const matched = methods.filter((method) => method.name === name);
    if (matched.length === 0) {
      ctx.env.debug('com: メソッドが無いのでスキップ', ctx.ruleName, name);
      return;
    }
    depth++;
    try {
      for (const method of matched) {
        ctx.base = null;
        await executeAction(method.action, ctx);
      }
    } finally {
      depth--;
    }
  };
  ctx.runMethod = runNamed;

  // HIDE_CMP が無ければ present 要素を cloak する
  if (!methods.some((method) => method.name === 'HIDE_CMP')) {
    for (const el of presentElements(rule, ctx)) ctx.cloak(el);
  }

  for (const name of METHOD_ORDER) {
    await runNamed(name);
  }

  const deadline = ctx.env.now() + SUCCESS_TIMEOUT_MS;
  for (;;) {
    ctx.base = null;
    if (!isRuleShowing(rule, ctx)) {
      // 成功 = showing が消えた = サイト側に選択が保存された。
      // カテゴリごとに選べていれば granular、そうでなければ押したボタンの文言で分類する。
      const decision: Decision | undefined = ctx.consentApplied
        ? 'granular'
        : decisionForClick(ctx.lastClickedText, options.mode);
      return {
        ok: true,
        ...(ctx.lastClickedText ? { clickedText: ctx.lastClickedText } : {}),
        ...(ctx.lastClickedLabel ? { clickedLabel: ctx.lastClickedLabel } : {}),
        ...(decision ? { decision } : {}),
        ...(ctx.consentApplied ? { allowed: allowedCategories(ctx.desired) } : {}),
      };
    }
    if (ctx.isCancelled() || ctx.env.now() >= deadline) break;
    await ctx.env.sleep(SUCCESS_POLL_MS);
  }
  ctx.env.debug('com: showing が消えなかった', ctx.ruleName);
  return { ok: false };
}
