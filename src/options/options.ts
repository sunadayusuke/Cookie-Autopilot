// options（docs/SPEC.md §14.5、docs/DESIGN.md §3「options」）
//
// 各設定は即保存（保存ボタンなし）。chrome API が無い環境（pnpm fixtures）では
// 既定値で描画したうえで操作だけを無効化する。
// 保存系の関数は失敗すると reject するようになったため、すべて try/catch し、
// 成功/失敗を右下固定の HUD 通知で表示する（レビュー H6）。

import type { CategoryKey, CustomRule, Fallback, Preset, Settings, SiteHistoryEntry, SiteOverride } from '../shared/types';
import { CATEGORY_COPY, ESSENTIAL_COPY, NOTES } from '../shared/copy';
import { activeCategories } from '../shared/presets';
import {
  DEFAULT_SETTINGS,
  clearSiteHistory,
  exportConfig,
  getComRules,
  getComRulesStatus,
  getCustomRules,
  getSettings,
  getSiteHistory,
  getSiteOverrides,
  hasChromeStorage,
  importConfig,
  onStorageChanged,
  removeCustomRule,
  saveAllowCategories,
  savePreset,
  saveSettings,
  setSiteOverride,
} from '../shared/storage';
import { openOnboardingPage, sendToRuntime } from '../shared/messages';
import { createPresetPicker } from '../ui/presetPicker';
import type { PresetPickerHandle } from '../ui/presetPicker';
import { createCategoryTable } from '../ui/categoryTable';
import type { CategoryTableHandle } from '../ui/categoryTable';

/** サイト別設定の Badge 文言（§14.5-3 / §14.9） */
function siteOverrideLabel(override: SiteOverride): string {
  return override.kind === 'off' ? '動かさない' : '個別に調整';
}
const ACTION_LABELS: Record<'reject' | 'accept', string> = { reject: '断る', accept: '許可' };
/** サイト別設定・教えたボタン一覧の Badge トーン（成功/失敗ではなく分類なので info/neutral を使う） */
function siteOverrideBadgeTone(override: SiteOverride): 'info' | 'neutral' {
  return override.kind === 'off' ? 'neutral' : 'info';
}

/** custom の override が許可している項目名（「必要なもの」は常に許可なので先頭に固定。§14.9） */
function siteOverrideAllowText(override: SiteOverride): string {
  if (override.kind !== 'custom') return '';
  const names = [ESSENTIAL_COPY.name, ...activeCategories(override.allow).map((key) => CATEGORY_COPY[key].name)];
  return `許可: ${names.join('・')}`;
}
const ACTION_BADGE_TONE: Record<'reject' | 'accept', 'info' | 'warning'> = { reject: 'info', accept: 'warning' };

interface UpdateRulesResult {
  ok: boolean;
  count: number;
  failed: number;
  error?: string;
}

function requireEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`要素が見つかりません: #${id}`);
  return el as unknown as T;
}

const els = {
  extensionNotice: requireEl<HTMLElement>('extension-notice'),
  presetSlot: requireEl<HTMLElement>('preset-picker-slot'),
  presetCustomBadge: requireEl<HTMLElement>('preset-custom-badge'),
  categoryTableSlot: requireEl<HTMLElement>('category-table-slot'),
  noteAlwaysRejected: requireEl<HTMLElement>('note-always-rejected'),
  noteGranularOnly: requireEl<HTMLElement>('note-granular-only'),
  showBadge: requireEl<HTMLButtonElement>('show-badge'),
  debug: requireEl<HTMLButtonElement>('debug'),
  observeSeconds: requireEl<HTMLInputElement>('observe-seconds'),
  siteHistoryCount: requireEl<HTMLElement>('site-history-count'),
  clearSiteHistoryBtn: requireEl<HTMLButtonElement>('clear-site-history'),
  reopenOnboarding: requireEl<HTMLButtonElement>('reopen-onboarding'),
  comStatus: requireEl<HTMLElement>('com-status'),
  comFailure: requireEl<HTMLElement>('com-failure'),
  updateRulesBtn: requireEl<HTMLButtonElement>('update-rules'),
  updateResult: requireEl<HTMLElement>('update-result'),
  siteList: requireEl<HTMLElement>('site-list'),
  siteEmpty: requireEl<HTMLElement>('site-empty'),
  customList: requireEl<HTMLElement>('custom-list'),
  customEmpty: requireEl<HTMLElement>('custom-empty'),
  exportBtn: requireEl<HTMLButtonElement>('export-btn'),
  importInput: requireEl<HTMLInputElement>('import-input'),
  ioResult: requireEl<HTMLElement>('io-result'),
  hud: requireEl<HTMLElement>('hud'),
};

