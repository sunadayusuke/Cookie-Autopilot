// バナーを見せない制御（docs/SPEC.md §5-1）
//
// cloak は opacity:0 + pointer-events:none。display:none にはしない
// （offsetHeight による可視判定とプログラム的な click を壊さないため）。
// 失敗時の「非表示」だけは display:none をインラインで当てる。

export const STYLE_ATTR = 'data-cookie-autopilot';
export const CLOAK_ATTR = 'data-cookie-autopilot-cloak';
export const HIDDEN_ATTR = 'data-cookie-autopilot-hidden';
/** hide する前の inline `display`（解除するときに戻す。空文字 = inline で持っていなかった） */
export const DISPLAY_ATTR = 'data-cookie-autopilot-display';

/** Node.ELEMENT_NODE（別 realm の Node でも比較できるよう数値で持つ） */
const ELEMENT_NODE = 1;

function styleOf(el: Element): CSSStyleDeclaration | null {
  const style = (el as HTMLElement).style;
  return style && typeof style.setProperty === 'function' ? style : null;
}

export function findStyleElement(doc: Document): HTMLStyleElement | null {
  return doc.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}]`);
}

/**
 * cloak 用の style を documentElement に注入する（document_start で head が無いため）。
 * selectors は即決 CMP 表の容器セレクタ。
 */
export function injectCloakStyle(doc: Document, selectors: readonly string[]): HTMLStyleElement | null {
  const root = doc.documentElement;
  if (!root) return null;
  const existing = findStyleElement(doc);
  if (existing) return existing;

  const style = doc.createElement('style');
  style.setAttribute(STYLE_ATTR, '');
  const all = [...selectors, `[${CLOAK_ATTR}]`].filter((selector) => selector.trim() !== '');
  style.textContent = `${all.join(',\n')} {\n  opacity: 0 !important;\n  pointer-events: none !important;\n}\n`;
  root.appendChild(style);
  return style;
}

export function removeCloakStyle(doc: Document): void {
  findStyleElement(doc)?.remove();
}

/** picker 中など、一時的に cloak を無効化する */
export function setCloakSuspended(doc: Document, suspended: boolean): void {
  const style = findStyleElement(doc);
  if (style) style.disabled = suspended;
}

export function cloakElement(el: Element): void {
  if (!el.hasAttribute(CLOAK_ATTR)) el.setAttribute(CLOAK_ATTR, '');
}

export function uncloakElement(el: Element): void {
  el.removeAttribute(CLOAK_ATTR);
}

/** cloak 属性をすべて外す（style は別途外す） */
export function uncloakAll(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll(`[${CLOAK_ATTR}]`))) el.removeAttribute(CLOAK_ATTR);
}

// ---------------------------------------------------------------------------
// スクロールロックの復帰
// ---------------------------------------------------------------------------

/** html / body 1 つ分の overflow の記録 */
interface OverflowSnapshot {
  /** 記録時点で computed overflow が hidden だったか（= サイト本来の指定） */
  hidden: boolean;
  /** 記録時点の inline 値（戻すときはこれに戻す） */
  inline: string;
  priority: string;
}

export interface ScrollSnapshot {
  html: OverflowSnapshot;
  body: OverflowSnapshot;
}

const NO_OVERFLOW: OverflowSnapshot = { hidden: false, inline: '', priority: '' };

function computedOverflowHidden(doc: Document, el: Element | null): boolean {
  const view = doc.defaultView;
  if (!el || !view?.getComputedStyle) return false;
  try {
    const computed = view.getComputedStyle(el);
    return computed.overflow === 'hidden' || computed.overflowY === 'hidden';
  } catch {
    return false;
  }
}

function snapshotOf(doc: Document, el: Element | null): OverflowSnapshot {
  const style = el ? styleOf(el) : null;
  if (!el || !style) return { ...NO_OVERFLOW };
  return {
    hidden: computedOverflowHidden(doc, el),
    inline: style.getPropertyValue('overflow'),
    priority: style.getPropertyPriority('overflow'),
  };
}

/**
 * html / body の overflow を記録する（容器を検出する前に 1 度だけ呼ぶ）。
 * サイト本来の `overflow:hidden` を後から勝手に解除しないための基準。
 */
export function captureScroll(doc: Document): ScrollSnapshot {
  return {
    html: snapshotOf(doc, doc.documentElement),
    body: snapshotOf(doc, doc.body),
  };
}

/**
 * クラス付与型のロック（`body.modal-open { overflow: hidden }`）を解除するために当てる inline 値。
 * クラス側が `!important` のこともあるので、こちらも important で当てる。
 */
const OVERRIDE_VALUE = 'auto';
const OVERRIDE_PRIORITY = 'important';

/** 自分が inline override を当てた要素の目印 */
export const SCROLL_ATTR = 'data-cookie-autopilot-scroll';

/**
 * 自分が当てた inline override を外し、override 前の inline 値に戻す。
 * サイトが overflow を自分で上書きしていたら触らない。
 */
function releaseOverride(el: Element, snapshot: OverflowSnapshot): void {
  el.removeAttribute(SCROLL_ATTR);
  const style = styleOf(el);
  if (!style) return;
  if (style.getPropertyValue('overflow') !== OVERRIDE_VALUE) return;
  if (style.getPropertyPriority('overflow') !== OVERRIDE_PRIORITY) return;
  if (snapshot.inline === '') style.removeProperty('overflow');
  else style.setProperty('overflow', snapshot.inline, snapshot.priority);
}

/**
 * override を当てた要素の class / style がサイト側で変更されたら、一度だけ override を外して身を引く
 * （サイトが自分のモーダル用にロックし直すのを邪魔しないため）。
 * observe は override を当てたあとに張るので、自分の変更では発火しない。
 */
function watchOverride(doc: Document, el: Element, snapshot: OverflowSnapshot): void {
  const Observer = doc.defaultView?.MutationObserver;
  if (!Observer) return;
  const observer = new Observer(() => {
    observer.disconnect();
    releaseOverride(el, snapshot);
  });
  try {
    observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
  } catch {
    /* 監視できない環境では override をそのまま残す */
  }
}

/** inline の override（`overflow: auto !important`）を当てて、以後の変更を見張る */
function applyOverride(doc: Document, el: Element, snapshot: OverflowSnapshot): void {
  const style = styleOf(el);
  if (!style) return;
  style.setProperty('overflow', OVERRIDE_VALUE, OVERRIDE_PRIORITY);
  el.setAttribute(SCROLL_ATTR, '');
  watchOverride(doc, el, snapshot);
}

/**
 * スクロールすべき中身があるか。
 * `scrollHeight <= innerHeight` は「内部スクロール設計のサイト」なので、
 * html/body が hidden でも触らない（触ると二重スクロールになる）。
 */
function hasScrollableContent(doc: Document): boolean {
  const height = doc.defaultView?.innerHeight ?? 0;
  if (height <= 0) return false;
  const scroller = doc.scrollingElement ?? doc.documentElement;
  if (!scroller) return false;
  return scroller.scrollHeight > height + 1;
}

function restoreOne(doc: Document, el: Element | null, snapshot: OverflowSnapshot): void {
  if (!el) return;
  const style = styleOf(el);
  if (!style) return;
  if (!computedOverflowHidden(doc, el)) return;

  // 記録時点で既に hidden だった場合、通常はサイト本来の指定なので触らない。
  // ただし SSR で最初から `body.no-scroll` の cookie wall はこの経路に来るので、
  // 「スクロールすべき中身がある」ときだけ override で解除する（M-b）。
  if (snapshot.hidden) {
    if (hasScrollableContent(doc)) applyOverride(doc, el, snapshot);
    return;
  }

  // まず記録した inline 値に戻す（バナーが inline で掛けた overflow:hidden はこれで解ける）
  if (snapshot.inline === '') style.removeProperty('overflow');
  else style.setProperty('overflow', snapshot.inline, snapshot.priority);
  if (!computedOverflowHidden(doc, el)) return;

  // まだ hidden なら inline 以外（クラス付与）が原因なので、inline で上書きして解除する
  applyOverride(doc, el, snapshot);
}

/**
 * バナーがスクロールを止めていた場合だけ解除する。記録した inline 値に戻し、
 * それでも hidden のまま（クラス付与型のロック）なら inline の override を当てる。
 * snapshot が無いときは何もしない（サイト本来の hidden を上書きしないため）。
 */
export function restoreScroll(doc: Document, snapshot: ScrollSnapshot | null): void {
  if (!snapshot) return;
  restoreOne(doc, doc.documentElement, snapshot.html);
  restoreOne(doc, doc.body, snapshot.body);
}

/**
 * 容器を display:none にする（拒否できなかったときの fallback='hide'）。
 * バナーがスクロールを止めていた場合は html/body の overflow を戻す。
 */
export function hideElement(el: Element, doc: Document, snapshot: ScrollSnapshot | null): void {
  const style = styleOf(el);
  if (!style) return;
  // 元の inline display を覚えておく（`#modal-root { display:flex }` のようなサイトの
  // 指定を、hide を解除したときに失わないため）。二重に hide しても上書きしない
  if (!el.hasAttribute(HIDDEN_ATTR)) el.setAttribute(DISPLAY_ATTR, style.getPropertyValue('display'));
  el.setAttribute(HIDDEN_ATTR, '');
  el.removeAttribute(CLOAK_ATTR);
  style.setProperty('display', 'none', 'important');
  restoreScroll(doc, snapshot);
}

