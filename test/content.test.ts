// content script（起動・監視窓・picker）の結合テスト。
// jsdom + fake timers で「監視窓の終了と進行中パスの競合」「rerun」「picker 中止後の復帰」を確かめる。
//
// 時計は fake timers（Date も含む）なので、env.sleep / setTimeout は
// vi.advanceTimersByTimeAsync で進める。可視判定と大きさだけ jsdom 用に差し替える。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategoryKey, Settings } from '../src/shared/types';

/** サイトごとの設定の allow（指定した key だけ true。§14.9） */
function siteAllow(...keys: CategoryKey[]): Record<CategoryKey, boolean> {
  return { A: false, B: false, D: false, E: false, F: false, X: false, ...Object.fromEntries(keys.map((k) => [k, true])) };
}

vi.mock('../src/engine/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/env')>();
  const { testEnv } = await import('./helpers');
  return {
    ...actual,
    createEnv: () => ({
      ...testEnv(),
      sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
    }),
  };
});

interface SentStatus {
  status: string;
  method?: string;
  action?: string;
  clickedText?: string;
  decision?: string;
  allowed?: string[];
  reason?: string;
  at: number;
}

type MessageListener = (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => unknown;

let sent: SentStatus[] = [];
let listeners: MessageListener[] = [];
/** installChrome が作った storage。テストの途中で設定を書き換えるのに使う */
let syncStore = new Map<string, unknown>();
const cleanups: (() => void)[] = [];
/** content script が差し替える前の history（テストごとに戻す。§5-4 の画面遷移監視） */
const nativeHistory = { pushState: history.pushState, replaceState: history.replaceState };

const BANNER_HTML = `
  <main><h1>記事</h1><p>本文です。</p></main>
  <div id="bar" class="cookie-bar" style="position:fixed">
    <p>当サイトでは Cookie を使用しています。</p>
    <button id="deny">拒否</button>
    <button id="agree">同意する</button>
  </div>
`;

/** 教えたボタン（siteKey は jsdom の localhost） */
const CUSTOM_RULE = {
  id: 'rule-1',
  host: 'localhost',
  action: 'reject',
  selector: '#deny',
  text: '拒否',
  createdAt: 0,
};

/** カテゴリごとに選べる同意画面（Consent-O-Matic ルールで処理する。M2 の許可カテゴリ確認用） */
const COM_HTML = `
  <main><h1>記事</h1><p>本文です。</p></main>
  <div id="cmp">
    <p>当サイトでは Cookie を使用しています。</p>
    <label><input id="pref" type="checkbox" checked /> 設定の記憶</label>
    <button id="cmp-save">保存して閉じる</button>
  </div>
`;

/** #pref を「設定の記憶」（カテゴリ A）のトグルとして扱う最小の Consent-O-Matic ルール */
const COM_RULES = {
  fetchedAt: 1,
  source: 'test',
  rules: {
    testcmp: {
      detectors: [{ presentMatcher: [{ type: 'css', target: { selector: '#cmp' } }] }],
      methods: [
        {
          name: 'DO_CONSENT',
          action: {
            type: 'consent',
            consents: [
              {
                type: 'A',
                matcher: { type: 'checkbox', target: { selector: '#pref' } },
                toggleAction: { type: 'click', target: { selector: '#pref' } },
              },
            ],
          },
        },
        { name: 'SAVE_CONSENT', action: { type: 'click', target: { selector: '#cmp-save' } } },
      ],
    },
  },
};

/** 拒否ボタンが無いバナー（fallback=hide の猶予に入る） */
const NO_REJECT_HTML = `
  <main><h1>記事</h1><p>本文です。</p></main>
  <div id="bar" class="cookie-bar" style="position:fixed">
    <p>当サイトでは Cookie を使用しています。</p>
    <button id="agree">同意する</button>
    <button id="config">設定</button>
  </div>
`;

function makeArea(store: Map<string, unknown>) {
  return {
    get: (key: string, callback?: (items: Record<string, unknown>) => void) => {
      const items: Record<string, unknown> = { [key]: store.get(key) };
      callback?.(items);
      return Promise.resolve(items);
    },
    set: (items: Record<string, unknown>, callback?: () => void) => {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
      callback?.();
      return Promise.resolve();
    },
    remove: (key: string, callback?: () => void) => {
      store.delete(key);
      callback?.();
      return Promise.resolve();
    },
  };
}

/** 最小限の chrome スタブ。storage があるので content script は fetch に行かない */
function installChrome(
  seed: Partial<Settings>,
  extraSync: Record<string, unknown> = {},
  extraLocal: Record<string, unknown> = {},
): void {
  const sync = new Map<string, unknown>([['settings', seed], ...Object.entries(extraSync)]);
  syncStore = sync;
  const stub = {
    runtime: {
      id: 'test-extension',
      lastError: undefined,
      sendMessage: (message: SentStatus) => {
        sent.push({ ...message, at: Date.now() });
        return Promise.resolve();
      },
      onMessage: {
        addListener: (listener: MessageListener) => listeners.push(listener),
        removeListener: () => undefined,
      },
    },
    storage: {
      sync: makeArea(sync),
      local: makeArea(new Map(Object.entries(extraLocal))),
      session: makeArea(new Map()),
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = stub;
}

/** DOM を作り直す（cloak の style も、前のテストの診断属性も消える） */
function prepare(html: string): void {
  document.documentElement.innerHTML = `<head></head><body>${html}</body>`;
  document.documentElement.removeAttribute('data-cookie-autopilot');
}

/** `<html data-cookie-autopilot="…">`（OBS-001） */
function markState(): string | null {
  return document.documentElement.getAttribute('data-cookie-autopilot');
}

function onDocument(type: string, listener: EventListener): void {
  document.addEventListener(type, listener, true);
  cleanups.push(() => document.removeEventListener(type, listener, true));
}

/** content script を読み込んで起動させる */
async function start(
  seed: Partial<Settings> = {},
  extraSync: Record<string, unknown> = {},
  extraLocal: Record<string, unknown> = {},
): Promise<void> {
  installChrome({ observeSeconds: 1, ...seed }, extraSync, extraLocal);
  vi.resetModules();
  await import('../src/content/index');
  await tick(1);
}

async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function send(message: unknown): void {
  for (const listener of listeners) listener(message, {}, () => undefined);
}

function cloakStyle(): Element | null {
  return document.querySelector('style[data-cookie-autopilot]');
}

/** 監視開始の経過報告（watching）を除いた、確定ステータスだけ（M-d） */
function results(): SentStatus[] {
  return sent.filter((message) => message.status !== 'watching');
}

/** 監視窓を開いた回数（＝再実行されたかを見る） */
function watchCount(): number {
  return sent.filter((message) => message.status === 'watching').length;
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  listeners = [];
});

afterEach(async () => {
  // 残っているパス・監視窓を必ず終わらせてから次のテストへ（古いモジュールが動き続けないように）
  await tick(120000);
  for (const cleanup of cleanups.splice(0)) cleanup();
  // 画面遷移の監視で差し替えた history を戻し、URL も初期状態に戻す
  history.pushState = nativeHistory.pushState;
  history.replaceState = nativeHistory.replaceState;
  history.replaceState({}, '', '/');
  vi.useRealTimers();
  vi.resetModules();
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe('監視窓と進行中パスの競合（H5）', () => {
  it('窓が切れても、進行中のパスが成功したら handled を報告する', async () => {
    prepare(BANNER_HTML);
    // 拒否を押しても 1.2 秒はバナーが残る（監視窓 1 秒より後に消える）
    onDocument('click', (event) => {
      if ((event.target as Element).id !== 'deny') return;
      setTimeout(() => document.getElementById('bar')?.remove(), 1200);
    });

    await start();
    // 監視窓（1 秒）が切れる時点ではまだクリックの検証中
    await tick(1100);
    expect(results()).toEqual([]);

    await tick(2000);
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ status: 'handled', method: 'heuristic', action: 'reject', clickedText: '拒否' });
    expect(results()[0]?.at).toBeGreaterThan(1000);
  });

  it('窓が切れて進行中のパスも失敗したら、パスの完了後に unhandled を 1 回だけ報告する', async () => {
    prepare(BANNER_HTML);
    await start();

    await tick(1100);
    expect(results()).toEqual([]); // クリックの検証が終わるまで確定しない

    await tick(3000);
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ status: 'unhandled' });
    expect(results()[0]?.at).toBeGreaterThanOrEqual(1600);
  });

  it('バナーが無ければ監視窓の終了で none を報告する', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start();
    await tick(1500);
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ status: 'none' });
  });
});

