// service worker（src/background/index.ts）のテスト。
//
// background/index.ts はトップレベルで chrome.runtime.onMessage 等にリスナーを登録する副作用を
// 持つため、テストごとに vi.resetModules() したうえでモック chrome を差し込み、動的 import で
// 新しいモジュールインスタンスを読み込む（＝リスナーをそのモックに対して登録し直させる）。
// storage.ts はモジュール自身に状態を持たず、常にグローバルの chrome 経由で読み書きするだけなので、
// このファイルの先頭で静的 import した storage.ts の関数と、background/index.ts が内部で動的に
// 読み込む storage.ts のインスタンスが異なっていても、同じモック chrome を見ている限り整合する。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getComRules,
  getComRulesStatus,
  getSiteHistoryEntry,
  getTabStatus,
  saveComRules,
  saveTabStatus,
} from '../src/shared/storage';

/** background/index.ts 内部の alarm 名（非公開定数なので値を合わせて重複定義する） */
const RULES_ALARM = 'cookie-autopilot:update-rules';
const RULES_LIST_URL = 'https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/rules-list.json';

type Listener = (...args: never[]) => unknown;

interface MockEvent<T extends Listener> {
  listeners: T[];
  addListener: (fn: T) => void;
  removeListener: (fn: T) => void;
}

function createEvent<T extends Listener>(): MockEvent<T> {
  const listeners: T[] = [];
  return {
    listeners,
    addListener: (fn: T) => {
      listeners.push(fn);
    },
    removeListener: (fn: T) => {
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
}

/** chrome.storage.StorageArea のモック（test/storage.test.ts と同じ最小実装） */
function createMockArea(runtime: { lastError: { message: string } | undefined }) {
  const data: Record<string, unknown> = {};
  const raw = {
    get(keys: unknown, callback: (items: Record<string, unknown>) => void): void {
      const result: Record<string, unknown> = {};
      if (keys === null || keys === undefined) {
        Object.assign(result, data);
      } else if (typeof keys === 'string') {
        if (keys in data) result[keys] = data[keys];
      } else if (Array.isArray(keys)) {
        for (const key of keys) if (key in data) result[key] = data[key];
      }
      callback(result);
    },
    set(items: Record<string, unknown>, callback: () => void): void {
      Object.assign(data, items);
      callback();
    },
    remove(keys: string | string[], callback: () => void): void {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      callback();
    },
  } as unknown as chrome.storage.StorageArea;
  return { data, raw };
}

interface AlarmRecord {
  name: string;
  periodInMinutes?: number;
  scheduledTime: number;
}

function createMockChrome() {
  const runtime: {
    lastError: { message: string } | undefined;
    onMessage: MockEvent<(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r?: unknown) => void) => unknown>;
    onInstalled: MockEvent<(details: { reason: string }) => void>;
    onStartup: MockEvent<() => void>;
    getURL: (path: string) => string;
  } = {
    lastError: undefined,
    onMessage: createEvent(),
    onInstalled: createEvent(),
    onStartup: createEvent(),
    getURL: (path: string) => `chrome-extension://mock-id/${path}`,
  };

  const sync = createMockArea(runtime);
  const local = createMockArea(runtime);
  const session = createMockArea(runtime);

  const onTabsUpdated = createEvent<(tabId: number, changeInfo: { status?: string }) => void>();
  const onTabsRemoved = createEvent<(tabId: number) => void>();
  const onAlarm = createEvent<(alarm: { name: string }) => void>();

  const alarmsData = new Map<string, AlarmRecord>();
  const alarmsCreateSpy = vi.fn((name: string, info: { periodInMinutes?: number }) => {
    alarmsData.set(name, { name, periodInMinutes: info.periodInMinutes, scheduledTime: Date.now() });
  });

  const setBadgeText = vi.fn(async () => undefined);
  const setBadgeBackgroundColor = vi.fn(async () => undefined);
  const tabsCreateSpy = vi.fn(async (_info: { url: string }) => undefined);

  const chromeObject = {
    runtime,
    tabs: {
      onUpdated: onTabsUpdated,
      onRemoved: onTabsRemoved,
      create: tabsCreateSpy,
    },
    alarms: {
      create: alarmsCreateSpy,
      get: (name: string, callback: (alarm: AlarmRecord | undefined) => void) => callback(alarmsData.get(name)),
      onAlarm,
    },
    action: {
      setBadgeText,
      setBadgeBackgroundColor,
    },
    storage: {
      sync: sync.raw,
      local: local.raw,
      session: session.raw,
      onChanged: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
    },
  };

  return {
    chromeObject,
    runtime,
    sync,
    local,
    session,
    onTabsUpdated,
    onTabsRemoved,
    onAlarm,
    alarmsData,
    alarmsCreateSpy,
    setBadgeText,
    setBadgeBackgroundColor,
    tabsCreateSpy,
  };
}

/** マイクロタスク・キューを使い切ってから戻る（fire-and-forget な async 処理を待つため） */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeResponse(ok: boolean, body: unknown, status = ok ? 200 : 500): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

let mock: ReturnType<typeof createMockChrome>;

beforeEach(() => {
  vi.resetModules();
  mock = createMockChrome();
  vi.stubGlobal('chrome', mock.chromeObject as unknown as typeof chrome);
  // 既定では何も取得できない扱いにする（seedRules 等が実ネットワークに触れないようにする）。
  // 個別テストで必要なら上書きする。
  vi.stubGlobal('fetch', vi.fn(async () => fakeResponse(false, {})));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadBackground() {
  return import('../src/background/index');
}

describe('status メッセージ（L11: サブフレームの unhandled 無視 / handled 優先）', () => {
  it('サブフレーム(frameId!==0)からの unhandled は無視し、トップフレームからの unhandled は反映する', async () => {
    await loadBackground();
    const sendResponse = vi.fn();

    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status: 'unhandled' },
      { tab: { id: 10 }, frameId: 2 } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushAsync();
    expect(await getTabStatus(10)).toBeNull();

    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status: 'unhandled' },
      { tab: { id: 10 }, frameId: 0 } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushAsync();
    expect((await getTabStatus(10))?.status).toBe('unhandled');
  });

  it('サブフレームからの handled は既存の unhandled を上書きして優先反映される', async () => {
    await loadBackground();
    const sendResponse = vi.fn();

    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status: 'unhandled' },
      { tab: { id: 11 }, frameId: 0 } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushAsync();
    expect((await getTabStatus(11))?.status).toBe('unhandled');

    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status: 'handled', method: 'heuristic' },
      { tab: { id: 11 }, frameId: 3 } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushAsync();
    expect((await getTabStatus(11))?.status).toBe('handled');
  });

  it('サブフレームからの handled が先でも、その後の同フレームの unhandled には上書きされない', async () => {
    await loadBackground();
    const sendResponse = vi.fn();

    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status: 'handled', method: 'heuristic' },
      { tab: { id: 12 }, frameId: 0 } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushAsync();

    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status: 'unhandled' },
      { tab: { id: 12 }, frameId: 0 } as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushAsync();
    expect((await getTabStatus(12))?.status).toBe('handled');
  });
});

