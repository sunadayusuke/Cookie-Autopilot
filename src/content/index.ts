// content script の起動・監視・メッセージ受信（docs/SPEC.md §5）
// run_at: document_start で走るので、document.body が無い時点でも動く必要がある。

import { injectCloakStyle, removeCloakStyle, uncloakAll } from '../engine/cloak';
import { cloakSelectors } from '../engine/cmpQuick';
import { parseComRules } from '../engine/com/engine';
import { createEnv } from '../engine/env';
import { elementLabel, elementText } from '../engine/normalize';
import type { RunDeps, RunOutcome } from '../engine/run';
import { clickAndVerify, createRunState, runOnce, unhandledSummary } from '../engine/run';
import { isExtensionMessage, sendStatus } from '../shared/messages';
import {
  effectiveCategories,
  effectiveMode,
  getComRules,
  getCustomRulesForHost,
  getSettings,
  getSiteOverrides,
  hasChromeStorage,
  saveCustomRule,
} from '../shared/storage';
import { siteKey } from '../shared/siteKey';
import { cancelPicker, isPickerActive, startPicker } from './picker';

/** 監視窓のあいだ見直す間隔 */
const POLL_INTERVAL_MS = 1000;

const IS_SUB_FRAME = window.top !== window;
const DEBOUNCE_MS = 300;
const MIN_INTERVAL_MS = 500;
/** 画面遷移（SPA）を拾ってから監視をやり直すまでの待ち。連続する遷移で暴発しないため */
const NAVIGATION_DEBOUNCE_MS = 1000;
/** 画面遷移による再実行の上限（1 回の滞在中） */
const MAX_NAVIGATION_RESTARTS = 5;
/** chrome API が無い環境（fixtures）で同梱ルールを読む場所 */
const FIXTURE_RULES_URL = '/rules/consent-o-matic.json';

let deps: RunDeps | null = null;
let host = '';
let observer: MutationObserver | null = null;
let windowTimer: ReturnType<typeof setTimeout> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
/** 監視窓のあいだ定期的に見直すタイマー（shadow DOM の中の変化は MutationObserver に届かない） */
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastRunAt = 0;
let running = false;
let finished = false;
/** 監視窓が切れたか（実行中のパスがあれば、その完了を待って確定する） */
let windowExpired = false;
/** 実行中に変異があったか（完了後に 1 回だけ再実行する） */
let pending = false;
/** 直近に見ていた URL のパス。ここが変わったら画面遷移とみなす */
let currentPath = location.pathname;
/** 画面遷移で監視をやり直した回数 */
let navigationRestarts = 0;
let navigationTimer: ReturnType<typeof setTimeout> | null = null;
/** `<html data-cookie-autopilot="…">` に最後に書いた状態（付け直しに使う） */
let markState = '';

// cloak は設定を待たずに注入する（バナーを一瞬でも見せないため）。
// モードが off だった場合は main() で外す。
injectCloakStyle(document, cloakSelectors(IS_SUB_FRAME));
// 動いていることを外から確かめられるようにする（デバッグログを出さない設定でも残る）。
// コンソールで document.documentElement.dataset.cookieAutopilot を見れば状態が分かる
mark('loading');

void main();

/**
 * `<html data-cookie-autopilot="…">` に状態を書く（動作確認用。失敗しても無視する）。
 * `loading` / `watching` / `watching+debug` / `handled` / `unhandled` / `none` / `off`。
 */
function mark(state: string): void {
  markState = state;
  applyMark();
}

/**
 * 覚えている状態を書き直す。document_start では `<html>` がまだ無くて書けないことがあり、
 * フレームワークのハイドレーションで属性ごと消えることもあるので、
 * DOM の準備ができた時点と状態が変わるたびに付け直す（OBS-001）。
 */
function applyMark(): void {
  if (markState === '') return;
  try {
    document.documentElement?.setAttribute('data-cookie-autopilot', markState);
  } catch {
    // document がまだ無い環境では諦める
  }
}

/** 監視中の表示。デバッグログの有無まで出すと実サイトでの確認がしやすい */
function markWatching(): void {
  mark(deps?.settings.debug === true ? 'watching+debug' : 'watching');
}

async function main(): Promise<void> {
  host = siteKey(topHostname());
  registerMessageListener();

  const next = await loadDeps();
  if (!next) {
    await goOff();
    // off でも同じく、DOM の準備ができてから書き直す（cloak は張り直さない）
    await domReady();
    applyMark();
    return;
  }
  deps = next;
  markWatching();

  watchNavigation();
  await domReady();
  // document_start で書けなかった / ハイドレーションで消えた分をここで必ず付け直す
  applyMark();
  startObserving();
}

