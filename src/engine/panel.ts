// 設定パネルを開いてチェックを外す層（docs/SPEC.md §5-5-e）
//
// 「設定」と「全てに同意」しか無い同意画面（断るボタンが無いもの）で、人間がやっている
// 「設定を押す → 分析・広告のチェックを外す → 選択を保存」を、サイト固有のセレクタを
// 持たずに汎用の手順として行う。誤操作（フォームの送信・必須項目の操作・関係ない
// モーダルの改変）の代償が大きいので、少しでも怪しければ**トグルに一切触れず**に
// 中止し、fallback（既定は非表示）へ落とす。

import {
  hasDangerousContext,
  isAmbiguousReject,
  isCloseWord,
  isForbiddenHard,
  isRejectMinimal,
  isRejectStrong,
  isSettingsButton,
} from '../shared/phrases';
import type { CategoryKey } from '../shared/types';
import { CATEGORY_KEYS } from '../shared/types';
import type { ButtonCandidate, ScoredCandidate } from './candidates';
import { collectButtons, navigatesAway } from './candidates';
import { deepQueryAll } from './deepQuery';
import type { DetectedContainer } from './detect';
import { MIN_HEIGHT, MIN_WIDTH, containsDeep, findContainers, wrapsPageStructure } from './detect';
import type { EngineEnv } from './env';
import { normalize } from './normalize';
import type { RunDeps, RunOutcome } from './run';

/** パネルの出現を待つ上限 */
export const PANEL_WAIT_MS = 2500;
/** 出現待ち・保存後の確認をする間隔 */
export const PANEL_POLL_MS = 250;
/** トグル 1 つごとの待ち（サイト側の再描画を待つ） */
export const PANEL_TOGGLE_WAIT_MS = 60;
/**
 * 触るトグルの上限。カテゴリ級だけを操作するときは数個で足りるが、
 * 入れ子のないパネル（カテゴリ級が見つからないパネル）では行数がそのまま効くので余裕を持たせる。
 */
export const PANEL_MAX_TOGGLES = 30;
/** 保存を押してからパネルが消えるのを待つ上限 */
export const PANEL_SAVE_WAIT_MS = 1500;
/** この層全体の時間予算 */
export const PANEL_BUDGET_MS = 6000;
/** 行テキストとして許す長さ（これ以上はパネル全体の文章なので使わない） */
export const MAX_ROW_TEXT_LENGTH = 400;
/** 行テキストを探して祖先を辿る上限 */
const MAX_ROW_DEPTH = 4;
/** パネル候補にする最小面積（容器の最小サイズと同じ） */
const MIN_PANEL_AREA = MIN_WIDTH * MIN_HEIGHT;
/**
 * 新しく現れたトグルからパネルを組み立てるときに、保存・閉じるボタンを探して
 * 祖先を辿る上限（§5-5-e の (c)）。無制限に登るとページ全体をパネルとみなしてしまう。
 */
const MAX_PANEL_CLIMB = 6;

/** Node.ELEMENT_NODE / Node.DOCUMENT_FRAGMENT_NODE（別 realm でも比較できるよう数値で持つ） */
const ELEMENT_NODE = 1;
const DOCUMENT_FRAGMENT_NODE = 11;

/** パネルにしてはいけない要素 */
const SKIP_TAGS = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'TEMPLATE']);

/**
 * トグル。radio は含めない（「許可する / 許可しない」のペアで意味が反転しうるので、
 * どちらを選べば拒否なのかを文言だけでは決められない）。
 * ラジオは「同じ name の 2 択で、片方が許可寄り・もう片方が拒否寄り」と読み切れるときだけ
 * 別経路（radioPairs）で扱う。
 */
export const TOGGLE_SELECTOR = 'input[type="checkbox"], [role="switch"], [aria-checked]';

/** ラジオ（許可 / 拒否のペア）。`role="radio"` は name が無くグループ化できないので含めない */
export const RADIO_SELECTOR = 'input[type="radio"]';

/** ラジオの「許可」側の行文言 */
export const RADIO_ALLOW_ROW = /許可|有効|オン|同意|accept|allow|on\b|enable/i;

/** ラジオの「拒否」側の行文言 */
export const RADIO_DENY_ROW = /拒否|無効|オフ|不同意|reject|deny|off\b|disable/i;

/**
 * 行の外側（＝パネルの操作部）に出てくるボタン。ラジオの行テキストを探して
 * 祖先を辿るとき、これを含む祖先まで登ったら「行ではなくパネル」とみなして止める。
 * リンクは行の中の「詳細」にも使われるので含めない。
 */
const PANEL_BUTTON_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"]';

/**
 * パネルにあったら中止する入力欄（フォームの誤操作よけ）。
 * checkbox / radio / hidden / button 系は同意画面の部品なので含めない。
 */
const FORM_INPUT_SELECTOR =
  'input[type="password"], input[type="email"], input[type="text"], input[type="tel"], input[type="number"], textarea';

/**
 * 必須（常に有効）の行。オフにできないうえ、押すとサイトが警告を出すことがあるので触らない。
 */
export const REQUIRED_ROW = /必須|必要|不可欠|essential|necessary|strictly|required|always\s*(?:active|on)|常に(?:有効|オン)/i;

/**
 * 「すべて選択する」行。パネルの先頭にある一括トグルで、部分選択の状態から押すと
 * **全部オンになる**（＝全許可）ことがあるので、どのモードでも絶対に触らない。
 */
export const SELECT_ALL_ROW =
  /すべて選択|全て選択|全部選択|select\s*all|すべてを?許可|全てを?許可|すべて同意|全て同意/i;

/**
 * 「すべて選択する」トグルの属性ヒント。行テキストが取れないときの保険。
 * `selected-all`（カテゴリが全選択状態であることを示す class）には当たらない。
 */
const SELECT_ALL_ATTRIBUTE = /select[-_ ]?all/i;

