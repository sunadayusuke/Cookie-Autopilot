// ボタン候補の収集と採点（docs/SPEC.md §5-5-d）

import {
  hasAgeGateContext,
  hasContainerHint,
  hasCookieWord,
  hasGenericContainerHint,
  hasWeakContainerHint,
  isAcceptStrong,
  isAcceptStrongSpecific,
  isAcceptWeak,
  isAmbiguousReject,
  isCloseWord,
  isForbidden,
  isForbiddenHard,
  isNonDecision,
  isRejectMinimal,
  isRejectStrong,
  isRejectWeak,
  isSettingsButton,
  overridesNonDecision,
} from '../shared/phrases';
import { deepQueryAll } from './deepQuery';
import type { EngineEnv } from './env';
import { elementLabel, elementText } from './normalize';

export const CLICKABLE_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"], a';

/**
 * バナー容器の中でだけ追加で拾うクリック候補の「探索用」セレクタ。
 * `<div class="cc-btn">Got it!</div>` のように role も button タグも持たない独自バナーが
 * あるため、onclick 属性とボタンらしい class を候補に足す。class は部分一致だと
 * `<div class="cookie-banner__buttons">` のようなラッパーまで拾ってしまうので、
 * ここでは `[class]` で広く集めておき isButtonClass() でトークン一致に絞る。
 * 汎用的すぎるので容器の外では使わない（collectButtons は必ず容器を root に呼ばれる）。
 * 可視・禁止語・非決定語・文言判定はふつうのボタンと同じ経路を通る。
 */
export const CONTAINER_CLICKABLE_SELECTOR = `${CLICKABLE_SELECTOR}, [onclick], [class]`;

/**
 * Cookie 固有の容器（`CandidateContext.cookieSpecific`）の中でだけ使う探索セレクタ。
 * `<wb7-button>` のようなカスタム要素・`<div data-testid="reject-all">`・
 * `<span class="cc-link">` は tag も role も class トークンも手がかりにならないので、
 * いったん全要素を集めて isLooseClickable()（押せる見た目）と isLooseText()（決定語）
 * の 2 つで絞る。Cookie 固有語ゲートの外では絶対に使わない。
 */
const LOOSE_CLICKABLE_SELECTOR = '*';

/**
 * 緩い候補の data-* ヒント。`data-testid="reject-all"` `data-action="cookie-accept"` のように
 * 属性値でボタンの役割を書いているサイト向け。値だけを見る（属性名は千差万別なので）。
 */
const DATA_HINT = /accept|reject|deny|decline|consent|cookie|agree|allow|save|confirm/i;

/**
 * ボタンらしい class トークン。クラス名そのものが `btn` / `button`、または
 * `-btn` `_btn` `__btn` `-button` `_button` `__button` で終わるもの
 * （`cc-btn` `btn` `cmp__button` は当たり、`buttons` `btn-group` `cookie-banner__buttons`
 * は当たらない）。部分一致にするとボタンの親ラッパーが候補になり、連結テキストで
 * 決定ボタンに化けてしまう。
 */
const BUTTON_CLASS = /(?:^|[-_])(?:btn|button)$/;

/** class 属性にボタンらしいトークンがあるか */
function isButtonClass(el: Element): boolean {
  const classes = el.classList;
  for (let i = 0; i < classes.length; i++) {
    const name = classes[i];
    if (name !== undefined && BUTTON_CLASS.test(name)) return true;
  }
  return false;
}

/** ふつうのボタン（button / [role=button] / input / a）か */
function isNativeClickable(el: Element): boolean {
  try {
    return el.matches(CLICKABLE_SELECTOR);
  } catch {
    return false;
  }
}

/** 拡張セレクタ（onclick 属性・ボタンらしい class）で拾ってよい要素か */
function isExtendedClickable(el: Element): boolean {
  return el.hasAttribute('onclick') || isButtonClass(el);
}

/** クリック候補になり得る要素か（ラッパー判定で「内側に候補があるか」を見るのに使う） */
function isClickCandidate(el: Element): boolean {
  return isNativeClickable(el) || isExtendedClickable(el);
}

