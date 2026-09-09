// 処理パイプライン（docs/SPEC.md §5-5〜§5-7）
//
// 層の順序: カスタムルール → 即決 CMP 表 → Consent-O-Matic ルール → ヒューリスティック。
// reject モードで許可カテゴリが 1 つでもあるときは、カテゴリ別設定を効かせるため
// 即決 CMP 表を Consent-O-Matic ルールより後ろに回す。
// ヒューリスティックで断るボタンが見つからないときは、fallback の直前に
// 設定パネル層（§5-5-e。engine/panel.ts）を 1 度だけ試す。

import { isForbiddenHard, isGenericPhrase } from '../shared/phrases';
import type {
  CategoryKey,
  ComRule,
  CustomRule,
  Decision,
  Settings,
  UnhandledReason,
} from '../shared/types';
import type { CandidateContext, ScoreOptions, ScoredCandidate } from './candidates';
import { CLICKABLE_SELECTOR, isEligibleAnchor, scoreCandidates } from './candidates';
import type { ScrollSnapshot } from './cloak';
import {
  captureScroll,
  cloakElement,
  hideElement,
  uncloakElement,
  watchHiddenAncestor,
} from './cloak';
import { quickCmpsFor } from './cmpQuick';
import { createComContext, detectRule, hasRunnableMethod, runRule } from './com/engine';
import { deepQueryAll } from './deepQuery';
import type { ContainerSignal, DetectedContainer } from './detect';
import {
  containsDeep,
  evaluateContainer,
  findContainers,
  hideTarget,
  outermostContainer,
  wrapsPageStructure,
} from './detect';
import type { EngineEnv } from './env';
import { elementLabel, elementText, normalize } from './normalize';
import { tryPanel } from './panel';

/** click 後に容器の様子を見る時間 */
export const CLICK_WAIT_MS = 800;
/** 1 つの層で試す候補の上限 */
export const MAX_CANDIDATES = 3;
/**
 * 容器を最初に検出してから fallback（hide / leave）を適用するまでの猶予。
 * 拒否ボタンが遅れて描画されるサイトで、先に hide してしまわないようにする。
 */
export const FALLBACK_GRACE_MS = 1000;
/** 猶予中の再試行間隔 */
export const FALLBACK_RETRY_MS = 250;

export type LayerName = 'custom' | 'quick' | 'com' | 'heuristic';

/**
 * 処理できなかったときの診断（§5-8）。デバッグログが有効なときだけコンソールに出す。
 * 「どの容器を見て、どんなボタンが集まったのか」が分かれば、利用者がそのまま報告できる。
 */
export interface RunDiagnosis {
  /** 容器の見分け（`DIV#cookie-bar.cookie-bar`） */
  container: string;
  /** 容器内で集まったクリック候補の数 */
  buttons: number;
  /** そのうち決定ボタンとして扱われた数 */
  decisions: number;
  /** 候補の表示用文言 */
  labels: string[];
  /** 容器の加点の合計（§5-5-d）。容器を採用できていないときは 0 */
  score: number;
  /**
   * 加点の内訳。**採用した容器の判断根拠**として残す。
   * `evaluateContainer()` が null を返した要素の点数はどこにも残らないので、
   * 「閾値に届かなかった容器に何が足りなかったか」はここからは分からない。
   */
  signals: ContainerSignal[];
}

export interface RunState {
  /** 同じ要素は 1 回だけ試す */
  tried: WeakSet<Element>;
  /** 同じ CMP ルールは 1 ページで 1 度だけ */
  triedComRules: Set<string>;
  /** 何らかのバナーを検出したか（監視終了時の status 判定に使う） */
  detectedAny: boolean;
  /** 監視窓の開始時刻。fallback の猶予を監視窓の終わりで打ち切るのに使う */
  startedAt: number;
  /** ヒューリスティックで採用中の容器。別要素に変わったら猶予をやり直す */
  containerEl: Element | null;
  /** 採用中の容器を最初に検出した時刻。null = まだ検出していない */
  containerSeenAt: number | null;
  /** 容器検出前の html/body の overflow。hide 時のスクロール復帰に使う */
  scroll: ScrollSnapshot | null;
  /** 設定パネル層（§5-5-e）を試したか。1 ページにつき 1 回だけ */
  panelTried: boolean;
  /** 監視窓が切れたなど、進行中のパスを打ち切りたいときに立てる */
  cancelled: boolean;
  /** 直近の「処理できなかった理由」（§5-8）。監視終了時の unhandled 報告にも使う */
  reason: UnhandledReason | null;
  /** 直近に採用した容器の診断（§5-8） */
  diagnosis: RunDiagnosis | null;
  /** 即決 CMP 表で検出した CMP 名（失敗要約に残す。§5-8） */
  cmp: string | null;
  /**
   * 即決 CMP 表が容器まで見つけたのに対象のボタンが無かった CMP の容器（§5-5-b）。
   * ヒューリスティックが容器を 1 つも拾えなかったときの控えにする
   * （`#usercentrics-cmp-ui` のように「その CMP だと言い切れる」要素だけが入る）。
   */
  quickContainers: Set<Element>;
  /** 同じ内容の進行ログを 1 監視窓につき 1 回だけ出すための既出集合（§5-8） */
  traced: Set<string>;
}