/**
 * 現在の設定を storage から読み直して deps を組む。実効モードが off なら null。
 * 起動時と rerun の両方から呼ぶ（rerun で「このサイトの設定」の変更を反映するため。M2）。
 */
async function loadDeps(): Promise<RunDeps | null> {
  const settings = await getSettings();
  const env = createEnv(settings.debug);
  const overrides = await getSiteOverrides();
  const mode = effectiveMode(host, overrides);
  const allowCategories = effectiveCategories(host, settings, overrides);

  if (mode === 'off') {
    env.debug('このサイトでは無効', host);
    return null;
  }

  const [customRules, comRules] = await Promise.all([getCustomRulesForHost(host), loadComRules()]);
  const parsed = parseComRules(comRules);
  env.debug('起動', {
    host,
    mode,
    allowCategories,
    customRules: customRules.length,
    comRules: Object.keys(parsed).length,
  });

  return {
    doc: document,
    env,
    settings,
    mode,
    allowCategories,
    customRules,
    comRules: parsed,
    isSubFrame: IS_SUB_FRAME,
    state: createRunState(),
  };
}

/** このサイトでは動かさない: 監視を止め、cloak を外して off を報告する */
async function goOff(): Promise<void> {
  mark('off');
  if (deps) deps.state.cancelled = true;
  finished = true;
  stopObserving();
  deps = null;
  removeCloakStyle(document);
  uncloakAll(document);
  if (!IS_SUB_FRAME) await sendStatus({ type: 'status', host, status: 'off' });
}

/**
 * サイト設定のキーに使うホスト名。
 * サブフレームでは自分（CMP ベンダーのドメイン）ではなくトップのホストを使う。
 */
function topHostname(): string {
  if (!IS_SUB_FRAME) return location.hostname;
  try {
    const origins = location.ancestorOrigins;
    const top = origins && origins.length > 0 ? origins[origins.length - 1] : '';
    if (top) return new URL(top).hostname;
  } catch {
    /* 取れない環境（Firefox 等）では自分のホストで代用する */
  }
  return location.hostname;
}

/** ルールは storage.local から。chrome が無い環境では相対 fetch（失敗は無視） */
async function loadComRules(): Promise<unknown> {
  const payload = await getComRules();
  if (payload) return payload.rules;
  if (hasChromeStorage()) return {};
  try {
    const response = await fetch(FIXTURE_RULES_URL);
    if (!response.ok) return {};
    const json: unknown = await response.json();
    if (json && typeof json === 'object' && 'rules' in json) return (json as { rules: unknown }).rules;
    return json;
  } catch {
    return {};
  }
}

function domReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

// ---------------------------------------------------------------------------
// 監視
// ---------------------------------------------------------------------------

function startObserving(): void {
  if (!deps) return;
  stopObserving();
  markWatching();
  // document_start では <html> がまだ無く注入できていないことがある（重複時は既存を返す）
  injectCloakStyle(document, cloakSelectors(IS_SUB_FRAME));
  finished = false;
  windowExpired = false;
  pending = false;
  // 監視窓をやり直すので、猶予の起点と打ち切り要求も戻す
  deps.state.startedAt = deps.env.now();
  deps.state.cancelled = false;

  const seconds = deps.settings.observeSeconds;
  observer = new MutationObserver(scheduleRun);
  try {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open'],
    });
  } catch {
    observer = null;
  }
  windowTimer = setTimeout(() => void onWindowEnd(), seconds * 1000);
  // Stencil などの Web コンポーネントは shadow root の中に同意画面を描く。
  // shadow root の変化は document の MutationObserver に届かないので、監視窓のあいだは
  // 定期的に見直す（実サイト mercedes-benz.co.jp の cmm-cookie-banner がこの形）
  pollTimer = setInterval(() => {
    if (finished || running) return;
    void runPass();
  }, POLL_INTERVAL_MS);
  // 監視中であることを popup に伝える（結果が出るまで「状態を取得できません」にしないため）
  if (!IS_SUB_FRAME) void sendStatus({ type: 'status', host, status: 'watching' });
  // 進行中のパスがあれば二重に走らせず、その完了後に 1 回だけ拾う（rerun との競合）
  if (running) pending = true;
  else void runPass();
}

/**
 * 監視をやり直す（popup の rerun / picker の中止から使う。猶予の起点も cloak も初期状態に戻す）。
 * 設定は毎回読み直す。popup で「このサイトの設定」を変えてから再実行したときに、
 * 起動時のプリセットのまま走らないようにするため（M2）。
 */
async function restart(): Promise<void> {
  // picker 中は自動処理を再開しない（ユーザーが選んでいる最中に hide されると混乱するため）
  if (isPickerActive()) return;
  const next = await loadDeps();
  if (!next) {
    await goOff();
    return;
  }
  deps = next;
  injectCloakStyle(document, cloakSelectors(IS_SUB_FRAME));
  startObserving();
}

