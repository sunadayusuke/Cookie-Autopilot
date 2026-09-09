// service worker（docs/SPEC.md §7）
// ステータス保存・バッジ更新・Consent-O-Matic ルールの同梱コピーと定期更新。

import type { ExtensionMessage, StatusMessage } from '../shared/messages';
import { isExtensionMessage } from '../shared/messages';
import {
  clearTabStatus,
  getComRules,
  getComRulesStatus,
  getOnboardingShownAt,
  getSettings,
  getTabStatus,
  recordSiteHistory,
  saveComRules,
  saveComRulesStatus,
  saveOnboardingShownAt,
  saveTabStatus,
} from '../shared/storage';
import type { ComRulesPayload, TabStatus } from '../shared/types';

const RULES_ALARM = 'cookie-autopilot:update-rules';
/** 初期設定ページ（§14.3） */
const ONBOARDING_PATH = 'onboarding.html';
/** 週 1 回 */
const RULES_PERIOD_MINUTES = 60 * 24 * 7;
/** これ以上経過していたら onStartup で即時更新する（M5: alarm は Chrome が起動していない間は発火しないため） */
const RULES_MAX_AGE_MS = RULES_PERIOD_MINUTES * 60 * 1000;
const BUNDLED_RULES_PATH = 'rules/consent-o-matic.json';
const SOURCE = 'https://github.com/cavi-au/Consent-O-Matic';
const RULES_LIST_URL = 'https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/rules-list.json';
const FETCH_CONCURRENCY = 8;

const BADGE_HANDLED = { text: '✓', color: '#16a34a' };
const BADGE_UNHANDLED = { text: '!', color: '#f59e0b' };

// ---------------------------------------------------------------------------
// バッジ
// ---------------------------------------------------------------------------

/** バッジを出さないステータス（watching は結果が出るまでの経過表示なので空のまま） */
const SILENT_STATUS = new Set<TabStatus['status']>(['none', 'off', 'watching']);

async function updateBadge(tabId: number, status: TabStatus['status'] | null): Promise<void> {
  if (!chrome.action?.setBadgeText) return;
  const settings = await getSettings();
  const badge = !settings.showBadge || status === null || SILENT_STATUS.has(status)
    ? null
    : status === 'handled'
      ? BADGE_HANDLED
      : BADGE_UNHANDLED;
  try {
    await chrome.action.setBadgeText({ tabId, text: badge?.text ?? '' });
    if (badge) await chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color });
  } catch {
    // タブが既に閉じている場合など
  }
}

/**
 * handled は他のステータスで上書きしない（iframe からの handled を優先）。
 * watching（監視開始の経過報告）が既存の handled を消さないのも、この 1 行で足りる。
 * 逆に watching は handled / unhandled で上書きされる。
 */
function shouldReplace(previous: TabStatus | null, next: StatusMessage): boolean {
  if (!previous) return true;
  if (previous.status === 'handled' && next.status !== 'handled') return false;
  return true;
}

/** サブフレームからの unhandled は無視する（handled は従来どおりサブフレームも優先して受け付ける。L11） */
async function handleStatus(
  message: StatusMessage,
  tabId: number | undefined,
  frameId: number | undefined,
): Promise<void> {
  if (typeof tabId !== 'number') return;
  if (message.status === 'unhandled' && frameId !== 0) return;

  const previous = await getTabStatus(tabId);
  if (!shouldReplace(previous, message)) return;

  const status: TabStatus = {
    host: message.host,
    status: message.status,
    at: Date.now(),
    ...(message.method ? { method: message.method } : {}),
    ...(message.action ? { action: message.action } : {}),
    ...(message.clickedText ? { clickedText: message.clickedText } : {}),
    ...(message.clickedLabel ? { clickedLabel: message.clickedLabel } : {}),
    ...(message.decision ? { decision: message.decision } : {}),
    ...(message.allowed ? { allowed: message.allowed } : {}),
    ...(message.reason ? { reason: message.reason } : {}),
  };
  try {
    await saveTabStatus(tabId, status);
  } catch {
    // session storage への保存に失敗しても致命的ではない（バッジ更新は試みる）
  }
  await updateBadge(tabId, status.status);
  await recordSiteHistoryIfNeeded(status);
}

/**
 * 一度答えたサイトは次回以降 Cookie の同意画面自体が出ないため、以前の記録を残す（§14.8）。
 * `hide`（method: 'hide'）は同意していないので対象外（バナーは再訪のたびに出て毎回隠すだけなので、
 * 現在の結果表示で足りる）。
 */