/** now は監視を始めた時刻（`env.now()` と同じ時計であること） */
export function createRunState(now: number = Date.now()): RunState {
  return {
    tried: new WeakSet<Element>(),
    triedComRules: new Set<string>(),
    detectedAny: false,
    startedAt: now,
    containerEl: null,
    containerSeenAt: null,
    scroll: null,
    panelTried: false,
    cancelled: false,
    reason: null,
    diagnosis: null,
    cmp: null,
    quickContainers: new Set<Element>(),
    traced: new Set<string>(),
  };
}

/** その内容の行がまだ出ていなければ真（出したものとして覚える） */
function firstTime(deps: RunDeps, key: string): boolean {
  if (deps.state.traced.has(key)) return false;
  deps.state.traced.add(key);
  return true;
}

/**
 * 同じ内容の進行ログは 1 監視窓につき 1 回だけ出す（§5-8）。
 * 監視中はパスが 1 秒ごとに回るので、「一致なし」「容器なし」のように状況が変わらない行を
 * そのまま出すと、実際に起きたこと（容器の検出・クリック・fallback）がログに埋もれる。
 * 状態が変われば文言も変わるので、変化した行は従来どおり出る。
 */
function traceOnce(deps: RunDeps, message: string): void {
  if (firstTime(deps, message)) deps.env.trace(message);
}

/** 同じ内容の debug 行も 1 監視窓につき 1 回だけ（実行できない COM ルールの列挙など） */
function debugOnce(deps: RunDeps, message: string, detail: string): void {
  if (firstTime(deps, `${message} ${detail}`)) deps.env.debug(message, detail);
}

/** 容器の見分け（`DIV#cookie-bar.cookie-bar`）。診断ログ用 */
function describeElement(el: Element): string {
  const id = el.id === '' ? '' : `#${el.id}`;
  const classes = (el.getAttribute('class') ?? '').trim().split(/\s+/).filter((name) => name !== '');
  return `${el.tagName}${id}${classes.length > 0 ? `.${classes.slice(0, 3).join('.')}` : ''}`;
}

/** 進行ログに並べる文言の上限。長い容器では全部出すと 1 行が読めなくなる */
const TRACE_LABEL_LIMIT = 8;

/**
 * 文言の一覧を `[断る / 全てに同意 / ほか 3 件 / 文言なし 4 件]` の形にする（進行ログ用）。
 * 文言の無い候補はまとめて数だけ出す。web components の shadow root にある実装の
 * `<button>`（文言はスロット越しなので取れない）がここに出るので、数自体が手がかりになる。
 */
function traceLabels(labels: readonly string[]): string {
  const named = labels.filter((label) => label !== '');
  const empty = labels.length - named.length;
  const parts = named.slice(0, TRACE_LABEL_LIMIT);
  const rest = named.length - parts.length;
  if (rest > 0) parts.push(`ほか ${rest} 件`);
  if (empty > 0) parts.push(`文言なし ${empty} 件`);
  return `[${parts.join(' / ')}]`;
}

/**
 * 処理できなかったときの 1 行要約（§5-8）。
 * デバッグログが有効なときだけ content script が `console.info` で出す
 * （`console.debug` は既定のログレベルで表示されず、利用者が見て報告できないため）。
 */
export function unhandledSummary(state: RunState): string {
  const { diagnosis } = state;
  return JSON.stringify({
    reason: state.reason ?? 'unknown',
    // 即決 CMP 表で名前が分かっているなら残す（`Usercentrics` を検出したが拒否ボタンが無い、等）
    cmp: state.cmp,
    container: diagnosis?.container ?? null,
    buttons: diagnosis?.buttons ?? 0,
    decisions: diagnosis?.decisions ?? 0,
    labels: diagnosis?.labels ?? [],
    // 容器の採点（§5-5-d）。**採用した容器を何を手がかりに選んだか**が分かる
    // （採用できなかった要素の点数は残らないので、不採用の理由はここには出ない）
    score: diagnosis?.score ?? 0,
    signals: diagnosis?.signals ?? [],
  });
}

export interface RunDeps {
  doc: Document;
  env: EngineEnv;
  settings: Settings;
  mode: 'reject' | 'accept';
  /** 実効の許可カテゴリ（§14.1 の effectiveCategories）。CMP ルールの consent に効く */
  allowCategories: readonly CategoryKey[];
  customRules: readonly CustomRule[];
  comRules: Record<string, ComRule>;
  isSubFrame: boolean;
  state: RunState;
}

