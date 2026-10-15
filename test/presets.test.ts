// プリセットと確定コピー（docs/SPEC.md §14.1 / §14.2）

import { beforeEach, describe, expect, it } from 'vitest';
import { categoryCopy, essentialCopy, notes, presetCopy } from '../src/shared/copy';
import { setLang } from '../src/shared/i18n';
import {
  PRESETS,
  PRESET_ORDER,
  activeCategories,
  allowRecordForPreset,
  categoriesForPreset,
  isPreset,
  presetFromCategories,
} from '../src/shared/presets';
import { CATEGORY_KEYS, EXTRA_PRESET, PRESET_KEYS } from '../src/shared/types';

describe('PRESETS', () => {
  it('プリセットごとの許可カテゴリは SPEC どおり', () => {
    expect(PRESETS).toEqual({ strict: [], minimal: ['A'], relaxed: ['A', 'B', 'E'], none: [] });
  });

  it('すべて拒否（none）は許可カテゴリを持たず、3 枚のカードとは別扱い（§14.1）', () => {
    expect(PRESETS.none).toEqual([]);
    expect(PRESET_ORDER).toHaveLength(3);
    expect(PRESET_ORDER).not.toContain(EXTRA_PRESET);
    expect(PRESET_ORDER).toEqual(['strict', 'minimal', 'relaxed']);
  });

  it('D / F / X はどのプリセットでも許可しない', () => {
    for (const preset of PRESET_ORDER) {
      for (const category of ['D', 'F', 'X'] as const) {
        expect(PRESETS[preset], preset).not.toContain(category);
      }
    }
  });

  it('categoriesForPreset は定数を書き換えられないようコピーを返す', () => {
    const categories = categoriesForPreset('minimal');
    categories.push('F');
    expect(PRESETS.minimal).toEqual(['A']);
  });

  it('allowRecordForPreset は全カテゴリぶんの真偽値を返す', () => {
    expect(allowRecordForPreset('relaxed')).toEqual({
      A: true,
      B: true,
      D: false,
      E: true,
      F: false,
      X: false,
    });
    expect(Object.keys(allowRecordForPreset('strict'))).toEqual([...CATEGORY_KEYS]);
  });

  it('activeCategories は true のカテゴリを既定の順で返す', () => {
    expect(activeCategories({ A: false, B: true, D: false, E: false, F: true, X: false })).toEqual(['B', 'F']);
  });

  it('isPreset はプリセット名（none を含む）だけを受け付ける', () => {
    for (const preset of PRESET_KEYS) expect(isPreset(preset)).toBe(true);
    expect(isPreset(EXTRA_PRESET)).toBe(true);
    for (const value of ['off', 'custom', 'reject', 'accept', '', null, undefined, 1]) {
      expect(isPreset(value), String(value)).toBe(false);
    }
  });
});

describe('presetFromCategories', () => {
  it('完全一致するプリセットがあればそれを返す（record でも配列でも）', () => {
    expect(presetFromCategories([])).toBe('strict');
    expect(presetFromCategories(['A'])).toBe('minimal');
    expect(presetFromCategories(['E', 'A', 'B'])).toBe('relaxed');
    expect(presetFromCategories(allowRecordForPreset('relaxed'))).toBe('relaxed');
  });

  it('どのプリセットとも一致しなければ custom', () => {
    expect(presetFromCategories(['B'])).toBe('custom');
    expect(presetFromCategories(['A', 'B'])).toBe('custom');
    expect(presetFromCategories(['A', 'B', 'E', 'F'])).toBe('custom');
  });

  it('none は返さない（許可カテゴリなしは strict。§14.1）', () => {
    expect(presetFromCategories([])).not.toBe(EXTRA_PRESET);
    expect(presetFromCategories(allowRecordForPreset('none'))).toBe('strict');
    const values = [[], ['A'], ['B'], ['A', 'B', 'E'], ['A', 'B', 'E', 'F']] as const;
    for (const allow of values) expect(presetFromCategories(allow), String(allow)).not.toBe(EXTRA_PRESET);
  });

  it('プリセット → カテゴリ → プリセットで元に戻る', () => {
    for (const preset of PRESET_KEYS) {
      expect(presetFromCategories(categoriesForPreset(preset)), preset).toBe(preset);
    }
  });
});

describe('コピー（§14.2 の表。日本語）', () => {
  beforeEach(() => {
    setLang('ja');
  });

  it('カテゴリは 6 件（必須は別枠）で、すべて 3 つの文言を持つ', () => {
    expect(Object.keys(categoryCopy())).toEqual([...CATEGORY_KEYS]);
    expect(Object.keys(categoryCopy())).toHaveLength(6);
    for (const key of CATEGORY_KEYS) {
      const copy = categoryCopy()[key];
      expect(copy.name, key).not.toBe('');
      expect(copy.short, key).not.toBe('');
      expect(copy.description.length, key).toBeGreaterThan(10);
    }
  });

  it('必須 Cookie は「常に許可」と伝える', () => {
    expect(essentialCopy().name).toBe('必要なもの');
    expect(essentialCopy().short).toBe('常に許可');
  });

  it('プリセットは 3 件 + すべて拒否で、おすすめはほどよく守るだけ', () => {
    const presets = presetCopy();
    expect(Object.keys(presets)).toEqual([...PRESET_KEYS, EXTRA_PRESET]);
    expect(presets.strict.name).toBe('しっかり守る');
    expect(presets.minimal.name).toBe('ほどよく守る');
    expect(presets.relaxed.name).toBe('ゆるく守る');
    expect(presets.none.name).toBe('すべて拒否');
    expect(presets.minimal.recommended).toBe(true);
    expect(presets.strict.recommended).toBeUndefined();
    expect(presets.relaxed.recommended).toBeUndefined();
    expect(presets.none.recommended).toBeUndefined();
    for (const preset of [...PRESET_KEYS, EXTRA_PRESET]) {
      expect(presets[preset].description.length).toBeGreaterThan(10);
    }
  });

  it('すべて拒否の説明はデメリットも伝える（§14.2）', () => {
    expect(presetCopy().none.description).toContain('何も押さずに');
    expect(presetCopy().none.description).toContain('同じ画面が何度も出たり');
    expect(presetCopy().none.description).toContain('一部の機能が使えない');
  });

  it('共通の注意書きは 2 文とも持つ', () => {
    expect(notes().alwaysRejected).toBe('追跡型の広告と用途が不明なものは、どの設定でも断ります。');
    expect(notes().granularOnly).toContain('サイトが細かく選べるようになっている場合');
    expect(notes().granularOnly).toContain('必要なもの以外を断ります');
  });

  it('UI に出す文言にカテゴリ記号や専門用語を混ぜない（§14.7）', () => {
    const texts = [
      ...Object.values(categoryCopy()).flatMap((copy) => [copy.name, copy.short]),
      ...Object.values(presetCopy()).map((copy) => copy.name),
      essentialCopy().name,
    ];
    for (const text of texts) {
      expect(text, text).not.toMatch(/CMP|Consent-O-Matic|カテゴリ[A-FX]|\bcookie\b/i);
    }
  });
});