describe('watching ステータス（M-d: 監視中の経過報告）', () => {
  /** status メッセージを 1 件流す */
  async function post(status: string, tabId: number, frameId = 0, extra: Record<string, unknown> = {}): Promise<void> {
    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status, ...extra },
      { tab: { id: tabId }, frameId } as chrome.runtime.MessageSender,
      vi.fn(),
    );
    await flushAsync();
  }

  it('watching を保存し、バッジは空のままにする', async () => {
    await loadBackground();
    await post('watching', 20);

    expect((await getTabStatus(20))?.status).toBe('watching');
    expect(mock.setBadgeText).toHaveBeenCalledWith({ tabId: 20, text: '' });
    expect(mock.setBadgeBackgroundColor).not.toHaveBeenCalled();
  });

  it('watching は既存の handled を上書きしない', async () => {
    await loadBackground();
    await post('handled', 21, 0, { method: 'heuristic' });
    await post('watching', 21);

    const status = await getTabStatus(21);
    expect(status?.status).toBe('handled');
    expect(status?.method).toBe('heuristic');
  });

  it('watching は handled / unhandled で上書きされる', async () => {
    await loadBackground();
    await post('watching', 22);
    await post('unhandled', 22);
    expect((await getTabStatus(22))?.status).toBe('unhandled');

    await post('watching', 23);
    await post('handled', 23, 0, { method: 'hide' });
    expect((await getTabStatus(23))?.status).toBe('handled');
  });
});

describe('tabs.onRemoved（L7: タブごとの session キーを掃除する）', () => {
  it('タブが閉じられたら該当タブの tabStatus を削除する', async () => {
    await loadBackground();
    await saveTabStatus(7, { host: 'a.com', status: 'handled', at: 1 });
    expect(await getTabStatus(7)).not.toBeNull();

    mock.onTabsRemoved.listeners[0]!(7);
    await flushAsync();

    expect(await getTabStatus(7)).toBeNull();
  });
});

