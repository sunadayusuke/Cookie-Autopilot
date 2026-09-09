// 設定の既定値と読み書き（docs/SPEC.md §3 / §14.1）
//
// 保存レイアウト:
//   chrome.storage.sync
//     - settings      : Settings（1 キー）
//     - siteOverrides : SiteOverrides（1 キー、host → { kind:'custom', allow } | { kind:'off' }）
//     - cr:<host>     : CustomRule[]（host 単位のキーに分割。1 キーの配列だと 8KB/item の
//                       QUOTA_BYTES_PER_ITEM を超えて書き込みが失敗するため）
//   chrome.storage.local
//     - comRules          : ComRulesPayload
//     - comRulesStatus    : ComRulesStatus
//     - onboardingShownAt : number（初期設定ページを開いた時刻。M4）
//   chrome.storage.session
//     - tab:<tabId>    : TabStatus（タブ単位のキー。1 キーの map だと read-modify-write の
//                        競合が起きやすいため）
//
// onStorageChanged の callback には実際に変化したキー名がそのまま渡る（例: 'cr:example.com',
// 'tab:123'）。'customRules' '"tabStatus'" という単一キーはもう存在しないので、購読側は
// 前方一致（'cr:' / 'tab:' プレフィックス）で判定すること。
//
// chrome API が無い環境（fixtures の素の HTML）でも動くよう、すべての chrome 参照を
// ガードしている。chrome が無い場合は既定値で動き、URL クエリ `?mode=accept` /
// `?debug=1` で上書きできる（拡張として動いているときは効かない）。

import type {
  CategoryKey,
  ComRulesPayload,
  ComRulesStatus,
  CustomRule,
  ExportBundle,
  Mode,
  Preset,
  Settings,
  SiteHistory,
  SiteHistoryEntry,
  SiteOverride,
  SiteOverrides,
  TabStatus,
} from './types';
import { CATEGORY_KEYS, EXTRA_PRESET, MODES } from './types';
import { activeCategories, allowRecordForPreset, isPreset, presetFromCategories } from './presets';

export const DEFAULT_PRESET: Preset = 'minimal';

export const DEFAULT_SETTINGS: Settings = {
  preset: DEFAULT_PRESET,
  allowCategories: allowRecordForPreset(DEFAULT_PRESET),
  pressCloseOnNotice: true,
  onboarded: false,
  fallbackWhenNoReject: 'hide',
  showBadge: true,
  debug: false,
  observeSeconds: 20,
};

const KEY_SETTINGS = 'settings';
const KEY_SITE_OVERRIDES = 'siteOverrides';
const CUSTOM_RULE_KEY_PREFIX = 'cr:';
const KEY_COM_RULES = 'comRules';
const KEY_COM_RULES_STATUS = 'comRulesStatus';
const KEY_ONBOARDING_SHOWN_AT = 'onboardingShownAt';
const TAB_STATUS_KEY_PREFIX = 'tab:';
const KEY_SITE_HISTORY = 'siteHistory';

/** インポート時の上限（M12）。上限超過・型不正は理由付きで reject する */
const MAX_HOST_LENGTH = 253;
const MAX_RULE_TEXT_LENGTH = 500;
const MAX_CUSTOM_RULES = 500;
const MAX_SITE_OVERRIDES = 1000;
/** サイトごとの対応記録の上限（§14.8）。超えたら at が古いものから間引く */
const MAX_SITE_HISTORY = 500;

type AreaName = 'sync' | 'local' | 'session';

function customRuleKey(host: string): string {
  return `${CUSTOM_RULE_KEY_PREFIX}${host}`;
}

function tabStatusKey(tabId: number): string {
  return `${TAB_STATUS_KEY_PREFIX}${tabId}`;
}

/** chrome.storage が使えるか */
export function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage;
}

function area(name: AreaName): chrome.storage.StorageArea | null {
  if (!hasChromeStorage()) return null;
  const store = chrome.storage as unknown as Record<AreaName, chrome.storage.StorageArea | undefined>;
  return store[name] ?? null;
}