describe('shadow DOM の中に遅れて現れる同意画面（定期チェック）', () => {
  it('document の MutationObserver に届かない変化でも拾う', async () => {
    // Stencil 製の Web コンポーネント（実サイト mercedes-benz.co.jp の cmm-cookie-banner）を模す。
    // shadow root の中身が変わっても document の MutationObserver は発火しないので、
    // 定期チェックが無いと監視窓が終わるまで見つけられない
    prepare('<main><p>本文です。</p></main><cmm-cookie-banner></cmm-cookie-banner>');
    const host = document.querySelector('cmm-cookie-banner') as HTMLElement;
    const root = host.attachShadow({ mode: 'open' });

    await start({ observeSeconds: 30 });
    await tick(500);
    expect(results()).toEqual([]);

    root.innerHTML =
      '<div class="cmm-cookie-banner__content" style="position:fixed">' +
      '<p>当サイトでは Cookie を使用しています。</p>' +
      '<button id="deny">拒否</button><button id="agree">同意する</button></div>';
    // shadow の外から見ると event.target は host に付け替えられるので、ボタンに直接付ける
    root.querySelector('#deny')?.addEventListener('click', () => host.remove());

    // MutationObserver は発火しない。定期チェック（1 秒間隔）だけが頼り
    await tick(3000);
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ status: 'handled', action: 'reject', clickedText: '拒否' });
  });
});