/**
 * 拡張セレクタ（onclick 属性・ボタンらしい class）で拾った要素が、
 * 「内側に別の候補を持つラッパー」か（`<div class="btn-group">` のような入れ物）。
 * 見るのは**光の DOM だけ**で、その要素自身の shadow root は覗かない。
 * `<wb7-button class="button …">設定</wb7-button>`（Stencil の shadow: true で作られた
 * デザインシステムのボタン）は shadow root の中に実装の `<button><slot></slot></button>` を
 * 持つが、押す先も文言もホストの方である。中を覗くとホストがラッパー扱いで候補から外れ、
 * 残った実装の `<button>` は文言がスロット越し（＝ `innerText` が空）なので決定ボタンにも
 * ならず、バナーからボタンが 1 つも見つからなくなる。
 */
function wrapsAnotherCandidate(el: Element): boolean {
  return deepQueryAll(el, CONTAINER_CLICKABLE_SELECTOR, { ownShadow: false }).some(isClickCandidate);
}

/** data-* の値にボタンらしい語があるか */
function hasDataHint(el: Element): boolean {
  const attributes = el.attributes;
  if (attributes === undefined || attributes === null) return false;
  for (let i = 0; i < attributes.length; i++) {
    const attribute = attributes[i];
    if (attribute === undefined) continue;
    if (!attribute.name.startsWith('data-')) continue;
    if (DATA_HINT.test(attribute.value)) return true;
  }
  return false;
}

/**
 * 押せる見た目・振る舞いか（緩い候補の構造条件）。
 * cursor は getComputedStyle が要るぶん重いので、属性で決まるものを先に見る。
 */
function isLooseClickable(el: Element, env: EngineEnv): boolean {
  if (el.getAttribute('tabindex') === '0') return true;
  if (hasDataHint(el)) return true;
  return env.getCursor(el) === 'pointer';
}

/**
 * 緩い候補にしてよい文言か。強い決定語（拒否の強一致・必要最小系・許可の specific 一致）
 * に加えて、弱一致（許可の弱一致・拒否の弱一致）と閉じる語も対象にする。
 * `isSettingsButton` を混ぜているのは設定パネル層（§5-5-e）が設定ボタンを探すため
 * （非決定語なので decisionCandidates では落ちる＝この経路で押されることはない）。
 * `ageGate`（容器の年齢確認・医療従事者確認ゲート文脈）が真のときは、他の弱一致経路
 * （`scoreCandidates` の `weakOk`）と揃えて弱一致・閉じる語を一切対象にしない
 * （強い決定語・設定ボタンは対象のまま）。
 *
 * 弱一致・閉じる語まで広げても誤クリックの代償が大きくならないのは次の 5 点が
 * 重なっているため:
 * ① この経路は `collectButtons()` の `allowLoose`（`context.cookieSpecific === true`）
 *   のときにしか使わない。Cookie 固有語も属性ヒントも無い容器では絶対に呼ばれない
 * ② 弱一致・閉じる語は `ACCEPT_WEAK_EXACT` / `REJECT_WEAK_EXACT` / `CLOSE_EXACT` の
 *   **完全一致**でしか当たらない（部分一致では拾わない）
 * ③ reject モードでは許可の弱一致（「同意」「OK」等）は `scoreCandidates` の reject 分岐
 *   （拒否の強一致 → 必要最小系 → `weakOk && isRejectWeak` の 3 つしか見ない）で
 *   一切候補にならない＝ここで拾う目的は「同意」を押すことではなく、①容器を成立させる
 *   （`decisionCandidates` を空にしない）②`canHide()`（`scoreCandidates` を accept モードで
 *   見て空でないこと）を満たして非表示にできるようにすることの 2 つだけ
 * ④ 裸の許可語（`ACCEPT_STRONG_BARE` の「同意する」「accept」等）は `isAcceptStrongSpecific`
 *   の条件を変えていないので引き続き対象外のまま
 * ⑤ `ageGate` が真の容器では弱一致・閉じる語をそもそも候補にしない（上記のとおり）。
 *   これが無いと、酒類・製薬サイトの年齢確認ゲート（"Are you over 18? [はい][いいえ]"
 *   相当の日本語）が `<div style="cursor:pointer">はい</div>` のような緩い要素だけで
 *   組まれていたとき、`scoreCandidates` は従来どおり弱一致を拾わない（＝押されない）ものの、
 *   候補が生まれること自体で `decisionCandidates` が空でなくなり、Cookie 同意画面ではない
 *   容器が新たに `evaluateContainer` を通って検出扱いになってしまう
 *   （未検出の `none` から `unhandled` へ、cloak の一時適用も伴う）
 *
 * 実例: gakken.co.jp の `<div class="title4 highlight"><h4>同意</h4></div>` は
 * `button` タグでも `role="button"` でも `onclick` でもなく、`title4` にボタンらしい
 * class トークンも無い。`h4` 自身に効く CSS（`cursor: pointer`）だけが手がかりで、
 * 文言は許可の弱一致「同意」の 1 つだけ。これを拾わないと決定ボタン候補が 0 件になり、
 * 容器自体が不採用（`evaluateContainer` が null）のまま監視終了時の報告が `unhandled`
 * ですらない `none`（未検出）になっていた。
 */
