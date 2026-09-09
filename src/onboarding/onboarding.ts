// 初期設定ページ（docs/SPEC.md §14.3）
//
// chrome API が無い環境（pnpm fixtures で配信される素の HTML）でも既定値で描画し、
// 保存だけを無効化する（他の画面と同じ idiom）。

import { NOTES, PRESET_COPY } from '../shared/copy';
import { isPreset } from '../shared/presets';
import type { Preset } from '../shared/types';
import { DEFAULT_PRESET, getSettings, hasChromeStorage, saveSettings, settingsForPreset } from '../shared/storage';
import { createPresetPicker } from '../ui/presetPicker';
import type { PresetPickerHandle } from '../ui/presetPicker';
import { createCategoryTable } from '../ui/categoryTable';

function requireEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`要素が見つかりません: #${id}`);
  return el as unknown as T;
}

const els = {
  extensionNotice: requireEl<HTMLElement>('extension-notice'),
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

let selectedPreset: Preset = DEFAULT_PRESET;
let picker: PresetPickerHandle | null = null;

void main();

async function main(): Promise<void> {
  const extensionAvailable = hasChromeStorage();

  els.noteAlwaysRejected.textContent = NOTES.alwaysRejected;
  els.noteGranularOnly.textContent = NOTES.granularOnly;
  els.categoryTableSlot.append(createCategoryTable().element);

  const settings = await getSettings().catch(() => null);
  selectedPreset = settings && isPreset(settings.preset) ? settings.preset : DEFAULT_PRESET;
  // 詳細設定でカテゴリを個別に変えている人には、ここで選ぶと上書きされることを伝える（L5）
  els.customNotice.hidden = settings?.preset !== 'custom';

  picker = createPresetPicker({
    name: 'onboarding-preset',
    label: 'どこまで許可しますか？',
    selected: selectedPreset,
    disabled: !extensionAvailable,
    onSelect: (preset) => {
      selectedPreset = preset;
    },
  });
  els.presetSlot.append(picker.element);

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
  }

  window.addEventListener('pagehide', () => stopCountdown(), { once: true });
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
    showHud('設定しました', false);
    showDone();
  } catch (error) {
    els.startBtn.disabled = false;
    showHudError(error);
  }
}

function showDone(): void {
  els.actions.hidden = true;
  picker?.setDisabled(true);
  els.doneSummary.textContent = `いまの設定: ${PRESET_COPY[selectedPreset].name}`;
  els.done.hidden = false;

  // タブを閉じる手段が無い環境（fixtures プレビュー）ではカウントダウンと
  // 「今すぐ閉じる」「閉じない」を出さず、「詳細設定を開く」だけにする（§14.3）
  if (canCloseTab()) {
    els.closeNowBtn.hidden = false;
    els.keepOpenBtn.hidden = false;
    startCountdown();
  }
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
  els.doneCountdown.textContent = `${countdownRemaining} 秒後にこのタブを閉じます`;
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
  showHud(`保存できませんでした: ${reason}`, true);
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