export interface RunOutcome {
  status: 'handled' | 'unhandled';
  /** 'custom' | 'quick:<name>' | 'com:<ruleName>' | 'heuristic' | 'panel' | 'hide' */
  method?: string;
  action?: 'reject' | 'accept';
  /** 押したボタンの正規化済み文言 */
  clickedText?: string;
  /** 押したボタンの表示用ラベル（popup はこちらを出す。H1） */
  clickedLabel?: string;
  /** 何をしたか（§14.6）。popup の「このサイトでの結果」はこれで組み立てる */
  decision?: Decision;
  /** decision === 'granular' のときに許可したカテゴリ */
  allowed?: CategoryKey[];
  /** status === 'unhandled' のときの理由（§5-8） */
  reason?: UnhandledReason;
}

/** cloak してはいけない要素（html / body / サイト本体を内包するもの） */
const UNCLOAKABLE_TAGS = new Set(['HTML', 'BODY']);

/**
 * cloak する。ページ全体を透明にしてしまう要素は拒否して偽を返す。
 * Consent-O-Matic の同梱ルールには `HIDE_CMP = hide { selector: 'html' }` のように
 * 「まずページごと隠して CMP を処理する」ものがあり、そのまま従うとルールが失敗した
 * ときにページが最大 observeSeconds 秒まるごと白紙になる。
 */
function cloak(el: Element, deps: RunDeps): boolean {
  if (UNCLOAKABLE_TAGS.has(el.tagName) || wrapsPageStructure(el)) {
    deps.env.debug('ページ全体に及ぶので cloak しない', el.tagName, el.id);
    return false;
  }
  cloakElement(el);
  return true;
}

/**
 * クリックが効いたか。押した要素と見張り対象（容器）の両方を見る。
 * display / visibility だけでなく、`transform` で viewport の外に出る場合と
 * `opacity: 0` にする場合（自前の cloak は除いて判定）も退場とみなす。
 */
export function isGone(clicked: Element, watch: Element, env: EngineEnv): boolean {
  if (!clicked.isConnected || !env.isVisible(clicked)) return true;
  if (!watch.isConnected || !env.isVisible(watch)) return true;
  if (env.isOffscreen(watch)) return true;
  return env.isFaded(watch);
}

function dispatchClickSequence(el: Element, doc: Document): void {
  const view = doc.defaultView;
  const globals = view as unknown as Record<string, unknown> | null;
  const init: MouseEventInit = { bubbles: true, cancelable: true, composed: true, view };

  const build = (type: string): Event | null => {
    const name = type.startsWith('pointer') ? 'PointerEvent' : 'MouseEvent';
    const ctor = globals?.[name];
    if (typeof ctor === 'function') {
      try {
        const Ctor = ctor as new (type: string, init: MouseEventInit) => Event;
        return new Ctor(type, init);
      } catch {
        /* PointerEvent が無い環境（jsdom など）は下のフォールバックへ */
      }
    }
    try {
      const event = doc.createEvent('Event');
      event.initEvent(type, true, true);
      return event;
    } catch {
      return null;
    }
  };

  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const event = build(type);
    if (event) el.dispatchEvent(event);
  }
}

/**
 * クリック手順（§5-6）: click → 800ms → まだ見えていればイベント列を dispatch → 800ms。
 * watch は消えたことを確認する要素（容器が分かればそれ、無ければ押した要素）。
 */
export async function clickAndVerify(el: Element, watch: Element, deps: RunDeps): Promise<boolean> {
  const { env } = deps;
  env.debug('クリック', elementText(el) || el.tagName);
  (el as HTMLElement).click?.();
  await env.sleep(CLICK_WAIT_MS);
  if (isGone(el, watch, env)) return true;

  dispatchClickSequence(el, deps.doc);
  await env.sleep(CLICK_WAIT_MS);
  return isGone(el, watch, env);
}

/**
 * 押せた候補（`clicked`）を返す。ヒューリスティックは kind から decision を決めるので候補ごと返す。
 * `tries` は実際にクリックした数（unhandled の理由を `click-failed` にするかの判断に使う）。
 */
async function tryCandidates<T extends { el: Element; text: string; label: string }>(
  elements: readonly T[],
  watch: Element | null,
  deps: RunDeps,
): Promise<{ ok: boolean; clicked?: T; tries: number }> {
  let tries = 0;
  for (const candidate of elements) {
    if (deps.state.cancelled) break;
    if (tries >= MAX_CANDIDATES) break;
    if (deps.state.tried.has(candidate.el)) continue;
    deps.state.tried.add(candidate.el);
    tries++;
    const ok = await clickAndVerify(candidate.el, watch ?? candidate.el, deps);
    if (ok) return { ok: true, clicked: candidate, tries };
  }
  return { ok: false, tries };
}

// ---------------------------------------------------------------------------
// a. カスタムルール（教えたボタン）
// ---------------------------------------------------------------------------

/** 教えたボタンの照合結果（tryCandidates に渡す最小の形） */
export interface CustomTarget {
  el: Element;
  /** 正規化済み文言 */
  text: string;
  /** 表示用の文言 */
  label: string;
}

/**
 * 教えたボタンを探す。selector で 1 件に絞れてもそれだけでは押さず、
 * 文言の一致・可視・禁止語を必ず確認する（サイト更新で別のボタンに当たるため）。
 * 文言だけで探す経路は、バナー容器の中に限定する。
 * 禁止語は HARD だけで見る（「保存して閉じる」のような SOFT 禁止語は、
 * ユーザーが明示的に教えている以上そのまま押してよい）。
 */
