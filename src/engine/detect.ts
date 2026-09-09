// バナー容器の検出（docs/SPEC.md §5-5-d）

import {
  hasAgeGateAttribute,
  hasAgeGateContext,
  hasBannerWord,
  hasContainerHint,
  hasCookieWord,
  hasDangerousContext,
  hasGenericContainerHint,
  hasSettledNotice,
  hasWeakContainerHint,
  isAcceptStrongSpecific,
  isCloseWord,
  isCollapseWord,
  isRejectMinimal,
  isRejectStrong,
} from '../shared/phrases';
import type { ButtonCandidate } from './candidates';
import { collectButtons, decisionCandidates, isCookieSpecific } from './candidates';
import { deepElements, deepQueryFirst } from './deepQuery';
import type { EngineEnv, Rect } from './env';
import { normalize } from './normalize';

export const MIN_WIDTH = 200;
export const MIN_HEIGHT = 40;
export const MAX_TEXT_LENGTH = 3000;
/**
 * 強い属性ヒント（id/class/aria-label が cookie 系）のある容器に許すテキスト長。
 * 設定パネルを開いたあとの容器は「本文 + 全カテゴリの説明 + 数十件のサービス名」になり
 * 3000 文字を軽く超えるが、cookie を名指しした容器を長いという理由だけで捨てると
 * パネルを見つけられない。ヒントが無い容器（position だけ・dialog だけ）は従来どおり。
 */
export const MAX_TEXT_LENGTH_HINTED = 20000;
/**
 * 本文に Cookie 固有語がある容器に許すテキスト長。
 * 属性ヒントを持たず `position: fixed` なだけの同意ダイアログでも、本文に規約の抜粋や
 * 目的別の説明を並べて 3000 文字を超えるものが実在する。Cookie を名指ししている本文なら
 * 誤検出の危険は小さいので、強い属性ヒント（20000）と従来の上限（3000）の間を許す。
 */
export const MAX_TEXT_LENGTH_COOKIE = 8000;
/** hide 対象を親方向に辿る上限 */
export const MAX_HIDE_DEPTH = 5;

/** 容器にしてはいけない要素 */
const SKIP_TAGS = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'TEMPLATE']);

/**
 * 操作要素そのもの（押す対象）。**どのヒント経路でも容器にしない**。
 * adidas.co.uk の `BUTTON#glass-gdpr-default-consent-accept-button`（「Accept all cookies」）は
 * id に gdpr / consent を含むので強い属性ヒントに当たり、そのボタン自身が最小のバナー容器として
 * 採用されていた。容器の中に拒否ボタンは無い（兄弟にある）ので候補 0 のまま非表示に落ちる。
 * 属性ヒントがどれだけ強くても、押す対象そのものはバナーの入れ物ではない。
 * 下の NON_CONTAINER_TAGS とは役割が違う——あちらは position 判定（getComputedStyle）の
 * コストを避けるための足切りで、属性・role・dialog の経路には効かない。
 */
const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'LABEL', 'SUMMARY']);

/**
 * position を見ないタグ（インライン・葉要素）。
 * 全要素に getComputedStyle を掛けるのは重いので、容器になり得ない要素は先に落とす。
 */
const NON_CONTAINER_TAGS = new Set([
  'SPAN', 'A', 'SVG', 'PATH', 'G', 'USE', 'CIRCLE', 'RECT', 'LINE', 'POLYGON', 'POLYLINE', 'ELLIPSE',
  'IMG', 'PICTURE', 'SOURCE', 'LI', 'TD', 'TH', 'LABEL', 'I', 'B', 'STRONG', 'EM', 'SMALL', 'BR', 'HR',
  'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'OPTION',
]);

/** これ自体だったり内包していたりしたら容器にしない（サイト本体を巻き込む） */
const PAGE_STRUCTURE_SELECTOR = 'main, [role="main"], article, nav';
const PAGE_STRUCTURE_TAGS = new Set(['MAIN', 'ARTICLE', 'NAV']);

/** 内包していたら容器にしない（入力フォーム。チャットウィジェット等の誤検出よけ） */
const TEXT_INPUT_SELECTOR =
  'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, select';

/** hide 対象を親方向に辿るときに許す position */
const OVERLAY_POSITIONS = new Set(['fixed', 'absolute']);

/** Node.DOCUMENT_FRAGMENT_NODE（shadow root の親を辿るのに使う） */
const DOCUMENT_FRAGMENT_NODE = 11;