/**
 * 行テキストからのカテゴリ推定（最初に一致したものを採る）。
 * どれにも当たらなければ X（＝用途が分からないので許可しない）。
 */
const CATEGORY_PATTERNS: readonly (readonly [CategoryKey, RegExp])[] = [
  // 「広告の設定」のような行が A（設定|機能）に化けないよう、具体的な語から先に見る
  ['F', /広告|マーケティング|advertis|marketing|targeting|ad\s*(?:selection|delivery)/i],
  ['B', /分析|解析|統計|パフォーマンス|analytic|statistic|performance|measurement|測定/i],
  ['E', /コンテンツ|おすすめ|レコメンド|personali[sz]|content\s*selection/i],
  ['D', /端末|保存|ストレージ|storage|device|情報の保存/i],
  ['A', /設定|機能|functional|preference|comfort|パーソナライズ設定/i],
];

/**
 * 保存ボタンの文言。この経路に限り SOFT 禁止語（保存・save・apply）は適用しない
 * （Cookie 設定画面の「選択を保存」はまさに押したいボタンのため）。
 * HARD 禁止語（購入・削除・送信 submit・ログイン等）は従来どおり適用する
 * （唯一の例外は下の PANEL_SUBMIT_WORDS）。
 */
export const SAVE_WORDS =
  /選択を保存|設定を保存|設定の保存|選択の保存|選んだ設定を保存|この設定で保存|保存する|保存して閉じる|選択を許可|選択した.*を許可|選択を確定|確定|適用|save|apply|confirm|allow\s*selection|save\s*(?:and|&)\s*(?:close|exit)|選択を反映/i;

/**
 * 「設定を送信する」型の保存ボタン。**この層に限り** HARD 禁止語（`submit` / `送信`）の
 * 例外にする。TrustArc の "Submit preferences"「設定を送信」のように、送信という語で
 * 選択を確定させる CMP があり、そのままでは保存できずに中止していた。
 * 安全なのは次の 4 つが重なっているため:
 * ① この経路は**自分で開いた Cookie 設定パネルの中**しか見ない（バナー本体・ページ全体の
 *    ボタンには一切適用されない）
 * ② `abortReason()` が入力欄（password / email / text / tel / number / textarea）のある
 *    パネルを先に弾いているので、ログイン・検索・問い合わせフォームには到達しない
 * ③ 文言を「preferences / choices / settings / selection を submit する」型に限定している
 *    （裸の "Submit"「送信」は従来どおり HARD 禁止語のまま押さない）
 * ④ `abortReason()` の危険文脈語判定は、このパターンに一致する言い回しだけを取り除いた
 *    テキストに対して行う（`withoutSubmitPhrases()`）ので、「設定を送信」というボタンが
 *    あるだけではパネルを中止しない。「お問い合わせを送信」「アカウントを削除」のような
 *    本物の危険文脈はそのまま残るので、従来どおり中止の対象になる
 * 判定対象は normalize 済みの文言（ボタン）と正規化前の可視テキスト（パネル全体）の
 * どちらにも使うので、空白は `\s*` で受け、大文字小文字は `i` フラグで吸収する。
 */
export const PANEL_SUBMIT_WORDS =
  /submit\s*(?:my\s*)?(?:preferences?|choices?|settings?|selections?)|(?:設定|選択)を送信/i;

/**
 * パネル内の「すべてオフ」系。トグルを一括で落とすボタンなので拒否ボタンとして扱う。
 * `isRejectStrong`（「全て拒否」"Reject all"）が拾えない言い回し
 * （「すべてオフにする」「全ての項目を無効にする」"Turn all off"）を補うためのもので、
 * 保存語（SAVE_WORDS）とは別に持つ。判定対象は正規化済みの文言（空白は除去済み）。
 */
export const REJECT_ALL_TOGGLES =
  /(?:すべて|全て).*(?:オフ|無効|解除)|turn\s*all\s*off|disable\s*all/i;

/** 保存に使うボタン */
export interface SaveButton extends ButtonCandidate {
  /**
   * reject = 拒否・必要最小・すべてオフ系（トグルを触らずにこれを押す）/
   * save = 選択を保存 / close = 閉じる（保存ボタンが無いときの最後の手段）
   */
  kind: 'reject' | 'save' | 'close';
}

export interface PanelOptions {
  /** ヒューリスティックで採用中の容器 */
  container: DetectedContainer;
  /** 採点済みの候補（断る候補が無いことの確認に使う） */
  candidates: readonly ScoredCandidate[];
  /** 見つけたパネルを隠す（run.ts の cloak。ページ全体に及ぶ要素は拒否される） */
  cloak: (el: Element) => boolean;
}

export interface PanelResult {
  /** 成功したときの結果。無ければ中止（呼び出し側は fallback へ落とす） */
  outcome?: RunOutcome;
  /** 開いたパネル。中止したときも cloak / hide の対象に含める */
  panel?: Element;
}

// ---------------------------------------------------------------------------
// 文言の判定（単体テストしやすいよう小さく切ってある）
// ---------------------------------------------------------------------------

/** 空白を 1 つに畳んで trim する（行テキストの比較用） */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 必須（常に有効）の行か */
export function isRequiredRow(rowText: string): boolean {
  return rowText !== '' && REQUIRED_ROW.test(rowText);
}

/** 行テキストからカテゴリを推定する。分からなければ X */
export function categoryForRow(rowText: string): CategoryKey {
  for (const [key, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(rowText)) return key;
  }
  return 'X';
}

/**
 * そのカテゴリを許可したいか。
 * X（用途が分からない行）は実効カテゴリに入っていても許可しない
 * ——「その他」を許可する設定は「サイトが X と明示している項目」に対するもので、
 * こちらで分類できなかった行まで許可してよいという意味ではないため。
 */
export function wantsCategory(category: CategoryKey, allow: readonly CategoryKey[]): boolean {
  if (category === 'X') return false;
  return allow.includes(category);
}

