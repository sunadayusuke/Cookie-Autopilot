// UI 文言の型（docs/SPEC.md §14.10）
//
// 画面に出る文言はすべてここに型として並べ、ja.ts / en.ts が実装する。
// 値は基本 string。可変部を含むものだけ関数にする（文の組み立て順が言語で変わるため、
// テンプレートを呼び出し側に置かない）。
// 開発者向けの例外メッセージ・デバッグログ・エンジンの検出フレーズは対象外（日本語のまま）。

import type { CategoryCopy, PresetCopy } from '../copy';
import type { CategoryKey, Preset } from '../types';

export type Lang = 'ja' | 'en';

/**
 * インポート検証の失敗理由（storage.ts の ImportError.code）。
 * storage.ts はコードだけを投げ、文言は表示する側が Messages.errors から引く（§14.10）。
 */
export type ImportErrorCode =
  | 'import:malformed'
  | 'import:settings'
  | 'import:site-overrides'
  | 'import:site-overrides-limit'
  | 'import:site-override-host'
  | 'import:site-override-value'
  | 'import:custom-rules'
  | 'import:custom-rules-limit'
  | 'import:custom-rule-shape'
  | 'import:custom-rule-host'
  | 'import:custom-rule-action'
  | 'import:custom-rule-selector'
  | 'import:custom-rule-text';

/**
 * content script / service worker だけが使う文言（runtime.ja.ts / runtime.en.ts が実装）。
 * 全文言の辞書を content バンドルに入れないよう、Messages から切り出してある（§14.10）。
 */
export interface RuntimeMessages {
  picker: {
    rejectForbidden: string;
    rejectNoText: string;
    rejectLabel: string;
    acceptLabel: string;
    /** 「<断るボタン> をクリックしてください」の前後（強調するラベルを挟む） */
    clickPrefix: string;
    clickSuffix: string;
  };

  background: {
    emptyRuleList: string;
    noRulesFetched: string;
  };
}

export interface Messages extends RuntimeMessages {
  /** 複数の画面で共用する文言 */
  common: {
    extensionNotice: string;
    presetHeading: string;
    categoryHeading: string;
    /** カテゴリ表の「あなたの設定」列 */
    yourSetting: string;
    /** プリセットカードの「おすすめ」バッジ */
    recommended: string;
    allow: string;
    deny: string;
    delete: string;
    saved: string;
    saveFailed(reason: string): string;
    /** 言語切り替えの行ラベル（どちらの言語でも同じ） */
    langLabel: string;
  };

  /** 確定コピー（§14.2）。copy.ts の関数アクセサから返す */
  copy: {
    essential: CategoryCopy;
    categories: Record<CategoryKey, CategoryCopy>;
    presets: Record<Preset, PresetCopy>;
    notes: {
      alwaysRejected: string;
      granularOnly: string;
    };
  };

  popup: {
    title: string;
    onboardingNotice: string;
    onboardingBtn: string;
    resultTitle: string;
    siteSettings: string;
    back: string;
    siteOff: string;
    resetToGlobal: string;
    siteDetailNote: string;
    teachReject: string;
    rerun: string;
    optionsLink: string;
    /** 状態バッジ（§14.4-1） */
    badge: {
      handled: string;
      unhandled: string;
      none: string;
      off: string;
      watching: string;
      loading: string;
      timeout: string;
      unavailable: string;
      recorded: string;
    };
    /** 「このサイトでの結果」の説明文 */
    result: {
      watching: string;
      loading: string;
      timeout: string;
      off: string;
      none: string;
      unhandled: string;
      handled: string;
    };
    /** unhandled の理由別の説明文（§14.4-2。no-reject は result.unhandled のまま） */
    unhandled: {
      noCandidates: string;
      panelAborted: string;
      clickFailed: string;
    };
    previewBadge: string;
    /** 「このサイトの設定」行の要約（§14.9） */
    siteSummary: {
      inherit: string;
      custom: string;
      off: string;
    };
    denyRest: string;
    teachHint: string;
    granular: string;
    pressed(label: string): string;
    pressedReject: string;
    pressedCustom(label: string): string;
    pressedCustomNoLabel: string;
    dismissed: string;
    hidden: string;
    historyAnswered(date: string): string;
    historyDismissed(date: string): string;
  };

  options: {
    title: string;
    customBadge: string;
    fallbackTitle: string;
    fallbackGroupLabel: string;
    fallbackHide: string;
    fallbackHideNote: string;
    fallbackLeave: string;
    fallbackLeaveNote: string;
    siteTitle: string;
    siteEmpty: string;
    customTitle: string;
    customEmpty: string;
    rulesTitle: string;
    rulesNote: string;
    loading: string;
    updateNow: string;
    miscTitle: string;
    showBadge: string;
    observeSeconds: string;
    debug: string;
    debugAria: string;
    siteHistoryCount: string;
    /** 件数の後ろに付く単位（英語では空） */
    siteHistoryUnit: string;
    clearHistory: string;
    reopenOnboarding: string;
    open: string;
    backupTitle: string;
    backupNote: string;
    exportBtn: string;
    importBtn: string;
    /** サイト別設定の Badge（§14.5-3 / §14.9） */
    overrideOff: string;
    overrideCustom: string;
    /** 教えたボタンの Badge */
    actionReject: string;
    actionAccept: string;
    /** custom の override が許可している項目の一覧（区切り文字も言語ごと） */
    allowedNames(names: string[]): string;
    /** 日時が無いときの表示 */
    noDate: string;
    lastUpdated(date: string): string;
    lastUpdateFailed(error: string): string;
    updating: string;
    updateUnavailable: string;
    updated: string;
    updateFailed(error: string): string;
    unknownError: string;
    handledOn(date: string): string;
    ruleText(text: string): string;
    historyCleared: string;
    exported: string;
    exportFailed(reason: string): string;
    imported(applied: boolean, siteOverrides: number, customRules: number): string;
    importFailed(reason: string): string;
  };

  onboarding: {
    title: string;
    lead: string;
    customNotice: string;
    start: string;
    doneHeading: string;
    doneMessage: string;
    currentSetting(presetName: string): string;
    countdown(seconds: number): string;
    closeNow: string;
    keepOpen: string;
    openOptions: string;
  };

  /**
   * インポート検証の失敗理由（§14.10）。可変部（ホスト名・上限件数）は投げ手が
   * ImportError の params に入れ、ここでは位置で受ける。
   */
  errors: Record<ImportErrorCode, (params: readonly string[]) => string>;
}