/**
 * 加点の理由（§5-5-d）。合計が CONTAINER_SCORE_THRESHOLD 以上なら容器として採用する。
 * 単一条件の連鎖（どれか 1 つ欠けたら全部落ちる）をやめたのは、実サイトで落ちた例が
 * すべて「条件は揃っているのに 1 つだけ欠けた」形だったため。
 */
export type ContainerSignal =
  | 'attr-cookie'
  | 'text-cookie'
  | 'ancestor-cookie'
  | 'attr-consent'
  | 'decision-strong'
  | 'attr-banner'
  | 'overlay'
  | 'text-banner'
  | 'decision-weak';

/**
 * signal ごとの点数（§5-5-d の表そのもの）。
 * 「Cookie の名指し」「バナーらしさ」「決定ボタンの強さ」を別々に数えて合算する。
 * 単体テストが 1 つずつ検証できるよう表としてエクスポートする。
 */
export const CONTAINER_SIGNAL_SCORES: Readonly<Record<ContainerSignal, number>> = {
  'attr-cookie': 3,
  'text-cookie': 3,
  'ancestor-cookie': 2,
  'attr-consent': 2,
  'decision-strong': 2,
  'attr-banner': 1,
  overlay: 1,
  'text-banner': 1,
  'decision-weak': 1,
};

/**
 * 採用に要る合計点。
 * **今日採用されている容器を 1 つも落とさない**値にしてある——ハード条件だけで
 * 入口の足切り（属性ヒントか overlay で ≥1 点）・Cookie の名指し（≥2 点）・
 * 決定ボタン（≥1 点）が保証されるので、これまで必須だったバナー語（1 点）が
 * 欠けても 4 点には届く。
 * 裏を返すと、**採用されうる構成の下限（`attr-cookie` 3 ＋ `decision-weak` 1 = 4）が
 * この閾値と同値**なので、閾値はいま 1 件も足切りしていない。ハード条件を緩めたときに
 * 効く安全網として置いてある（そのときは配点の見直しも要る）。
 */
export const CONTAINER_SCORE_THRESHOLD = 4;

/** 加点の結果（内訳は診断ログにそのまま出す。§5-8） */
export interface ContainerScore {
  score: number;
  signals: ContainerSignal[];
}

export interface DetectedContainer {
  el: Element;
  /** 可視テキスト（正規化前） */
  text: string;
  /** 面積（最も内側＝最小を選ぶための指標） */
  area: number;
  /** 加点の合計（CONTAINER_SCORE_THRESHOLD 以上） */
  score: number;
  /** 加点の内訳 */
  signals: ContainerSignal[];
  /** Cookie バナーだと言い切れる容器か（汎用文言のクリックと hide の条件。isCookieSpecific） */
  cookieSpecific: boolean;
  /** 可視テキストに年齢確認・医療従事者確認のゲート語があるか（弱一致を止める） */
  ageGate: boolean;
  buttons: ButtonCandidate[];
  decisions: ButtonCandidate[];
}