let currentSettings: Settings = DEFAULT_SETTINGS;
let presetPicker: PresetPickerHandle | null = null;
let categoryTable: CategoryTableHandle | null = null;
let unsubscribe: (() => void) | null = null;

void main();

async function main(): Promise<void> {
  els.noteAlwaysRejected.textContent = NOTES.alwaysRejected;
  els.noteGranularOnly.textContent = NOTES.granularOnly;

  const extensionAvailable = hasChromeStorage();

  currentSettings = await getSettings();
  presetPicker = createPresetPicker({
    name: 'options-preset',
    label: 'どこまで許可しますか？',
    selected: currentSettings.preset,
    onSelect: (preset) => void onPresetSelect(preset),
  });
  els.presetSlot.append(presetPicker.element);

  categoryTable = createCategoryTable({
    toggles: {
      allow: currentSettings.allowCategories,
      onToggle: (key, on) => void onCategoryToggle(key, on),
    },
  });
  els.categoryTableSlot.append(categoryTable.element);

  if (!extensionAvailable) {
    els.extensionNotice.hidden = false;
    setDisabled(document, true);
  }

  renderBasicSettings(currentSettings);
  renderPresetBadge(currentSettings);
  bindBasicSettings();
  bindUpdateRulesButton();
  bindExportImport();
  bindReopenOnboarding();
  bindClearSiteHistory();

  await Promise.all([renderComRulesInfo(), renderSiteList(), renderCustomList(), renderSiteHistoryCount()]);

  unsubscribe = onStorageChanged((area, keys) => {
    if (area === 'sync') {
      if (keys.includes('settings')) void refreshSettingsFromStorage();
      if (keys.includes('siteOverrides')) void renderSiteList();
      if (keys.some((key) => key.startsWith('cr:'))) void renderCustomList();
      return;
    }
    if (area !== 'local') return;
    // 週次の自動更新や「今すぐ更新」の結果（最終更新日時・失敗）を描き直す
    if (keys.includes('comRules') || keys.includes('comRulesStatus')) void renderComRulesInfo();
    // 対応記録（§14.8）: 件数と、サイト一覧の「<日付>に対応」を描き直す
    if (keys.includes('siteHistory')) {
      void renderSiteHistoryCount();
      void renderSiteList();
    }
  });
  window.addEventListener('pagehide', () => unsubscribe?.(), { once: true });
}

/** 他のタブ（onboarding 含む）で settings が変わったら、プリセット・トグル・カスタム表示を描き直す */
async function refreshSettingsFromStorage(): Promise<void> {
  currentSettings = await getSettings();
  renderBasicSettings(currentSettings);
  categoryTable?.setAllow(currentSettings.allowCategories);
  renderPresetBadge(currentSettings);
  presetPicker?.setSelected(currentSettings.preset);
}

// ---------------------------------------------------------------------------
// 共通ヘルパ
// ---------------------------------------------------------------------------

function setDisabled(scope: ParentNode, disabled: boolean): void {
  for (const el of scope.querySelectorAll('input, button')) {
    (el as HTMLInputElement | HTMLButtonElement).disabled = disabled;
  }
}

function radiosByName(name: string): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isToggleOn(toggle: HTMLElement): boolean {
  return toggle.getAttribute('aria-checked') === 'true';
}

function setToggle(toggle: HTMLElement, on: boolean): void {
  toggle.setAttribute('aria-checked', on ? 'true' : 'false');
}

function formatDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** サイトごとの対応記録に添える日付（月日のみ。年が違うときだけ年も付ける。§14.8。popup と同じ形式） */
function formatHistoryDate(at: number): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'long', day: 'numeric' };
  return new Intl.DateTimeFormat('ja-JP', options).format(date);
}

// ---------------------------------------------------------------------------
// HUD 通知（保存しました／保存できませんでした。右下固定。DESIGN.md §2、レビュー H6）
// ---------------------------------------------------------------------------

let hudRevealFrame: number | null = null;
let hudHideTimer: number | null = null;
let hudFinalizeTimer: number | null = null;