/**
 * ラジオ 1 つの行文言がどちら側か。読み切れなければ null（＝そのグループには触らない）。
 * 「許可しない」「同意しない」は許可語に部分一致するので、**拒否側を先に見る**
 * （取り違えると「拒否したつもりで同意」になる）。
 */
export function radioSide(rowText: string): 'allow' | 'deny' | null {
  if (rowText === '') return null;
  if (RADIO_DENY_ROW.test(rowText) || isRejectStrong(normalize(rowText))) return 'deny';
  return RADIO_ALLOW_ROW.test(rowText) ? 'allow' : null;
}

// ---------------------------------------------------------------------------
// トグル
// ---------------------------------------------------------------------------

function parentElementOf(el: Element): Element | null {
  const parent: Node | null = el.parentNode;
  if (parent === null) return null;
  if (parent.nodeType === DOCUMENT_FRAGMENT_NODE) return (parent as ShadowRoot).host ?? null;
  return parent.nodeType === ELEMENT_NODE ? (parent as Element) : null;
}

function isCheckbox(el: Element): boolean {
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox';
}

/** radio は対象外（許可 / 拒否のペアで意味が反転しうる） */
function isRadio(el: Element): boolean {
  if (el.getAttribute('role') === 'radio') return true;
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio';
}

/**
 * root 配下のトグル。
 * 可視かどうかは見ない（カスタムスイッチは実体の input を `display:none` などで
 * 隠したうえで label を見せるため。押す先は clickTargetFor で決める）。
 */
export function collectToggles(root: ParentNode): Element[] {
  return deepQueryAll(root, TOGGLE_SELECTOR).filter((el) => !isRadio(el));
}

/**
 * root 配下の「カテゴリを選ぶ部品」。トグル + ラジオ（`input[type="radio"]`）。
 * パネルを**見つける**ためだけに使う（操作は collectToggles と radioPairs で分ける）。
 * ラジオしか無い設定パネルを取りこぼさないため。name でグループ化できない
 * `role="radio"` は含めない。
 */