export function resolveCustomTargets(rule: CustomRule, deps: RunDeps): CustomTarget[] {
  const { doc, env } = deps;
  const wanted = normalize(rule.text);
  if (wanted === '') {
    env.debug('カスタムルールに文言が無いので使わない', rule.id);
    return [];
  }

  /** 押してよい要素か（文言一致・可視・禁止語なし） */
  const accept = (el: Element): CustomTarget | null => {
    if (!isEligibleAnchor(el)) return null;
    if (!env.isVisible(el)) return null;
    const text = elementText(el);
    if (text !== wanted || isForbiddenHard(text)) return null;
    return { el, text, label: elementLabel(el) };
  };

  if (rule.selector) {
    try {
      const matched = Array.from(doc.querySelectorAll(rule.selector));
      const first = matched[0];
      if (matched.length === 1 && first) {
        const target = accept(first);
        if (target) return [target];
        env.debug('カスタムルールのセレクタは一致したが文言・可視条件を満たさない', rule.selector);
      }
    } catch {
      env.debug('カスタムルールのセレクタが不正', rule.selector);
    }
  }

  const out: CustomTarget[] = [];
  // 文言だけの経路は誤クリックしやすいので、バナー容器の中の要素に限る
  for (const container of findContainers(doc, env)) {
    // OK・はい・閉じるのような汎用文言は Cookie 固有語のある容器でだけ許す
    if (isGenericPhrase(wanted) && !container.cookieSpecific) continue;
    for (const el of deepQueryAll(container.el, CLICKABLE_SELECTOR)) {
      const target = accept(el);
      if (!target) continue;
      if (out.some((found) => found.el === el)) continue;
      out.push(target);
    }
  }
  return out;
}

async function layerCustom(deps: RunDeps): Promise<RunOutcome | null> {
  let matched = 0;
  for (const rule of deps.customRules) {
    if (rule.action !== deps.mode) continue;
    const targets = resolveCustomTargets(rule, deps);
    if (targets.length === 0) continue;
    matched++;
    deps.state.detectedAny = true;
    const result = await tryCandidates(targets, null, deps);
    deps.env.trace(`教えたボタン: 「${rule.text}」を試行 → ${result.ok ? '成功' : '失敗'}`);
    if (result.ok) {
      return {
        status: 'handled',
        method: 'custom',
        action: deps.mode,
        clickedText: result.clicked?.text,
        clickedLabel: result.clicked?.label,
        decision: 'custom',
      };
    }
  }
  if (matched === 0 && deps.customRules.length > 0) traceOnce(deps, '教えたボタン: 一致なし');
  return null;
}

// ---------------------------------------------------------------------------
// b. 即決 CMP 表
// ---------------------------------------------------------------------------

/**
 * 即決 CMP 表が容器まで見つけたのに対象のボタンが無かったときの控え（§5-5-b）。
 * ヒューリスティックが容器を拾えなくても hide の判断ができるよう容器を覚えておき、
 * 失敗要約にも「どの CMP の・どの容器で・どんなボタンが見つかったか」を残す（§5-8）。
 */
function noteQuickContainer(name: string, el: Element, deps: RunDeps): void {
  deps.state.cmp = name;
  deps.state.quickContainers.add(el);
  const detected = evaluateContainer(el, deps.env, { relaxSize: true });
  deps.state.diagnosis = {
    container: describeElement(el),
    buttons: detected?.buttons.length ?? 0,
    decisions: detected?.decisions.length ?? 0,
    labels: detected?.buttons.map((button) => button.label) ?? [],
    score: detected?.score ?? 0,
    signals: detected?.signals ?? [],
  };
}

async function layerQuick(deps: RunDeps): Promise<RunOutcome | null> {
  const { doc, env } = deps;
  let matched = 0;
  for (const cmp of quickCmpsFor(deps.isSubFrame)) {
    const container = deepQueryAll(doc, cmp.container).find((el) => env.isVisible(el));
    if (!container) continue;

    matched++;
    cloak(container, deps);
    deps.state.detectedAny = true;
    env.debug('即決 CMP 表で検出', cmp.name);

    const selector = deps.mode === 'reject' ? cmp.reject : cmp.accept;
    if (!selector) {
      // ボタンは文言ヒューリスティックに任せる
      noteQuickContainer(cmp.name, container, deps);
      traceOnce(deps, `即決表: ${cmp.name} を検出 → ボタンはヒューリスティックに任せる`);
      continue;
    }

    // `#deny` `#accept` `#declineButton` `button[action-type="DENY"]` のような汎用セレクタが
    // 無関係な要素に当たらないよう、探すのは容器の中だけ。無ければこの層は失敗として次へ
    const found = deepQueryAll(container, selector).filter((el) => env.isVisible(el));
    const buttons = found.map((el) => ({ el, text: elementText(el), label: elementLabel(el) }));
    if (buttons.length === 0) {
      noteQuickContainer(cmp.name, container, deps);
      traceOnce(deps, `即決表: ${cmp.name} を試行 → 失敗（容器の中にボタンが無い）`);
      continue;
    }

    const result = await tryCandidates(buttons, container, deps);
    env.trace(`即決表: ${cmp.name} を試行 → ${result.ok ? '成功' : '失敗（押しても消えない）'}`);
    if (result.ok) {
      return {
        status: 'handled',
        method: `quick:${cmp.name}`,
        action: deps.mode,
        clickedText: result.clicked?.text,
        clickedLabel: result.clicked?.label,
        // 即決表で押すのは拒否ボタンそのもの（accept モードは fixtures 専用なので付けない）
        ...(deps.mode === 'reject' ? { decision: 'reject-all' as const } : {}),
      };
    }
  }
  if (matched === 0) traceOnce(deps, '即決表: 一致なし');
  return null;
}