function showHud(message: string, danger: boolean): void {
  if (hudRevealFrame !== null) cancelAnimationFrame(hudRevealFrame);
  if (hudHideTimer !== null) window.clearTimeout(hudHideTimer);
  if (hudFinalizeTimer !== null) window.clearTimeout(hudFinalizeTimer);

  els.hud.textContent = message;
  els.hud.classList.toggle('is-danger', danger);
  els.hud.hidden = false;
  els.hud.classList.remove('is-visible');

  // 2 フレーム待ってから is-visible を付ける（hidden 解除直後だと transition が飛ぶため）
  hudRevealFrame = requestAnimationFrame(() => {
    hudRevealFrame = requestAnimationFrame(() => {
      els.hud.classList.add('is-visible');
    });
  });

  hudHideTimer = window.setTimeout(() => {
    els.hud.classList.remove('is-visible');
    hudFinalizeTimer = window.setTimeout(() => {
      els.hud.hidden = true;
    }, 180);
  }, 1200);
}

function showSaveError(error: unknown): void {
  showHud(`保存できませんでした: ${reasonOf(error)}`, true);
}

// ---------------------------------------------------------------------------
// 基本設定（断れなかったとき・その他カード: バッジ・監視秒数・デバッグ）
// ---------------------------------------------------------------------------

function renderBasicSettings(settings: Settings): void {
  for (const input of radiosByName('fallback')) input.checked = input.value === settings.fallbackWhenNoReject;
  setToggle(els.showBadge, settings.showBadge);
  setToggle(els.debug, settings.debug);
  els.observeSeconds.value = String(settings.observeSeconds);
}

function bindBasicSettings(): void {
  for (const input of radiosByName('fallback')) {
    input.addEventListener('change', () => {
      if (input.checked) {
        const value: Fallback = input.value === 'leave' ? 'leave' : 'hide';
        void updateSettings({ fallbackWhenNoReject: value });
      }
    });
  }
  els.showBadge.addEventListener('click', () => {
    setToggle(els.showBadge, !isToggleOn(els.showBadge));
    void updateSettings({ showBadge: isToggleOn(els.showBadge) });
  });
  els.debug.addEventListener('click', () => {
    setToggle(els.debug, !isToggleOn(els.debug));
    void updateSettings({ debug: isToggleOn(els.debug) });
  });
  els.observeSeconds.addEventListener('change', () => {
    void updateSettings({ observeSeconds: Number(els.observeSeconds.value) });
  });
}

/** 保存失敗時は表示を元に戻し、HUD で理由を表示する（H6） */
async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const previous = currentSettings;
  try {
    currentSettings = await saveSettings(patch);
    // クランプ後の実値（監視秒数など）を入力欄に反映する
    renderBasicSettings(currentSettings);
    showHud('保存しました', false);
  } catch (error) {
    renderBasicSettings(previous);
    showSaveError(error);
  }
}

function bindReopenOnboarding(): void {
  els.reopenOnboarding.addEventListener('click', () => void openOnboardingPage());
}

// ---------------------------------------------------------------------------
// 対応したサイトの記録（その他カード。§14.8）
// ---------------------------------------------------------------------------

async function renderSiteHistoryCount(): Promise<void> {
  const history = await getSiteHistory();
  els.siteHistoryCount.textContent = String(Object.keys(history).length);
}

function bindClearSiteHistory(): void {
  els.clearSiteHistoryBtn.addEventListener('click', () => void onClearSiteHistory());
}

/** 保存失敗時は表示をそのままにし、HUD で理由を表示する（H6） */
async function onClearSiteHistory(): Promise<void> {
  try {
    await clearSiteHistory();
    await renderSiteHistoryCount();
    await renderSiteList();
    showHud('記録を消しました', false);
  } catch (error) {
    showSaveError(error);
  }
}

// ---------------------------------------------------------------------------
// どこまで許可しますか？（プリセットカード + カテゴリ表。§14.5-1）
// ---------------------------------------------------------------------------

function renderPresetBadge(settings: Settings): void {
  els.presetCustomBadge.hidden = settings.preset !== 'custom';
}

/** プリセットカードを選ぶ: allowCategories も savePreset 側で書き換わるのでトグルも描き直す */
async function onPresetSelect(preset: Preset): Promise<void> {
  const previous = currentSettings;
  try {
    currentSettings = await savePreset(preset);
    presetPicker?.setSelected(currentSettings.preset);
    categoryTable?.setAllow(currentSettings.allowCategories);
    renderPresetBadge(currentSettings);
    showHud('保存しました', false);
  } catch (error) {
    currentSettings = previous;
    presetPicker?.setSelected(previous.preset);
    showSaveError(error);
  }
}