function isLooseText(text: string, ageGate: boolean): boolean {
  if (text === '' || isForbiddenHard(text)) return false;
  if (isRejectStrong(text) || isRejectMinimal(text) || isAcceptStrongSpecific(text) || isSettingsButton(text)) {
    return true;
  }
  if (ageGate) return false;
  return isAcceptWeak(text) || isRejectWeak(text) || isCloseWord(text);
}

/** ancestor の子孫（shadow DOM 横断）に el があるか。同一要素は偽 */
function wrapsElement(ancestor: Element, el: Element): boolean {
  if (ancestor === el) return false;
  return deepQueryAll(ancestor, LOOSE_CLICKABLE_SELECTOR).includes(el);
}

/**
 * 緩い経路で拾った候補のうち、同じボタンを二重に数えるものを落とす。
 * cursor は継承するので `<button><span>Reject all</span></button>` の span も、
 * `<div data-testid="reject-all"><span>Reject all</span></div>` の div も条件を満たす。
 * ① ふつうの候補（tag / role / class トークン）の内側にある緩い候補は、その候補と同じボタン
 * ② ほかの候補を内側に持つ緩い候補はラッパー（押す先は内側でよい）
 * どちらも残すと候補の枠（最大 3）を二重に使ってしまう。
 */
function dropLooseDuplicates(
  buttons: readonly ButtonCandidate[],
  loose: ReadonlySet<Element>,
): ButtonCandidate[] {
  const solid = buttons.filter((button) => !loose.has(button.el));
  const kept = buttons.filter(
    (button) => !loose.has(button.el) || !solid.some((other) => wrapsElement(other.el, button.el)),
  );
  return kept
    .filter(
      (button) => !loose.has(button.el) || !kept.some((other) => wrapsElement(button.el, other.el)),
    )
    .map((button, index) => ({ ...button, index }));
}

export type CandidateKind =
  | 'reject-strong'
  | 'reject-minimal'
  | 'reject-weak'
  | 'accept-strong'
  | 'accept-weak'
  | 'close';

export interface ButtonCandidate {
  el: Element;
  /** 正規化済み文言（照合・採点用） */
  text: string;
  /** 表示用の文言（popup の結果表示用。正規化していない生の文言） */
  label: string;
  /** 容器内の出現順 */
  index: number;
}

export interface ScoredCandidate extends ButtonCandidate {
  kind: CandidateKind;
  score: number;
}

/**
 * 採点に使う容器の文脈。
 * 許可の弱一致・拒否の弱一致・閉じる語・裸の許可語（agree/accept/allow/consent）は、
 * 規約ダイアログやフォームの決定ボタンにも使われるため、
 * その容器が Cookie バナーだと言い切れるとき（cookieSpecific）だけ有効にする。
 */
export interface CandidateContext {
  /** Cookie バナーだと言い切れる容器か（テキストの Cookie 固有語、または属性ヒント。isCookieSpecific） */
  cookieSpecific: boolean;
  /**
   * 容器の可視テキストに年齢確認・医療従事者確認のゲート語があるか。
   * 真なら弱一致（許可の弱一致・拒否の弱一致・閉じる語）を一切使わない。
   */
  ageGate: boolean;
}

/** 採点の細かい振る舞い（設定由来。容器から決まる CandidateContext とは分けている） */
export interface ScoreOptions {
  /**
   * 選択肢のないお知らせ（決定ボタンが閉じる語 1 つだけ）を押してよいか。既定 true。
   * プリセット「すべて拒否」（Settings.pressCloseOnNotice が false）では reject モードで
   * これを押さず、fallback（既定は非表示）に落とす（§14.1）。
   */
  pressCloseOnNotice?: boolean;
}

/** 強い属性ヒントを探して祖先を辿る上限（自身 + この数だけ上まで） */
const MAX_HINT_DEPTH = 5;

