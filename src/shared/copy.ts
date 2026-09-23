// UI に出す確定コピー（docs/SPEC.md §14.2）
//
// onboarding / popup / options で共用する。文言は i18n の辞書（i18n/ja.ts / i18n/en.ts）
// だけに置き、UI 側で書き換えない。言語は実行時に切り替わるので、定数ではなく関数で返す。
// カテゴリ記号（A/B/…）・CMP・Consent-O-Matic は画面に出さない（§14.7）。

import { t } from './i18n';
import type { CategoryKey, Preset } from './types';

export interface CategoryCopy {
  /** 表示名 */
  name: string;
  /** 一言 */
  short: string;
  /** 初心者向けの説明 */
  description: string;
}

export interface PresetCopy {
  name: string;
  /** 「おすすめ」バッジを出すか */
  recommended?: boolean;
  description: string;
}

/** 必須 Cookie。カテゴリではなく常に許可するので、一覧の先頭に固定で並べる */
export function essentialCopy(): CategoryCopy {
  return t().copy.essential;
}

export function categoryCopy(): Record<CategoryKey, CategoryCopy> {
  return t().copy.categories;
}

export function presetCopy(): Record<Preset, PresetCopy> {
  return t().copy.presets;
}

/** どの画面でも添える共通の注意書き（§14.2 / §14.1） */
export function notes(): { alwaysRejected: string; granularOnly: string } {
  return t().copy.notes;
}