describe('ステータスの decision / allowed（§14.6）', () => {
  it('decision と allowed をそのまま tab:<id> に保存する', async () => {
    await loadBackground();
    mock.chromeObject.runtime.onMessage.listeners[0]!(
      {
        type: 'status',
        host: 'example.com',
        status: 'handled',
        method: 'com:cookiebot',
        action: 'reject',
        clickedText: '選択を許可',
        decision: 'granular',
        allowed: ['A', 'B'],
      },
      { tab: { id: 11 }, frameId: 0 } as chrome.runtime.MessageSender,
      vi.fn(),
    );
    await flushAsync();

    expect(await getTabStatus(11)).toMatchObject({
      status: 'handled',
      method: 'com:cookiebot',
      decision: 'granular',
      allowed: ['A', 'B'],
    });
  });

  it('decision が無いステータスにはキーを作らない', async () => {
    await loadBackground();
    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status: 'none' },
      { tab: { id: 12 }, frameId: 0 } as chrome.runtime.MessageSender,
      vi.fn(),
    );
    await flushAsync();

    const status = await getTabStatus(12);
    expect(status).not.toBeNull();
    expect(status && 'decision' in status).toBe(false);
    expect(status && 'allowed' in status).toBe(false);
  });

  it('unhandled の reason もそのまま保存する（§5-8）', async () => {
    await loadBackground();
    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status: 'unhandled', reason: 'no-candidates' },
      { tab: { id: 13 }, frameId: 0 } as chrome.runtime.MessageSender,
      vi.fn(),
    );
    await flushAsync();

    expect(await getTabStatus(13)).toMatchObject({ status: 'unhandled', reason: 'no-candidates' });
  });
});

describe('siteHistory の記録（§14.8）', () => {
  /** status メッセージを 1 件流す（'watching ステータス' の post と同内容。describe が別なのでこちらにも定義する） */
  async function post(status: string, tabId: number, extra: Record<string, unknown> = {}): Promise<void> {
    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'status', host: 'example.com', status, ...extra },
      { tab: { id: tabId }, frameId: 0 } as chrome.runtime.MessageSender,
      vi.fn(),
    );
    await flushAsync();
  }

  it('handled（hide 以外）を受けたら記録する', async () => {
    await loadBackground();
    await post('handled', 30, {
      method: 'com:cookiebot',
      decision: 'granular',
      allowed: ['A', 'B'],
      clickedLabel: '選択を保存',
    });

    expect(await getSiteHistoryEntry('example.com')).toMatchObject({
      host: 'example.com',
      decision: 'granular',
      allowed: ['A', 'B'],
      clickedLabel: '選択を保存',
      method: 'com:cookiebot',
    });
  });

  it('dismissed（選択肢のない通知を閉じただけ）も記録する', async () => {
    await loadBackground();
    await post('handled', 31, { method: 'heuristic', decision: 'dismissed' });

    expect(await getSiteHistoryEntry('example.com')).toMatchObject({ host: 'example.com', decision: 'dismissed' });
  });

  it('method: "hide"（同意していない）は記録しない', async () => {
    await loadBackground();
    await post('handled', 32, { method: 'hide', decision: 'hidden' });

    expect(await getSiteHistoryEntry('example.com')).toBeNull();
  });

  it('unhandled は記録しない', async () => {
    await loadBackground();
    await post('unhandled', 33);

    expect(await getSiteHistoryEntry('example.com')).toBeNull();
  });
});

describe('初期設定ページ（§14.3）', () => {
  const ONBOARDING_URL = 'chrome-extension://mock-id/onboarding.html';

  it('インストール直後は初期設定ページを開く', async () => {
    await loadBackground();
    mock.chromeObject.runtime.onInstalled.listeners[0]!({ reason: 'install' });
    await flushAsync();

    expect(mock.tabsCreateSpy).toHaveBeenCalledWith({ url: ONBOARDING_URL });
  });

  it('更新のときは、まだ初期設定が終わっていない人にだけ開く', async () => {
    mock.sync.data['settings'] = { onboarded: false };
    await loadBackground();
    mock.chromeObject.runtime.onInstalled.listeners[0]!({ reason: 'update' });
    await flushAsync();

    expect(mock.tabsCreateSpy).toHaveBeenCalledWith({ url: ONBOARDING_URL });
  });

  it('初期設定が済んでいれば更新では開かない', async () => {
    mock.sync.data['settings'] = { onboarded: true };
    await loadBackground();
    mock.chromeObject.runtime.onInstalled.listeners[0]!({ reason: 'update' });
    await flushAsync();

    expect(mock.tabsCreateSpy).not.toHaveBeenCalled();
  });

  it('一度開いたら、次の更新では開かない（M4）', async () => {
    mock.sync.data['settings'] = { onboarded: false };
    mock.local.data['onboardingShownAt'] = 1_700_000_000_000;
    await loadBackground();
    mock.chromeObject.runtime.onInstalled.listeners[0]!({ reason: 'update' });
    await flushAsync();

    expect(mock.tabsCreateSpy).not.toHaveBeenCalled();
  });

  it('開いたら開いた時刻を記録する（M4）', async () => {
    await loadBackground();
    mock.chromeObject.runtime.onInstalled.listeners[0]!({ reason: 'install' });
    await flushAsync();

    expect(mock.tabsCreateSpy).toHaveBeenCalledWith({ url: ONBOARDING_URL });
    expect(typeof mock.local.data['onboardingShownAt']).toBe('number');
  });

  it('openOnboarding メッセージでも開ける（popup / options から）', async () => {
    await loadBackground();
    const sendResponse = vi.fn();
    mock.chromeObject.runtime.onMessage.listeners[0]!(
      { type: 'openOnboarding' },
      {} as chrome.runtime.MessageSender,
      sendResponse,
    );
    await flushAsync();

    expect(mock.tabsCreateSpy).toHaveBeenCalledWith({ url: ONBOARDING_URL });
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });
});