describe('rerun', () => {
  it('監視が終わったあとでも rerun で監視窓をやり直す', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start();
    await tick(1500);
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ status: 'none' });
    expect(cloakStyle()).toBeNull();

    // 遅れて出てきたバナーを rerun で処理する
    document.body.insertAdjacentHTML('beforeend', BANNER_HTML);
    onDocument('click', (event) => {
      if ((event.target as Element).id === 'deny') document.getElementById('bar')?.remove();
    });
    send({ type: 'rerun' });
    // rerun は設定を読み直してから再開するので、cloak の再注入は次の tick（M2）
    await tick(1);
    expect(cloakStyle()).not.toBeNull();

    await tick(1500);
    expect(results()).toHaveLength(2);
    expect(results()[1]).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: '拒否' });
    expect(cloakStyle()).toBeNull();
  });
});

describe('rerun は設定を読み直す（M2）', () => {
  it('「このサイトでは動かさない」に変えて rerun すると、何もせず off を報告する', async () => {
    prepare(BANNER_HTML);
    await start({ observeSeconds: 30 });
    await tick(100);

    syncStore.set('siteOverrides', { localhost: { kind: 'off' } });
    send({ type: 'rerun' });
    await tick(10000);

    expect(results().map((message) => message.status)).toEqual(['off']);
    // バナーは押しも消しもせず、cloak も外す
    expect(document.getElementById('bar')).not.toBeNull();
    expect((document.getElementById('bar') as HTMLElement).style.display).toBe('');
    expect(cloakStyle()).toBeNull();
  });

  it('項目のトグル（サイトごとの allow）を切ると、その内容で同意画面に答える（§14.9）', async () => {
    prepare(COM_HTML);
    onDocument('click', (event) => {
      if ((event.target as Element).id === 'cmp-save') document.getElementById('cmp')?.remove();
    });

    // 同意画面ごと DOM から消えるので、チェックボックスは先に掴んでおく
    const firstPref = document.getElementById('pref') as HTMLInputElement;
    await start(
      { observeSeconds: 30 },
      { siteOverrides: { localhost: { kind: 'custom', allow: siteAllow('A') } } },
      { comRules: COM_RULES },
    );
    await tick(2000);
    // 「設定の記憶」を ON にしているので、許可したまま保存する
    expect(results()[0]).toMatchObject({ status: 'handled', decision: 'granular', allowed: ['A'] });
    expect(firstPref.checked).toBe(true);

    // 「設定の記憶」を OFF に変えて、同じ同意画面をもう一度出す
    syncStore.set('siteOverrides', { localhost: { kind: 'custom', allow: siteAllow() } });
    prepare(COM_HTML);
    const secondPref = document.getElementById('pref') as HTMLInputElement;
    send({ type: 'rerun' });
    await tick(2000);

    expect(results()).toHaveLength(2);
    expect(results()[1]).toMatchObject({ status: 'handled', decision: 'granular', allowed: [] });
    expect(secondPref.checked).toBe(false);
  });

  it('サイトごとの allow は全体の設定より優先される（§14.9）', async () => {
    prepare(COM_HTML);
    onDocument('click', (event) => {
      if ((event.target as Element).id === 'cmp-save') document.getElementById('cmp')?.remove();
    });

    const pref = document.getElementById('pref') as HTMLInputElement;
    // 全体は「設定の記憶」を許可（既定）だが、このサイトだけ OFF にしてある
    await start(
      { observeSeconds: 30, allowCategories: siteAllow('A') },
      { siteOverrides: { localhost: { kind: 'custom', allow: siteAllow() } } },
      { comRules: COM_RULES },
    );
    await tick(2000);

    expect(results()[0]).toMatchObject({ status: 'handled', decision: 'granular', allowed: [] });
    expect(pref.checked).toBe(false);
  });
});