// ---------------------------------------------------------------------------
// c. Consent-O-Matic ルール
// ---------------------------------------------------------------------------

async function layerCom(deps: RunDeps): Promise<RunOutcome | null> {
  const { doc, env, mode } = deps;
  let matched = 0;
  for (const [name, rule] of Object.entries(deps.comRules)) {
    if (deps.state.cancelled) break;
    if (deps.state.triedComRules.has(name)) continue;
    // 実行できるメソッドが無いルールは必ず失敗して時間だけ捨てるので、検出も試さない（M3）
    if (!hasRunnableMethod(rule)) {
      debugOnce(deps, 'com: 実行できるメソッドが無いのでスキップ', name);
      continue;
    }
    // ルール単位で cloak した要素を覚えておき、失敗したら即座に見せ直す
    // （ルールが空振りしたまま cloak を残すと、その要素が監視窓の終わりまで消えたままになる）
    const cloakedByRule = new Set<Element>();
    const options = {
      doc,
      env,
      mode,
      allowCategories: deps.allowCategories,
      ruleName: name,
      isSubFrame: deps.isSubFrame,
      cloak: (el: Element) => {
        if (cloak(el, deps)) cloakedByRule.add(el);
      },
      isCancelled: () => deps.state.cancelled,
    };

    let detected = false;
    try {
      detected = detectRule(rule, createComContext(options));
    } catch (error) {
      env.debug('com: 検出で例外', name, error);
      continue;
    }
    if (!detected) continue;

    matched++;
    deps.state.triedComRules.add(name);
    deps.state.detectedAny = true;
    env.debug('com: ルールを検出', name);

    try {
      const result = await runRule(rule, options);
      env.trace(`COM: ${name} を試行 → ${result.ok ? '成功' : '失敗'}`);
      if (result.ok) {
        return {
          status: 'handled',
          method: `com:${name}`,
          action: mode,
          clickedText: result.clickedText,
          ...(result.clickedLabel ? { clickedLabel: result.clickedLabel } : {}),
          ...(result.decision ? { decision: result.decision } : {}),
          ...(result.allowed ? { allowed: result.allowed } : {}),
        };
      }
    } catch (error) {
      env.debug('com: ルール実行で例外', name, error);
      env.trace(`COM: ${name} を試行 → 失敗（例外）`);
    }
    // ここに来たのは失敗か例外。このルールが隠した分は元に戻す
    for (const el of cloakedByRule) uncloakElement(el);
  }
  if (matched === 0) traceOnce(deps, 'COM: 一致なし');
  return null;
}

// ---------------------------------------------------------------------------
// d. ヒューリスティック
// ---------------------------------------------------------------------------

function contextFor(container: DetectedContainer): CandidateContext {
  return { cookieSpecific: container.cookieSpecific, ageGate: container.ageGate };
}

/**
 * 採点のオプション（§14.1）。プリセット「すべて拒否」では選択肢のないお知らせも押さず、
 * fallback（既定は非表示）に落とす。設定はサイトごとの override を持たない全体設定なので、
 * deps.settings からそのまま読む。
 */
function scoreOptionsFor(deps: RunDeps): ScoreOptions {
  return { pressCloseOnNotice: deps.settings.pressCloseOnNotice };
}

/**
 * display:none にしてよい容器か。
 * バナー以外の固定 UI（チャットウィジェット・sticky ヘッダー）を消してしまわないよう、
 * Cookie 固有語があり、かつ「押さずに残した許可ボタン」がある容器に限る。
 */
function canHide(container: DetectedContainer): boolean {
  if (!container.cookieSpecific) return false;
  return scoreCandidates(container.buttons, 'accept', contextFor(container)).length > 0;
}

/**
 * 非表示にする。クリック候補は最小容器で探すが、消す範囲はそれを内包する最外側の容器
 * （BEM のボタン行だけを消してバナー本文が残るのを防ぐ）＋ 同じテキストの
 * fixed / absolute 祖先（バックドロップ）。
 */