/** id / class / aria-label をつないだ文字列（容器ヒントの照合用） */
function hintAttributes(el: Element): string {
  return `${el.id} ${el.getAttribute('class') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
}

/** 押す対象そのもの（ボタン・リンク）か。どのヒント経路でも容器にしない */
function isInteractive(el: Element): boolean {
  if (INTERACTIVE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute('role');
  return role === 'button' || role === 'link';
}

/**
 * 前面に出す UI か（`role="dialog"` / `aria-modal="true"` / computed position が fixed・sticky）。
 * position の判定は getComputedStyle が要るので、容器になり得ないタグ（インライン・葉要素）は
 * 先に落とす。入口の足切りと `overlay` の加点で同じ判定を使う。
 */
function isOverlay(el: Element, env: EngineEnv): boolean {
  const role = el.getAttribute('role');
  if (role === 'dialog' || el.getAttribute('aria-modal') === 'true') return true;
  if (NON_CONTAINER_TAGS.has(el.tagName)) return false;
  const position = env.getPosition(el);
  return position === 'fixed' || position === 'sticky';
}

/**
 * 入口の足切り（§5-5-d の①）。安価な条件だけで「そもそも容器になり得るか」を見る。
 * 採否は加点（containerScore）で決めるので、ここは真偽だけを返す。
 * `overlay` は `isOverlay()` の結果を受け取る（加点の `overlay` と**同じ値**であること。
 * ここで通した要素が加点で 1 点も得ないという食い違いを作らないため）。
 * 足切りを残しているのは 2 つの理由から:
 * ① **性能** — 属性も role も position も持たない要素にまで `innerText` を読みに行くと
 *   大きなページで重い（この関数を通った要素だけが本文を読まれる）
 * ② **安全** — プライバシーポリシー本文中の「Cookie の説明 + 同意ボタン」のような
 *   ページ内セクションを容器にしない
 */
function isContainerCandidate(attributes: string, overlay: boolean): boolean {
  const hasAttributes = attributes.trim() !== '';
  if (hasAttributes && hasContainerHint(attributes)) return true;
  if (hasAttributes && hasGenericContainerHint(attributes)) return true;
  if (hasAttributes && hasWeakContainerHint(attributes)) return true;
  return overlay;
}

/**
 * 強い決定語（拒否の強一致・必要最小系・許可の specific 一致）か。
 * 「全て拒否」「必要なもののみ」「すべて許可」のように、押せば選択が確定する文言で、
 * これがある容器は同意画面だと考えてよい。判定の組は candidates.ts の実リンクの緩和
 * （`allowsRealLink`）・緩い候補（`isLooseText`）と同じ 3 つ。
 */
function isStrongDecision(text: string): boolean {
  return isRejectStrong(text) || isRejectMinimal(text) || isAcceptStrongSpecific(text);
}

/** 加点に使う、ハード条件の途中で分かっている事実 */
export interface ContainerFacts {
  /** 可視テキスト（containerText の結果） */
  text: string;
  /** id / class / aria-label をつないだ文字列（hintAttributes の結果） */
  attributes: string;
  /** 自身の属性が Cookie を名指ししているか（hasContainerHint の結果＝ attr-cookie） */
  attrCookie: boolean;
  /** 前面に出す UI か（isOverlay の結果＝入口の足切りが見たものと同じ値） */
  overlay: boolean;
  /** Cookie の名指しがあるか（isCookieSpecific の結果） */
  cookieSpecific: boolean;
  /** 子孫の決定ボタン候補（decisionCandidates の結果） */
  decisions: readonly ButtonCandidate[];
}

/**
 * 容器らしさの加点（§5-5-d）。ハード条件をすべて満たした要素にだけ掛ける。
 * 事実（本文・属性・overlay・cookieSpecific・決定候補）を**すべて `facts` で受ける**のは、
 * ① ハード条件の判定で既に求めてある値を二度計算しないため（`isOverlay` は
 * `getComputedStyle` を、`collectButtons` は容器の中の全走査を伴う）
 * ② **入口の足切りと加点が同じ述語を見ている**ことをコード上で保証するため。
 * 「入口を通った要素は必ず 1 点以上を得る」＝閾値が取りこぼしを生まないという不変条件は、
 * ここで別々に計算し直していると片方だけ条件を変えたときに静かに壊れる。
 */
export function containerScore(facts: ContainerFacts): ContainerScore {
  const hasAttributes = facts.attributes.trim() !== '';
  const textCookie = hasCookieWord(facts.text);
  const strongDecision = facts.decisions.some((button) => isStrongDecision(button.text));

  // 表の並び順に積む（診断ログの内訳が毎回同じ順で読めるように）
  const signals: ContainerSignal[] = [];
  if (facts.attrCookie) signals.push('attr-cookie');
  if (textCookie) signals.push('text-cookie');
  // 自身では名指ししていないのに cookieSpecific なら、根拠は祖先（属性か本文）にある
  if (facts.cookieSpecific && !facts.attrCookie && !textCookie) signals.push('ancestor-cookie');
  if (hasAttributes && hasGenericContainerHint(facts.attributes)) signals.push('attr-consent');
  if (strongDecision) signals.push('decision-strong');
  if (hasAttributes && hasWeakContainerHint(facts.attributes)) signals.push('attr-banner');
  if (facts.overlay) signals.push('overlay');
  if (hasBannerWord(facts.text)) signals.push('text-banner');
  if (!strongDecision && facts.decisions.length > 0) signals.push('decision-weak');

  let score = 0;
  for (const signal of signals) score += CONTAINER_SIGNAL_SCORES[signal];
  return { score, signals };
}

/** サイト本体（main / article / nav）を内包する、または自身がそれか */
export function wrapsPageStructure(el: Element): boolean {
  if (PAGE_STRUCTURE_TAGS.has(el.tagName) || el.getAttribute('role') === 'main') return true;
  return deepQueryFirst(el, PAGE_STRUCTURE_SELECTOR) !== null;
}

/**
 * その容器に許すテキスト長（強い属性ヒント > 本文の Cookie 固有語 > 従来の上限）。
 * `attrCookie` は `attr-cookie` の signal が付くか（= 自身の id/class/aria-label が
 * 強い属性ヒントに当たるか）。
 */
function maxTextLength(attrCookie: boolean, text: string): number {
  if (attrCookie) return MAX_TEXT_LENGTH_HINTED;
  return hasCookieWord(text) ? MAX_TEXT_LENGTH_COOKIE : MAX_TEXT_LENGTH;
}

/** テキスト入力を内包するか（フォーム・チャットウィジェット） */
function wrapsTextInput(el: Element): boolean {
  return deepQueryFirst(el, TEXT_INPUT_SELECTOR) !== null;
}

/**
 * shadow ホストの実効サイズ。
 * `ASIDE#usercentrics-cmp-ui`（deepl.com）のように**ホスト自身の高さが 0** で、
 * open shadow root の中の `position: fixed` な子だけが画面に出ている CMP がある。
 * ホスト自身の矩形が下限に届かないときに限り、shadow root 直下の可視な子で測り直す
 * （矩形の位置は EngineEnv からは読めないので、幅・高さそれぞれの最大を取る）。
 * shadow root を持たない要素の挙動は変えない。
 */
function containerRect(el: Element, env: EngineEnv): Rect {
  const rect = env.getRect(el);
  if (rect.width >= MIN_WIDTH && rect.height >= MIN_HEIGHT) return rect;
  const shadow = el.shadowRoot;
  if (shadow === null) return rect;

  let width = rect.width;
  let height = rect.height;
  for (const child of shadowChildren(shadow, env)) {
    const childRect = env.getRect(child);
    if (childRect.width > width) width = childRect.width;
    if (childRect.height > height) height = childRect.height;
  }
  return { width, height };
}

/**
 * shadow root 直下の「画面に出ている子」。
 * `<style>` は必ず外す——`innerText` は描画されない要素では textContent に落ちるので、
 * CSS の中身（`.cookie-banner { … }`）を容器の本文として読んでしまう。
 */
function shadowChildren(shadow: ShadowRoot, env: EngineEnv): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(shadow.children)) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    if (!env.isVisible(child)) continue;
    out.push(child);
  }
  return out;
}

