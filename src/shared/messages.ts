// 拡張内メッセージの型と送信ヘルパ（docs/SPEC.md §5-8, §5-9）

import type { CategoryKey, Decision, TabStatusKind, UnhandledReason } from './types';

/** content → service worker */
export interface StatusMessage {
  type: 'status';
  host: string;
  status: TabStatusKind;
  /** 'custom' | 'quick:<name>' | 'com:<ruleName>' | 'heuristic' | 'hide' */
  method?: string;
  action?: 'reject' | 'accept';
  /** 押したボタンの正規化済み文言 */
  clickedText?: string;
  /** 押したボタンの表示用ラベル（popup はこちらを出す） */
  clickedLabel?: string;
  /** 何をしたか（§14.6） */
  decision?: Decision;
  /** decision === 'granular' のときに許可したカテゴリ */
  allowed?: CategoryKey[];
  /** status === 'unhandled' のときの理由（§5-8） */
  reason?: UnhandledReason;
}

/** popup → content: 監視窓をやり直す */
export interface RerunMessage {
  type: 'rerun';
}

/** popup → content: ボタンを教えるモードを開始 */
export interface StartPickerMessage {
  type: 'startPicker';
  action: 'reject' | 'accept';
}

/** popup → content: ボタンを教えるモードを中止 */
export interface CancelPickerMessage {
  type: 'cancelPicker';
}

/** options/popup → service worker: 判定ルールを再取得 */
export interface UpdateRulesMessage {
  type: 'updateRules';
}

/** popup/options → service worker: 初期設定ページを開く（§14.3） */
export interface OpenOnboardingMessage {
  type: 'openOnboarding';
}

export type ExtensionMessage =
  | StatusMessage
  | RerunMessage
  | StartPickerMessage
  | CancelPickerMessage
  | UpdateRulesMessage
  | OpenOnboardingMessage;

export type ExtensionMessageType = ExtensionMessage['type'];

export function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === 'status' ||
    type === 'rerun' ||
    type === 'startPicker' ||
    type === 'cancelPicker' ||
    type === 'updateRules' ||
    type === 'openOnboarding'
  );
}

function canSendRuntimeMessage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage && !!chrome.runtime?.id;
}

/** ステータス報告（chrome が無い環境では何もしない） */
export async function sendStatus(message: StatusMessage): Promise<void> {
  await sendToRuntime(message);
}

/** service worker 宛にメッセージを送る。失敗（受信側不在など）は無視する */
export async function sendToRuntime<T = unknown>(message: ExtensionMessage): Promise<T | undefined> {
  if (!canSendRuntimeMessage()) return undefined;
  try {
    return (await chrome.runtime.sendMessage(message)) as T | undefined;
  } catch {
    return undefined;
  }
}

/**
 * 初期設定ページをタブで開く。popup / options から呼ぶ。
 * popup は直後に window.close() するので、SW へのメッセージ経由だと閉じる前に届かないことがある。
 * 自分で chrome.tabs.create を呼び、開けない環境だけ SW に頼む。
 */
export async function openOnboardingPage(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
      return;
    } catch {
      // フォールバックへ
    }
  }
  await sendToRuntime({ type: 'openOnboarding' });
}

/** タブの content script 宛にメッセージを送る。frameId を省略すると全フレームへ */
export async function sendToTab<T = unknown>(
  tabId: number,
  message: ExtensionMessage,
  frameId?: number,
): Promise<T | undefined> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) return undefined;
  try {
    if (typeof frameId === 'number') {
      return (await chrome.tabs.sendMessage(tabId, message, { frameId })) as T | undefined;
    }
    return (await chrome.tabs.sendMessage(tabId, message)) as T | undefined;
  } catch {
    return undefined;
  }
}