export function collectControls(root: ParentNode): Element[] {
  return deepQueryAll(root, `${TOGGLE_SELECTOR}, ${RADIO_SELECTOR}`).filter(
    (el) => !isRadio(el) || (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio'),
  );
}

/** 操作してはいけないトグルか（無効・読み取り専用） */
export function isToggleLocked(el: Element): boolean {
  if (el.hasAttribute('disabled') || el.hasAttribute('readonly')) return true;
  return el.getAttribute('aria-disabled') === 'true';
}

/** 今オンか。checkbox は checked、それ以外は aria-checked */
export function toggleState(el: Element): boolean {
  if (isCheckbox(el)) return (el as HTMLInputElement).checked === true;
  return el.getAttribute('aria-checked') === 'true';
}

/**
 * トグルの行テキスト。トグルから最大 4 階層上まで祖先を辿り、
 * 「他のトグルを含まない」「テキストが取れる（400 文字未満）」最小の祖先のものを使う。
 * 取れなければ aria-label / title / name / id で代用する。
 */
export function rowTextFor(toggle: Element, toggles: readonly Element[], env: EngineEnv): string {
  let current = parentElementOf(toggle);
  for (let depth = 0; current !== null && depth < MAX_ROW_DEPTH; depth++) {
    const ancestor = current;
    if (toggles.some((other) => other !== toggle && containsDeep(ancestor, other))) break;
    const text = collapse(env.getText(ancestor));
    if (text.length >= MAX_ROW_TEXT_LENGTH) break;
    if (text !== '') return text;
    current = parentElementOf(ancestor);
  }
  const attribute =
    toggle.getAttribute('aria-label') ??
    toggle.getAttribute('title') ??
    toggle.getAttribute('name') ??
    toggle.getAttribute('id') ??
    '';
  return collapse(attribute);
}

/**
 * 「すべて選択する」系のトグルか。行テキスト、または `data-test` / id / class で見る。
 * 部分選択の状態でこれを押すと全部オンになる（＝全許可）ので、一切触らない。
 */
export function isSelectAllToggle(toggle: Element, rowText: string): boolean {
  if (rowText !== '' && SELECT_ALL_ROW.test(rowText)) return true;
  const attributes = `${toggle.getAttribute('data-test') ?? ''} ${toggle.id} ${toggle.getAttribute('class') ?? ''}`;
  return SELECT_ALL_ATTRIBUTE.test(attributes);
}

/**
 * トグルの「区画」。トグルから最大 4 階層上まで祖先を辿り、
 * ほかのトグルを含む最小の祖先を返す（無ければ null）。
 */
function sectionFor(toggle: Element, toggles: readonly Element[]): Element | null {
  let current = parentElementOf(toggle);
  for (let depth = 0; current !== null && depth < MAX_ROW_DEPTH; depth++) {
    const ancestor = current;
    if (toggles.some((other) => other !== toggle && containsDeep(ancestor, other))) return ancestor;
    current = parentElementOf(ancestor);
  }
  return null;
}

/** ancestor から el までの親の数（含まれていなければ -1） */
function depthWithin(ancestor: Element, el: Element): number {
  let depth = 0;
  for (let current: Element | null = el; current !== null; current = parentElementOf(current)) {
    if (current === ancestor) return depth;
    depth++;
  }
  return -1;
}

/**
 * カテゴリ級のトグル（入れ子のパネルで「カテゴリ全体」を切り替える側）。
 * 実サイトの設定パネルは「カテゴリのチェックボックス 4 件 + その配下に個別サービスの
 * チェックボックス数十件」という入れ子になっていることがあり、全部を対象にすると上限に
 * 掛かるうえ、カテゴリ側を切れば配下も一緒に落ちるので個別トグルを触る必要がない。
 * 判定は「そのトグルが区画（sectionFor）の**最初**のトグルで、同じ区画にあるほかのトグルが
 * **すべて自分より深い**（＝自分の下にぶら下がっている）」こと。
 * 同じ深さで並ぶだけのトグル（ふつうの 1 段パネル）はカテゴリ級にならないので、
 * その場合は呼び出し側が従来どおり全トグルを扱う。
 */
export function categoryToggles(toggles: readonly Element[]): Element[] {
  return toggles.filter((toggle) => {
    // 区画が取れた時点で「ほかのトグルを含む」ことは保証されている（sectionFor）
    const section = sectionFor(toggle, toggles);
    if (section === null) return false;
    const inside = toggles.filter((other) => containsDeep(section, other));
    if (inside[0] !== toggle) return false;
    const depth = depthWithin(section, toggle);
    return inside.every((other) => other === toggle || depthWithin(section, other) > depth);
  });
}

/**
 * 実際にクリックする要素。
 * input が不可視（カスタムスイッチ）なら `label[for=id]` か祖先の label を押す。
 */
export function clickTargetFor(toggle: Element, panel: ParentNode, env: EngineEnv): Element {
  if (toggle.tagName !== 'INPUT' || env.isVisible(toggle)) return toggle;
  const id = toggle.getAttribute('id');
  if (id !== null && id !== '') {
    // id のエスケープを避けるため、label[for] を集めてから突き合わせる
    const label = deepQueryAll(panel, 'label[for]').find((el) => el.getAttribute('for') === id);
    if (label) return label;
  }
  const ancestor = typeof toggle.closest === 'function' ? toggle.closest('label') : null;
  return ancestor ?? toggle;
}

/**
 * 「操作できる」部品（押す先が見えているトグル・ラジオ）。
 * 設定ボタンの前後でこの数を比べ、増えていればパネルが開いたとみなす（§5-5-e のパネル検出）。
 * 容器が新しいかどうかで見ると、アコーディオンのように**容器としては元から可視**のまま
 * 中身だけが開くパネルを拾えないため。
 */
export function reachableControls(root: ParentNode, env: EngineEnv): Element[] {
  return collectControls(root).filter((el) => env.isVisible(clickTargetFor(el, root, env)));
}

// ---------------------------------------------------------------------------
// ラジオ（許可 / 拒否のペア）
// ---------------------------------------------------------------------------

/** 許可 / 拒否の 2 択で出ているカテゴリ 1 行分 */
export interface RadioPair {
  /** 許可側のラジオ */
  allow: Element;
  /** 拒否側のラジオ */
  deny: Element;
  /** グループの行テキスト（カテゴリ推定・必須系の判定に使う） */
  rowText: string;
  /** 行テキストから推定したカテゴリ */
  category: CategoryKey;
}

/** ラジオが選ばれているか */
function radioChecked(el: Element): boolean {
  return (el as HTMLInputElement).checked === true;
}

/** a と b の両方を含む最小の祖先（shadow の境界も跨ぐ） */
function commonAncestorOf(a: Element, b: Element): Element | null {
  for (let current = parentElementOf(a); current !== null; current = parentElementOf(current)) {
    if (containsDeep(current, b)) return current;
  }
  return null;
}

/**
 * ラジオのグループの行テキスト。2 つのラジオの共通祖先から最大 4 階層上まで辿り、
 * 「ほかのグループのラジオ・トグルを含まない」「400 文字未満」の祖先を見る。
 * トグルの rowTextFor と違って**カテゴリ名が取れるまで登る**のは、共通祖先が
 * `<div class="options">[許可][拒否]</div>` のように選択肢だけを囲んでいることがあり、
 * そこで止めるとカテゴリが必ず X（＝許可しない）になってしまうため。
 * ほかのグループを含む祖先では止めるので、隣の行の名前を拾うことはない。
 * ボタンを含む祖先でも止める。グループが 1 つしか無いパネルで登りすぎると、
 * パネル全体の見出し（「Cookie の設定」）からカテゴリを引いて**許可側を選んでしまう**ため
 * （引けなければ X ＝拒否側なので、止めるほうが安全側）。
 */
function groupRowText(allow: Element, deny: Element, others: readonly Element[], env: EngineEnv): string {
  let fallback = '';
  let current = commonAncestorOf(allow, deny);
  for (let depth = 0; current !== null && depth < MAX_ROW_DEPTH; depth++) {
    const ancestor = current;
    if (others.some((other) => containsDeep(ancestor, other))) break;
    if (deepQueryAll(ancestor, PANEL_BUTTON_SELECTOR).length > 0) break;
    const text = collapse(env.getText(ancestor));
    if (text.length >= MAX_ROW_TEXT_LENGTH) break;
    if (text !== '') {
      if (categoryForRow(text) !== 'X') return text;
      // カテゴリが引けないまま登り切ったときは、いちばん外側（＝行の名前まで含む）を使う。
      // 必須系・「すべて選択」の判定に効かせるため。カテゴリはどれを採っても X なので変わらない
      fallback = text;
    }
    current = parentElementOf(ancestor);
  }
  return fallback !== '' ? fallback : collapse(allow.getAttribute('name') ?? '');
}

/**
 * パネル内のラジオを同じ `name` でグループ化し、「許可 / 拒否」の 2 択になっているものだけ返す。
 * 3 つ以上の選択肢や、片側しか読み切れないグループは**触らない**
 * （どちらを選べば拒否なのかを決められないため）。
 */
export function radioPairs(panel: Element, env: EngineEnv): RadioPair[] {
  const radios = deepQueryAll(panel, RADIO_SELECTOR).filter(
    (radio) => (radio.getAttribute('name') ?? '') !== '',
  );
  if (radios.length === 0) return [];

  const groups = new Map<string, Element[]>();
  for (const radio of radios) {
    const name = radio.getAttribute('name') ?? '';
    const found = groups.get(name);
    if (found) found.push(radio);
    else groups.set(name, [radio]);
  }

  const toggles = collectToggles(panel);
  const pairs: RadioPair[] = [];
  for (const options of groups.values()) {
    // ちょうど 2 択のときだけ扱う
    if (options.length !== 2) continue;
    const [first, second] = options as [Element, Element];
    const sides = [radioSide(rowTextFor(first, radios, env)), radioSide(rowTextFor(second, radios, env))];
    const allowIndex = sides.indexOf('allow');
    const denyIndex = sides.indexOf('deny');
    // 片側しか判定できない（＝両方が同じ側 / どちらも読めない）グループは触らない
    if (allowIndex < 0 || denyIndex < 0) continue;

    const allow = options[allowIndex] as Element;
    const deny = options[denyIndex] as Element;
    const others = [...radios.filter((radio) => radio !== allow && radio !== deny), ...toggles];
    const rowText = groupRowText(allow, deny, others, env);
    pairs.push({ allow, deny, rowText, category: categoryForRow(rowText) });
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// ボタン
// ---------------------------------------------------------------------------

/**
 * 容器の中の設定ボタン。実ページへのリンク（とその中の要素）と HARD 禁止語は除く。
 * 容器内で最初に出てくるものを使う。
 * collectButtons は Cookie の容器では強い決定語のリンクを候補に含めるようになったので
 * （§5-5-d）、この層では自前で `navigatesAway` を確かめる。押すと設定パネルではなく
 * 別ページが開いてしまい、以降の手順が全部空振りするため。
 */
export function findSettingsButton(buttons: readonly ButtonCandidate[]): ButtonCandidate | null {
  return (
    buttons.find(
      (button) =>
        isSettingsButton(button.text) && !isForbiddenHard(button.text) && !navigatesAway(button.el),
    ) ?? null
  );
}

/**
 * 可視テキストから PANEL_SUBMIT_WORDS に一致する言い回しだけを取り除く。
 * `panelButtons()` の HARD 禁止語判定と `abortReason()` の危険文脈語判定の両方で使う。
 * `送信` は HARD 禁止語であり危険文脈語でもあるので、除かずに見ると「設定を送信」という
 * ボタンがあるだけで免除・中止のどちらも過剰に効いてしまう。取り除くのは PANEL_SUBMIT_WORDS
 * に一致する言い回しだけなので、「お問い合わせを送信」「アカウントを削除」のような
 * 本物の危険文脈・禁止語は残る。
 * `g` 付き正規表現の lastIndex を呼び出しをまたいで持ち回らないよう、
 * 呼び出しごとに RegExp を生成する。
 */
function withoutSubmitPhrases(text: string): string {
  return text.replace(new RegExp(PANEL_SUBMIT_WORDS.source, 'gi'), '');
}

/**
 * パネルの中で押す候補にしてよいボタン（文言あり・HARD 禁止語なし・曖昧な拒否でない）。
 * 免除するのは submit 句（PANEL_SUBMIT_WORDS）そのものだけ。「設定を送信して登録」
 * "Submit my choices and subscribe" のように submit 句と別の HARD 禁止語（登録・subscribe 等）が
 * 同居するラベルは、submit 句を取り除いた残りにその禁止語が残るので従来どおり押さない。
 */
function panelButtons(panel: Element, env: EngineEnv): ButtonCandidate[] {
  return collectButtons(panel, env).filter(
    (button) =>
      button.text !== '' &&
      !isForbiddenHard(withoutSubmitPhrases(button.text)) &&
      !isAmbiguousReject(button.text),
  );
}

/** 拒否ボタン扱いにする文言か（拒否語・必要最小系・「すべてオフ」系） */
function isPanelReject(text: string): boolean {
  return isRejectStrong(text) || isRejectMinimal(text) || REJECT_ALL_TOGGLES.test(text);
}

/**
 * パネルの中の「保存に使えるボタン」。
 * a. 拒否語・必要最小系・「すべてオフ」系があればそれ（トグルを触らずに押せるので、より確実で安全）
 * b. 無ければ保存語か「設定を送信」型（PANEL_SUBMIT_WORDS）
 * どちらも「すべて許可」の言い回しを含むのに否定形が無いもの（"すべて許可して保存"）は
 * 押さない（isAmbiguousReject）。HARD 禁止語も b の例外を除いて押さない。
 */
export function findSaveButton(panel: Element, env: EngineEnv): SaveButton | null {
  const buttons = panelButtons(panel, env);
  const reject = buttons.find((button) => isPanelReject(button.text));
  if (reject) return { ...reject, kind: 'reject' };
  const save = buttons.find(
    (button) => SAVE_WORDS.test(button.text) || PANEL_SUBMIT_WORDS.test(button.text),
  );
  return save ? { ...save, kind: 'save' } : null;
}

/**
 * パネルの中の「閉じる」ボタン（閉じる語の完全一致）。
 * 保存ボタンが無いときの最後の手段で、**トグルを切ると即座に反映される** CMP 向け
 * （保存の手段が本当に無ければ、従来どおりトグルに触れず中止する）。
 */
export function findCloseButton(panel: Element, env: EngineEnv): SaveButton | null {
  const close = panelButtons(panel, env).find((button) => isCloseWord(button.text));
  return close ? { ...close, kind: 'close' } : null;
}

// ---------------------------------------------------------------------------
// パネルの検出
// ---------------------------------------------------------------------------

/** 退場したか（押した結果を確かめる。run.ts の isGone の見張り側と同じ判定） */
function isDismissed(el: Element, env: EngineEnv): boolean {
  if (!el.isConnected || !env.isVisible(el)) return true;
  if (env.isOffscreen(el)) return true;
  return env.isFaded(el);
}

/**
 * パネルになり得る容器か。
 * findContainers が拾った容器（＝バナーと同じ条件）か、role=dialog / aria-modal /
 * position:fixed で十分な面積がある可視要素。サイト本体を巻き込む要素は除く。
 */
function isPanelContainer(el: Element, containers: ReadonlySet<Element>, env: EngineEnv): boolean {
  if (SKIP_TAGS.has(el.tagName)) return false;
  if (!env.isVisible(el)) return false;
  if (wrapsPageStructure(el)) return false;
  if (containers.has(el)) return true;
  const rect = env.getRect(el);
  if (rect.width * rect.height < MIN_PANEL_AREA) return false;
  if (el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true') return true;
  return env.getPosition(el) === 'fixed';
}

/**
 * 容器の外にある「トグルを含む可視の容器」をすべて集める。
 * 設定ボタンを押す前後で 2 回呼び、押す前から見えていたものは候補から外す（§5-5-e の
 * 「**新しい**可視の容器」）。ページに元からある固定ウィジェット（通知設定のパネルなど）を
 * Cookie の設定パネルと取り違えて操作しないため。
 */
export function panelCandidates(origin: Element, deps: RunDeps): Element[] {
  const { doc, env } = deps;
  const toggles = collectControls(doc).filter((toggle) => !containsDeep(origin, toggle));
  if (toggles.length === 0) return [];

  const containers = new Set(findContainers(doc, env).map((container) => container.el));
  const seen = new Set<Element>();
  const found: Element[] = [];
  for (const toggle of toggles) {
    for (let el = parentElementOf(toggle); el !== null; el = parentElementOf(el)) {
      if (seen.has(el)) break;
      seen.add(el);
      if (el !== origin && isPanelContainer(el, containers, env)) found.push(el);
    }
  }
  return found;
}

/** 設定ボタンを押す前の様子（開いたパネルかどうかの判定に使う） */
export interface PanelBefore {
  /** 押す前から見えていたパネル候補（＝開いたパネルではない） */
  containers: ReadonlySet<Element>;
  /** 押す前から操作できたトグル・ラジオ */
  controls: ReadonlySet<Element>;
}

/** 何も押していない状態（テストや既定値用） */
const NOTHING_BEFORE: PanelBefore = { containers: new Set(), controls: new Set() };

/**
 * 新しく操作できるようになったトグルからパネルを組み立てる（(c) の経路）。
 * トグル群を含む最小の共通祖先から、保存・閉じるボタンを含む祖先まで登ったものをパネルとする
 * （共通祖先のままだと保存ボタンが外に出て中止になってしまう）。
 * ページ全体をパネルにしないよう、登れるのは MAX_PANEL_CLIMB 階層まで。
 */
function panelFromNewToggles(deps: RunDeps, before: PanelBefore): Element | null {
  const { doc, env } = deps;
  const now = reachableControls(doc, env);
  // 「押す前に見えていたトグルの数より増えた」ことが検出条件
  if (now.length <= before.controls.size) return null;
  const appeared = now.filter((toggle) => !before.controls.has(toggle));
  const first = appeared[0];
  if (!first) return null;

  let common: Element | null = parentElementOf(first);
  for (const toggle of appeared) {
    while (common !== null && !containsDeep(common, toggle)) common = parentElementOf(common);
  }

  let candidate: Element | null = common;
  for (let depth = 0; candidate !== null && depth <= MAX_PANEL_CLIMB; depth++) {
    const el: Element = candidate;
    if (SKIP_TAGS.has(el.tagName) || wrapsPageStructure(el)) return null;
    if (env.isVisible(el) && (findSaveButton(el, env) !== null || findCloseButton(el, env) !== null)) return el;
    candidate = parentElementOf(el);
  }
  return null;
}

/**
 * 開いたパネルを探す。
 * (a) 元の容器の中にトグルが現れた（その場展開）か、
 * (b) 設定ボタンを押して新しく見えるようになった容器にトグルがある、
 * (c) 容器としては元から可視でも、操作できるトグルが増えた（アコーディオンのその場展開）。
 * (b) の候補が複数あるときは「保存・閉じるに使えるボタンも含む最小の容器」を優先する
 * （トグルだけを囲む内側の div を選ぶと、保存ボタンが外に出て中止になってしまうため）。
 */
export function findPanel(
  origin: Element,
  deps: RunDeps,
  /** 設定ボタンを押す前の様子（これと変わっていないものはパネルではない） */
  before: PanelBefore = NOTHING_BEFORE,
): Element | null {
  const { env } = deps;
  if (collectControls(origin).length > 0) return origin;

  const found = panelCandidates(origin, deps)
    .filter((el) => !before.containers.has(el))
    .map((el) => {
      const rect = env.getRect(el);
      return {
        el,
        area: rect.width * rect.height,
        savable: findSaveButton(el, env) !== null,
        closable: findCloseButton(el, env) !== null,
      };
    });
  found.sort(
    (a, b) =>
      Number(b.savable) - Number(a.savable) || Number(b.closable) - Number(a.closable) || a.area - b.area,
  );
  return found[0]?.el ?? panelFromNewToggles(deps, before);
}

/** パネルが出てくるのを待つ（最大 PANEL_WAIT_MS、PANEL_POLL_MS 間隔） */
async function waitForPanel(
  origin: Element,
  deps: RunDeps,
  until: number,
  before: PanelBefore,
): Promise<Element | null> {
  const { env, state } = deps;
  for (let waited = PANEL_POLL_MS; waited <= PANEL_WAIT_MS; waited += PANEL_POLL_MS) {
    await env.sleep(PANEL_POLL_MS);
    if (state.cancelled || env.now() > until) return null;
    const panel = findPanel(origin, deps, before);
    if (panel) return panel;
  }
  return null;
}

/**
 * トグルに触ってはいけないパネルか（該当したら理由を返す）。
 * 「保存に使えるボタンが無い」は呼び出し側で先に確かめてある。
 */
function abortReason(panel: Element, deps: RunDeps): string | null {
  if (deepQueryAll(panel, FORM_INPUT_SELECTOR).length > 0) return '入力欄がある';
  if (hasDangerousContext(withoutSubmitPhrases(deps.env.getText(panel)))) return '危険文脈語がある';
  return null;
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

/** この層を試してよいか（§5-5-e の発動条件。設定ボタンの有無は呼び出し側で見る） */
export function shouldTryPanel(
  deps: RunDeps,
  container: DetectedContainer,
  candidates: readonly ScoredCandidate[],
): boolean {
  if (deps.mode !== 'reject') return false;
  if (deps.state.panelTried) return false;
  if (!container.cookieSpecific) {
    deps.env.trace('設定パネル: 試さない（Cookie バナーと言い切れない容器）');
    return false;
  }
  // 監視窓の残りが時間予算に満たないなら試さない。途中で打ち切られると
  // 「設定パネルを開いたまま監視窓が終わって、そのパネルを見せてしまう」ため
  const windowEnd = deps.state.startedAt + deps.settings.observeSeconds * 1000;
  if (deps.env.now() + PANEL_BUDGET_MS > windowEnd) {
    deps.env.debug('パネル: 監視窓の残りが足りないので開かない');
    deps.env.trace('設定パネル: 試さない（監視窓の残りが足りない）');
    return false;
  }
  return !candidates.some((candidate) => candidate.kind === 'reject-strong' || candidate.kind === 'reject-minimal');
}

/** パネルの見分け（`DIV#cookie-settings.cookie-settings-content`）。進行ログ用（§5-8） */
function describePanel(el: Element): string {
  const id = el.id === '' ? '' : `#${el.id}`;
  const classes = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter((name) => name !== '');
  return `${el.tagName}${id}${classes.length > 0 ? `.${classes.slice(0, 3).join('.')}` : ''}`;
}

/** 押したボタンから成功時の結果を組み立てる */
function outcomeFor(save: SaveButton, allowed: CategoryKey[]): RunOutcome {
  return {
    status: 'handled',
    method: 'panel',
    action: 'reject',
    clickedText: save.text,
    clickedLabel: save.label,
    decision: 'granular',
    allowed,
  };
}

/** ボタンを押して、容器とパネルの両方が消えるのを待つ */
async function clickAndWaitGone(
  el: Element,
  watch: readonly Element[],
  deps: RunDeps,
  until: number,
): Promise<boolean> {
  const { env, state } = deps;
  (el as HTMLElement).click?.();
  for (let waited = PANEL_POLL_MS; waited <= PANEL_SAVE_WAIT_MS; waited += PANEL_POLL_MS) {
    await env.sleep(PANEL_POLL_MS);
    if (state.cancelled || env.now() > until) return false;
    if (watch.every((target) => isDismissed(target, env))) return true;
  }
  return false;
}

/** トグルを望む状態に揃える。打ち切られたら false */
async function applyToggles(
  panel: Element,
  toggles: readonly Element[],
  rows: ReadonlyMap<Element, CategoryKey>,
  deps: RunDeps,
  until: number,
): Promise<boolean> {
  const { env, state } = deps;
  for (const toggle of toggles.slice(0, PANEL_MAX_TOGGLES)) {
    const category = rows.get(toggle) ?? 'X';
    const wanted = wantsCategory(category, deps.allowCategories);
    if (toggleState(toggle) !== wanted) {
      const target = clickTargetFor(toggle, panel, env);
      env.debug('パネル: トグルを操作', category, wanted ? 'on' : 'off');
      (target as HTMLElement).click?.();
    }
    await env.sleep(PANEL_TOGGLE_WAIT_MS);
    if (state.cancelled || env.now() > until) return false;
  }
  return true;
}

/**
 * ラジオ（許可 / 拒否のペア）を望む状態に揃える。打ち切られたら false。
 * 既に望む側が選ばれていれば触らない。
 */
async function applyRadioPairs(
  panel: Element,
  pairs: readonly RadioPair[],
  deps: RunDeps,
  until: number,
): Promise<boolean> {
  const { env, state } = deps;
  for (const pair of pairs.slice(0, PANEL_MAX_TOGGLES)) {
    const wanted = wantsCategory(pair.category, deps.allowCategories);
    const target = wanted ? pair.allow : pair.deny;
    if (!radioChecked(target)) {
      env.debug('パネル: ラジオを選ぶ', pair.category, wanted ? 'allow' : 'deny');
      (clickTargetFor(target, panel, env) as HTMLElement).click?.();
    }
    await env.sleep(PANEL_TOGGLE_WAIT_MS);
    if (state.cancelled || env.now() > until) return false;
  }
  return true;
}

/** 操作したあとにオンのまま残ったカテゴリ（報告用） */
function allowedCategories(
  toggles: readonly Element[],
  rows: ReadonlyMap<Element, CategoryKey>,
  pairs: readonly RadioPair[],
): CategoryKey[] {
  const allowed = new Set<CategoryKey>();
  for (const toggle of toggles.slice(0, PANEL_MAX_TOGGLES)) {
    if (toggleState(toggle)) allowed.add(rows.get(toggle) ?? 'X');
  }
  for (const pair of pairs.slice(0, PANEL_MAX_TOGGLES)) {
    if (radioChecked(pair.allow)) allowed.add(pair.category);
  }
  return CATEGORY_KEYS.filter((key) => allowed.has(key));
}

/**
 * 設定パネルを開いて選択を保存する（§5-5-e）。
 * 戻り値が null ならこの層は動いていない。`panel` だけを返したときは中止したので、
 * 呼び出し側は fallback（非表示 / そのまま）にパネルも含めること。
 */
export async function tryPanel(deps: RunDeps, options: PanelOptions): Promise<PanelResult | null> {
  const { container, candidates, cloak } = options;
  const { env, state } = deps;
  if (!shouldTryPanel(deps, container, candidates)) return null;

  const settings = findSettingsButton(container.buttons);
  if (!settings) {
    env.debug('パネル: 設定ボタンが無いので開かない');
    env.trace('設定パネル: 試さない（容器に設定ボタンが無い）');
    return null;
  }

  state.panelTried = true;
  const until = env.now() + PANEL_BUDGET_MS;
  // 押す前から見えていた候補・操作できたトグルは「開いたパネル」ではないので覚えておく
  const before: PanelBefore = {
    containers: new Set(panelCandidates(container.el, deps)),
    controls: new Set(reachableControls(deps.doc, env)),
  };
  env.debug('パネル: 設定ボタンを押す', settings.label);
  env.trace(`設定パネル: 「${settings.label}」を押して開く`);
  state.tried.add(settings.el);
  (settings.el as HTMLElement).click?.();

  const panel = await waitForPanel(container.el, deps, until, before);
  if (!panel) {
    env.debug('パネル: 出てこなかった');
    env.trace('設定パネル: 中止（パネルが出てこない）');
    return null;
  }
  if (panel !== container.el) cloak(panel);
  env.trace(`設定パネル: ${describePanel(panel)} トグル ${collectControls(panel).length} 件`);

  const reason = abortReason(panel, deps);
  if (reason !== null) {
    env.debug('パネル: 触らずに中止', reason);
    env.trace(`設定パネル: 中止（${reason}）`);
    return { panel };
  }

  // 保存に使えるボタンが無ければ、変更を確定できないのでトグルに触らない。
  // ただし「閉じる」があれば、トグルが即座に反映される型の CMP かもしれないので最後の手段に残す
  const save = findSaveButton(panel, env) ?? findCloseButton(panel, env);
  if (!save) {
    env.debug('パネル: 保存に使えるボタンが無い');
    env.trace('設定パネル: 中止（保存にも閉じるにも使えるボタンが無い）');
    return { panel };
  }

  // 拒否ボタンがあるならトグルは触らない（そちらの方が確実で安全）
  if (save.kind === 'reject') {
    env.debug('パネル: 拒否ボタンを押す', save.label);
    state.tried.add(save.el);
    const ok = await clickAndWaitGone(save.el, [container.el, panel], deps, until);
    env.trace(`設定パネル: 「${save.label}」を押した → ${ok ? '成功' : '失敗（押しても消えない）'}`);
    return ok ? { outcome: outcomeFor(save, []), panel } : { panel };
  }

  const all = collectToggles(panel);
  const rowTexts = new Map<Element, string>();
  for (const toggle of all) rowTexts.set(toggle, rowTextFor(toggle, all, env));

  // カテゴリ級が見つかったらそれだけを操作する（配下の個別トグルはカテゴリ側に従うので触らない）。
  // 「すべて選択する」はどちらの経路でも対象外
  const categories = categoryToggles(all).filter(
    (toggle) => !isSelectAllToggle(toggle, rowTexts.get(toggle) ?? ''),
  );
  if (categories.length > 0) env.debug('パネル: カテゴリ級のトグルだけを操作する', categories.length);
  const scope = categories.length > 0 ? categories : all;

  const rows = new Map<Element, CategoryKey>();
  const touchable: Element[] = [];
  let locked = 0;
  for (const toggle of scope) {
    const rowText = rowTexts.get(toggle) ?? '';
    if (isRequiredRow(rowText) || isSelectAllToggle(toggle, rowText)) continue;
    if (isToggleLocked(toggle)) {
      locked++;
      continue;
    }
    rows.set(toggle, categoryForRow(rowText));
    touchable.push(toggle);
  }

  // 許可 / 拒否のラジオで出ているカテゴリ（必須系・「すべて選択」・操作できないものは除く）
  const pairs = radioPairs(panel, env).filter(
    (pair) =>
      !isToggleLocked(pair.allow) &&
      !isToggleLocked(pair.deny) &&
      !isRequiredRow(pair.rowText) &&
      !isSelectAllToggle(pair.allow, pair.rowText),
  );

  if (touchable.length === 0 && pairs.length === 0) {
    env.debug('パネル: 触れるトグルが無い');
    env.trace(`設定パネル: 中止（触れるトグルが無い。全 ${all.length} 件 / 操作できない ${locked} 件）`);
    return { panel };
  }

  // 保存できないのに操作できないトグルが残るパネルは、結果を確かめようが無いので触らない
  if (save.kind === 'close' && locked > 0) {
    env.debug('パネル: 保存ボタンが無く、操作できないトグルがある', locked);
    env.trace(`設定パネル: 中止（保存ボタンが無く、操作できないトグルが ${locked} 件ある）`);
    return { panel };
  }

  env.trace(
    `設定パネル: 触るのは ${touchable.length + pairs.length} 件` +
      `（${categories.length > 0 ? 'カテゴリ級' : '全トグル'}）` +
      ` [${touchable.map((toggle) => `${collapse(rowTexts.get(toggle) ?? '')}=${rows.get(toggle) ?? 'X'}`).join(' / ')}]`,
  );
  if (!(await applyToggles(panel, touchable, rows, deps, until))) {
    env.debug('パネル: 予算切れ / 打ち切り');
    env.trace('設定パネル: 中止（予算切れ / 打ち切り）');
    return { panel };
  }
  if (!(await applyRadioPairs(panel, pairs, deps, until))) {
    env.debug('パネル: 予算切れ / 打ち切り');
    env.trace('設定パネル: 中止（予算切れ / 打ち切り）');
    return { panel };
  }

  const allowed = allowedCategories(touchable, rows, pairs);
  env.debug(save.kind === 'close' ? 'パネル: 閉じる' : 'パネル: 選択を保存', save.label, allowed);
  state.tried.add(save.el);
  const ok = await clickAndWaitGone(save.el, [container.el, panel], deps, until);
  env.trace(
    `設定パネル: 「${save.label}」を押した → ${ok ? `成功（残したのは ${allowed.length > 0 ? allowed.join(' / ') : 'なし'}）` : '失敗（押しても消えない）'}`,
  );
  if (!ok) {
    env.debug('パネル: 押しても消えなかった');
    return { panel };
  }
  return { outcome: outcomeFor(save, allowed), panel };
}