async function recordSiteHistoryIfNeeded(status: TabStatus): Promise<void> {
  if (status.status !== 'handled' || status.method === 'hide') return;
  try {
    await recordSiteHistory({
      host: status.host,
      at: status.at,
      ...(status.method ? { method: status.method } : {}),
      ...(status.clickedLabel ? { clickedLabel: status.clickedLabel } : {}),
      ...(status.decision ? { decision: status.decision } : {}),
      ...(status.allowed ? { allowed: status.allowed } : {}),
    });
  } catch {
    // 記録できなくても致命的ではない（次に処理したときにまた記録される）
  }
}

// ---------------------------------------------------------------------------
// Consent-O-Matic ルール
// ---------------------------------------------------------------------------

async function readBundledRules(): Promise<ComRulesPayload | null> {
  try {
    const response = await fetch(chrome.runtime.getURL(BUNDLED_RULES_PATH));
    if (!response.ok) return null;
    const json = (await response.json()) as Partial<ComRulesPayload>;
    if (!json || typeof json !== 'object' || !json.rules) return null;
    return {
      fetchedAt: typeof json.fetchedAt === 'number' ? json.fetchedAt : Date.now(),
      source: typeof json.source === 'string' ? json.source : SOURCE,
      rules: json.rules,
    };
  } catch {
    return null;
  }
}

/** 同梱ルールが未保存、または保存済みより新しければコピーする（L6: 拡張更新で同梱 JSON が
 * 新しくなっているのに、未保存判定だけだと古い既存 storage が維持されてしまう問題への対処） */
async function seedRules(): Promise<void> {
  const current = await getComRules();
  const bundled = await readBundledRules();
  if (!bundled) return;
  if (current && current.fetchedAt >= bundled.fetchedAt) return;
  try {
    await saveComRules(bundled);
    await saveComRulesStatus({
      updatedAt: Date.now(),
      count: Object.keys(bundled.rules).length,
      ok: true,
    });
  } catch {
    // 同梱データの反映に失敗しても致命的ではない（次回起動時に再試行される）
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

function extractReferences(list: unknown): string[] {
  if (Array.isArray(list)) return list.filter((url): url is string => typeof url === 'string');
  if (list && typeof list === 'object') {
    for (const key of ['references', 'rulesLists', 'rules']) {
      const value = (list as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value.filter((url): url is string => typeof url === 'string');
    }
  }
  return [];
}

/** rules-list.json の URL からファイル名相当を取り出す（失敗名の表示用） */
function refLabel(url: string): string {
  const parts = url.split('/');
  return parts[parts.length - 1] || url;
}

/**
 * GitHub から再取得して差し替える。
 * raw.githubusercontent.com は CORS を許可しているので host_permissions は不要。
 * 取得できた分だけ既存ルールにマージする（同名は上書き、取得に失敗した分は既存を維持。M6）。
 */
export async function updateRulesFromNetwork(): Promise<{ ok: boolean; count: number; failed: number; error?: string }> {
  try {
    const listResponse = await fetch(RULES_LIST_URL);
    if (!listResponse.ok) throw new Error(`rules-list.json HTTP ${listResponse.status}`);
    const references = extractReferences(await listResponse.json());
    if (references.length === 0) throw new Error('ルール一覧が空です');

    const failedNames: string[] = [];
    const fetched = await mapLimit(references, FETCH_CONCURRENCY, async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as unknown;
      } catch {
        failedNames.push(refLabel(url));
        return null;
      }
    });

    const fetchedRules: Record<string, unknown> = {};
    for (const json of fetched) {
      if (!json || typeof json !== 'object' || Array.isArray(json)) continue;
      for (const [name, rule] of Object.entries(json)) {
        if (rule && typeof rule === 'object') fetchedRules[name] = rule;
      }
    }
    if (Object.keys(fetchedRules).length === 0 && failedNames.length > 0) {
      throw new Error('取得できたルールがありません');
    }

    const current = await getComRules();
    const rules: Record<string, unknown> = { ...(current?.rules ?? {}), ...fetchedRules };
    const count = Object.keys(rules).length;

    await saveComRules({ fetchedAt: Date.now(), source: SOURCE, rules } as ComRulesPayload);
    await saveComRulesStatus({
      updatedAt: Date.now(),
      count,
      ok: true,
      ...(failedNames.length > 0 ? { failed: failedNames.length, failedNames } : {}),
    });
    return { ok: true, count, failed: failedNames.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = await getComRules();
    try {
      await saveComRulesStatus({
        updatedAt: Date.now(),
        count: current ? Object.keys(current.rules).length : 0,
        ok: false,
        error: message,
      });
    } catch {
      // ステータス保存にも失敗した場合は諦める（結果は戻り値で呼び出し元に伝える）
    }
    return { ok: false, count: 0, failed: 0, error: message };
  }
}

// ---------------------------------------------------------------------------
// 初期設定ページ（§14.3）
// ---------------------------------------------------------------------------

/** 初期設定ページをタブで開く。開けない環境（テスト等）では何もしない */
function openOnboarding(): void {
  if (!chrome.tabs?.create || !chrome.runtime?.getURL) return;
  try {
    void chrome.tabs.create({ url: chrome.runtime.getURL(ONBOARDING_PATH) });
  } catch {
    // タブを開けなくても致命的ではない（popup / options からも開ける）
  }
}

/** 初期設定ページを開き、開いたことを記録する（記録に失敗しても開く。M4） */
async function openOnboardingAndRecord(): Promise<void> {
  openOnboarding();
  try {
    await saveOnboardingShownAt(Date.now());
  } catch {
    // 記録できなくても致命的ではない（次の更新でもう一度開くだけ）
  }
}

/**
 * インストール直後は必ず開く。更新のときは、まだ初期設定を終えていない人に 1 回だけ開く
 * （UX 改修より前から使っている人は onboarded が false のまま入ってくる）。
 * 更新のたびに開かないよう、開いたことを storage.local に記録して判定する（M4）。
 */
async function openOnboardingIfNeeded(reason: string): Promise<void> {
  if (reason === 'install') {
    await openOnboardingAndRecord();
    return;
  }
  if (reason !== 'update') return;
  if ((await getOnboardingShownAt()) !== null) return;
  const settings = await getSettings();
  if (!settings.onboarded) await openOnboardingAndRecord();
}

/** 指定名の alarm が既に存在するか */
function alarmExists(name: string): Promise<boolean> {
  if (!chrome.alarms) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      chrome.alarms.get(name, (alarm) => resolve(!!alarm));
    } catch {
      resolve(false);
    }
  });
}

