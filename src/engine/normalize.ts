// 文言の正規化（docs/SPEC.md §5-5-d）
// trim → 小文字化 → 全角英数記号を半角へ → 空白・不可視の書式文字・句読点を除去
// 依存なしのリーフモジュール（shared/phrases.ts からも使う）

/**
 * 除去する記号。ボタン文言の揺れ（"Don't accept" / "opt-out" / "Accept & Close"）を
 * 語彙の正規表現で書き分けずに済ませるため、意味を持たない約物はすべて落とす。
 * 全角は toHalfWidth で半角になるが、`’` `—` `…` `【】` のように U+FF01–U+FF5E の外に
 * ある記号は変換されないので、ここで直接列挙している。
 * `×` `✕` は CLOSE_EXACT の閉じるボタン文言なので残す。
 */
const PUNCTUATION = /[。！!.,、'’‘"“”?？…:：;；‐–—()（）[\]【】&＆+＋・»›«‹→-]/g;

/**
 * 除去する不可視の書式文字。Unicode が「描画しない」と定めた文字の集合
 * （Default_Ignorable_Code_Point。ソフトハイフン U+00AD `&shy;`・ゼロ幅スペース U+200B・
 * ゼロ幅（非）接合子 U+200C / U+200D・単語結合子 U+2060・方向制御 U+200E / U+200F /
 * U+202A–U+202E / U+2066–U+2069・異体字セレクタ U+FE0F・BOM U+FEFF など）をまとめて落とす。
 * BOM 以外は JS の `\s` に含まれないので空白の除去では消えず、`Un&shy;block all` が
 * `un\u00adblockall` のまま REJECT_STRONG の `(?<!un…)blockall` の否定後読みをすり抜けて
 * 拒否語として押されてしまう（Unblock は押すと同意になる）。LRM / RLM（U+200E / U+200F）は
 * RTL 対応の CMS が翻訳文言の前後に自動で挟むことがあり、攻撃でなくてもふつうに混ざる。
 * 1 文字ずつ列挙すると漏れた文字でまたすり抜けるので、プロパティでまとめて指定する。
 * 見た目の文言と照合結果を一致させるため、空白と同じ段で落とす。
 * normalize は語彙・禁止語・hideTarget のテキスト比較・カスタムルールのすべての照合に効くが、
 * どれも「見た目の文字列に近づく」方向の変化なので、禁止語の `De&shy;lete` もむしろ
 * 当たるようになる（安全側）。表示用の elementLabel はそのまま。
 */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;

/** 全角（U+FF01–U+FF5E）を半角へ。全角スペース U+3000 は \s に含まれるので除去側で処理される */
function toHalfWidth(text: string): string {
  return text.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

export function normalize(text: string | null | undefined): string {
  if (!text) return '';
  return toHalfWidth(text.trim().toLowerCase())
    .replace(/\s+/g, '')
    .replace(INVISIBLE, '')
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