/**
 * ⒞（祖先の本文）を Cookie の根拠にしてよい本文の長さの上限。
 * `detect.ts` の `MAX_TEXT_LENGTH_COOKIE` と**同じ値**（8000）。あちらから import すると
 * `detect.ts` → `candidates.ts` → `detect.ts` の循環 import になるため、値をここに複製している。
 * 値を変えるときは両方直すこと。
 */
const MAX_TEXT_LENGTH_COOKIE = 8000;

/** Node.DOCUMENT_FRAGMENT_NODE（shadow root の親を辿るのに使う） */
const DOCUMENT_FRAGMENT_NODE = 11;

/** 親要素（shadow の境界は host へ抜ける） */
function parentElementOf(el: Element): Element | null {
  const parent: Node | null = el.parentNode;
  if (parent === null) return null;
  if (parent.nodeType === DOCUMENT_FRAGMENT_NODE) return (parent as ShadowRoot).host ?? null;
  return el.parentElement;
}

/** id / class / aria-label をつないだ文字列（容器ヒントの照合用） */
function hintAttributes(el: Element): string {
  return `${el.id} ${el.getAttribute('class') ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
}

/**
 * Cookie バナーだと言い切れる容器か（§5-5-d の Cookie 固有語ゲート）。
 * ① 自身の可視テキストに Cookie 固有語（cookie / クッキー / gdpr）がある、または
 * ② 自身か 5 階層以内の祖先の id / class / aria-label が**強い容器ヒント**（CONTAINER_HINT）に当たる、
 * または ③ **バナーらしい名乗りを持つ**5 階層以内の祖先の本文に Cookie 固有語がある
 * （見てよい祖先の条件は `canUseAncestorText`）。
 * ②③ を見るのは、`<div class="cmm-cookie-banner__actions">[設定][全てに同意]</div>` のように
 * **ボタン行だけが最小容器になる**構造で、その行のテキスト（「設定 / 全てに同意 / プライバシー
 * ポリシー」）には Cookie 固有語が無いため。class は cookie を名指ししているのに Cookie バナーと
 * 認められず、非表示にも設定パネル層にも進めないまま `unhandled` で残っていた。
 * 汎用ヒント（consent / privacy）と弱ヒント（banner / notice）は②に**含めない**
 * ——`class="consent-modal"` の規約更新モーダルまで Cookie バナー扱いになってしまうため。
 */
export function isCookieSpecific(
  el: Element,
  text: string,
  getText?: (el: Element) => string,
): boolean {
  if (hasCookieWord(text)) return true;
  let current: Element | null = el;
  for (let depth = 0; current !== null && depth <= MAX_HINT_DEPTH; depth++) {
    const attributes = hintAttributes(current);
    if (attributes.trim() !== '' && hasContainerHint(attributes)) return true;
    // 祖先の本文に Cookie 固有語があれば、この要素も Cookie バナーの一部とみなす。
    // ボタンだけが並ぶ行（"設定 / 全てに同意" など）は自身のテキストに Cookie 語を持たないが、
    // 見出しを持つ親の中にある。根拠にしてよい祖先は canUseAncestorText で絞る。
    if (depth > 0 && getText !== undefined && canUseAncestorText(current, attributes)) {
      // 祖先の本文はここで 1 度だけ読む（下の長さ上限と hasCookieWord の両方に使い回す。
      // 二度読まない——`getText` は innerText 相当でレイアウトを強制するため）
      const ancestorText = getText(current);
      // 祖先の本文を Cookie の根拠にしてよいのは、その祖先自身が「バナーそのものだと言い切れる
      // 大きさ」のときだけ（MAX_TEXT_LENGTH_COOKIE）。`banner` / `notice` のような弱い名乗りを
      // 持つ**ページ全体のラッパー**が対象になると、フッターの Cookie Policy が無関係な
      // モーダルの根拠になってしまう（§5-5-d ⒞。残存リスクは docs/SPEC.md 末尾）
      if (ancestorText.length < MAX_TEXT_LENGTH_COOKIE && hasCookieWord(ancestorText)) return true;
    }
    current = parentElementOf(current);
  }
  return false;
}

/**
 * 祖先の本文を Cookie バナーの根拠にしてよいか。次の 2 つを満たす祖先だけ
 * （本文の長さの上限は③として呼び出し元 `isCookieSpecific` が見る——ここで求めていない
 * `getText(current)` の結果に対する条件なので、二度読まないためにあえて外に出してある）。
 * ① **その祖先自身がバナーらしい名乗りを持つ**（hasBannerLikeName）
 * ② ページ全体・サイト構造の入れ物でない（body / html と、main / nav / article を内包する祖先）
 *
 * ①が無いと `<div id="root">` `<div class="content">` のような**ただの入れ物**の本文まで根拠に
 * なる。入れ物の `innerText` には**別の枝**にあるフッターの「Cookie Policy」まで含まれるので、
 * `main` / `nav` / `article` を使わない div 入れ子のサイトでは②が止められず、リンク 1 本で
 * 周辺の要素がまとめて Cookie バナー扱いになっていた。自身の本文にバナー語だけがある要素——
 * 「利用規約とプライバシーポリシーを改定しました…［同意する］［拒否］」の規約更新モーダル——が
 * これで容器として採用され、reject モードで「拒否」（＝規約に同意しない）を押していた
 * （fixture `trap-ancestor-cookie` の⑤）。
 * `attributes` は呼び出し元が求めてある hintAttributes() の結果（二度作らないため）。
 */
function canUseAncestorText(el: Element, attributes: string): boolean {
  if (el.tagName === 'BODY' || el.tagName === 'HTML') return false;
  if (!hasBannerLikeName(el, attributes)) return false;
  if (typeof el.querySelector !== 'function') return true;
  return el.querySelector('main, nav, article, [role="main"]') === null;
}

/**
 * バナーらしい名乗りを持つ要素か（id / class / aria-label が容器ヒントのいずれか、
 * または `role="dialog"` / `aria-modal="true"`）。
 * 判定は**属性の読み取りだけ**で完結する——`position: fixed` を根拠に足さないのは、
 * `EngineEnv`（getComputedStyle）を isCookieSpecific まで引き回さずに済ませるため。
 * fixed なだけの無名の祖先を⒞の対象から外しても、**多くの構造では**祖先自身が容器の条件
 * （overlay ＋ 本文の Cookie 固有語）を満たすので、容器がボタン行から祖先に移るだけで影響しない。
 * ただし次のいずれかに当たると祖先自身も容器になれず、正味の取りこぼしになる——
 * 祖先が入力欄を内包する（`wrapsTextInput`）／サイト構造 main・nav・article を内包する
 * （`wrapsPageStructure`）／本文が長すぎる（`evaluateContainer` のハード条件 7. のテキスト長
 * 上限を超える）／`position` が static（overlay にならず属性ヒントも無いので入口の足切りで
 * 落ちる）。この場合 hide の対象も「ボタン行 → 祖先」に**広がる**（従来どおり、ではなく
 * 安全側に変わる）。残存リスクは docs/SPEC.md 末尾にまとめてある。
 * なお強いヒント（CONTAINER_HINT）を持つ祖先は isCookieSpecific のループの属性判定で
 * 先に真を返すので、ここで実際に効くのは汎用ヒント（consent / privacy）・弱ヒント
 * （banner / notice）・dialog を名乗る祖先である。
 */
function hasBannerLikeName(el: Element, attributes: string): boolean {
  if (el.getAttribute('role') === 'dialog') return true;
  if (el.getAttribute('aria-modal') === 'true') return true;
  if (attributes.trim() === '') return false;
  return (
    hasContainerHint(attributes) ||
    hasGenericContainerHint(attributes) ||
    hasWeakContainerHint(attributes)
  );
}

/** 容器要素からそのまま文脈を作る */
export function contextOf(container: Element, env: EngineEnv): CandidateContext {
  const text = env.getText(container);
  return {
    cookieSpecific: isCookieSpecific(container, text, (el) => env.getText(el)),
    ageGate: hasAgeGateContext(text),
  };
}

/** a 要素は href が空・`#`・javascript: か role="button" のときだけ候補にする */
export function isEligibleAnchor(el: Element): boolean {
  if (el.tagName !== 'A') return true;
  if (el.getAttribute('role') === 'button') return true;
  const href = el.getAttribute('href');
  if (href === null) return true;
  const value = href.trim();
  return value === '' || value === '#' || value.toLowerCase().startsWith('javascript:');
}

/**
 * クリックすると実ページへ遷移してしまう原因の `a`。無ければ null。
 * 実リンクの `a` 自身と、実リンクの中にある要素
 * （`<a href="/leave"><div class="btn">Decline</div></a>` の div。クリックが a にバブルする）。
 */
function realLinkOf(el: Element): Element | null {
  if (!isEligibleAnchor(el)) return el;
  if (typeof el.closest !== 'function') return null;
  const anchor = el.closest('a');
  if (anchor === null || anchor === el || isEligibleAnchor(anchor)) return null;
  return anchor;
}

/** クリックが実ページへの遷移になる要素か（設定パネル層が設定ボタンを選ぶのに使う。§5-5-e） */
export function navigatesAway(el: Element): boolean {
  return realLinkOf(el) !== null;
}

/**
 * 実ページへのリンクでも候補にしてよい文言か（§5-5-d）。
 * 決定ボタンをリンクで作っているサイト（`<a href="/consent/all">全てに同意</a>`）があり、
 * 一律に外すと候補が 1 つも集まらず、hide の条件（押さずに残した許可ボタンがある）すら
 * 満たせない。遷移という副作用を負う以上、条件は厳しくする:
 * ① 容器に Cookie 固有語がある ② 文言が強い決定語（拒否の強一致・必要最小系・
 * 許可の specific 一致）③ HARD 禁止語でない。
 * 弱一致・閉じる語・非決定語は対象外なので、「プライバシーポリシー」「インプリント」
 * 「詳細」のような情報リンクは従来どおり候補にならない。
 */
function allowsRealLink(text: string, context: CandidateContext | undefined): boolean {
  if (context?.cookieSpecific !== true) return false;
  if (text === '' || isForbiddenHard(text)) return false;
  return isRejectStrong(text) || isRejectMinimal(text) || isAcceptStrongSpecific(text);
}

/**
 * 容器内の可視なクリック候補（shadow DOM 横断）。
 * `context` を渡すと、実ページへのリンクでも強い決定語なら候補にする（allowsRealLink）。
 * 省略時は実リンク（とその中の要素）を一切候補にしない。
 * `context.cookieSpecific` が真のときだけ、tag も role も class トークンも無い要素
 * （カスタム要素・`data-*` だけのボタン）も緩い条件で候補にする（§5-5-d）。
 */
export function collectButtons(
  container: ParentNode,
  env: EngineEnv,
  context?: CandidateContext,
): ButtonCandidate[] {
  const allowLoose = context?.cookieSpecific === true;
  const out: ButtonCandidate[] = [];
  const loose = new Set<Element>();

  for (const el of deepQueryAll(
    container,
    allowLoose ? LOOSE_CLICKABLE_SELECTOR : CONTAINER_CLICKABLE_SELECTOR,
  )) {
    let isLoose = false;
    if (!isNativeClickable(el)) {
      if (isExtendedClickable(el)) {
        // 拡張セレクタで拾った要素がボタンの親ラッパーのことがある（`<div class="btn-group">`）。
        // ラッパーの click は効かないうえ、連結テキストで決定ボタンに化けて候補枠を食うので、
        // 内側に別の候補を持つものは候補にしない
        if (wrapsAnotherCandidate(el)) continue;
      } else {
        if (!allowLoose) continue;
        isLoose = true;
      }
    }
    if (el.hasAttribute('disabled')) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (isLoose && !isLooseClickable(el, env)) continue;
    if (!env.isVisible(el)) continue;
    const text = elementText(el);
    if (isLoose && !isLooseText(text, context?.ageGate === true)) continue;
    const link = realLinkOf(el);
    if (link !== null) {
      if (!allowsRealLink(text, context)) continue;
      // a 自身を候補にできたなら、その中の要素は同じボタンなので重ねて候補にしない
      // （押す先は結局 a なのに、候補の枠（最大 3）を二重に使ってしまう）
      if (link !== el && out.some((button) => button.el === link)) continue;
    }
    if (isLoose) loose.add(el);
    out.push({ el, text, label: elementLabel(el), index: out.length });
  }

  return loose.size === 0 ? out : dropLooseDuplicates(out, loose);
}

/**
 * 決定ボタン候補（禁止語・非決定語・文言なしを除いたもの）。
 * ただし総量を明示する決定語（必要最小系、または「すべて〜」を伴う許可の specific 一致・
 * 拒否の強一致）に一致する文言は、`purposes` `vendors` のような設定系の語を含んでいても
 * 非決定語として落とさない（"Accept all purposes" "Reject all vendors" を決定ボタン扱いに
 * するため）。総量マーカーを要求しないと "Manage or reject cookies" まで決定ボタンになる。
 */
export function decisionCandidates(buttons: readonly ButtonCandidate[]): ButtonCandidate[] {
  return buttons.filter((button) => {
    if (button.text === '') return false;
    // 強い拒否語・必要最小系は SOFT 禁止語（保存・解除など）より優先する。
    // 「すべて解除」「選択を解除」は断るボタンそのものなので、解除 の語で落としてはいけない
    const strictly = !isRejectStrong(button.text) && !isRejectMinimal(button.text);
    if (isForbidden(button.text, { strict: strictly })) return false;
    if (!isNonDecision(button.text)) return true;
    return overridesNonDecision(button.text);
  });
}

/**
 * モードごとの採点。良い順に並べて返す。
 * reject: 拒否語の強一致(3) > 必要最小系(2) > 弱一致(1)
 * accept: 許可語の強一致(3) > 弱一致(2)
 * どちらのモードでも、決定ボタンが 1 つだけでそれが閉じる語なら候補にする(1)。
 * 拒否・許可の弱一致と閉じる語・裸の許可語は context.cookieSpecific が真のときだけ。
 * さらに年齢確認ゲート（context.ageGate）の容器では弱一致と閉じる語を一切使わない。
 * reject モードの閉じる語は、options.pressCloseOnNotice が false なら使わない（§14.1）。
 */
export function scoreCandidates(
  buttons: readonly ButtonCandidate[],
  mode: 'reject' | 'accept',
  context: CandidateContext,
  options: ScoreOptions = {},
): ScoredCandidate[] {
  const decisions = decisionCandidates(buttons);
  const scored: ScoredCandidate[] = [];
  const weakOk = context.cookieSpecific && !context.ageGate;

  for (const button of decisions) {
    if (mode === 'reject') {
      // 「すべて許可」の言い回しを含むのに否定形が無いものは、拒否ボタンだと言い切れない
      if (isAmbiguousReject(button.text)) continue;
      if (isRejectStrong(button.text)) scored.push({ ...button, kind: 'reject-strong', score: 3 });
      else if (isRejectMinimal(button.text)) scored.push({ ...button, kind: 'reject-minimal', score: 2 });
      else if (weakOk && isRejectWeak(button.text)) {
        scored.push({ ...button, kind: 'reject-weak', score: 1 });
      }
    } else if (isAcceptStrong(button.text)) {
      if (context.cookieSpecific || isAcceptStrongSpecific(button.text)) {
        scored.push({ ...button, kind: 'accept-strong', score: 3 });
      }
    } else if (weakOk && isAcceptWeak(button.text)) {
      scored.push({ ...button, kind: 'accept-weak', score: 2 });
    }
  }

  // 「すべて拒否」では同意を意味するボタンを一切押さないので、閉じる語も押さない。
  // accept モード（fixtures 専用）は従来どおり
  const closeOk = mode === 'accept' || options.pressCloseOnNotice !== false;
  const only = decisions.length === 1 ? decisions[0] : undefined;
  if (scored.length === 0 && only && weakOk && closeOk && isCloseWord(only.text) && !hasSettingsChoice(buttons, mode, only)) {
    scored.push({ ...only, kind: 'close', score: 1 });
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored;
}

/**
 * reject モードで閉じる語を使ってはいけない容器か。
 * `[Continue] [Manage settings]` は "Manage settings" が非決定語で落ちて決定ボタンが 1 つに
 * なるが、ここでの Continue は同意ボタンなので押せない（既定 fallback の hide に落とす）。
 * 情報リンク（Learn more / Privacy policy）しか無い通知バナーは従来どおり閉じる語で閉じる。
 * accept モードでは Continue を押してよいので見ない。
 */
function hasSettingsChoice(
  buttons: readonly ButtonCandidate[],
  mode: 'reject' | 'accept',
  only: ButtonCandidate,
): boolean {
  if (mode !== 'reject') return false;
  return buttons.some((button) => button !== only && isSettingsButton(button.text));
}

/** 容器内から対象モードの候補を採点して返す */
export function pickCandidates(
  container: Element,
  mode: 'reject' | 'accept',
  env: EngineEnv,
  options: ScoreOptions = {},
): ScoredCandidate[] {
  const context = contextOf(container, env);
  return scoreCandidates(collectButtons(container, env, context), mode, context, options);
}
