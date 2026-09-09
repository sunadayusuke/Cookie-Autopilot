// プリセット選択カード（docs/SPEC.md §14.3 / §14.5）
//
// onboarding と options の両方で使う共通部品。`<fieldset role="radiogroup">` の中に
// PRESET_ORDER の順で 3 枚のカードを並べ、その下に 4 つ目（EXTRA_PRESET = すべて拒否）を
// 一段小さいカード（.preset-card-compact。チップは出さない）として置く。各カードは視覚的に
// 隠した radio + ラベルで、選択状態は theme.css の .preset-card（非選択 白地 + 細枠 /
// 選択 白地 + 黒枠）で表現する。
// 文言は copy.ts（PRESET_COPY / CATEGORY_COPY / ESSENTIAL_COPY）だけを使い、ここではハード
// コードしない。

import type { Preset } from '../shared/types';
import { EXTRA_PRESET } from '../shared/types';
import { CATEGORY_COPY, ESSENTIAL_COPY, PRESET_COPY } from '../shared/copy';
import { PRESET_ORDER, categoriesForPreset } from '../shared/presets';

export interface PresetPickerOptions {
  /** radio の name 属性。onboarding / options で別々の名前にする */
  name: string;
  /** アクセシブルな名前（fieldset の aria-label） */
  label: string;
  /** 初期選択。'custom' はどのカードも選択しない状態を表す */
  selected: Preset | 'custom';
  disabled?: boolean;
  /** カードを選んだときに呼ばれる（保存は呼び出し側の責務） */
  onSelect: (preset: Preset) => void;
}

export interface PresetPickerHandle {
  /** カード要素そのもの（呼び出し側がスロットに append する） */
  element: HTMLElement;
  /** 選択状態を描き直す（'custom' なら全カード非選択にする） */
  setSelected(preset: Preset | 'custom'): void;
  /** 保存中・拡張未検出などで操作を止めたいときに使う */
  setDisabled(disabled: boolean): void;
}

export function createPresetPicker(options: PresetPickerOptions): PresetPickerHandle {
  const fieldset = document.createElement('fieldset');
  fieldset.setAttribute('role', 'radiogroup');
  fieldset.setAttribute('aria-label', options.label);
  fieldset.className = 'preset-picker';

  const inputs: HTMLInputElement[] = [];

  /** 1 枚ぶん。compact は 4 つ目（すべて拒否）用で、一段小さくチップを出さない */
  function buildCard(preset: Preset, compact: boolean): HTMLElement {
    const copy = PRESET_COPY[preset];

    const card = document.createElement('label');
    card.className = compact ? 'preset-card preset-card-compact' : 'preset-card';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = options.name;
    input.value = preset;
    input.className = 'preset-card-input visually-hidden';
    input.checked = options.selected === preset;
    input.disabled = options.disabled === true;
    input.addEventListener('change', () => {
      if (input.checked) options.onSelect(preset);
    });
    inputs.push(input);

    const head = document.createElement('div');
    head.className = 'preset-card-head';
    const name = document.createElement('span');
    name.className = 'preset-card-name';
    name.textContent = copy.name;
    head.append(name);
    if (copy.recommended) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-success';
      badge.textContent = 'おすすめ';
      head.append(badge);
    }

    const desc = document.createElement('p');
    desc.className = 'preset-card-desc';
    desc.textContent = copy.description;

    card.append(input, head, desc);
    if (compact) return card;

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    chips.append(createChip(ESSENTIAL_COPY.name));
    for (const category of categoriesForPreset(preset)) chips.append(createChip(CATEGORY_COPY[category].name));
    card.append(chips);
    return card;
  }

  for (const preset of PRESET_ORDER) fieldset.append(buildCard(preset, false));
  // 4 つ目は主要な 3 つと並べず、下に小さく置く（§14.3）
  fieldset.append(buildCard(EXTRA_PRESET, true));

  return {
    element: fieldset,
    setSelected(preset) {
      for (const input of inputs) input.checked = input.value === preset;
    },
    setDisabled(disabled) {
      for (const input of inputs) input.disabled = disabled;
    },
  };
}

function createChip(text: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'chip chip-neutral';
  chip.textContent = text;
  return chip;
}