function stopObserving(): void {
  observer?.disconnect();
  observer = null;
  if (windowTimer !== null) clearTimeout(windowTimer);
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  if (pollTimer !== null) clearInterval(pollTimer);
  windowTimer = null;
  debounceTimer = null;
  pollTimer = null;
}

// ---------------------------------------------------------------------------
// 画面遷移（SPA）
// ---------------------------------------------------------------------------

/**
 * 画面遷移を見張る（§5-4）。監視窓が終わったあとに遷移した先で出る同意画面を拾うため。
 * 注意: content script は isolated world で動くので、ここでの `history` の差し替えが
 * 捕まえるのは**同じ world からの呼び出し**（＝ content.js をページのスクリプトとして
 * 読む fixtures）だけ。実際の拡張ではページ側の `pushState` は素通りするので、
 * 効くのは `popstate`（DOM イベントなので isolated world にも届く）になる。
 */
/** location を見張る間隔と上限（pushState の差し替えは isolated world では効かないため） */
const LOCATION_POLL_MS = 1500;
const LOCATION_POLL_LIMIT_MS = 10 * 60 * 1000;

function watchNavigation(): void {
  window.addEventListener('popstate', () => onNavigated());
  // content script は isolated world なので、ページ側の history.pushState は差し替えられない。
  // 実拡張で SPA の遷移を拾うには location を定期的に見るのが確実（文字列比較だけなので軽い）
  let lastPath = location.pathname;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    if (Date.now() - startedAt > LOCATION_POLL_LIMIT_MS) {
      clearInterval(timer);
      return;
    }
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    onNavigated();
  }, LOCATION_POLL_MS);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = history[name];
    if (typeof original !== 'function') continue;
    history[name] = function patched(this: History, ...args: Parameters<History['pushState']>): void {
      original.apply(this, args);
      onNavigated();
    };
  }
}

/**
 * URL のパスが変わったら監視をやり直す。
 * クエリ・ハッシュだけの変化（絞り込み・タブ切り替え）では再実行しない。
 * picker 中は無視し、off のサイト（deps が無い）では何もしない。
 * 連続する遷移で暴発しないよう 1 秒のデバウンスを掛け、滞在中の再実行は 5 回まで。
 */
function onNavigated(): void {
  const path = location.pathname;
  if (path === currentPath) return;
  currentPath = path;
  if (!deps || isPickerActive()) return;
  if (navigationRestarts >= MAX_NAVIGATION_RESTARTS) {
    deps.env.debug('画面遷移の再実行は上限に達している', navigationRestarts);
    return;
  }
  if (navigationTimer !== null) clearTimeout(navigationTimer);
  navigationTimer = setTimeout(() => {
    navigationTimer = null;
    if (!deps || isPickerActive()) return;
    navigationRestarts++;
    deps.env.debug('画面遷移で監視をやり直す', path, navigationRestarts);
    void restart();
  }, NAVIGATION_DEBOUNCE_MS);
}

/**
 * MutationObserver からの再試行（トレーリング throttle。最短間隔 500ms）。
 * タイマーが張られている間の変異は捨て、実行中の変異は pending にして完了後に 1 回だけ拾う
 * （連続して変異するページでも必ず再パスが走るようにする）。
 */
function scheduleRun(): void {
  if (finished || !deps) return;
  if (running) {
    pending = true;
    return;
  }
  if (debounceTimer !== null) return;
  const sinceLast = Date.now() - lastRunAt;
  const wait = Math.max(DEBOUNCE_MS, MIN_INTERVAL_MS - sinceLast);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runPass();
  }, wait);
}

async function runPass(): Promise<void> {
  if (finished || running || !deps) return;
  running = true;
  pending = false;
  lastRunAt = Date.now();
  let outcome: RunOutcome | null = null;
  try {
    outcome = await runOnce(deps);
  } catch (error) {
    // 実行中に off へ切り替わると deps が null になりうる（M2）
    deps?.env.debug('パスで例外', error);
  } finally {
    running = false;
    await settlePass(outcome);
  }
}

/** パス完了後の後始末。監視窓が切れていたらここで確定する */
async function settlePass(outcome: RunOutcome | null): Promise<void> {
  if (outcome) {
    await finish(outcome);
    return;
  }
  if (windowExpired) {
    await finishWindow();
    return;
  }
  if (pending) {
    pending = false;
    scheduleRun();
  }
}

