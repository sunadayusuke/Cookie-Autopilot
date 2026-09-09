import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  clearSiteHistory,
  clearTabStatus,
  effectiveCategories,
  effectiveMode,
  exportConfig,
  getComRules,
  getCustomRules,
  getCustomRulesForHost,
  getSettings,
  getSiteHistory,
  getSiteHistoryEntry,
  getSiteOverrides,
  getTabStatus,
  hasChromeStorage,
  importConfig,
  recordSiteHistory,
  removeCustomRule,
  removeSiteHistoryEntry,
  saveAllowCategories,
  saveCustomRule,
  savePreset,
  saveSettings,
  saveTabStatus,
  setSiteAllow,
  setSiteOff,
  setSiteOverride,
} from '../src/shared/storage';
import { allowRecordForPreset } from '../src/shared/presets';
import type { CategoryKey, CustomRule } from '../src/shared/types';

/** 許可カテゴリの record（指定した key だけ true） */
function allowOnly(...keys: CategoryKey[]): Record<CategoryKey, boolean> {
  return { A: false, B: false, D: false, E: false, F: false, X: false, ...Object.fromEntries(keys.map((k) => [k, true])) };
}

function setQuery(query: string): void {
  window.history.replaceState({}, '', `/${query}`);
}

afterEach(() => {
  setQuery('');
});

describe('chrome API が無い環境', () => {
  it('chrome を参照しても落ちない', () => {
    expect(hasChromeStorage()).toBe(false);
  });

  it('既定値どおりの設定を返す（プリセットはほどよく守る）', async () => {
    expect(DEFAULT_SETTINGS).toEqual({
      preset: 'minimal',
      allowCategories: { A: true, B: false, D: false, E: false, F: false, X: false },
      pressCloseOnNotice: true,
      onboarded: false,
      fallbackWhenNoReject: 'hide',
      showBadge: true,
      debug: false,
      observeSeconds: 20,
    });
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await getSiteOverrides()).toEqual({});
    expect(await getCustomRules()).toEqual([]);
    expect(await getComRules()).toBeNull();
  });

  it('?mode=accept でモードを上書きできる（fixtures 用）', async () => {
    setQuery('?mode=accept');
    expect(effectiveMode('example.com', {})).toBe('accept');

    setQuery('?mode=off');
    expect(effectiveMode('example.com', {})).toBe('off');

    setQuery('?mode=bogus');
    expect(effectiveMode('example.com', {})).toBe('reject');
  });

  it('?debug=1 でデバッグログを有効にできる', async () => {
    setQuery('?debug=1');
    expect((await getSettings()).debug).toBe(true);

    setQuery('?debug=0');
    expect((await getSettings()).debug).toBe(false);
  });
});

describe('effectiveMode（§14.1 / §14.9: off か reject のみ）', () => {
  it('サイト設定が off のときだけ off、それ以外は常に reject', () => {
    expect(effectiveMode('example.com', {})).toBe('reject');
    expect(effectiveMode('example.com', { 'example.com': { kind: 'off' } })).toBe('off');
    expect(effectiveMode('example.com', { 'example.com': { kind: 'custom', allow: allowOnly('A') } })).toBe('reject');
    expect(effectiveMode('example.com', { 'other.com': { kind: 'off' } })).toBe('reject');
  });
});

describe('effectiveCategories（§14.1 / §14.9）', () => {
  it('サイト設定（custom）があればその allow を使う', () => {
    expect(effectiveCategories('example.com', DEFAULT_SETTINGS, { 'example.com': { kind: 'custom', allow: allowOnly() } })).toEqual([]);
    expect(
      effectiveCategories('example.com', DEFAULT_SETTINGS, {
        'example.com': { kind: 'custom', allow: allowOnly('A', 'B', 'E') },
      }),
    ).toEqual(['A', 'B', 'E']);
  });

  it('サイト設定が無ければ全体の allowCategories を使う', () => {
    expect(effectiveCategories('example.com', DEFAULT_SETTINGS, {})).toEqual(['A']);
    const custom = {
      ...DEFAULT_SETTINGS,
      allowCategories: { A: false, B: true, D: false, E: false, F: true, X: false },
    };
    expect(effectiveCategories('example.com', custom, { 'other.com': { kind: 'custom', allow: allowOnly() } })).toEqual([
      'B',
      'F',
    ]);
  });

  it('動かさないサイトでは空', () => {
    expect(effectiveCategories('example.com', DEFAULT_SETTINGS, { 'example.com': { kind: 'off' } })).toEqual([]);
  });
});