function hideBanner(container: DetectedContainer, containers: readonly DetectedContainer[], deps: RunDeps): void {
  const { env, doc } = deps;
  const base = outermostContainer(container, containers).el;
  const target = hideTarget(base, env);
  env.debug('容器を非表示にする', target.tagName, target.id);
  uncloakElement(container.el);

  if (target !== base) {
    // 祖先まで登った場合は容器自身も消しておく。後でポータルルートの hide を
    // 解除してもバナーが出てこないようにするため
    hideElement(base, doc, null);
    hideElement(target, doc, deps.state.scroll);
    watchHiddenAncestor(target, base, doc);
    return;
  }
  hideElement(target, doc, deps.state.scroll);
}

/**
 * 設定パネル層（§5-5-e）が開いたパネルも消す。
 * バナー本体を hide できたときだけ呼ぶので、ページ全体に及ぶ要素でないことだけ確かめる。
 */
function hidePanel(panel: Element, deps: RunDeps): void {
  if (UNCLOAKABLE_TAGS.has(panel.tagName) || wrapsPageStructure(panel)) {
    deps.env.debug('パネルはページ全体に及ぶので非表示にしない', panel.tagName, panel.id);
    uncloakElement(panel);
    return;
  }
  deps.env.debug('パネルを非表示にする', panel.tagName, panel.id);
  hideElement(panel, deps.doc, null);
}

/**
 * 断れなかったときの挙動（§5-1 / §5-5-d fallback）。'accept'（許可して閉じる）は §14.1 で廃止。
 * panel は設定パネル層が開いたまま中止したパネル（§5-5-e）。バナーと同じ扱いで消す / 見せる。
 */
async function applyFallback(
  container: DetectedContainer,
  containers: readonly DetectedContainer[],
  deps: RunDeps,
  reason: UnhandledReason,
  panel: Element | null = null,
): Promise<RunOutcome | null> {
  const { settings, env } = deps;
  deps.state.reason = reason;
  env.debug('拒否ボタンが見つからないので fallback', settings.fallbackWhenNoReject, reason);

  if (settings.fallbackWhenNoReject === 'hide') {
    if (canHide(container)) {
      hideBanner(container, containers, deps);
      if (panel !== null && panel !== container.el) hidePanel(panel, deps);
      env.trace(`fallback: 非表示にした（理由: ${reason}）`);
      return { status: 'handled', method: 'hide', decision: 'hidden' };
    }
    env.debug('Cookie バナーと言い切れないので非表示にしない', container.el.tagName, container.el.id);
    env.trace(`fallback: そのまま（Cookie バナーと言い切れないので非表示にしない。理由: ${reason}）`);
  } else {
    env.trace(`fallback: そのまま（設定が「そのまま表示」。理由: ${reason}）`);
  }

  // leave（hide できなかったときも同じ）: cloak を外して見せる
  uncloakElement(container.el);
  if (panel !== null) uncloakElement(panel);
  return { status: 'unhandled', reason };
}

/**
 * fallback に落ちた理由（§5-8）。popup の説明文の出し分けに使う。
 * 「設定パネルを開いたのに操作できなかった」＞「押したが消えなかった」＞
 * 「断るボタンが無い」の順に、利用者にとって具体的な方を採る。
 */
function fallbackReason(panelAborted: boolean, clicked: boolean): UnhandledReason {
  if (panelAborted) return 'panel-aborted';
  return clicked ? 'click-failed' : 'no-reject';
}

/**
 * fallback を適用してよくなる時刻。
 * 容器の初検出から FALLBACK_GRACE_MS までは待つが、監視窓（observeSeconds）が先に切れると
 * cloak ごと外れてしまうので、その手前で打ち切る。
 */
function fallbackDeadline(deps: RunDeps): number {
  const seenAt = deps.state.containerSeenAt ?? deps.env.now();
  const windowEnd = deps.state.startedAt + deps.settings.observeSeconds * 1000 - FALLBACK_RETRY_MS;
  return Math.min(seenAt + FALLBACK_GRACE_MS, windowEnd);
}

/** 採用した容器を cloak し、別要素に変わっていたら猶予の起点をやり直す */
function noteContainer(container: DetectedContainer, deps: RunDeps): void {
  cloak(container.el, deps);
  const diagnosis: RunDiagnosis = {
    container: describeElement(container.el),
    buttons: container.buttons.length,
    decisions: container.decisions.length,
    labels: container.buttons.map((button) => button.label),
    score: container.score,
    signals: container.signals,
  };
  deps.state.diagnosis = diagnosis;
  if (deps.state.containerEl === container.el) return;
  deps.state.containerEl = container.el;
  deps.state.containerSeenAt = deps.env.now();
  // 容器が差し替わるたびに猶予の起点が戻るので、そのこと自体が診断の手がかりになる（§5-8）
  deps.env.trace(
    `容器: ${diagnosis.container} 文字数 ${container.text.length} ボタン ${diagnosis.buttons} 件` +
      ` ${traceLabels(diagnosis.labels)} cookieSpecific=${container.cookieSpecific}` +
      ` score=${diagnosis.score} [${diagnosis.signals.join('/')}]`,
  );
}