/**
 * カテゴリ表のトグルを個別に変える。保存失敗時は表示を元に戻し、HUD で理由を表示する（H6）。
 * preset は saveAllowCategories 側で presetFromCategories により引き直されるので、
 * どのプリセットとも一致しなくなればカードの選択を外し「カスタム」を表示する（§14.5-1）。
 */
async function onCategoryToggle(key: CategoryKey, on: boolean): Promise<void> {
  const previous = currentSettings;
  try {
    currentSettings = await saveAllowCategories({ [key]: on });
    categoryTable?.setAllow(currentSettings.allowCategories);
    presetPicker?.setSelected(currentSettings.preset);
    renderPresetBadge(currentSettings);
    showHud('保存しました', false);
  } catch (error) {
    currentSettings = previous;
    categoryTable?.setAllow(previous.allowCategories);
    showSaveError(error);
  }
}

// ---------------------------------------------------------------------------
// 判定ルールの更新（§14.5-5。Consent-O-Matic の名前・件数・ライセンスは出さない）
// ---------------------------------------------------------------------------

function setComFailure(text: string, danger: boolean): void {
  if (!text) {
    els.comFailure.hidden = true;
    els.comFailure.textContent = '';
    return;
  }
  els.comFailure.textContent = text;
  els.comFailure.classList.toggle('text-danger', danger);
  els.comFailure.classList.toggle('text-warning', !danger);
  els.comFailure.hidden = false;
}

async function renderComRulesInfo(): Promise<void> {
  const status = await getComRulesStatus();
  if (status) {
    els.comStatus.textContent = `最終更新: ${formatDate(status.updatedAt)}`;
    if (!status.ok && status.error) setComFailure(`前回の更新に失敗しました: ${status.error}`, true);
    else setComFailure('', false);
    return;
  }
  setComFailure('', false);
  const payload = await getComRules();
  els.comStatus.textContent = `最終更新: ${payload ? formatDate(payload.fetchedAt) : '—'}`;
}

function bindUpdateRulesButton(): void {
  els.updateRulesBtn.addEventListener('click', () => void onUpdateRules());
}

async function onUpdateRules(): Promise<void> {
  els.updateRulesBtn.disabled = true;
  els.updateResult.classList.remove('text-danger');
  els.updateResult.textContent = '更新しています…';
  const result = await sendToRuntime<UpdateRulesResult>({ type: 'updateRules' });
  els.updateRulesBtn.disabled = false;

  if (!result) {
    els.updateResult.classList.add('text-danger');
    els.updateResult.textContent = '更新できませんでした（拡張が動作していません）';
    return;
  }
  if (result.ok) {
    els.updateResult.textContent = '更新しました';
  } else {
    els.updateResult.classList.add('text-danger');
    els.updateResult.textContent = `更新に失敗しました: ${result.error ?? '不明なエラー'}`;
  }
  await renderComRulesInfo();
}

// ---------------------------------------------------------------------------
// サイトごとの設定の一覧
// ---------------------------------------------------------------------------

async function renderSiteList(): Promise<void> {
  const [overrides, history] = await Promise.all([getSiteOverrides(), getSiteHistory()]);
  const entries = Object.entries(overrides);
  els.siteList.replaceChildren();
  els.siteEmpty.hidden = entries.length > 0;
  for (const [siteHost, override] of entries) els.siteList.append(buildSiteRow(siteHost, override, history[siteHost]));
}