describe('rerun と進行中パスの競合（M-3）', () => {
  it('実行中の rerun は二重に走らせず、パスの完了後に 1 回だけ再実行する', async () => {
    // 容器として検出されない素のボタンを「教えたボタン」で押す構成にして、
    // ヒューリスティックの猶予や fallback（hide）が割り込まないようにする
    prepare('<main><h1>記事</h1><p>本文です。</p></main><button id="deny">拒否</button>');
    // 1 回目のパスでは押しても閉じないサイト（closeEnabled を立てたあとだけ閉じる）
    let closeEnabled = false;
    const clicks: string[] = [];
    onDocument('click', (event) => {
      const el = (event.target as Element).closest?.('button');
      if (!el || el.id !== 'deny') return;
      clicks.push(el.id);
      if (closeEnabled) el.remove();
    });

    await start({ observeSeconds: 30 }, { 'cr:localhost': [CUSTOM_RULE] });
    await tick(100);
    expect(clicks).toHaveLength(1); // パス 1 が教えたボタンを押して結果を待っている

    send({ type: 'rerun' });
    await tick(100);
    expect(clicks).toHaveLength(1); // 進行中のパスと二重には走らない

    await tick(1600); // パス 1 が失敗して完了（まだ何も報告しない）
    expect(results()).toEqual([]);

    // 完了後に 1 回だけ走る再パスで処理される
    closeEnabled = true;
    await tick(3000);
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({
      status: 'handled',
      method: 'custom',
      action: 'reject',
      clickedText: '拒否',
      decision: 'custom',
    });
  });

  it('picker 中の rerun は無視する（自動処理を再開しない）', async () => {
    prepare(NO_REJECT_HTML);
    await start({ observeSeconds: 30 });

    send({ type: 'startPicker', action: 'reject' });
    await tick(1);
    expect(document.querySelector('[data-cookie-autopilot-picker]')).not.toBeNull();

    send({ type: 'rerun' });
    await tick(10000);

    // picker は開いたままで、猶予が切れても fallback（hide）は走らない
    expect(document.querySelector('[data-cookie-autopilot-picker]')).not.toBeNull();
    expect((document.getElementById('bar') as HTMLElement).style.display).toBe('');
    expect(document.querySelectorAll('[data-cookie-autopilot-hidden]')).toHaveLength(0);
    expect(results()).toEqual([]);

    // picker の capture リスナーを次のテストに残さない
    send({ type: 'cancelPicker' });
  });
});