/**
 * 押せる候補も無く hide の見込みも無いまま抜けるときは cloak を外す。
 * cloak したまま返すと、監視窓が終わるまでバナーが「見えないのに居る」状態になる。
 * cloak を残してよいのは「このあと hide しうる」＝ reject モードで fallback が hide、
 * かつ hide の条件を満たす容器のときだけ（accept モードや fallback=leave では
 * 消える見込みが無いので、そのまま見せる）。
 */
function releaseIfHopeless(container: DetectedContainer, deps: RunDeps): void {
  if (deps.mode === 'reject' && deps.settings.fallbackWhenNoReject === 'hide' && canHide(container)) return;
  uncloakElement(container.el);
}

/**
 * 文言判定で押したボタンから decision を決める（§14.6）。
 * 閉じる語（選択肢のないお知らせ）は「断った」わけではないので dismissed。
 * 拒否語・必要最小系は reject-all（accept モードは fixtures 専用なので付けない）。
 */
function decisionForHeuristic(
  clicked: ScoredCandidate | undefined,
  deps: RunDeps,
): { decision?: Decision } {
  if (clicked?.kind === 'close') return { decision: 'dismissed' };
  return deps.mode === 'reject' ? { decision: 'reject-all' } : {};
}

/**
 * 即決 CMP 表が見つけた容器（§5-5-b の取りこぼし）を、大きさの下限だけ緩めて拾い直す。
 * 対象は「その CMP だと言い切れる」セレクタに一致した要素だけで、Cookie 固有語・
 * 決定ボタンの有無といった他の条件はそのまま課す。面積の小さい順。
 */
function quickContainersOf(deps: RunDeps): DetectedContainer[] {
  const found: DetectedContainer[] = [];
  for (const el of deps.state.quickContainers) {
    if (!el.isConnected) continue;
    const container = evaluateContainer(el, deps.env, { relaxSize: true });
    if (container !== null) found.push(container);
  }
  found.sort((a, b) => a.area - b.area);
  return found;
}

/**
 * ヒューリスティックが見る容器。
 * ① 1 つも拾えなかったときは即決 CMP 表が見つけた容器を控えにする。
 * `ASIDE#usercentrics-cmp-ui` のように**ホスト自身の大きさが 0** の CMP でも、
 * fallback（hide）の判断まで進めるようにするため。
 * ② 拾えたときも、最小容器を**内包する**即決表の容器があればそちらを先頭に据える。
 * 即決表のセレクタは「その CMP だと言い切れる」ものなので、中の断片より CMP の根の方が
 * 正しい容器（ibm.com の TrustArc は、説明文だけの `DIV#truste-consent-text` が最小容器に
 * なり、設定導線「オプションの続き」が容器の外に出て設定パネル層へ進めなかった）。
 * 残りのリストはそのまま後ろに残す（hide の範囲を決める outermostContainer が使う）。
 * 戻り値は**先頭が採用容器**で、以降は順不同（②で先頭を差し替えるため、面積昇順の約束は
 * そこで崩れる）。
 */
function heuristicContainers(deps: RunDeps): DetectedContainer[] {
  const found = findContainers(deps.doc, deps.env);
  if (deps.state.quickContainers.size === 0) return found;

  const fromQuick = quickContainersOf(deps);
  const inner = found[0];
  if (inner === undefined) return fromQuick;

  const root = fromQuick.find((candidate) => containsDeep(candidate.el, inner.el));
  if (root === undefined) return found;
  // すでに拾えている容器なら並べ直すだけ（同じ要素を二重に持たせない）
  return [root, ...found.filter((container) => container.el !== root.el)];
}

