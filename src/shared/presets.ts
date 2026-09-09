// プリセットと許可カテゴリの対応（docs/SPEC.md §14.1）
//
// D（端末への保存）/ F（追跡型の広告）/ X（その他）はどのプリセットでも許可しない。
// 詳細設定のトグルでは個別に ON にできるが、そのとき preset は 'custom' になる。
// 'none'（すべて拒否）の許可カテゴリは strict と同じ空。違いは閉じる語も押さないこと
// （Settings.pressCloseOnNotice）だけなので、カテゴリからは引き直せない（§14.1）。

import type { CategoryKey, Preset } from './types';
import { CATEGORY_KEYS, EXTRA_PRESET, PRESET_KEYS } from './types';

export const PRESETS: Record<Preset, CategoryKey[]> = {
  strict: [],
  minimal: ['A'],
  relaxed: ['A', 'B', 'E'],
  none: [],
};

/** UI に並べる順（弱い順）。onboarding / options の 3 枚のカードはこの順で並べる */
export const PRESET_ORDER = PRESET_KEYS;

export function isPreset(value: unknown): value is Preset {
  if (typeof value !== 'string') return false;
  return value === EXTRA_PRESET || (PRESET_KEYS as readonly string[]).includes(value);
}

/** そのプリセットで許可するカテゴリ（呼び出し側が書き換えても定数を壊さないようコピーを返す） */
export function categoriesForPreset(preset: Preset): CategoryKey[] {
  return [...PRESETS[preset]];
}

/** そのプリセットの allowCategories（Settings に入れる形） */
export function allowRecordForPreset(preset: Preset): Record<CategoryKey, boolean> {
  const allow = PRESETS[preset];
  const out = {} as Record<CategoryKey, boolean>;
  for (const key of CATEGORY_KEYS) out[key] = allow.includes(key);
  return out;
}

/** allowCategories（record）から true のカテゴリだけを CATEGORY_KEYS の順で取り出す */
export function activeCategories(allow: Record<CategoryKey, boolean>): CategoryKey[] {
  return CATEGORY_KEYS.filter((key) => allow[key] === true);
}

function normalize(allow: Record<CategoryKey, boolean> | readonly CategoryKey[]): CategoryKey[] {
  if (Array.isArray(allow)) return CATEGORY_KEYS.filter((key) => allow.includes(key));
  return activeCategories(allow as Record<CategoryKey, boolean>);
}

/**
 * 許可カテゴリに完全一致するプリセットがあればそれ、無ければ 'custom'。
 * 見るのは主要な 3 つ（PRESET_KEYS）だけなので 'none' は返さない。
 * 'none' は strict と同じ「許可カテゴリなし」で、カードを明示的に選んだときだけの状態。
 */
export function presetFromCategories(
  allow: Record<CategoryKey, boolean> | readonly CategoryKey[],
): Preset | 'custom' {
  const active = normalize(allow);
  for (const preset of PRESET_KEYS) {
    const expected = PRESETS[preset];
    if (expected.length !== active.length) continue;
    if (expected.every((key) => active.includes(key))) return preset;
  }
  return 'custom';
}