describe('picker の中止（H4）', () => {
  it('Esc で中止したら cloak を外して監視を再開する', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start({ observeSeconds: 30 });
    expect(cloakStyle()).not.toBeNull();

    send({ type: 'startPicker', action: 'reject' });
    await tick(1);
    expect(document.querySelector('[data-cookie-autopilot-picker]')).not.toBeNull();

    // picker 中に出てきたバナー。中止後の再開で処理されるはず
    document.body.insertAdjacentHTML('beforeend', BANNER_HTML);
    onDocument('click', (event) => {
      if ((event.target as Element).id === 'deny') document.getElementById('bar')?.remove();
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(1);
    expect(document.querySelector('[data-cookie-autopilot-picker]')).toBeNull();
    // picker が付けた要素単位の cloak は残さないが、再開は rerun と同じ経路なので
    // cloak の style は張り直される（H-D）
    expect(document.querySelectorAll('[data-cookie-autopilot-cloak]')).toHaveLength(0);
    expect(cloakStyle()).not.toBeNull();

    await tick(2000);
    expect(results()).toHaveLength(1);
    expect(results()[0]).toMatchObject({ status: 'handled', clickedText: '拒否' });
  });

  it('実行中パスの最中に startPicker すると、パスが打ち切られ fallback も走らない（H-D）', async () => {
    prepare(NO_REJECT_HTML);
    await start({ observeSeconds: 30 });

    // 猶予（3 秒）の途中で picker を開始する
    await tick(500);
    const bar = document.getElementById('bar') as HTMLElement;
    expect(bar.style.display).toBe('');

    send({ type: 'startPicker', action: 'reject' });
    await tick(1);
    expect(document.querySelector('[data-cookie-autopilot-picker]')).not.toBeNull();

    // 猶予が切れるだけ待っても hide されない
    await tick(10000);
    expect(bar.style.display).toBe('');
    expect(document.querySelectorAll('[data-cookie-autopilot-hidden]')).toHaveLength(0);
    expect(results()).toEqual([]);

    // picker の capture リスナーを次のテストに残さない
    send({ type: 'cancelPicker' });
  });

  it('cancelPicker メッセージでも同じように復帰する', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start({ observeSeconds: 30 });

    send({ type: 'startPicker', action: 'accept' });
    await tick(1);
    expect(document.querySelector('[data-cookie-autopilot-picker]')).not.toBeNull();

    send({ type: 'cancelPicker' });
    await tick(1);
    expect(document.querySelector('[data-cookie-autopilot-picker]')).toBeNull();
    // 再開は rerun と同じ経路なので cloak の style が再注入される（H-D）
    expect(cloakStyle()).not.toBeNull();
    expect(document.querySelectorAll('[data-cookie-autopilot-cloak]')).toHaveLength(0);

    // 監視が再開しているので、監視窓の終わりに none が届き、cloak も外れる
    await tick(31000);
    expect(results().map((message) => message.status)).toEqual(['none']);
    expect(cloakStyle()).toBeNull();
  });
});

describe('画面遷移後の再実行（SPA。§5-4）', () => {
  it('pushState でパスが変わると監視をやり直す', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start();
    await tick(1500);
    expect(results()).toMatchObject([{ status: 'none' }]);

    // 遷移した先で出てきたバナー
    document.body.insertAdjacentHTML('beforeend', BANNER_HTML);
    onDocument('click', (event) => {
      if ((event.target as Element).id === 'deny') document.getElementById('bar')?.remove();
    });
    history.pushState({}, '', '/articles/1');
    // 1 秒のデバウンスを置いてから監視をやり直す
    await tick(900);
    expect(watchCount()).toBe(1);
    await tick(2000);

    expect(watchCount()).toBe(2);
    expect(results()).toHaveLength(2);
    expect(results()[1]).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: '拒否' });
  });

  it('クエリ・ハッシュだけの変化では再実行しない', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start();
    await tick(1500);
    expect(watchCount()).toBe(1);

    history.pushState({}, '', '/?q=1');
    history.replaceState({}, '', '/?q=2#section');
    await tick(5000);

    expect(watchCount()).toBe(1);
    expect(results()).toHaveLength(1);
  });

  it('連続した遷移はまとめて 1 回だけやり直す', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start();
    await tick(1500);

    history.pushState({}, '', '/a');
    await tick(300);
    history.pushState({}, '', '/b');
    await tick(300);
    history.pushState({}, '', '/c');
    await tick(5000);

    expect(watchCount()).toBe(2);
  });

  it('picker 中の画面遷移は無視する', async () => {
    prepare(NO_REJECT_HTML);
    await start({ observeSeconds: 30 });

    send({ type: 'startPicker', action: 'reject' });
    await tick(1);
    expect(watchCount()).toBe(1);

    history.pushState({}, '', '/next');
    await tick(5000);

    // picker は開いたままで、監視も再開しない
    expect(document.querySelector('[data-cookie-autopilot-picker]')).not.toBeNull();
    expect(watchCount()).toBe(1);
    expect(results()).toEqual([]);

    // picker の capture リスナーを次のテストに残さない
    send({ type: 'cancelPicker' });
  });

  it('ページ滞在中の再実行は 5 回まで', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start();
    await tick(1500);
    expect(watchCount()).toBe(1);

    for (let step = 1; step <= 7; step++) {
      history.pushState({}, '', `/page-${step}`);
      await tick(3000);
    }

    expect(watchCount()).toBe(6);
  });
});