describe('importConfig（検証。chrome が無くても検証と件数計算は動く）', () => {
  it('トップレベルがオブジェクトでなければ reject する', async () => {
    await expect(importConfig(null)).rejects.toThrow('インポートするファイルの形式が不正です');
    await expect(importConfig('nope')).rejects.toThrow();
    await expect(importConfig(42)).rejects.toThrow();
  });

  it('settings がオブジェクトでなければ reject する', async () => {
    await expect(importConfig({ settings: 'nonsense' })).rejects.toThrow('settings の形式が不正です');
  });

  it('siteOverrides の形式が不正なら reject する', async () => {
    await expect(importConfig({ siteOverrides: 'nonsense' })).rejects.toThrow('siteOverrides の形式が不正です');
  });

  it('siteOverrides の値がプリセットでも off でもなければ reject する', async () => {
    await expect(importConfig({ siteOverrides: { 'a.com': 'nonsense' } })).rejects.toThrow(
      /siteOverrides の設定値が不正です/,
    );
  });

  it('siteOverrides の host が 253 文字を超えたら reject する', async () => {
    const longHost = `${'a'.repeat(250)}.com`; // 254 文字
    await expect(importConfig({ siteOverrides: { [longHost]: 'reject' } })).rejects.toThrow(
      /siteOverrides の host が不正です/,
    );
  });

  it('siteOverrides が 1000 件を超えたら reject する', async () => {
    const siteOverrides = Object.fromEntries(
      Array.from({ length: 1001 }, (_, i) => [`host${i}.example.com`, 'reject']),
    );
    await expect(importConfig({ siteOverrides })).rejects.toThrow(/siteOverrides が上限（1000 件）を超えています/);
  });

  it('customRules が配列でなければ reject する', async () => {
    await expect(importConfig({ customRules: 'nonsense' })).rejects.toThrow('customRules の形式が不正です');
  });

  it('customRules の要素がオブジェクトでなければ reject する', async () => {
    await expect(importConfig({ customRules: ['nope'] })).rejects.toThrow(
      'customRules の要素がオブジェクトではありません',
    );
  });

  it('customRules の action が 2 値以外なら reject する', async () => {
    await expect(importConfig({ customRules: [{ host: 'a.com', action: 'invalid' }] })).rejects.toThrow(
      /customRules の action が不正です/,
    );
  });

  it('customRules の host が 253 文字を超えたら reject する', async () => {
    const longHost = `${'a'.repeat(250)}.com`;
    await expect(importConfig({ customRules: [{ host: longHost, action: 'reject' }] })).rejects.toThrow(
      /customRules の host が不正です/,
    );
  });

  it('customRules の selector / text が 500 文字を超えたら reject する', async () => {
    const longText = 'a'.repeat(501);
    await expect(
      importConfig({ customRules: [{ host: 'a.com', action: 'reject', selector: longText }] }),
    ).rejects.toThrow(/customRules の selector が長すぎます/);
    await expect(
      importConfig({ customRules: [{ host: 'a.com', action: 'reject', text: longText }] }),
    ).rejects.toThrow(/customRules の text が長すぎます/);
  });

  it('customRules が 500 件を超えたら reject する', async () => {
    const customRules = Array.from({ length: 501 }, (_, i) => ({ host: `h${i}.example.com`, action: 'reject' }));
    await expect(importConfig({ customRules })).rejects.toThrow(/customRules が上限（500 件）を超えています/);
  });

  it('妥当なデータはそのまま取り込み、件数を返す', async () => {
    const result = await importConfig({
      settings: { preset: 'relaxed', observeSeconds: 999 },
      siteOverrides: { 'a.com': 'strict', 'b.com': 'off' },
      customRules: [
        { host: 'a.com', action: 'reject', selector: '#x', text: '拒否' },
        { host: 'b.com', action: 'accept' },
      ],
    });
    expect(result).toEqual({ settings: true, siteOverrides: 2, customRules: 2 });
  });

  it('旧スキーマのバックアップも読み替えて取り込む（reject → strict、accept は捨てる）', async () => {
    const result = await importConfig({
      settings: { defaultMode: 'accept', rejectAllowCategories: { A: true }, fallbackWhenNoReject: 'accept' },
      siteOverrides: { 'a.com': 'reject', 'b.com': 'accept', 'c.com': 'off' },
    });
    // 'accept' の 1 件は捨てるので 2 件
    expect(result).toEqual({ settings: true, siteOverrides: 2, customRules: 0 });
  });

  it('省略した項目は既存の内容に触れない（0 件・false を返す）', async () => {
    expect(await importConfig({})).toEqual({ settings: false, siteOverrides: 0, customRules: 0 });
  });
});