/**
 * shadow ホストの実効テキスト。
 * `innerText` はホストの**光の DOM** しか見ないので、CMP のマウント点がそのまま容器に
 * なる構造では空になり、バナー語も Cookie 固有語も拾えない。空のときだけ
 * shadow root 直下の可視な子のテキストで補う（shadow root を持たない要素は従来どおり）。
 */
function containerText(el: Element, env: EngineEnv): string {
  const text = env.getText(el);
  // shadow root の有無を先に見る（全要素を通る経路なので、ほとんどの要素はここで返る）
  const shadow = el.shadowRoot;
  if (shadow === null || text.trim() !== '') return text;

  const parts: string[] = [];
  for (const child of shadowChildren(shadow, env)) parts.push(env.getText(child));
  return parts.join('\n');
}

/**
 * もう選び終わったことを伝えるだけの案内か（同意を求める画面ではない）。
 * theguardian.com の「You've chosen to reject third-party cookies…［Collapse banner］」を
 * 同意画面とみなすと、押せるボタンが無いまま `unhandled` として報告してしまう。
 * 誤って本物の同意画面を見逃さないよう、**完了状態の文言があり、かつ決定ボタンが
 * 閉じる語・折りたたみ語しか無い**ときだけとみなす。
 */
function isSettledNotice(text: string, decisions: readonly ButtonCandidate[]): boolean {
  if (!hasSettledNotice(text)) return false;
  return decisions.every((button) => isCloseWord(button.text) || isCollapseWord(button.text));
}

export interface ContainerOptions {
  /**
   * 大きさの下限（MIN_WIDTH / MIN_HEIGHT）を課さない。
   * 即決 CMP 表（§5-5-b）が名指しで見つけた容器——「その CMP だと言い切れる」セレクタに
   * 一致した要素——にだけ使う。ヒューリスティックの探索では使わない。
   */
  relaxSize?: boolean;
}