async function finish(outcome: RunOutcome): Promise<void> {
  // 監視窓の終了と競合したときも、処理できたことは必ず報告する
  if (finished && outcome.status !== 'handled') return;
  finished = true;
  mark(outcome.status);
  stopObserving();
  // 成功したら cloak は外す（サイト側がバナーを消している）
  removeCloakStyle(document);
  uncloakAll(document);
  deps?.env.debug('処理完了', outcome);

  const message = {
    type: 'status' as const,
    host,
    status: outcome.status,
    ...(outcome.method ? { method: outcome.method } : {}),
    ...(outcome.action ? { action: outcome.action } : {}),
    ...(outcome.clickedText ? { clickedText: outcome.clickedText } : {}),
    ...(outcome.clickedLabel ? { clickedLabel: outcome.clickedLabel } : {}),
    ...(outcome.decision ? { decision: outcome.decision } : {}),
    ...(outcome.allowed ? { allowed: outcome.allowed } : {}),
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
  if (outcome.status === 'unhandled') logUnhandled();
  await sendStatus(message);
}

/**
 * 処理できなかったことをコンソールに残す（§5-8）。
 * デバッグログが有効なときだけ、利用者が見てそのまま報告できるよう
 * `console.info` で 1 行出す（`console.debug` は既定のログレベルで表示されない）。
 */
function logUnhandled(): void {
  if (!deps?.settings.debug) return;
  console.info('[cookie-autopilot] 同意画面を処理できませんでした:', unhandledSummary(deps.state));
}

/** 監視時間切れ。実行中のパスがあれば打ち切りを頼み、確定はパスの完了後に行う */
async function onWindowEnd(): Promise<void> {
  if (finished) return;
  windowExpired = true;
  if (running) {
    if (deps) deps.state.cancelled = true;
    deps?.env.debug('監視終了（実行中のパスの完了を待つ）');
    return;
  }
  await finishWindow();
}

async function finishWindow(): Promise<void> {
  if (finished) return;
  finished = true;
  stopObserving();
  removeCloakStyle(document);
  uncloakAll(document);

  const detected = deps?.state.detectedAny === true;
  mark(detected ? 'unhandled' : 'none');
  deps?.env.debug('監視終了', { detected });
  if (detected) {
    const reason = deps?.state.reason ?? null;
    logUnhandled();
    await sendStatus({ type: 'status', host, status: 'unhandled', ...(reason ? { reason } : {}) });
    return;
  }
  // バナー未検出はトップフレームだけが報告する
  if (!IS_SUB_FRAME) await sendStatus({ type: 'status', host, status: 'none' });
}

// ---------------------------------------------------------------------------
// メッセージ受信（popup → content）
// ---------------------------------------------------------------------------

function registerMessageListener(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isExtensionMessage(message)) return undefined;

    switch (message.type) {
      case 'rerun': {
        void restart();
        sendResponse({ ok: true });
        return undefined;
      }
      case 'startPicker': {
        if (!IS_SUB_FRAME) beginPicker(message.action);
        sendResponse({ ok: true });
        return undefined;
      }
      case 'cancelPicker': {
        cancelPicker();
        sendResponse({ ok: true });
        return undefined;
      }
      default:
        return undefined;
    }
  });
}

function beginPicker(action: 'reject' | 'accept'): void {
  // picker 中は自動処理を止める。実行中のパスにも打ち切りを頼む
  // （ユーザーが自分でボタンを選んでいる最中に fallback で hide されると混乱するため）
  finished = true;
  if (deps) deps.state.cancelled = true;
  stopObserving();

  startPicker({
    doc: document,
    action,
    onPicked: async ({ el, selector, text }) => {
      // 保存に失敗しても、教えられたボタンを押すところまではやり切る
      try {
        await saveCustomRule({
          host,
          action,
          ...(selector ? { selector } : {}),
          ...(text ? { text } : {}),
        });
      } catch (error) {
        console.warn('[cookie-autopilot] 教えたボタンを保存できませんでした', error);
      }
      const clickedText = text || elementText(el);
      const clickedLabel = elementLabel(el);
      if (deps) {
        deps.state.tried = new WeakSet<Element>();
        deps.state.cancelled = false;
        await clickAndVerify(el, el, deps);
      } else {
        (el as HTMLElement).click?.();
      }
      removeCloakStyle(document);
      uncloakAll(document);
      mark('handled');
      await sendStatus({
        type: 'status',
        host,
        status: 'handled',
        method: 'custom',
        action,
        decision: 'custom',
        ...(clickedText ? { clickedText } : {}),
        ...(clickedLabel ? { clickedLabel } : {}),
      });
    },
    // 中止したら cloak を残さない。自動処理は rerun と同じ経路で再開する
    onCancel: () => {
      removeCloakStyle(document);
      uncloakAll(document);
      void restart();
    },
  });
}