/** hide（display:none）を取り消し、hide する前の inline display に戻す */
export function unhideElement(el: Element): void {
  const previous = el.getAttribute(DISPLAY_ATTR) ?? '';
  el.removeAttribute(HIDDEN_ATTR);
  el.removeAttribute(DISPLAY_ATTR);
  const style = styleOf(el);
  if (!style) return;
  if (previous === '') style.removeProperty('display');
  else style.setProperty('display', previous);
}

/**
 * hide の対象が「バナー容器そのものではなく登った先の祖先」だったときの保険。
 * `#modal-root` のようなポータルルートにサイトが後からモーダルを描いても消えたままに
 * ならないよう、バナー以外の子要素が追加されたら祖先の hide だけ解除する
 * （バナー容器自身は別途 hide してあるので、解除してもバナーは出てこない）。
 */
export function watchHiddenAncestor(ancestor: Element, banner: Element, doc: Document): void {
  const Observer = doc.defaultView?.MutationObserver;
  if (!Observer) return;
  const observer = new Observer((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        // 要素だけを見る（テキストノードの追加では身を引かない）
        if (node.nodeType !== ELEMENT_NODE || node === banner) continue;
        if (node.contains(banner)) continue;
        observer.disconnect();
        unhideElement(ancestor);
        return;
      }
    }
  });
  try {
    observer.observe(ancestor, { childList: true });
  } catch {
    /* 監視できない環境では hide をそのまま残す */
  }
}

/**
 * hide（display:none）を一時的に外す / 戻す。
 * picker 中に「バナーを見せない」処理で消えた要素も選べるようにするため。
 */
export function setHiddenSuspended(doc: Document, suspended: boolean): void {
  for (const el of Array.from(doc.querySelectorAll(`[${HIDDEN_ATTR}]`))) {
    const style = styleOf(el);
    if (!style) continue;
    if (suspended) style.removeProperty('display');
    else style.setProperty('display', 'none', 'important');
  }
}