describe('alarms（M5: onStartup のたびに周期をリセットしない）', () => {
  it('既に同名の alarm があれば create し直さない（onInstalled）', async () => {
    mock.alarmsData.set(RULES_ALARM, { name: RULES_ALARM, periodInMinutes: 10080, scheduledTime: 123 });
    await loadBackground();

    mock.chromeObject.runtime.onInstalled.listeners[0]!({ reason: 'install' });
    await flushAsync();

    expect(mock.alarmsCreateSpy).not.toHaveBeenCalled();
  });

  it('alarm が無ければ create する（onInstalled）', async () => {
    await loadBackground();

    mock.chromeObject.runtime.onInstalled.listeners[0]!({ reason: 'install' });
    await flushAsync();

    expect(mock.alarmsCreateSpy).toHaveBeenCalledWith(RULES_ALARM, expect.objectContaining({ periodInMinutes: expect.any(Number) }));
  });

  it('onStartup でも既存の alarm を create し直さない', async () => {
    mock.alarmsData.set(RULES_ALARM, { name: RULES_ALARM, periodInMinutes: 10080, scheduledTime: 123 });
    await loadBackground();

    mock.chromeObject.runtime.onStartup.listeners[0]!();
    await flushAsync();

    expect(mock.alarmsCreateSpy).not.toHaveBeenCalled();
  });
});

describe('updateRulesFromNetwork（M6: 部分失敗は既存ルールとマージする）', () => {
  it('取得できた分だけ既存ルールにマージし、失敗分は既存を維持したうえで失敗件数を記録する', async () => {
    const bg = await loadBackground();

    // 既存ルール（今回 b.json 経由の取得に失敗しても rule-c は残ってほしい）
    await saveComRules({
      fetchedAt: 1000,
      source: 'https://github.com/cavi-au/Consent-O-Matic',
      rules: { 'rule-c': { detectors: [] } },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === RULES_LIST_URL) {
          return fakeResponse(true, ['https://example.com/a.json', 'https://example.com/b.json']);
        }
        if (url === 'https://example.com/a.json') {
          return fakeResponse(true, { 'rule-a': { detectors: [] } });
        }
        // b.json は失敗させる（rule-c 相当を含んでいたと仮定）
        return fakeResponse(false, {});
      }),
    );

    const result = await bg.updateRulesFromNetwork();

    expect(result.ok).toBe(true);
    expect(result.failed).toBe(1);

    const stored = await getComRules();
    expect(Object.keys(stored?.rules ?? {}).sort()).toEqual(['rule-a', 'rule-c']);

    const status = await getComRulesStatus();
    expect(status?.ok).toBe(true);
    expect(status?.failed).toBe(1);
    expect(status?.failedNames).toEqual(['b.json']);
  });

  it('全件失敗のときは既存ルールに触れず、ok:false を返す', async () => {
    const bg = await loadBackground();
    await saveComRules({
      fetchedAt: 1000,
      source: 'https://github.com/cavi-au/Consent-O-Matic',
      rules: { 'rule-c': { detectors: [] } },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url === RULES_LIST_URL) return fakeResponse(true, ['https://example.com/a.json']);
        return fakeResponse(false, {});
      }),
    );

    const result = await bg.updateRulesFromNetwork();
    expect(result.ok).toBe(false);

    const stored = await getComRules();
    expect(Object.keys(stored?.rules ?? {})).toEqual(['rule-c']);
  });
});
