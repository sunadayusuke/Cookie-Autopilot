// shadow DOM を横断する querySelector（docs/SPEC.md §5-5-d）
// 開いた shadow root のみ辿れる（closed は仕様上たどれない）。

const MAX_ELEMENTS = 20000;

function pushAll(target: Element[], list: ArrayLike<Element>): void {
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el) target.push(el);
  }
}

/**
 * root 自身が shadow ホストのときの shadow root。
 * `querySelectorAll('*')` は root 自身を含まないので、ホスト要素をそのまま root に
 * 渡されると（`#usercentrics-root` のような CMP のマウント点が容器になった場合）
 * 中のボタンを 1 つも拾えなかった。
 */
function ownShadowRoot(root: ParentNode): ShadowRoot | null {
  return (root as Element).shadowRoot ?? null;
}

export interface DeepQueryOptions {
  /**
   * root 自身の shadow root も見るか（既定 true）。
   * false にすると「root の光の DOM だけ」を探す（子孫が持つ shadow root には従来どおり入る）。
   * web components 製のボタン（`<wb7-button>` = Stencil の shadow: true）は shadow root の中に
   * 実装の `<button>` を持つので、「内側に別の候補があるならラッパー」の判定でそこを覗くと、
   * ボタン本体をラッパーだと誤認してしまう（§5-5-d）。
   */
  ownShadow?: boolean;
}

/** root 配下（shadow DOM を含む）から selector に一致する要素をすべて集める */
export function deepQueryAll(
  root: ParentNode | null | undefined,
  selector: string,
  options: DeepQueryOptions = {},
): Element[] {
  if (!root || selector.trim() === '') return [];
  const out: Element[] = [];
  // pop で取り出すので、light DOM を先に処理するために自身の shadow root は先に積む
  const own = options.ownShadow === false ? null : ownShadowRoot(root);
  const roots: ParentNode[] = own === null ? [root] : [own, root];
  let scanned = 0;

  while (roots.length > 0) {
    const current = roots.pop();
    if (!current) break;
    try {
      pushAll(out, current.querySelectorAll(selector));
    } catch {
      // 不正なセレクタは無視（ルール由来のセレクタが壊れている場合がある）
    }
    let hosts: NodeListOf<Element>;
    try {
      hosts = current.querySelectorAll('*');
    } catch {
      continue;
    }
    for (let i = 0; i < hosts.length; i++) {
      if (++scanned > MAX_ELEMENTS) return out;
      const shadow = hosts[i]?.shadowRoot;
      if (shadow) roots.push(shadow);
    }
  }
  return out;
}

/** 最初の 1 件（shadow DOM 横断） */
export function deepQueryFirst(root: ParentNode | null | undefined, selector: string): Element | null {
  return deepQueryAll(root, selector)[0] ?? null;
}

/** root 配下（shadow DOM を含む）のすべての要素 */
export function deepElements(root: ParentNode | null | undefined): Element[] {
  return deepQueryAll(root, '*');
}