// ---------------------------------------------------------------------------
// chrome.storage をモックした環境（per-host キー・書き込み失敗の伝播・タブ単位キーの検証）
// ---------------------------------------------------------------------------

interface MockArea {
  data: Record<string, unknown>;
  failNextSet: (message: string) => void;
  raw: chrome.storage.StorageArea;
}

interface MockChrome {
  chromeObject: unknown;
  runtime: { lastError: { message: string } | undefined };
  sync: MockArea;
  local: MockArea;
  session: MockArea;
}

function createMockArea(runtime: { lastError: { message: string } | undefined }): MockArea {
  const data: Record<string, unknown> = {};
  let pendingFailure: string | null = null;

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
      if (pendingFailure) {
        runtime.lastError = { message: pendingFailure };
        pendingFailure = null;
        callback();
        runtime.lastError = undefined;
        return;
      }
      Object.assign(data, items);
      callback();
    },
    remove(keys: string | string[], callback: () => void): void {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      callback();
    },
  } as unknown as chrome.storage.StorageArea;

  return {
    data,
    failNextSet: (message: string) => {
      pendingFailure = message;
    },
    raw,
  };
}

function createMockChrome(): MockChrome {
  const runtime: { lastError: { message: string } | undefined } = { lastError: undefined };
  const sync = createMockArea(runtime);
  const local = createMockArea(runtime);
  const session = createMockArea(runtime);
  const chromeObject = {
    runtime,
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
  return { chromeObject, runtime, sync, local, session };
}

describe('chrome.storage あり（per-host キー・書き込み失敗の伝播）', () => {
  let mock: MockChrome;

  beforeEach(() => {
    mock = createMockChrome();
    (globalThis as { chrome?: unknown }).chrome = mock.chromeObject;
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('hasChromeStorage が true になる', () => {
    expect(hasChromeStorage()).toBe(true);
  });

  it('areaSet の lastError は reject になる（saveSettings 経由）', async () => {
    mock.sync.failNextSet('QUOTA_BYTES_PER_ITEM の上限を超えました');
    await expect(saveSettings({ debug: true })).rejects.toThrow(/QUOTA_BYTES_PER_ITEM/);
  });

  it('setSiteOverride も書き込み失敗を reject で伝播する', async () => {
    mock.sync.failNextSet('quota exceeded');
    await expect(setSiteOverride('example.com', { kind: 'custom', allow: allowOnly() })).rejects.toThrow(
      'quota exceeded',
    );
  });

  it('旧スキーマの保存値を新スキーマに読み替えて読む（§14.1 の移行）', async () => {
    mock.sync.data['settings'] = {
      defaultMode: 'accept',
      rejectAllowCategories: { A: true, B: true, D: false, E: false, F: false, X: false },
      fallbackWhenNoReject: 'accept',
      showBadge: false,
      observeSeconds: 30,
    };
    mock.sync.data['siteOverrides'] = { 'a.com': 'reject', 'b.com': 'accept', 'c.com': 'off' };

    const settings = await getSettings();
    // 旧 rejectAllowCategories は捨てて既定（ほどよく守る）で埋め直す。初期設定も未完了扱い
    expect(settings.preset).toBe('minimal');
    expect(settings.allowCategories).toEqual({ A: true, B: false, D: false, E: false, F: false, X: false });
    expect(settings.onboarded).toBe(false);
    // fallback の 'accept' は 'hide' に読み替える。他のフィールドはそのまま
    expect(settings.fallbackWhenNoReject).toBe('hide');
    expect(settings.showBadge).toBe(false);
    expect(settings.observeSeconds).toBe(30);
    expect('defaultMode' in settings).toBe(false);

    // override は reject → strict 相当の custom、accept は削除（§14.9）
    expect(await getSiteOverrides()).toEqual({
      'a.com': { kind: 'custom', allow: allowRecordForPreset('strict') },
      'c.com': { kind: 'off' },
    });
  });

  describe('サイトごとの設定（項目ごとのトグル。§14.9）', () => {
    it('旧形式（プリセット名 / off / reject / accept）を新形式に変換して読む', async () => {
      mock.sync.data['siteOverrides'] = {
        'preset.com': 'relaxed',
        'legacy.com': 'reject',
        'off.com': 'off',
        'dropped.com': 'accept',
        'unknown.com': 'nonsense',
      };
      // accept と未知の値は捨てる（= 全体の設定に従う）
      expect(await getSiteOverrides()).toEqual({
        'preset.com': { kind: 'custom', allow: allowRecordForPreset('relaxed') },
        'legacy.com': { kind: 'custom', allow: allowRecordForPreset('strict') },
        'off.com': { kind: 'off' },
      });
    });

    it('新形式はそのまま読み、allow は CATEGORY_KEYS の形に揃える', async () => {
      mock.sync.data['siteOverrides'] = {
        'a.com': { kind: 'custom', allow: { B: true, Z: true } },
        'b.com': { kind: 'off' },
        'c.com': { kind: 'bogus' },
      };
      expect(await getSiteOverrides()).toEqual({
        'a.com': { kind: 'custom', allow: allowOnly('B') },
        'b.com': { kind: 'off' },
      });
    });

    it('setSiteAllow は override が無ければ全体の allowCategories を土台に custom を作る', async () => {
      // 全体は既定（ほどよく守る = A だけ）
      expect((await setSiteAllow('a.com', { B: true }))['a.com']).toEqual({
        kind: 'custom',
        allow: allowOnly('A', 'B'),
      });
      // 2 回目は作った custom を土台にする（全体には戻さない）
      expect((await setSiteAllow('a.com', { A: false }))['a.com']).toEqual({ kind: 'custom', allow: allowOnly('B') });
    });

    it('setSiteAllow は off のサイトを custom に戻してから適用する', async () => {
      await setSiteOff('a.com', true);
      expect((await setSiteAllow('a.com', { E: true }))['a.com']).toEqual({
        kind: 'custom',
        allow: allowOnly('A', 'E'),
      });
    });

    it('setSiteAllow は他のサイトの設定に触れない', async () => {
      await setSiteOff('b.com', true);
      expect((await setSiteAllow('a.com', { F: true }))['b.com']).toEqual({ kind: 'off' });
    });

    it('setSiteOff(true) は off、false は override ごと消して全体の設定に戻す', async () => {
      await setSiteAllow('a.com', { B: true });
      expect((await setSiteOff('a.com', true))['a.com']).toEqual({ kind: 'off' });
      expect((await setSiteOff('a.com', false))['a.com']).toBeUndefined();
      expect(await getSiteOverrides()).toEqual({});
    });

    it('setSiteAllow / setSiteOff も書き込み失敗を reject で伝播する（H6）', async () => {
      mock.sync.failNextSet('quota exceeded');
      await expect(setSiteAllow('a.com', { B: true })).rejects.toThrow('quota exceeded');
      mock.sync.failNextSet('quota exceeded');
      await expect(setSiteOff('a.com', true)).rejects.toThrow('quota exceeded');
    });

    it('エクスポートは新形式、インポートは新旧どちらの形式も受け入れる', async () => {
      await setSiteAllow('a.com', { B: true });
      await setSiteOff('b.com', true);
      expect((await exportConfig()).siteOverrides).toEqual({
        'a.com': { kind: 'custom', allow: allowOnly('A', 'B') },
        'b.com': { kind: 'off' },
      });

      // 旧形式のバックアップ（全置換）
      expect(await importConfig({ siteOverrides: { 'c.com': 'relaxed', 'd.com': 'off' } })).toMatchObject({
        siteOverrides: 2,
      });
      expect(await getSiteOverrides()).toEqual({
        'c.com': { kind: 'custom', allow: allowRecordForPreset('relaxed') },
        'd.com': { kind: 'off' },
      });

      // 新形式のバックアップ（全置換）
      await importConfig({ siteOverrides: { 'e.com': { kind: 'custom', allow: allowOnly('E') } } });
      expect(await getSiteOverrides()).toEqual({ 'e.com': { kind: 'custom', allow: allowOnly('E') } });
    });

    it('インポートの kind が不正なら reject する', async () => {
      await expect(importConfig({ siteOverrides: { 'a.com': { kind: 'bogus' } } })).rejects.toThrow(
        /siteOverrides の設定値が不正です/,
      );
    });
  });

  it('savePreset は preset と allowCategories を同時に書き換える', async () => {
    expect(await savePreset('relaxed')).toMatchObject({
      preset: 'relaxed',
      allowCategories: { A: true, B: true, D: false, E: true, F: false, X: false },
    });
    expect(await savePreset('strict')).toMatchObject({
      preset: 'strict',
      allowCategories: { A: false, B: false, D: false, E: false, F: false, X: false },
    });
  });

  describe('すべて拒否（プリセット none。§14.1）', () => {
    it('savePreset は preset・allowCategories・pressCloseOnNotice の 3 つを揃えて書く', async () => {
      expect(await savePreset('none')).toMatchObject({
        preset: 'none',
        allowCategories: allowOnly(),
        pressCloseOnNotice: false,
      });
      // 読み直しても none のまま（strict と同じ「許可なし」だが preset は区別される）
      expect(await getSettings()).toMatchObject({ preset: 'none', pressCloseOnNotice: false });
    });

    it('他のプリセットを選ぶと pressCloseOnNotice は true に戻る', async () => {
      await savePreset('none');
      expect(await savePreset('strict')).toMatchObject({ preset: 'strict', pressCloseOnNotice: true });
      await savePreset('none');
      expect(await savePreset('minimal')).toMatchObject({ preset: 'minimal', pressCloseOnNotice: true });
    });

    it('トグルを個別に変えても pressCloseOnNotice は true に戻る（none はカードを選んだときだけ）', async () => {
      await savePreset('none');
      // 許可カテゴリは none と同じ（すべて false）のまま B を切っても、閉じる語は押す側に戻す
      expect(await saveAllowCategories({ B: false })).toMatchObject({
        preset: 'strict',
        pressCloseOnNotice: true,
      });

      await savePreset('none');
      expect(await saveAllowCategories({ A: true })).toMatchObject({
        preset: 'minimal',
        pressCloseOnNotice: true,
      });
    });

    it('他の設定を変えても none のままにする', async () => {
      await savePreset('none');
      expect(await saveSettings({ observeSeconds: 30 })).toMatchObject({
        preset: 'none',
        pressCloseOnNotice: false,
      });
    });

    it('許可カテゴリがあるのに閉じる語だけ押さない保存値は既定（押す）に揃える', async () => {
      mock.sync.data['settings'] = { allowCategories: allowOnly('A'), pressCloseOnNotice: false };
      expect(await getSettings()).toMatchObject({ preset: 'minimal', pressCloseOnNotice: true });
    });

    it('pressCloseOnNotice を持たない旧設定は既定の true で埋める', async () => {
      mock.sync.data['settings'] = { allowCategories: allowOnly(), observeSeconds: 20 };
      expect(await getSettings()).toMatchObject({ preset: 'strict', pressCloseOnNotice: true });
    });

    it('preset だけ none と書かれた手書きの保存値も汲む（フラグが無くても）', async () => {
      mock.sync.data['settings'] = { preset: 'none' };
      expect(await getSettings()).toMatchObject({
        preset: 'none',
        allowCategories: allowOnly(),
        pressCloseOnNotice: false,
      });
    });

    it('バックアップの書き出し・読み込みでも none のまま戻る', async () => {
      await savePreset('none');
      const bundle = await exportConfig();
      await savePreset('relaxed');
      await importConfig(bundle);
      expect(await getSettings()).toMatchObject({ preset: 'none', pressCloseOnNotice: false });
    });
  });

  it('saveAllowCategories は preset を引き直す（一致しなければ custom）', async () => {
    // 既定（minimal = A）に F を足すとどのプリセットとも一致しない
    expect(await saveAllowCategories({ F: true })).toMatchObject({
      preset: 'custom',
      allowCategories: { A: true, B: false, D: false, E: false, F: true, X: false },
    });
    // 戻せば minimal に戻る
    expect((await saveAllowCategories({ F: false })).preset).toBe('minimal');
    // relaxed と同じ組み合わせにすれば relaxed
    expect((await saveAllowCategories({ B: true, E: true })).preset).toBe('relaxed');
  });

  it('saveCustomRule は customRules ではなく cr:<host> キーに保存する', async () => {
    await saveCustomRule({ host: 'a.example.com', action: 'reject', selector: '#x' });
    expect(mock.sync.data['cr:a.example.com']).toBeDefined();
    expect(mock.sync.data['customRules']).toBeUndefined();
  });

  it('saveCustomRule の書き込み失敗は reject で伝播する', async () => {
    mock.sync.failNextSet('quota exceeded');
    await expect(saveCustomRule({ host: 'a.com', action: 'reject' })).rejects.toThrow('quota exceeded');
  });

  it('getCustomRulesForHost は該当 host の 1 キーだけ読む', async () => {
    await saveCustomRule({ host: 'a.com', action: 'reject' });
    await saveCustomRule({ host: 'b.com', action: 'accept' });
    const hostRules = await getCustomRulesForHost('a.com');
    expect(hostRules.map((r) => r.host)).toEqual(['a.com']);
  });

  it('getCustomRules は全 cr:<host> キーを集約する', async () => {
    await saveCustomRule({ host: 'a.com', action: 'reject' });
    await saveCustomRule({ host: 'b.com', action: 'accept' });
    const all = await getCustomRules();
    expect(all.map((r) => r.host).sort()).toEqual(['a.com', 'b.com']);
  });

  it('saveCustomRule は同じ host・action の既存ルールだけ置き換える', async () => {
    await saveCustomRule({ host: 'a.com', action: 'reject', text: 'first' });
    await saveCustomRule({ host: 'a.com', action: 'accept', text: 'allow' });
    await saveCustomRule({ host: 'a.com', action: 'reject', text: 'second' });

    const hostRules = await getCustomRulesForHost('a.com');
    expect(hostRules).toHaveLength(2);
    const reject = hostRules.find((r) => r.action === 'reject');
    const accept = hostRules.find((r) => r.action === 'accept');
    expect(reject?.text).toBe('second');
    expect(accept?.text).toBe('allow');
  });

  it('removeCustomRule は該当ルールだけ削除し、host のルールが 0 件になったらキーごと削除する', async () => {
    const rejectRule = await saveCustomRule({ host: 'a.com', action: 'reject' });
    await saveCustomRule({ host: 'a.com', action: 'accept' });

    await removeCustomRule(rejectRule.id);
    const afterFirstRemove = await getCustomRulesForHost('a.com');
    expect(afterFirstRemove).toHaveLength(1);
    expect(mock.sync.data['cr:a.com']).toBeDefined();

    const lastRule = afterFirstRemove[0] as CustomRule;
    await removeCustomRule(lastRule.id);
    expect(await getCustomRulesForHost('a.com')).toEqual([]);
    expect(mock.sync.data['cr:a.com']).toBeUndefined();
  });

  it('importConfig の customRules は全置換される（インポートに無い host は消える）', async () => {
    await saveCustomRule({ host: 'old.example.com', action: 'reject' });
    await importConfig({ customRules: [{ host: 'new.example.com', action: 'accept' }] });

    expect(await getCustomRulesForHost('old.example.com')).toEqual([]);
    expect(mock.sync.data['cr:old.example.com']).toBeUndefined();
    expect(await getCustomRulesForHost('new.example.com')).toHaveLength(1);
  });

  it('importConfig の customRules は 1 回の set で書き、書き込み失敗でも旧データを消さない（M-e）', async () => {
    await saveCustomRule({ host: 'old.example.com', action: 'reject', text: '拒否' });
    mock.sync.failNextSet('quota exceeded');

    await expect(
      importConfig({
        customRules: [
          { host: 'a.example.com', action: 'accept' },
          { host: 'b.example.com', action: 'reject' },
        ],
      }),
    ).rejects.toThrow('quota exceeded');

    // 新しい cr:* が書けなかったので、旧データはそのまま残っている（全消しにはしない）
    expect(await getCustomRulesForHost('old.example.com')).toHaveLength(1);
    expect(mock.sync.data['cr:a.example.com']).toBeUndefined();
    expect(mock.sync.data['cr:b.example.com']).toBeUndefined();
  });

  it('importConfig({ customRules: [] }) は既存の customRules を全消去する', async () => {
    await saveCustomRule({ host: 'old.example.com', action: 'reject' });
    await importConfig({ customRules: [] });
    expect(await getCustomRules()).toEqual([]);
  });

  it('tabStatus は tabStatus という単一キーではなく tab:<id> に保存される', async () => {
    await saveTabStatus(42, { host: 'a.com', status: 'handled', at: 1 });
    expect(mock.session.data['tab:42']).toBeDefined();
    expect(mock.session.data['tabStatus']).toBeUndefined();
    expect(await getTabStatus(42)).toEqual({ host: 'a.com', status: 'handled', at: 1 });
  });

  it('clearTabStatus は該当タブの tab:<id> キーだけ削除する', async () => {
    await saveTabStatus(1, { host: 'a.com', status: 'handled', at: 1 });
    await saveTabStatus(2, { host: 'b.com', status: 'handled', at: 2 });
    await clearTabStatus(1);
    expect(await getTabStatus(1)).toBeNull();
    expect(await getTabStatus(2)).not.toBeNull();
  });

  describe('siteHistory（サイトごとの対応記録。§14.8）', () => {
    it('recordSiteHistory は同じ host（siteKey）を上書きする', async () => {
      await recordSiteHistory({ host: 'a.com', decision: 'reject-all', at: 1 });
      await recordSiteHistory({ host: 'a.com', decision: 'dismissed', at: 2 });

      expect(await getSiteHistoryEntry('a.com')).toEqual({ host: 'a.com', decision: 'dismissed', at: 2 });
      expect(Object.keys(await getSiteHistory())).toEqual(['a.com']);
    });

    it('記録の無い host は null を返す', async () => {
      expect(await getSiteHistoryEntry('nope.example.com')).toBeNull();
    });

    it('上限（500 件）を超えたら at が古いものから間引く', async () => {
      for (let i = 0; i < 500; i++) {
        await recordSiteHistory({ host: `host${i}.example.com`, at: i });
      }
      expect(Object.keys(await getSiteHistory())).toHaveLength(500);

      // 501 件目を足すと、もっとも at が古い host0（at: 0）が消え、2 番目に古い host1 は残る
      await recordSiteHistory({ host: 'host500.example.com', at: 500 });
      expect(Object.keys(await getSiteHistory())).toHaveLength(500);
      expect(await getSiteHistoryEntry('host0.example.com')).toBeNull();
      expect(await getSiteHistoryEntry('host1.example.com')).not.toBeNull();
      expect(await getSiteHistoryEntry('host500.example.com')).not.toBeNull();
    });

    it('removeSiteHistoryEntry は指定した host だけ削除する', async () => {
      await recordSiteHistory({ host: 'a.com', at: 1 });
      await recordSiteHistory({ host: 'b.com', at: 2 });

      await removeSiteHistoryEntry('a.com');
      expect(await getSiteHistoryEntry('a.com')).toBeNull();
      expect(await getSiteHistoryEntry('b.com')).not.toBeNull();
    });

    it('clearSiteHistory はすべて消す', async () => {
      await recordSiteHistory({ host: 'a.com', at: 1 });
      await recordSiteHistory({ host: 'b.com', at: 2 });

      await clearSiteHistory();
      expect(await getSiteHistory()).toEqual({});
    });

    it('recordSiteHistory の書き込み失敗は reject で伝播する（H6）', async () => {
      mock.local.failNextSet('quota exceeded');
      await expect(recordSiteHistory({ host: 'a.com', at: 1 })).rejects.toThrow('quota exceeded');
    });
  });
});