function areaGet<T>(name: AreaName, key: string): Promise<T | undefined> {
  const store = area(name);
  if (!store) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    try {
      store.get(key, (items: Record<string, unknown>) => {
        void chrome.runtime?.lastError;
        resolve(items?.[key] as T | undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

/** エリア全体を読む（host / タブ単位のキーを集約するのに使う）。読み取りはベストエフォートで reject しない */
function areaGetAll(name: AreaName): Promise<Record<string, unknown>> {
  const store = area(name);
  if (!store) return Promise.resolve({});
  return new Promise((resolve) => {
    try {
      store.get(null, (items: Record<string, unknown>) => {
        void chrome.runtime?.lastError;
        resolve(items ?? {});
      });
    } catch {
      resolve({});
    }
  });
}

/** 複数キーを 1 回で書く。書き込み失敗は握りつぶさず reject する（H6 / M-e） */
function areaSetMany(name: AreaName, items: Record<string, unknown>): Promise<void> {
  const store = area(name);
  if (!store) return Promise.resolve();
  return new Promise((resolve, reject) => {
    try {
      store.set(items, () => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          const keys = Object.keys(items).join(', ');
          reject(new Error(lastError.message ?? `chrome.storage.${name}.set に失敗しました（key: ${keys}）`));
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** 書き込み失敗（8KB/item の QUOTA_BYTES_PER_ITEM 超過など）を握りつぶさず reject する（H6） */
function areaSet(name: AreaName, key: string, value: unknown): Promise<void> {
  return areaSetMany(name, { [key]: value });
}

/** キー削除。tabStatus の掃除など致命的でない用途のみに使うため reject しない（ベストエフォート） */
function areaRemove(name: AreaName, keys: string[]): Promise<void> {
  const store = area(name);
  if (!store || keys.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      store.remove(keys, () => {
        void chrome.runtime?.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

/** chrome が無いときだけ効く URL クエリによる上書き（fixtures 用） */
function overridesFromQuery(): Partial<Settings> {
  const params = queryParams();
  if (!params) return {};
  const patch: Partial<Settings> = {};
  const debug = params.get('debug');
  if (debug !== null && debug !== '0' && debug !== 'false') patch.debug = true;
  return patch;
}

function queryParams(): URLSearchParams | null {
  if (typeof location === 'undefined' || !location.search) return null;
  try {
    return new URLSearchParams(location.search);
  } catch {
    return null; // 壊れたクエリは無視
  }
}

/**
 * fixtures（chrome API が無い素の HTML）でだけ効く `?mode=accept` / `?mode=off`。
 * 実効モードは本来 'off' か 'reject' だけなので、accept を試せる経路はここにしか無い。
 * 拡張として動いているときは常に null（ページの URL に `?mode=accept` があっても効かない）。
 */
export function modeFromQuery(): Mode | null {
  if (hasChromeStorage()) return null;
  const mode = queryParams()?.get('mode');
  return isMode(mode) ? mode : null;
}

/**
 * 保存値を新スキーマに揃える（§14.1 の移行）。
 * 旧 `defaultMode` `rejectAllowCategories` は捨て、`fallbackWhenNoReject: 'accept'` は
 * 'hide' に読み替える。preset は allowCategories（と pressCloseOnNotice）から引き直すので、
 * 両者が食い違うことはない。`pressCloseOnNotice` を持たない旧設定は既定の true で埋める。
 */
function mergeSettings(stored: unknown): Settings {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Partial<Settings>;

  let categories: Record<CategoryKey, boolean>;
  const rawCategories = raw.allowCategories;
  if (rawCategories && typeof rawCategories === 'object') {
    categories = {} as Record<CategoryKey, boolean>;
    for (const key of CATEGORY_KEYS) categories[key] = rawCategories[key] === true;
  } else if (isPreset(raw.preset)) {
    categories = allowRecordForPreset(raw.preset);
  } else {
    categories = { ...DEFAULT_SETTINGS.allowCategories };
  }

  const observeSeconds =
    typeof raw.observeSeconds === 'number' && Number.isFinite(raw.observeSeconds)
      ? Math.min(120, Math.max(1, Math.round(raw.observeSeconds)))
      : DEFAULT_SETTINGS.observeSeconds;
  // 'none'（すべて拒否）は「許可カテゴリなし」+「閉じる語も押さない」の組で表す。
  // 許可カテゴリがあるのに閉じる語だけ押さない状態は UI から作れないので、
  // 保存値がそうなっていたら既定（押す）に揃える。
  // 手書きの JSON をインポートしたときのために、preset だけ 'none' でフラグが無い場合も汲む。
  const derived = presetFromCategories(categories);
  const wantsNone =
    raw.pressCloseOnNotice === false ||
    (raw.preset === EXTRA_PRESET && raw.pressCloseOnNotice !== true);
  const pressesNothing = wantsNone && derived === 'strict';
  return {
    preset: pressesNothing ? EXTRA_PRESET : derived,
    allowCategories: categories,
    pressCloseOnNotice: !pressesNothing,
    onboarded: raw.onboarded === true,
    // 旧 'accept'（許可して閉じる）は既定の 'hide' に読み替える
    fallbackWhenNoReject: raw.fallbackWhenNoReject === 'leave' ? 'leave' : 'hide',
    showBadge: raw.showBadge !== false,
    debug: raw.debug === true,
    observeSeconds,
  };
}

export async function getSettings(): Promise<Settings> {
  if (!hasChromeStorage()) return { ...mergeSettings({}), ...overridesFromQuery() };
  return mergeSettings(await areaGet<Partial<Settings>>('sync', KEY_SETTINGS));
}

/** 差分を渡して保存し、保存後の全体を返す。書き込み失敗（H6）は reject して伝播する */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = mergeSettings({ ...(await getSettings()), ...patch });
  await areaSet('sync', KEY_SETTINGS, next);
  return next;
}

/**
 * プリセットを選んだときに書き換わる 3 フィールド（§14.1）。
 * 閉じる語を押さないのは 'none'（すべて拒否）だけで、他のプリセットを選んだら押す側に戻す。
 * onboarding は onboarded と一緒に 1 回で保存したいので、この形だけを共有する。
 */
export function settingsForPreset(preset: Preset): Pick<Settings, 'preset' | 'allowCategories' | 'pressCloseOnNotice'> {
  return {
    preset,
    allowCategories: allowRecordForPreset(preset),
    pressCloseOnNotice: preset !== EXTRA_PRESET,
  };
}

/** プリセットを選ぶ。allowCategories と pressCloseOnNotice も一緒に書き換える（§14.1） */
export async function savePreset(preset: Preset): Promise<Settings> {
  return saveSettings(settingsForPreset(preset));
}

/**
 * カテゴリのトグルを個別に変える。preset は presetFromCategories で引き直すので、
 * どのプリセットとも一致しなくなれば 'custom' になる（§14.5）。
 * 'none' はカードを明示的に選んだときだけの状態なので、ここでは閉じる語を押す側に戻す。
 */
export async function saveAllowCategories(patch: Partial<Record<CategoryKey, boolean>>): Promise<Settings> {
  const current = await getSettings();
  const allowCategories = { ...current.allowCategories };
  for (const key of CATEGORY_KEYS) {
    const value = patch[key];
    if (typeof value === 'boolean') allowCategories[key] = value;
  }
  return saveSettings({
    preset: presetFromCategories(allowCategories),
    allowCategories,
    pressCloseOnNotice: true,
  });
}

/** 許可カテゴリの record を CATEGORY_KEYS の形に揃える（保存値に余計なキーや欠けがあっても壊れないように） */
function normalizeAllowRecord(raw: Partial<Record<CategoryKey, boolean>>): Record<CategoryKey, boolean> {
  const allow = {} as Record<CategoryKey, boolean>;
  for (const key of CATEGORY_KEYS) allow[key] = raw[key] === true;
  return allow;
}

/**
 * 保存済みの 1 件を新スキーマ（§14.9）に読み替える。
 * 旧形式のプリセット名はそのプリセットの許可カテゴリを持つ custom に変換する。
 * さらに古い 'reject'（必要なもののみ）は「このサイトだけは厳しく」という意図なので strict 相当、
 * 'accept'（すべて許可）は UI から作れなくなったので捨てる（= 全体の設定に従う）。
 */
function parseSiteOverride(value: unknown): SiteOverride | null {
  if (value === 'off') return { kind: 'off' };
  if (isPreset(value)) return { kind: 'custom', allow: allowRecordForPreset(value) };
  if (value === 'reject') return { kind: 'custom', allow: allowRecordForPreset('strict') };
  if (value && typeof value === 'object') {
    const raw = value as { kind?: unknown; allow?: unknown };
    if (raw.kind === 'off') return { kind: 'off' };
    if (raw.kind === 'custom' && raw.allow && typeof raw.allow === 'object') {
      return { kind: 'custom', allow: normalizeAllowRecord(raw.allow as Partial<Record<CategoryKey, boolean>>) };
    }
  }
  return null; // 'accept' と未知の値は捨てる
}

export async function getSiteOverrides(): Promise<SiteOverrides> {
  const raw = await areaGet<Record<string, unknown>>('sync', KEY_SITE_OVERRIDES);
  const out: SiteOverrides = {};
  if (raw && typeof raw === 'object') {
    for (const [host, value] of Object.entries(raw)) {
      const override = parseSiteOverride(value);
      if (override) out[host] = override;
    }
  }
  return out;
}

/** null を渡すとキーを削除（= 全体設定に従う）。書き込み失敗（H6）は reject して伝播する */
export async function setSiteOverride(host: string, override: SiteOverride | null): Promise<SiteOverrides> {
  const overrides = await getSiteOverrides();
  if (override === null) delete overrides[host];
  else overrides[host] = override;
  await areaSet('sync', KEY_SITE_OVERRIDES, overrides);
  return overrides;
}

/**
 * このサイトの項目トグルを 1 つ（複数可）変える（§14.9）。
 * override が無ければ全体の allowCategories を土台に custom を作り、'off' だったときも
 * その時点の実効値（= 全体の設定）を土台に custom へ戻す。書き込み失敗（H6）は reject して伝播する。
 */
export async function setSiteAllow(
  host: string,
  patch: Partial<Record<CategoryKey, boolean>>,
): Promise<SiteOverrides> {
  const [overrides, settings] = await Promise.all([getSiteOverrides(), getSettings()]);
  const current = overrides[host];
  const base = current?.kind === 'custom' ? current.allow : settings.allowCategories;
  const allow = normalizeAllowRecord(base);
  for (const key of CATEGORY_KEYS) {
    const value = patch[key];
    if (typeof value === 'boolean') allow[key] = value;
  }
  overrides[host] = { kind: 'custom', allow };
  await areaSet('sync', KEY_SITE_OVERRIDES, overrides);
  return overrides;
}

/**
 * 「このサイトでは動かさない」の ON/OFF（§14.9）。
 * OFF に戻すときは直前の allow を復元できないので、override ごと削除して全体の設定に戻す。
 * 書き込み失敗（H6）は reject して伝播する。
 */
export async function setSiteOff(host: string, off: boolean): Promise<SiteOverrides> {
  return setSiteOverride(host, off ? { kind: 'off' } : null);
}

/**
 * 実効モード（§14.1 / §14.9）。サイト設定が off なら 'off'、それ以外は常に 'reject'。
 * 「すべて許可」は UI から作れないので、accept になるのは fixtures の `?mode=accept` だけ。
 */
export function effectiveMode(host: string, overrides: SiteOverrides): Mode {
  if (overrides[host]?.kind === 'off') return 'off';
  return modeFromQuery() ?? 'reject';
}

/**
 * 実効の許可カテゴリ（§14.1 / §14.9）。
 * サイトに custom の override があればその allow、無ければ全体の allowCategories。
 */
export function effectiveCategories(
  host: string,
  settings: Settings,
  overrides: SiteOverrides,
): CategoryKey[] {
  const override = overrides[host];
  if (override?.kind === 'custom') return activeCategories(override.allow);
  if (override?.kind === 'off') return [];
  return activeCategories(settings.allowCategories);
}

// ---------------------------------------------------------------------------
// customRules（host 単位のキー = cr:<host>。H6）
// ---------------------------------------------------------------------------

function isCustomRule(rule: unknown): rule is CustomRule {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as Partial<CustomRule>;
  return typeof r.id === 'string' && typeof r.host === 'string' && (r.action === 'reject' || r.action === 'accept');
}

/** 1 サイト分だけ読む（content script はページ読み込みごとにこれだけ読めばよい） */
export async function getCustomRulesForHost(host: string): Promise<CustomRule[]> {
  const raw = await areaGet<unknown>('sync', customRuleKey(host));
  if (!Array.isArray(raw)) return [];
  return raw.filter(isCustomRule);
}

/** 全 cr:<host> キーを集約する（options のサイト一覧・エクスポート用） */
export async function getCustomRules(): Promise<CustomRule[]> {
  const all = await areaGetAll('sync');
  const rules: CustomRule[] = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(CUSTOM_RULE_KEY_PREFIX) || !Array.isArray(value)) continue;
    for (const rule of value) if (isCustomRule(rule)) rules.push(rule);
  }
  return rules;
}

/** 同じ host・同じ action の既存ルールは置き換える。書き込み失敗（H6）は reject して伝播する */
export async function saveCustomRule(
  input: Pick<CustomRule, 'host' | 'action'> & Partial<Pick<CustomRule, 'selector' | 'text' | 'id' | 'createdAt'>>,
): Promise<CustomRule> {
  const rule: CustomRule = {
    id: input.id ?? `${input.host}:${input.action}:${Date.now().toString(36)}`,
    host: input.host,
    action: input.action,
    createdAt: input.createdAt ?? Date.now(),
  };
  if (input.selector) rule.selector = input.selector;
  if (input.text) rule.text = input.text;
  const rules = (await getCustomRulesForHost(rule.host)).filter((r) => r.action !== rule.action);
  rules.push(rule);
  await areaSet('sync', customRuleKey(rule.host), rules);
  return rule;
}

/**
 * id だけでは host が分からないため、全 cr:<host> を読んで探す（削除は options からの低頻度操作）。
 * 該当ホストのルールが 0 件になったらキー自体を削除する。書き込み失敗（H6）は reject して伝播する。
 */
export async function removeCustomRule(id: string): Promise<CustomRule[]> {
  const all = await getCustomRules();
  const target = all.find((rule) => rule.id === id);
  if (!target) return all;

  const remainingForHost = all.filter((rule) => rule.host === target.host && rule.id !== id);
  if (remainingForHost.length > 0) await areaSet('sync', customRuleKey(target.host), remainingForHost);
  else await areaRemove('sync', [customRuleKey(target.host)]);

  return all.filter((rule) => rule.id !== id);
}

// ---------------------------------------------------------------------------
// Consent-O-Matic ルール（chrome.storage.local）
// ---------------------------------------------------------------------------

export async function getComRules(): Promise<ComRulesPayload | null> {
  const raw = await areaGet<Partial<ComRulesPayload>>('local', KEY_COM_RULES);
  if (!raw || typeof raw !== 'object' || !raw.rules || typeof raw.rules !== 'object') return null;
  return {
    fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : 0,
    source: typeof raw.source === 'string' ? raw.source : '',
    rules: raw.rules,
  };
}

/** 書き込み失敗（H6）は reject して伝播する */
export async function saveComRules(payload: ComRulesPayload): Promise<void> {
  await areaSet('local', KEY_COM_RULES, payload);
}

export async function getComRulesStatus(): Promise<ComRulesStatus | null> {
  return (await areaGet<ComRulesStatus>('local', KEY_COM_RULES_STATUS)) ?? null;
}

/** 書き込み失敗（H6）は reject して伝播する */
export async function saveComRulesStatus(status: ComRulesStatus): Promise<void> {
  await areaSet('local', KEY_COM_RULES_STATUS, status);
}

// ---------------------------------------------------------------------------
// 初期設定ページを開いた記録（chrome.storage.local。M4）
// ---------------------------------------------------------------------------

/** 初期設定ページを自動で開いた時刻。まだ一度も開いていなければ null */
export async function getOnboardingShownAt(): Promise<number | null> {
  const raw = await areaGet<unknown>('local', KEY_ONBOARDING_SHOWN_AT);
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** 書き込み失敗（H6）は reject して伝播する */
export async function saveOnboardingShownAt(at: number): Promise<void> {
  await areaSet('local', KEY_ONBOARDING_SHOWN_AT, at);
}

// ---------------------------------------------------------------------------
// tabStatus（タブ単位のキー = tab:<tabId>。L7）
// ---------------------------------------------------------------------------

/** 全タブ分を集約する（現状の利用箇所は無いが、デバッグ等での利用に備えて残す） */
export async function getTabStatusMap(): Promise<Record<string, TabStatus>> {
  const all = await areaGetAll('session');
  const map: Record<string, TabStatus> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(TAB_STATUS_KEY_PREFIX) || !value || typeof value !== 'object') continue;
    map[key.slice(TAB_STATUS_KEY_PREFIX.length)] = value as TabStatus;
  }
  return map;
}

export async function getTabStatus(tabId: number): Promise<TabStatus | null> {
  return (await areaGet<TabStatus>('session', tabStatusKey(tabId))) ?? null;
}

/** 書き込み失敗（H6）は reject して伝播する */
export async function saveTabStatus(tabId: number, status: TabStatus): Promise<void> {
  await areaSet('session', tabStatusKey(tabId), status);
}

/** タブが閉じた／読み込み直された掃除用。ベストエフォート（reject しない） */
export async function clearTabStatus(tabId: number): Promise<void> {
  await areaRemove('session', [tabStatusKey(tabId)]);
}

// ---------------------------------------------------------------------------
// サイトごとの対応記録（chrome.storage.local の siteHistory = Record<host, SiteHistoryEntry>。§14.8）
// エクスポート／インポート（下のセクション）には含めない。設定ではなく履歴のため。
// ---------------------------------------------------------------------------

function isSiteHistoryEntry(value: unknown): value is SiteHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<SiteHistoryEntry>;
  return typeof v.host === 'string' && typeof v.at === 'number';
}

export async function getSiteHistory(): Promise<SiteHistory> {
  const raw = await areaGet<Record<string, unknown>>('local', KEY_SITE_HISTORY);
  const out: SiteHistory = {};
  if (raw && typeof raw === 'object') {
    for (const [host, value] of Object.entries(raw)) {
      if (isSiteHistoryEntry(value)) out[host] = value;
    }
  }
  return out;
}

export async function getSiteHistoryEntry(host: string): Promise<SiteHistoryEntry | null> {
  const history = await getSiteHistory();
  return history[host] ?? null;
}

/** at が古いものから間引いて上限（MAX_SITE_HISTORY 件）に収める */
function pruneSiteHistory(history: SiteHistory): void {
  const hosts = Object.keys(history);
  const overflow = hosts.length - MAX_SITE_HISTORY;
  if (overflow <= 0) return;
  const oldestFirst = hosts.sort((a, b) => (history[a]?.at ?? 0) - (history[b]?.at ?? 0));
  for (const host of oldestFirst.slice(0, overflow)) delete history[host];
}

/**
 * 同じ host（siteKey）は上書きする。上限（MAX_SITE_HISTORY 件）を超えたら at が古いものから削除する。
 * 書き込み失敗（H6）は reject して伝播する。
 */
export async function recordSiteHistory(entry: SiteHistoryEntry): Promise<void> {
  const history = await getSiteHistory();
  history[entry.host] = entry;
  pruneSiteHistory(history);
  await areaSet('local', KEY_SITE_HISTORY, history);
}

/** 書き込み失敗（H6）は reject して伝播する */
export async function removeSiteHistoryEntry(host: string): Promise<void> {
  const history = await getSiteHistory();
  delete history[host];
  await areaSet('local', KEY_SITE_HISTORY, history);
}

/** 書き込み失敗（H6）は reject して伝播する */
export async function clearSiteHistory(): Promise<void> {
  await areaSet('local', KEY_SITE_HISTORY, {});
}

// ---------------------------------------------------------------------------
// エクスポート／インポート（M12: 上限・型ガード・全置換）
// ---------------------------------------------------------------------------

export async function exportConfig(): Promise<ExportBundle> {
  return {
    settings: await getSettings(),
    siteOverrides: await getSiteOverrides(),
    customRules: await getCustomRules(),
  };
}

function isValidHost(host: unknown): host is string {
  return typeof host === 'string' && host.length > 0 && host.length <= MAX_HOST_LENGTH;
}

function isValidRuleText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_RULE_TEXT_LENGTH;
}

/** インポートされた 1 件を検証する。不正なら理由付きで例外を投げる（M12） */
function parseImportedCustomRule(raw: unknown): CustomRule {
  if (!raw || typeof raw !== 'object') throw new Error('customRules の要素がオブジェクトではありません');
  const r = raw as Partial<CustomRule>;
  if (!isValidHost(r.host)) {
    throw new Error(`customRules の host が不正です（文字列かつ ${MAX_HOST_LENGTH} 文字以下である必要があります）`);
  }
  if (r.action !== 'reject' && r.action !== 'accept') {
    throw new Error(`customRules の action が不正です（host: ${r.host}）`);
  }
  if (r.selector !== undefined && !isValidRuleText(r.selector)) {
    throw new Error(`customRules の selector が長すぎます（host: ${r.host}、上限 ${MAX_RULE_TEXT_LENGTH} 文字）`);
  }
  if (r.text !== undefined && !isValidRuleText(r.text)) {
    throw new Error(`customRules の text が長すぎます（host: ${r.host}、上限 ${MAX_RULE_TEXT_LENGTH} 文字）`);
  }
  const rule: CustomRule = {
    id: typeof r.id === 'string' && r.id.length > 0 ? r.id : `${r.host}:${r.action}:${Date.now().toString(36)}`,
    host: r.host,
    action: r.action,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
  };
  if (typeof r.selector === 'string') rule.selector = r.selector;
  if (typeof r.text === 'string') rule.text = r.text;
  return rule;
}

/**
 * host ごとにまとめ直した cr:<host> を 1 回の set で書き、成功したあとで不要になった
 * 旧キーだけを削除する（全置換）。
 * 「先に全部消してから host ごとに直列で書く」順序だと、途中で書き込みが失敗したときに
 * 旧データも新データも無い状態になってしまうため。remove が失敗しても、余分な旧 host の
 * ルールが残るだけで、インポートした内容は揃っている。
 */
async function replaceAllCustomRules(rules: CustomRule[]): Promise<void> {
  const byHost = new Map<string, CustomRule[]>();
  for (const rule of rules) {
    const list = byHost.get(rule.host) ?? [];
    list.push(rule);
    byHost.set(rule.host, list);
  }

  const items: Record<string, CustomRule[]> = {};
  for (const [host, list] of byHost) items[customRuleKey(host)] = list;
  if (Object.keys(items).length > 0) await areaSetMany('sync', items);

  const existing = await areaGetAll('sync');
  const staleKeys = Object.keys(existing).filter(
    (key) => key.startsWith(CUSTOM_RULE_KEY_PREFIX) && !(key in items),
  );
  await areaRemove('sync', staleKeys);
}

/**
 * JSON インポート。取り込めた件数を返す。
 * 型が不正・上限超過の場合は理由付きで reject する（M12）。全項目を検証してから書き込むため、
 * 途中の項目が不正で reject したときに一部だけ反映されている、という状態にはならない。
 * siteOverrides・customRules はインポートに含まれていれば既存の内容を全置換する。
 */
export async function importConfig(data: unknown): Promise<{ settings: boolean; siteOverrides: number; customRules: number }> {
  if (!data || typeof data !== 'object') throw new Error('インポートするファイルの形式が不正です');
  const bundle = data as Partial<ExportBundle>;

  let settingsToSave: Settings | null = null;
  if (bundle.settings !== undefined) {
    if (!bundle.settings || typeof bundle.settings !== 'object') throw new Error('settings の形式が不正です');
    settingsToSave = mergeSettings(bundle.settings);
  }

  let overridesToSave: SiteOverrides | null = null;
  if (bundle.siteOverrides !== undefined) {
    if (!bundle.siteOverrides || typeof bundle.siteOverrides !== 'object') {
      throw new Error('siteOverrides の形式が不正です');
    }
    // 旧スキーマ（host → Mode）のバックアップも読めるよう unknown として検証する
    const entries = Object.entries(bundle.siteOverrides as Record<string, unknown>);
    if (entries.length > MAX_SITE_OVERRIDES) {
      throw new Error(`siteOverrides が上限（${MAX_SITE_OVERRIDES} 件）を超えています`);
    }
    const overrides: SiteOverrides = {};
    for (const [host, value] of entries) {
      // host は Object.entries が返す時点で必ず string（型ガードは使わず長さだけ見る。
      // isValidHost(host: unknown) を既に string な値に適用すると、失敗時の分岐が
      // TypeScript 上 never に narrow されて host.slice が型エラーになるため）
      if (host.length === 0 || host.length > MAX_HOST_LENGTH) {
        throw new Error(`siteOverrides の host が不正です: ${host.slice(0, 80)}`);
      }
      // 旧スキーマ（プリセット名 / Mode）のバックアップも読み替えて受け入れる。'accept' は捨てるので
      // 「不正」ではなく単に取り込まない
      if (value === 'accept') continue;
      const override = parseSiteOverride(value);
      if (!override) throw new Error(`siteOverrides の設定値が不正です（host: ${host}）`);
      overrides[host] = override;
    }
    overridesToSave = overrides;
  }

  let rulesToSave: CustomRule[] | null = null;
  if (bundle.customRules !== undefined) {
    if (!Array.isArray(bundle.customRules)) throw new Error('customRules の形式が不正です');
    if (bundle.customRules.length > MAX_CUSTOM_RULES) {
      throw new Error(`customRules が上限（${MAX_CUSTOM_RULES} 件）を超えています`);
    }
    rulesToSave = bundle.customRules.map(parseImportedCustomRule);
  }

  const result = { settings: false, siteOverrides: 0, customRules: 0 };
  if (settingsToSave) {
    await areaSet('sync', KEY_SETTINGS, settingsToSave);
    result.settings = true;
  }
  if (overridesToSave) {
    await areaSet('sync', KEY_SITE_OVERRIDES, overridesToSave);
    result.siteOverrides = Object.keys(overridesToSave).length;
  }
  if (rulesToSave) {
    await replaceAllCustomRules(rulesToSave);
    result.customRules = rulesToSave.length;
  }
  return result;
}

/** storage の変更監視。戻り値を呼ぶと解除。渡されるキー名は実際のストレージキー（'cr:xxx' 等）そのもの */
export function onStorageChanged(callback: (areaName: string, keys: string[]) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => undefined;
  const listener = (changes: Record<string, unknown>, areaName: string) => callback(areaName, Object.keys(changes));
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
