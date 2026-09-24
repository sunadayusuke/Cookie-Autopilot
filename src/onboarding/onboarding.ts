// 初期設定ページ（docs/SPEC.md §14.3）
//
// chrome API が無い環境（pnpm fixtures で配信される素の HTML）でも既定値で描画し、
// 保存だけを無効化する（他の画面と同じ idiom）。

import { notes, presetCopy } from '../shared/copy';
import type { Lang } from '../shared/i18n';
import { applyDocumentLang, applyI18n, getLang, initLangCache, resolveLang, setLang, t } from '../shared/i18n';
import { isPreset } from '../shared/presets';
import type { Preset } from '../shared/types';
import {
  DEFAULT_PRESET,
  getSettings,
  hasChromeStorage,
  onStorageChanged,
  saveSettings,
  settingsForPreset,
} from '../shared/storage';
import { createPresetPicker } from '../ui/presetPicker';
import type { PresetPickerHandle } from '../ui/presetPicker';
import { createCategoryTable } from '../ui/categoryTable';
import { createLangToggle } from '../ui/langToggle';
import type { LangToggleHandle } from '../ui/langToggle';

function requireEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`要素が見つかりません: #${id}`);
  return el as unknown as T;
}

const els = {
  extensionNotice: requireEl<HTMLElement>('extension-notice'),
  langToggleSlot: requireEl<HTMLElement>('lang-toggle-slot'),
  customNotice: requireEl<HTMLElement>('custom-notice'),
  presetSlot: requireEl<HTMLElement>('preset-picker-slot'),
  categoryTableSlot: requireEl<HTMLElement>('category-table-slot'),
  noteAlwaysRejected: requireEl<HTMLElement>('note-always-rejected'),
  noteGranularOnly: requireEl<HTMLElement>('note-granular-only'),
  hud: requireEl<HTMLElement>('hud'),
  actions: requireEl<HTMLElement>('onboarding-actions'),
  startBtn: requireEl<HTMLButtonElement>('start-btn'),
  done: requireEl<HTMLElement>('onboarding-done'),
  doneSummary: requireEl<HTMLElement>('onboarding-done-summary'),
  doneCountdown: requireEl<HTMLElement>('onboarding-done-countdown'),
  closeNowBtn: requireEl<HTMLButtonElement>('close-now-btn'),
  keepOpenBtn: requireEl<HTMLButtonElement>('keep-open-btn'),
  openOptionsBtn: requireEl<HTMLButtonElement>('open-options-btn'),
};

let unsubscribe: (() => void) | null = null;
let selectedPreset: Preset = DEFAULT_PRESET;
let picker: PresetPickerHandle | null = null;
let langToggle: LangToggleHandle | null = null;
/** 「この設定で始める」を押したあとか（言語を切り替えても完了表示のままにするため） */
let done = false;

void main();

async function main(): Promise<void> {
  // storage を待つ間に別の言語で描画されないよう、まずキャッシュの言語で描く（§14.10）
  initLangCache();
  renderStaticText();

  const extensionAvailable = hasChromeStorage();

  const settings = await getSettings().catch(() => null);
  // 正は保存値。キャッシュと食い違っていたらここで描き直す（動的な部品はこのあと組み立てる）
  const lang = resolveLang(settings?.lang ?? null);
  if (lang !== getLang()) {
    setLang(lang);
    renderStaticText();
  }
  selectedPreset = settings && isPreset(settings.preset) ? settings.preset : DEFAULT_PRESET;
  // 詳細設定でカテゴリを個別に変えている人には、ここで選ぶと上書きされることを伝える（L5）
  els.customNotice.hidden = settings?.preset !== 'custom';

  langToggle = createLangToggle({ lang: getLang(), onSelect: (next) => void onLangSelect(next) });
  els.langToggleSlot.append(langToggle.element);
  buildPresetPicker(extensionAvailable);
  els.categoryTableSlot.replaceChildren(createCategoryTable().element);

  els.startBtn.addEventListener('click', () => void onStart());
  els.closeNowBtn.addEventListener('click', () => void onCloseNow());
  els.keepOpenBtn.addEventListener('click', () => onKeepOpen());
  els.openOptionsBtn.addEventListener('click', () => {
    // 押しても閉じる自体はしない。カウントダウンだけ止め、設定を見ている最中に
    // 自動クローズしないようにする（表示はそのまま。§14.3）
    stopCountdown();
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
  });

  if (!extensionAvailable) {
    els.extensionNotice.hidden = false;
    setDisabled(document, true);
    // 言語だけは切り替えて見た目を確認できるよう、トグルは有効に戻す（options と同じ idiom）
    langToggle?.setDisabled(false);
  }

  window.addEventListener('pagehide', () => stopCountdown(), { once: true });

  unsubscribe = onStorageChanged((area, keys) => {
    // 他のタブ（options）で言語を切り替えたら、この画面も追従する（§14.10）
    if (area === 'sync' && keys.includes('settings')) void refreshLangFromStorage();
  });
  window.addEventListener('pagehide', () => unsubscribe?.(), { once: true });
}

// ---------------------------------------------------------------------------
// 言語（§14.10）
// ---------------------------------------------------------------------------

/** HTML の data-i18n・<html lang>・スクリプトで入れる固定文を現在の言語で描き直す */
function renderStaticText(): void {
  applyDocumentLang();
  applyI18n();
  document.title = t().onboarding.title;
  els.noteAlwaysRejected.textContent = notes().alwaysRejected;
  els.noteGranularOnly.textContent = notes().granularOnly;
}

