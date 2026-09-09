// 文言の正規化（docs/SPEC.md §5-5-d）
// trim → 小文字化 → 全角英数記号を半角へ → 空白と句読点を除去
// 依存なしのリーフモジュール（shared/phrases.ts からも使う）

/**
 * 除去する記号。ボタン文言の揺れ（"Don't accept" / "opt-out" / "Accept & Close"）を
 * 語彙の正規表現で書き分けずに済ませるため、意味を持たない約物はすべて落とす。
 * 全角は toHalfWidth で半角になるが、`’` `—` `…` `【】` のように U+FF01–U+FF5E の外に
 * ある記号は変換されないので、ここで直接列挙している。
 * `×` `✕` は CLOSE_EXACT の閉じるボタン文言なので残す。
 */
const PUNCTUATION = /[。！!.,、'’‘"“”?？…:：;；‐–—()（）[\]【】&＆+＋・»›«‹→-]/g;

/** 全角（U+FF01–U+FF5E）を半角へ。全角スペース U+3000 は \s に含まれるので除去側で処理される */
function toHalfWidth(text: string): string {
  return text.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

export function normalize(text: string | null | undefined): string {
  if (!text) return '';
  return toHalfWidth(text.trim().toLowerCase())
    .replace(/\s+/g, '')
    .replace(PUNCTUATION, '');
}

/** 表示用ラベルの上限。これを超えたら省略記号を付けて切る */
const MAX_LABEL_LENGTH = 80;

/** 要素の文言そのもの。innerText → value → aria-label → title の順（最後は textContent） */
function rawText(el: Element): string {
  const html = el as HTMLElement & { value?: unknown };
  return (
    (typeof html.innerText === 'string' && html.innerText) ||
    (typeof html.value === 'string' && html.value) ||
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.textContent ||
    ''
  );
}

/** 要素の文言を取り出して正規化する（照合用） */
export function elementText(el: Element): string {
  return normalize(rawText(el));
}

/**
 * 要素の文言を表示用に取り出す（popup の「『◯◯』を押しました」に使う）。
 * 正規化（小文字化・約物の除去）はせず、trim と連続空白の畳み込みだけを行う。
 */
export function elementLabel(el: Element): string {
  const label = rawText(el).trim().replace(/\s+/g, ' ');
  return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, MAX_LABEL_LENGTH)}…` : label;
}