/** 既にスケジュール済みなら create し直さない（M5: 毎回 create すると周期がリセットされ、
 * 起動が頻繁だと週次更新が実質発火しなくなる） */
async function ensureRulesAlarm(): Promise<void> {
  if (!chrome.alarms) return;
  if (await alarmExists(RULES_ALARM)) return;
  chrome.alarms.create(RULES_ALARM, { periodInMinutes: RULES_PERIOD_MINUTES });
}

/** 最終更新から 7 日以上経過していれば即時更新する（M5: alarm は Chrome 停止中に取りこぼされるため） */
async function updateRulesIfStale(): Promise<void> {
  const status = await getComRulesStatus();
  const age = status ? Date.now() - status.updatedAt : Number.POSITIVE_INFINITY;
  if (age >= RULES_MAX_AGE_MS) void updateRulesFromNetwork();
}

// ---------------------------------------------------------------------------
// イベント登録
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isExtensionMessage(message)) return undefined;
  const typed: ExtensionMessage = message;

  if (typed.type === 'status') {
    void handleStatus(typed, sender.tab?.id, sender.frameId);
    sendResponse({ ok: true });
    return undefined;
  }
  if (typed.type === 'updateRules') {
    void updateRulesFromNetwork().then((result) => sendResponse(result));
    return true; // 非同期で応答する
  }
  if (typed.type === 'openOnboarding') {
    openOnboarding();
    sendResponse({ ok: true });
    return undefined;
  }
  return undefined;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  void clearTabStatus(tabId).then(() => updateBadge(tabId, null));
});

/** タブが閉じられたら session の tabStatus も掃除する（L7） */
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabStatus(tabId);
});

chrome.runtime.onInstalled.addListener((details) => {
  void seedRules();
  void ensureRulesAlarm();
  void openOnboardingIfNeeded(details?.reason ?? '');
});

chrome.runtime.onStartup?.addListener(() => {
  // seedRules が comRulesStatus を更新しうるため、鮮度チェックはその後に行う
  void (async () => {
    await seedRules();
    await updateRulesIfStale();
  })();
  void ensureRulesAlarm();
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== RULES_ALARM) return;
  void updateRulesFromNetwork();
});