async function layerHeuristic(deps: RunDeps): Promise<RunOutcome | null> {
  let containers = heuristicContainers(deps);
  let container = containers[0];
  if (!container) {
    traceOnce(deps, 'ヒューリスティック: 容器なし');
    return null;
  }

  noteContainer(container, deps);
  deps.state.detectedAny = true;
  deps.env.debug('ヒューリスティックで容器を検出', container.el.tagName, container.el.id);

  // 押したのに同意画面が消えなかったことを覚えておく（unhandled の理由に使う。§5-8）
  let clicked = false;
  for (;;) {
    const candidates = scoreCandidates(container.buttons, deps.mode, contextFor(container), scoreOptionsFor(deps));
    // 候補の行は同じ内容なら 1 回だけ（猶予中は 250ms ごと、監視中は毎秒ここを通るため）
    traceOnce(
      deps,
      candidates.length === 0
        ? 'ヒューリスティック: 候補 0'
        : `ヒューリスティック: 候補 ${candidates.length} 件 ${traceLabels(candidates.map((c) => c.label))}`,
    );
    if (candidates.length > 0) {
      const result = await tryCandidates(candidates, container.el, deps);
      if (result.ok) {
        deps.env.trace(`ヒューリスティック: 「${result.clicked?.label ?? ''}」を押した → 成功`);
        return {
          status: 'handled',
          method: 'heuristic',
          action: deps.mode,
          clickedText: result.clicked?.text,
          clickedLabel: result.clicked?.label,
          ...decisionForHeuristic(result.clicked, deps),
        };
      }
      if (result.tries > 0) {
        if (!clicked) deps.env.trace(`ヒューリスティック: ${result.tries} 件押した → 失敗（同意画面が消えない）`);
        clicked = true;
      }
    }

    if (deps.state.cancelled) {
      deps.env.trace('ヒューリスティック: 監視窓が切れたので打ち切り（fallback も走らない）');
      releaseIfHopeless(container, deps);
      return null;
    }
    // fallback は reject モードのみ。accept は次のパス（MutationObserver）に任せる
    if (deps.mode !== 'reject') {
      releaseIfHopeless(container, deps);
      return null;
    }
    if (deps.env.now() >= fallbackDeadline(deps)) {
      // 断るボタンが無いので、fallback の前に「設定を開いてチェックを外す」を 1 度だけ試す
      const attempt = await tryPanel(deps, { container, candidates, cloak: (el) => cloak(el, deps) });
      if (attempt?.outcome) return attempt.outcome;
      if (deps.state.cancelled) {
        deps.env.trace('設定パネル: 監視窓が切れたので打ち切り（fallback も走らない）');
        // 中止したパネルは見せ直す（監視窓の終わりに cloak ごと外れるため）
        if (attempt?.panel) uncloakElement(attempt.panel);
        releaseIfHopeless(container, deps);
        return null;
      }
      const panel = attempt?.panel ?? null;
      return applyFallback(container, containers, deps, fallbackReason(panel !== null, clicked), panel);
    }

    // 猶予の間は cloak したまま待ち、遅れて出てくる拒否ボタンを拾う
    await deps.env.sleep(FALLBACK_RETRY_MS);
    if (deps.state.cancelled) {
      deps.env.trace('ヒューリスティック: 監視窓が切れたので打ち切り（fallback も走らない）');
      releaseIfHopeless(container, deps);
      return null;
    }
    const next = heuristicContainers(deps);
    const first = next[0];
    if (!first) {
      deps.env.debug('猶予中に容器が消えた');
      deps.env.trace('ヒューリスティック: 猶予中に容器が消えた');
      // 容器としては採用されなくなったが、まだ画面に居るかもしれないので cloak は外す
      uncloakElement(container.el);
      return null;
    }
    // 容器が別要素に差し替わっていることがあるので毎回 cloak する
    containers = next;
    container = first;
    noteContainer(container, deps);
  }
}

// ---------------------------------------------------------------------------

const LAYERS: Record<LayerName, (deps: RunDeps) => Promise<RunOutcome | null>> = {
  custom: layerCustom,
  quick: layerQuick,
  com: layerCom,
  heuristic: layerHeuristic,
};

/** 層の実行順を決める */
export function layerOrder(deps: RunDeps): LayerName[] {
  const allowsSome = deps.mode === 'reject' && deps.allowCategories.length > 0;
  return allowsSome ? ['custom', 'com', 'quick', 'heuristic'] : ['custom', 'quick', 'com', 'heuristic'];
}

/** 1 パス実行する。処理できなければ null */
export async function runOnce(deps: RunDeps): Promise<RunOutcome | null> {
  // サイト本来の overflow を、容器を触る前に記録しておく（hide 時のスクロール復帰用）
  if (deps.state.scroll === null) deps.state.scroll = captureScroll(deps.doc);

  // 層ごとの所要時間（§5-8）。層は要素数に比例して重くなるので、監視窓（既定 20 秒）を
  // 使い切って打ち切られたときに「どの層で時間を使ったか」が分かるようにする
  const spent: string[] = [];
  const passStartedAt = deps.env.now();

  for (const layer of layerOrder(deps)) {
    if (deps.state.cancelled) break;
    const layerStartedAt = deps.env.now();
    let outcome: RunOutcome | null = null;
    try {
      outcome = await LAYERS[layer](deps);
    } catch (error) {
      deps.env.debug('層の実行で例外', layer, error);
      deps.env.trace(`層 ${layer}: 例外で中断`);
    }
    spent.push(`${layer} ${Math.round(deps.env.now() - layerStartedAt)}ms`);
    if (outcome) {
      tracePass(deps, spent, passStartedAt, outcome.method ?? outcome.status);
      return outcome;
    }
  }
  // どの層も動かせなかった。何かは検出しているので、押せるボタンの候補すら
  // 集まらなかったこと（＝容器の中のボタンを判別できなかったこと）を残す（§5-8）
  if (deps.state.detectedAny && !deps.state.cancelled && deps.state.reason === null) {
    deps.state.reason = 'no-candidates';
  }
  tracePass(deps, spent, passStartedAt, deps.state.cancelled ? '打ち切り' : '未処理');
  return null;
}

/** 1 パスの締めくくり 1 行（§5-8）。層ごとの所要時間と結末をまとめる */
function tracePass(deps: RunDeps, spent: readonly string[], startedAt: number, result: string): void {
  deps.env.trace(`パス: ${spent.join(' / ')} 合計 ${Math.round(deps.env.now() - startedAt)}ms → ${result}`);
}