describe('診断属性 data-cookie-autopilot（OBS-001）', () => {
  it('監視中から結果まで、状態が変わるたびに書き換える', async () => {
    prepare(BANNER_HTML);
    onDocument('click', (event) => {
      if ((event.target as Element).id === 'deny') document.getElementById('bar')?.remove();
    });

    await start({ observeSeconds: 30 });
    expect(markState()).toBe('watching');

    await tick(2000);
    expect(results()[0]).toMatchObject({ status: 'handled' });
    expect(markState()).toBe('handled');
  });

  it('デバッグログが有効なら watching+debug', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start({ observeSeconds: 30, debug: true });
    expect(markState()).toBe('watching+debug');
  });

  it('バナーが無ければ none、断れなければ unhandled', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start();
    await tick(1500);
    expect(markState()).toBe('none');

    prepare(NO_REJECT_HTML);
    await start({ observeSeconds: 30, fallbackWhenNoReject: 'leave' });
    await tick(12000);
    expect(markState()).toBe('unhandled');
  });

  it('このサイトでは動かさない設定なら off', async () => {
    prepare(BANNER_HTML);
    await start({}, { siteOverrides: { localhost: { kind: 'off' } } });
    expect(markState()).toBe('off');
  });

  it('サイト側に属性を消されても、次の状態変化で付け直す', async () => {
    prepare('<main><p>本文です。</p></main>');
    await start();
    expect(markState()).toBe('watching');

    // フレームワークのハイドレーションで <html> の属性が消える
    document.documentElement.removeAttribute('data-cookie-autopilot');
    await tick(1500);
    expect(markState()).toBe('none');
  });

  it('document_start で書けなくても DOMContentLoaded の後に付け直す', async () => {
    prepare('<main><p>本文です。</p></main>');
    let readyState = 'loading';
    Object.defineProperty(document, 'readyState', { get: () => readyState, configurable: true });
    cleanups.push(() => void Reflect.deleteProperty(document, 'readyState'));

    await start({ observeSeconds: 30 });
    expect(markState()).toBe('watching');

    // <html> がまだ無かった / 途中で消されたのと同じ状態にしてから DOM の準備完了へ
    document.documentElement.removeAttribute('data-cookie-autopilot');
    readyState = 'interactive';
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await tick(1);
    expect(markState()).toBe('watching');
  });
});

describe('処理できなかったことの報告（§5-8）', () => {
  it('unhandled には理由が付き、デバッグログが有効なら console.info に要約を出す', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    prepare(NO_REJECT_HTML);
    await start({ observeSeconds: 30, fallbackWhenNoReject: 'leave', debug: true });

    // 猶予（1 秒）＋ 設定パネル層を待って fallback（leave）まで進める
    await tick(12000);
    expect(results()).toMatchObject([{ status: 'unhandled', reason: 'no-reject' }]);
    expect(info).toHaveBeenCalledTimes(1);
    const summary = JSON.parse(String(info.mock.calls[0]?.[1]));
    expect(summary).toMatchObject({
      reason: 'no-reject',
      container: 'DIV#bar.cookie-bar',
      labels: ['同意する', '設定'],
    });
    info.mockRestore();
  });

  it('デバッグログが無効なら console.info は出さない', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    prepare(NO_REJECT_HTML);
    await start({ observeSeconds: 30, fallbackWhenNoReject: 'leave' });

    await tick(12000);
    expect(results()).toMatchObject([{ status: 'unhandled', reason: 'no-reject' }]);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
