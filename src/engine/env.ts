// エンジンに注入する環境（docs/SPEC.md §1）
// jsdom では offsetHeight / getBoundingClientRect / getComputedStyle が使えないので、
// 可視判定や位置取得は差し替えられるようにしてある。

import { findStyleElement } from './cloak';

export interface Rect {
  width: number;
  height: number;
}

export interface EngineEnv {
  /**
   * 可視判定。
   * 注意: 透明度（opacity）は見ない。cloak が opacity:0 を使うため、
   * cloak 中の容器を「サイト側が消した」と誤判定しないようにしている。
   */
  isVisible(el: Element): boolean;
  /**
   * viewport の外に出ているか。`transform: translateY(100%)` で退場するバナーは
   * display も visibility も変わらないので、矩形で退場を見る。
   */
  isOffscreen(el: Element): boolean;
  /**
   * サイト側の指定で透明・不可視になっているか（opacity:0 / visibility:hidden）。
   * 自前の cloak も opacity:0 なので、判定の間だけ cloak の style を無効化する
   * （同一タスク内で戻すので画面は点滅しない）。
   */
  isFaded(el: Element): boolean;
  /** computed style の position */
  getPosition(el: Element): string;
  /**
   * computed style の cursor。`<wb7-button>` のようなカスタム要素や
   * `<div data-testid="reject-all">` は button でも `role="button"` でもないので、
   * 「押せる見た目か」をこれで見る（§5-5-d の緩い候補）。
   */
  getCursor(el: Element): string;
  /** 大きさ */
  getRect(el: Element): Rect;
  /** 可視テキスト（正規化前） */
  getText(el: Element): string;
  /** computed style の任意プロパティ（styleFilters 用） */
  getStyle(el: Element, property: string): string;
  sleep(ms: number): Promise<void>;
  now(): number;
  debug(...args: unknown[]): void;
  /**
   * 進行ログ（§5-8）。debug と同じく「デバッグログ」設定が有効なときだけ出るが、
   * 各層が何をしたかを利用者がそのままコピーして報告できるよう `console.info` で出す
   * （`console.debug` は既定のログレベルで表示されない）。
   * 出すのは層ごとの結果 1 行だけで、細かい経過は debug に残す。
   */
  trace(...args: unknown[]): void;
}

function computed(el: Element): CSSStyleDeclaration | null {
  const view = el.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return null;
  try {
    return view.getComputedStyle(el);
  } catch {
    return null;
  }
}

export function defaultIsVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const style = computed(el);
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  const html = el as HTMLElement;
  if (typeof html.offsetWidth === 'number' && (html.offsetWidth > 0 || html.offsetHeight > 0)) return true;
  const rects = typeof el.getClientRects === 'function' ? el.getClientRects() : null;
  if (rects && rects.length > 0) return true;
  // offsetParent を持たない fixed 要素などのために矩形も見る
  const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
  return !!rect && (rect.width > 0 || rect.height > 0);
}

export function defaultIsOffscreen(el: Element): boolean {
  const view = el.ownerDocument?.defaultView;
  if (!view || typeof el.getBoundingClientRect !== 'function') return false;
  const width = view.innerWidth ?? 0;
  const height = view.innerHeight ?? 0;
  if (width <= 0 || height <= 0) return false; // viewport が測れない環境では判定しない
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false; // 大きさゼロは isVisible の担当
  return rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width;
}

/** 自前の cloak を一時的に無効化して読む（同期のうちに戻すので paint は挟まらない） */
function withoutCloak<T>(el: Element, read: () => T): T {
  const doc = el.ownerDocument;
  const style = doc ? findStyleElement(doc) : null;
  if (!style || style.disabled) return read();
  style.disabled = true;
  try {
    return read();
  } finally {
    style.disabled = false;
  }
}

/**
 * opacity は自分だけでなく祖先も見る（body の手前まで）。
 * `.modal-wrap { opacity: 0 }` のように親側をフェードさせて退場するバナーがあり、
 * 自分の opacity だけだと「拒否したのに失敗扱い」→ fallback=accept で許可まで押してしまう。
 * visibility は継承されるので要素自身の computed だけを見る
 * （祖先まで辿ると `.wrap { visibility: hidden } .banner { visibility: visible }` の
 * 見えているバナーを退場と誤判定してしまう）。
 */
export function defaultIsFaded(el: Element): boolean {
  return withoutCloak(el, () => {
    const own = computed(el);
    if (own?.visibility === 'hidden' || own?.visibility === 'collapse') return true;
    const body = el.ownerDocument?.body ?? null;
    for (let current: Element | null = el; current !== null && current !== body; current = current.parentElement) {
      if (computed(current)?.opacity === '0') return true;
    }
    return false;
  });
}

export function defaultGetText(el: Element): string {
  const html = el as HTMLElement;
  if (typeof html.innerText === 'string' && html.innerText !== '') return html.innerText;
  return el.textContent ?? '';
}

export const defaultEnv: EngineEnv = {
  isVisible: defaultIsVisible,
  isOffscreen: defaultIsOffscreen,
  isFaded: defaultIsFaded,
  getPosition: (el) => computed(el)?.position ?? 'static',
  getCursor: (el) => computed(el)?.cursor ?? '',
  getRect: (el) => {
    const rect = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  },
  getText: defaultGetText,
  getStyle: (el, property) => computed(el)?.getPropertyValue(property) ?? '',
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  debug: () => undefined,
  trace: () => undefined,
};

/** debug 設定を反映した env を作る */
export function createEnv(debug: boolean, base: EngineEnv = defaultEnv): EngineEnv {
  if (!debug) return base;
  return {
    ...base,
    // console.debug は Chrome の既定のログレベルでは表示されないので info を使う
    debug: (...args: unknown[]) => console.info('[cookie-autopilot]', ...args),
    trace: (...args: unknown[]) => console.info('[cookie-autopilot]', ...args),
  };
}
