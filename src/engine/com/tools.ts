// Consent-O-Matic ルールの要素探索（docs/SPEC.md §4）
// 実ルール JSON の構造に合わせている:
//   探索設定 = { parent?: DomSelector|null, target: DomSelector }
//   matcher / action はそれ自身が探索設定を兼ねる
// querySelectorAll は shadow DOM を横断しない（Consent-O-Matic と同じ挙動）。

import type { ComDomSelector, ComFindConfig, ComRule } from '../../shared/types';
import type { EngineEnv } from '../env';

export interface FindResult {
  parent: Element | null;
  target: Element | null;
}

export interface ComContext {
  doc: Document;
  env: EngineEnv;
  /** このフレームが iframe（サブフレーム）か。iframeFilter の判定に使う */
  isSubFrame: boolean;
  /** foreach / runrooted で差し替わる探索ルート。null なら doc */
  base: ParentNode | null;
  /** カテゴリごとの「望む状態」 */
  desired: Record<string, boolean>;
  /** 未知カテゴリのときの既定（accept モードなら true） */
  desiredDefault: boolean;
  ruleName: string;
  /** cloak（opacity:0）で隠す。COM の hide アクションはこれに割り当てる */
  cloak(el: Element): void;
  /** runmethod 用 */
  runMethod(name: string): Promise<void>;
  /** 最後にクリックした要素の正規化済み文言（分類用） */
  lastClickedText: string;
  /** 最後にクリックした要素の表示用ラベル（popup の結果表示用） */
  lastClickedLabel: string;
  /** クリックした回数（consent が実際にトグルを押したかの判定に使う。§14.6 / M1） */
  clickCount: number;
  /** カテゴリごとに選んだと言えるか（§14.6 の granular 判定に使う） */
  consentApplied: boolean;
  /** 暴走防止の締め切り（env.now() 比較） */
  deadline: number;
  /** 監視窓が切れたなど、実行を打ち切るべきか */
  isCancelled(): boolean;
}

function rootOf(ctx: ComContext, parent: ParentNode | null): ParentNode {
  return parent ?? ctx.base ?? ctx.doc;
}

function textOf(el: Element): string {
  return (el.textContent ?? '').toLowerCase();
}

function matchesTextFilter(el: Element, filter: string | string[]): boolean {
  const text = textOf(el);
  const list = Array.isArray(filter) ? filter : [filter];
  for (const needle of list) {
    if (typeof needle !== 'string') continue;
    if (text.includes(needle.toLowerCase())) return true;
  }
  return false;
}

/** DomSelector 1 つで要素を探す（フィルタ適用済み） */
export function queryDom(
  selector: ComDomSelector | undefined | null,
  parent: ParentNode | null,
  ctx: ComContext,
): Element[] {
  if (!selector || typeof selector !== 'object') return [];
  // slide のように target が入れ子になっているケース
  if (typeof selector.selector !== 'string' && selector.target) {
    return queryDom(selector.target, parent, ctx);
  }
  if (typeof selector.selector !== 'string' || selector.selector.trim() === '') {
    ctx.env.debug('com: selector が無い探索設定', ctx.ruleName, selector);
    return [];
  }
  // iframeFilter は要素ではなく「今のフレームが iframe か」を見る（Consent-O-Matic 本体と同じ）
  if (typeof selector.iframeFilter === 'boolean' && ctx.isSubFrame !== selector.iframeFilter) return [];

  let found: Element[];
  try {
    found = Array.from(rootOf(ctx, parent).querySelectorAll(selector.selector));
  } catch {
    ctx.env.debug('com: 不正なセレクタ', ctx.ruleName, selector.selector);
    return [];
  }

  if (selector.textFilter != null) {
    found = found.filter((el) => matchesTextFilter(el, selector.textFilter as string | string[]));
  }
  if (Array.isArray(selector.styleFilters)) {
    found = found.filter((el) => {
      for (const filter of selector.styleFilters ?? []) {
        if (!filter || typeof filter.option !== 'string') continue;
        const actual = ctx.env.getStyle(el, filter.option);
        const same = actual === filter.value;
        if (filter.negated ? same : !same) return false;
      }
      return true;
    });
  }
  if (typeof selector.displayFilter === 'boolean') {
    // SPEC の offsetHeight !== 0 に相当。jsdom で差し替えられるよう env.isVisible を使う
    found = found.filter((el) => ctx.env.isVisible(el) === selector.displayFilter);
  }
  if (selector.childFilter) {
    const negate = selector.childFilterNegate === true;
    found = found.filter((el) => {
      const hasChild = comFindOne(selector.childFilter as ComFindConfig, ctx, el) != null;
      return negate ? !hasChild : hasChild;
    });
  }
  return found;
}

/** 探索設定（parent + target）で要素を探す */
export function comFind(config: ComFindConfig | undefined, ctx: ComContext, parent?: Element | null): FindResult[] {
  if (!config || typeof config !== 'object') return [];
  if (config.parent) {
    const parents = queryDom(config.parent, parent ?? null, ctx);
    const results: FindResult[] = [];
    for (const p of parents) {
      const targets = queryDom(config.target, p, ctx);
      if (targets.length === 0) results.push({ parent: p, target: null });
      else for (const t of targets) results.push({ parent: p, target: t });
    }
    return results;
  }
  const targets = queryDom(config.target, parent ?? null, ctx);
  return targets.map((target) => ({ parent: null, target }));
}

/** 最初に見つかった target（無ければ null） */
export function comFindOne(
  config: ComFindConfig | undefined,
  ctx: ComContext,
  parent?: Element | null,
): Element | null {
  for (const result of comFind(config, ctx, parent)) {
    if (result.target) return result.target;
  }
  return null;
}

/** 見つかった target をすべて */
export function comFindAll(config: ComFindConfig | undefined, ctx: ComContext): Element[] {
  const out: Element[] = [];
  for (const result of comFind(config, ctx)) if (result.target) out.push(result.target);
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * ルール JSON（未検証）を内部型へ変換する。any / unknown の入口はここだけ。
 * detectors が無いルールは検出できないので捨てる。
 */
export function parseComRules(value: unknown): Record<string, ComRule> {
  const out: Record<string, ComRule> = {};
  if (!isPlainObject(value)) return out;
  for (const [name, raw] of Object.entries(value)) {
    if (!isPlainObject(raw)) continue;
    const detectors = Array.isArray(raw['detectors']) ? raw['detectors'].filter(isPlainObject) : [];
    const methods = Array.isArray(raw['methods']) ? raw['methods'].filter(isPlainObject) : [];
    if (detectors.length === 0) continue;
    out[name] = { detectors, methods } as ComRule;
  }
  return out;
}