/**
 * 要素 1 つを容器として評価する（条件は §5-5-d）。満たさなければ null。
 * findContainers は全要素をこれに掛け、即決 CMP 表の取りこぼし（§5-5-b）は
 * 見つけた容器だけをこれに掛け直す。
 * 判定は 3 層 — ①入口の足切り ②ハード条件（1 つでも欠けたら容器にしない）
 * ③加点（合計が閾値以上で採用）。
 */
export function evaluateContainer(
  el: Element,
  env: EngineEnv,
  options: ContainerOptions = {},
): DetectedContainer | null {
  // 1. 容器にしてはいけない要素
  if (SKIP_TAGS.has(el.tagName)) return null;
  // 2. 押す対象そのものは容器ではない（強い属性ヒントより先に見る）
  if (isInteractive(el)) return null;
  const attributes = hintAttributes(el);
  // 3. サイトの入口ゲート・年齢ゲートは同意画面ではないので、どの経路でも容器にしない。
  // 見るのは**その要素自身の属性だけ**で祖先は辿らない（年齢ゲートのオーバーレイの中に
  // 別途 Cookie バナーが入っている構造まで捨ててしまわないため）
  if (attributes.trim() !== '' && hasAgeGateAttribute(attributes)) return null;
  // 4. 入口の足切り。overlay の判定（getComputedStyle）は③の加点でも使うので 1 回だけ求める
  const overlay = isOverlay(el, env);
  if (!isContainerCandidate(attributes, overlay)) return null;
  // 5. 可視
  if (!env.isVisible(el)) return null;

  // 6. 大きさの下限
  const rect = containerRect(el, env);
  if (options.relaxSize !== true && (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT)) return null;

  // 7. テキスト長の上限
  const text = containerText(el, env);
  const attrCookie = attributes.trim() !== '' && hasContainerHint(attributes);
  if (text.length >= maxTextLength(attrCookie, text)) return null;

  // 8. 自身の属性が Cookie を名指ししていないなら、**自身の本文にバナー語があること**。
  // 旧実装の必須条件（バナー語）を、自身の属性が Cookie を名指ししているときだけ免除する形に
  // 緩めたもの（`class="cookie-consent"` + アイコンだけのバナーを拾うため）。無条件に外すと、
  // 祖先の本文にだけ Cookie 語がある div soup——`main` / `nav` / `article` を使わないページの
  // フッターに「Cookie Policy」リンクが 1 本あるだけで、5 階層ぶんの子孫がすべて次の 9. を
  // 通ってしまう——で、規約更新モーダル（reject で「同意しない」を押す）や無関係な固定プロモ
  // （押す・消す）を容器にしてしまう。
  // 9. の `isCookieSpecific()` より**前**に置くのは、祖先の本文（`innerText` ＝レイアウト強制）を
  // 読みに行く要素を増やさないため。
  if (!attrCookie && !hasBannerWord(text)) return null;

  const cookieSpecific = isCookieSpecific(el, text, (target) => containerText(target, env));
  // 決済・削除・認証などの文脈にあるボタンは 1 つも押さない。
  // ただし**自身**が Cookie を名指ししている容器（attr-cookie / text-cookie）は Cookie バナーと
  // みなし、ボタン単位の禁止語だけで守る（"We use cookies in order to …" のような正当なバナーを
  // 取りこぼさないため）。Cookie の根拠が祖先由来だけ（ancestor-cookie）の容器には効かせる
  // ——「この記事を削除しますか？[はい][いいえ]」のようなダイアログが、祖先の Cookie 語だけで
  // 次の 9. を通ってしまうことへの二重の歯止め。
  if (!attrCookie && !hasCookieWord(text) && hasDangerousContext(text)) return null;
  // 9. Cookie の名指しがあること。fixed なだけ・`class="consent-modal"` なだけの
  // 規約更新モーダル（「新しい規約に同意しますか？[同意する][同意しない]」）を容器にすると、
  // accept で「同意する」を、reject で「同意しない」を押してしまうため
  if (!cookieSpecific) return null;
  // 10. サイト本体や入力フォームを巻き込む要素はバナーではない
  if (wrapsPageStructure(el) || wrapsTextInput(el)) return null;

  const ageGate = hasAgeGateContext(text);
  // 文脈を渡すのは、Cookie の容器に限って実リンクの決定ボタン
  // （`<a href="/consent/all">全てに同意</a>`）も候補にするため（§5-5-d）
  const buttons = collectButtons(el, env, { cookieSpecific, ageGate });
  const decisions = decisionCandidates(buttons);
  // 11. 決定ボタンを子孫として持つこと（自身がボタンの場合は 2. で既に落ちている）
  if (decisions.length === 0) return null;
  // 12. 「もう拒否済みです」の案内は同意画面ではないので、押しも隠しもしない
  if (isSettledNotice(text, decisions)) return null;

  // 加点。バナー語（text-banner）は 1 点の signal でもあるが、8. のとおり
  // 「自身の属性が Cookie を名指ししていない容器」では必須のまま
  const { score, signals } = containerScore({
    text,
    attributes,
    attrCookie,
    overlay,
    cookieSpecific,
    decisions,
  });
  if (score < CONTAINER_SCORE_THRESHOLD) return null;

  return {
    el,
    text,
    area: rect.width * rect.height,
    score,
    signals,
    cookieSpecific,
    ageGate,
    buttons,
    decisions,
  };
}