function buildSiteRow(siteHost: string, override: SiteOverride, historyEntry: SiteHistoryEntry | undefined): HTMLElement {
  const li = document.createElement('li');
  li.className = 'entry-row hairline-row';

  const main = document.createElement('div');
  main.className = 'entry-main';
  const top = document.createElement('div');
  top.className = 'entry-main-top';
  const hostEl = document.createElement('span');
  hostEl.className = 'entry-host';
  hostEl.textContent = siteHost;
  const badge = document.createElement('span');
  badge.className = `badge badge-${siteOverrideBadgeTone(override)}`;
  badge.textContent = siteOverrideLabel(override);
  top.append(hostEl, badge);
  main.append(top);

  const allowText = siteOverrideAllowText(override);
  if (allowText) {
    const allow = document.createElement('span');
    allow.className = 'entry-detail';
    allow.textContent = allowText;
    main.append(allow);
  }

  if (historyEntry) {
    const detail = document.createElement('span');
    detail.className = 'entry-detail';
    detail.textContent = `${formatHistoryDate(historyEntry.at)}に対応`;
    main.append(detail);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-ghost btn-sm entry-delete';
  deleteBtn.textContent = '削除';
  deleteBtn.addEventListener('click', () => void onDeleteSiteOverride(siteHost));

  li.append(main, deleteBtn);
  return li;
}

/** 保存失敗時は一覧をそのままにし、HUD で理由を表示する（H6） */
async function onDeleteSiteOverride(siteHost: string): Promise<void> {
  try {
    await setSiteOverride(siteHost, null);
    await renderSiteList();
    showHud('保存しました', false);
  } catch (error) {
    showSaveError(error);
  }
}

// ---------------------------------------------------------------------------
// 教えたボタンの一覧
// ---------------------------------------------------------------------------

async function renderCustomList(): Promise<void> {
  const rules = await getCustomRules();
  els.customList.replaceChildren();
  els.customEmpty.hidden = rules.length > 0;
  for (const rule of rules) els.customList.append(buildCustomRow(rule));
}

function buildCustomRow(rule: CustomRule): HTMLElement {
  const li = document.createElement('li');
  li.className = 'entry-row hairline-row';

  const main = document.createElement('div');
  main.className = 'entry-main';

  const top = document.createElement('div');
  top.className = 'entry-main-top';
  const hostEl = document.createElement('span');
  hostEl.className = 'entry-host';
  hostEl.textContent = rule.host;
  const badge = document.createElement('span');
  badge.className = `badge badge-${ACTION_BADGE_TONE[rule.action]}`;
  badge.textContent = ACTION_LABELS[rule.action];
  top.append(hostEl, badge);
  main.append(top);

  const detail = document.createElement('span');
  detail.className = 'entry-detail';
  detail.textContent = formatDate(rule.createdAt);
  main.append(detail);

  if (rule.selector) {
    const code = document.createElement('code');
    code.className = 'entry-code';
    code.textContent = rule.selector;
    main.append(code);
  }
  if (rule.text) {
    const code = document.createElement('code');
    code.className = 'entry-code';
    code.textContent = `文言: ${rule.text}`;
    main.append(code);
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-ghost btn-sm entry-delete';
  deleteBtn.textContent = '削除';
  deleteBtn.addEventListener('click', () => void onDeleteCustomRule(rule.id));

  li.append(main, deleteBtn);
  return li;
}

/** 保存失敗時は一覧をそのままにし、HUD で理由を表示する（H6） */
async function onDeleteCustomRule(id: string): Promise<void> {
  try {
    await removeCustomRule(id);
    await renderCustomList();
    showHud('保存しました', false);
  } catch (error) {
    showSaveError(error);
  }
}

// ---------------------------------------------------------------------------
// バックアップ（エクスポート／インポート）
// ---------------------------------------------------------------------------

function bindExportImport(): void {
  els.exportBtn.addEventListener('click', () => void onExport());
  els.importInput.addEventListener('change', () => void onImport());
}

async function onExport(): Promise<void> {
  try {
    const bundle = await exportConfig();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cookie-autopilot-config.json';
    a.click();
    // revokeObjectURL を同期的に呼ぶと、一部ブラウザで click() のダウンロード開始前に
    // URL が失効することがあるため、次のタスクに回す（レビュー L5）。
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    els.ioResult.classList.remove('text-danger');
    els.ioResult.textContent = 'エクスポートしました';
  } catch (error) {
    els.ioResult.classList.add('text-danger');
    els.ioResult.textContent = `エクスポートできませんでした: ${reasonOf(error)}`;
  }
}

async function onImport(): Promise<void> {
  const file = els.importInput.files?.[0];
  els.importInput.value = '';
  if (!file) return;

  try {
    const data: unknown = JSON.parse(await file.text());
    const result = await importConfig(data);
    els.ioResult.classList.remove('text-danger');
    els.ioResult.textContent =
      `インポートしました（設定: ${result.settings ? '反映しました' : '変更なし'} / ` +
      `サイトごとの設定: ${result.siteOverrides} 件 / 教えたボタン: ${result.customRules} 件）`;
    await refreshAfterImport();
  } catch (error) {
    els.ioResult.classList.add('text-danger');
    els.ioResult.textContent = `インポートに失敗しました: ${reasonOf(error)}`;
  }
}

async function refreshAfterImport(): Promise<void> {
  currentSettings = await getSettings();
  renderBasicSettings(currentSettings);
  categoryTable?.setAllow(currentSettings.allowCategories);
  renderPresetBadge(currentSettings);
  presetPicker?.setSelected(currentSettings.preset);
  await Promise.all([renderSiteList(), renderCustomList()]);
}
