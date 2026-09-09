// テスト用の EngineEnv。
// jsdom には offsetHeight / getBoundingClientRect が無いため、大きさと可視判定を注入する。

import type { EngineEnv, Rect } from '../src/engine/env';

/** getComputedStyle を持つもの（別 realm の window でもよい） */
export interface WindowLike {
  getComputedStyle(el: Element): CSSStyleDeclaration;
}

const DOCUMENT_FRAGMENT_NODE = 11;

function computedFrom(win: WindowLike | null, el: Element): CSSStyleDeclaration | null {
  const view = win ?? (el.ownerDocument?.defaultView as unknown as WindowLike | null);
  if (!view?.getComputedStyle) return null;
  try {
    return view.getComputedStyle(el);
  } catch {
    return null;
  }
}

/** 祖先（shadow ホストを含む）を辿って display / visibility / hidden を見る */
function isVisibleIn(win: WindowLike | null, el: Element): boolean {
  if (!el.isConnected) return false;
  let current: Element | null = el;
  while (current !== null) {
    if (current.hasAttribute('hidden')) return false;
    const style = computedFrom(win, current);
    if (style) {
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    const parent: ParentNode | null = current.parentNode;
    if (parent !== null && parent.nodeType === DOCUMENT_FRAGMENT_NODE) {
      const host: Element | null = (parent as ShadowRoot).host ?? null;
      current = host;
    } else {
      current = current.parentElement;
    }
  }
  return true;
}

export function makeEnv(win: WindowLike | null, overrides: Partial<EngineEnv> = {}): EngineEnv {
  const rect: Rect = { width: 600, height: 120 };
  // 仮想時計。sleep で now が進むので、fallback の猶予などを実時間を待たずに検証できる。
  // 経過した仮想時間は env.now() で読める。
  let clock = 0;
  return {
    isVisible: (el) => isVisibleIn(win, el),
    // jsdom はレイアウトしないので、既定では「退場していない」。必要なテストで差し替える
    isOffscreen: () => false,
    isFaded: () => false,
    getPosition: (el) => computedFrom(win, el)?.position || 'static',
    // jsdom は cursor を継承しない（宣言のある要素だけ pointer になる）。
    // 実ブラウザでは子孫にも継承されるので、緩い候補の葉判定はそれ込みで書く
    getCursor: (el) => computedFrom(win, el)?.cursor || '',
    getRect: () => rect,
    getText: (el) => el.textContent ?? '',
    getStyle: (el, property) => computedFrom(win, el)?.getPropertyValue(property) ?? '',
    sleep: async (ms) => void (clock += Math.max(0, ms)),
    now: () => clock,
    debug: () => undefined,
    trace: () => undefined,
    ...overrides,
  };
}

/** グローバル document（vitest の jsdom environment）用 */
export function testEnv(overrides: Partial<EngineEnv> = {}): EngineEnv {
  return makeEnv(null, overrides);
}

/** document.body に HTML を流し込む */
export function setBody(html: string): void {
  document.body.innerHTML = html;
}