/** 容器候補をすべて集める（面積の小さい順） */
export function findContainers(root: ParentNode, env: EngineEnv): DetectedContainer[] {
  const found: DetectedContainer[] = [];

  for (const el of deepElements(root)) {
    const container = evaluateContainer(el, env);
    if (container !== null) found.push(container);
  }

  // 複数あれば最も内側（最小）を優先
  found.sort((a, b) => a.area - b.area);
  return found;
}

/** 最有力のバナー容器 */
export function detectBannerContainer(root: ParentNode, env: EngineEnv): DetectedContainer | null {
  return findContainers(root, env)[0] ?? null;
}

/** ancestor が el を内包するか（shadow DOM の境界も跨ぐ）。同一要素も真 */
export function containsDeep(ancestor: Element, el: Element): boolean {
  let current: Node | null = el;
  while (current !== null) {
    if (current === ancestor) return true;
    const parent: Node | null = current.parentNode;
    current = parent !== null && parent.nodeType === DOCUMENT_FRAGMENT_NODE
      ? ((parent as ShadowRoot).host ?? null)
      : parent;
  }
  return false;
}

/**
 * 外側へ登ってよい容器の signal。id/class/aria-label がバナーを名指ししている容器だけを
 * 登る先にする。`position: sticky` なヘッダーの中に cookie notice がある構造で、
 * overlay 起点の外側容器（ヘッダーごと）まで消してしまわないため。
 */
const OUTERMOST_SIGNALS: readonly ContainerSignal[] = ['attr-cookie', 'attr-consent'];

/** hide の範囲を広げる先にしてよい容器か */
function canBeOutermost(container: DetectedContainer): boolean {
  return container.signals.some((signal) => OUTERMOST_SIGNALS.includes(signal));
}

/**
 * hide の対象にする容器。クリック候補は最も内側の容器で探すが、非表示は
 * 「その容器を内包する容器のうち最も外側」に掛ける。
 * BEM 構造（`.cookie-consent > .cookie-consent__actions`）ではボタン行が最小容器に
 * なるので、そのまま消すと本文だけが残ってしまうため。
 * 候補は findContainers の結果なので、body/html・main/nav/article 内包・
 * テキスト入力内包という除外条件はすべて満たしている。
 */
export function outermostContainer(
  container: DetectedContainer,
  containers: readonly DetectedContainer[],
): DetectedContainer {
  let best = container;
  for (const candidate of containers) {
    if (candidate.el === best.el) continue;
    if (!canBeOutermost(candidate)) continue;
    if (!containsDeep(candidate.el, container.el)) continue;
    if (containsDeep(candidate.el, best.el)) best = candidate;
  }
  return best;
}

/**
 * 非表示にする対象。モーダル型バナーは容器の外側にバックドロップがあるので、
 * 「テキストが容器と同じ（他に中身がない）fixed / absolute な祖先」を辿って最上位を返す。
 * body / html には決して達しない。
 */
export function hideTarget(container: Element, env: EngineEnv): Element {
  const text = normalize(env.getText(container));
  let target = container;
  let current = container.parentElement;
  for (let depth = 0; current !== null && depth < MAX_HIDE_DEPTH; depth++) {
    if (SKIP_TAGS.has(current.tagName)) break;
    if (!OVERLAY_POSITIONS.has(env.getPosition(current))) break;
    if (normalize(env.getText(current)) !== text) break;
    target = current;
    current = current.parentElement;
  }
  return target;
}