function buildPresetPicker(enabled: boolean): void {
  picker = createPresetPicker({
    name: 'onboarding-preset',
    label: t().common.presetHeading,
    selected: selectedPreset,
    disabled: !enabled || done,
    onSelect: (preset) => {
      selectedPreset = preset;
    },
  });
  els.presetSlot.replaceChildren(picker.element);
}

/** 言語が変わったあとの全面描き直し（動的に組んだ部品は作り直す） */
function renderLanguage(): void {
  renderStaticText();
  langToggle?.setLang(getLang());
  buildPresetPicker(hasChromeStorage());
  els.categoryTableSlot.replaceChildren(createCategoryTable().element);
  if (done) renderDoneSummary();
  if (countdownTimer !== null) renderCountdown();
  // 作り直した部品は disabled が外れているので、拡張外プレビューでは当て直す（言語だけは切り替えられる）
  if (!hasChromeStorage()) {
    setDisabled(document, true);
    langToggle?.setDisabled(false);
  }
}

/** JA / EN を選んだとき。保存してからページ全体を描き直す */
async function onLangSelect(lang: Lang): Promise<void> {
  const previous = getLang();
  setLang(lang);
  renderLanguage();
  try {
    await saveSettings({ lang });
    showHud(t().common.saved, false);
  } catch (error) {
    setLang(previous);
    renderLanguage();
    showHudError(error);
  }
}

async function refreshLangFromStorage(): Promise<void> {
  const settings = await getSettings().catch(() => null);
  const lang = resolveLang(settings?.lang ?? null);
  if (lang === getLang()) return;
  setLang(lang);
  renderLanguage();
}

function setDisabled(scope: ParentNode, disabled: boolean): void {
  for (const el of scope.querySelectorAll('input, button')) {
    (el as HTMLInputElement | HTMLButtonElement).disabled = disabled;
  }
}

// ---------------------------------------------------------------------------
// 「この設定で始める」→ 保存 → 完了表示
// ---------------------------------------------------------------------------

async function onStart(): Promise<void> {
  els.startBtn.disabled = true;
  try {
    // プリセット（許可カテゴリと閉じる語の扱いを含む）・完了フラグを 1 回で保存する
    // （途中で失敗して「プリセットだけ保存された」状態にしないため。L5）
    await saveSettings({ ...settingsForPreset(selectedPreset), onboarded: true });
    showHud(t().onboarding.doneHeading, false);
    showDone();
  } catch (error) {
    els.startBtn.disabled = false;
    showHudError(error);
  }
}

function showDone(): void {
  done = true;
  els.actions.hidden = true;
  picker?.setDisabled(true);
  renderDoneSummary();
  els.done.hidden = false;

  // タブを閉じる手段が無い環境（fixtures プレビュー）ではカウントダウンと
  // 「今すぐ閉じる」「閉じない」を出さず、「詳細設定を開く」だけにする（§14.3）
  if (canCloseTab()) {
    els.closeNowBtn.hidden = false;
    els.keepOpenBtn.hidden = false;
    startCountdown();
  }
}

function renderDoneSummary(): void {
  els.doneSummary.textContent = t().onboarding.currentSetting(presetCopy()[selectedPreset].name);
}

// ---------------------------------------------------------------------------
// 自動クローズ（5 秒後にこのタブを閉じる。§14.3）
// ---------------------------------------------------------------------------

const AUTO_CLOSE_SECONDS = 5;

let countdownRemaining = AUTO_CLOSE_SECONDS;
let countdownTimer: number | null = null;

/** `chrome.tabs.getCurrent` / `remove` が両方使える環境か（追加の権限は不要） */
function canCloseTab(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.tabs?.getCurrent && !!chrome.tabs?.remove;
}

function startCountdown(): void {
  countdownRemaining = AUTO_CLOSE_SECONDS;
  els.doneCountdown.hidden = false;
  renderCountdown();
  countdownTimer = window.setInterval(() => {
    countdownRemaining -= 1;
    if (countdownRemaining <= 0) {
      stopCountdown();
      void closeThisTab();
      return;
    }
    renderCountdown();
  }, 1000);
}

function renderCountdown(): void {
  els.doneCountdown.textContent = t().onboarding.countdown(countdownRemaining);
}

function stopCountdown(): void {
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/** 「閉じない」: カウントダウンを止め、カウントダウン行と「今すぐ閉じる」を消す（「詳細設定を開く」のみ残す） */
function onKeepOpen(): void {
  stopCountdown();
  els.doneCountdown.hidden = true;
  els.closeNowBtn.hidden = true;
  els.keepOpenBtn.hidden = true;
}

/** 「今すぐ閉じる」 */
async function onCloseNow(): Promise<void> {
  els.closeNowBtn.disabled = true;
  stopCountdown();
  await closeThisTab();
}

/** このタブを閉じる。取れなければ window.close() にフォールバック */
async function closeThisTab(): Promise<void> {
  if (canCloseTab()) {
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) {
        await chrome.tabs.remove(tab.id);
        return;
      }
    } catch {
      // フォールバックへ
    }
  }
  window.close();
}

// ---------------------------------------------------------------------------
// HUD 通知（保存しました／保存できませんでした。popup / options と同じ idiom）
// ---------------------------------------------------------------------------

let hudRevealFrame: number | null = null;
let hudHideTimer: number | null = null;
let hudFinalizeTimer: number | null = null;

function showHudError(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  showHud(t().common.saveFailed(reason), true);
}

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
