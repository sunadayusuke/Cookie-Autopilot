// カテゴリ表（docs/SPEC.md §14.2 / §14.3 / §14.5）
//
// onboarding と options の両方で使う共通部品。「必要なもの」+ CATEGORY_KEYS 7 行を
// <details> アコーディオンで並べ、各行に「しっかり守る / ほどよく守る / ゆるく守る」の
// ✓／— マーク列を出す。`toggles` を渡すと右にもう 1 列「あなたの設定」を足し、
// A/B/D/E/F/X の行に既存の ToggleSwitch（theme.css の .toggle）を置く（options 用）。
// 文言は copy.ts だけを使い、ここではハードコードしない。

import type { CategoryCopy } from '../shared/copy';
import { CATEGORY_COPY, ESSENTIAL_COPY, PRESET_COPY } from '../shared/copy';
import { PRESET_ORDER, categoriesForPreset } from '../shared/presets';
import type { CategoryKey } from '../shared/types';
import { CATEGORY_KEYS } from '../shared/types';

export interface CategoryTableToggles {
  /** 現在の許可状態（A/B/D/E/F/X のみ。「必要なもの」は常に許可なので含まない） */
  allow: Record<CategoryKey, boolean>;
  /** トグルを操作したときに呼ばれる（保存は呼び出し側の責務） */
  onToggle: (key: CategoryKey, on: boolean) => void;
}

export interface CategoryTableOptions {
  /** 渡すと右に「あなたの設定」列（ToggleSwitch）を追加する。無指定なら読み物として表示する（onboarding） */
  toggles?: CategoryTableToggles;
}

export interface CategoryTableHandle {
  /** 表そのもの（呼び出し側がスロットに append する） */
  element: HTMLElement;
  /** トグル列の状態を外から描き直す（toggles 未指定時は何もしない） */
  setAllow: (allow: Record<CategoryKey, boolean>) => void;
}

interface CategoryRow {
  key: CategoryKey | null;
  copy: CategoryCopy;
}

function categoryRows(): CategoryRow[] {
  return [{ key: null, copy: ESSENTIAL_COPY }, ...CATEGORY_KEYS.map((key) => ({ key, copy: CATEGORY_COPY[key] }))];
}

export function createCategoryTable(options: CategoryTableOptions = {}): CategoryTableHandle {
  const { toggles } = options;
  const toggleButtons = new Map<CategoryKey, HTMLButtonElement>();

  const element = document.createElement('div');
  element.className = 'category-table';
  element.append(buildLegend(toggles), buildAccordion(toggles, toggleButtons));

  return {
    element,
    setAllow(allow) {
      for (const [key, button] of toggleButtons) setToggleState(button, allow[key] === true);
    },
  };
}

/** 列見出し（しっかり守る / ほどよく守る / ゆるく守る + toggles があれば「あなたの設定」）。装飾目的（各行のマーク／トグルに個別の aria-label があるため aria-hidden） */
function buildLegend(toggles: CategoryTableToggles | undefined): HTMLElement {
  const legend = document.createElement('div');
  legend.className = 'category-legend';
  legend.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'category-legend-label';
  legend.append(label);

  const cols = document.createElement('span');
  cols.className = 'category-legend-cols';
  for (const preset of PRESET_ORDER) {
    const col = document.createElement('span');
    col.className = 'category-legend-col';
    col.textContent = PRESET_COPY[preset].name;
    cols.append(col);
  }
  if (toggles) {
    const col = document.createElement('span');
    col.className = 'category-legend-col category-legend-col-toggle';
    col.textContent = 'あなたの設定';
    cols.append(col);
  }
  legend.append(cols);

  return legend;
}

function buildAccordion(
  toggles: CategoryTableToggles | undefined,
  toggleButtons: Map<CategoryKey, HTMLButtonElement>,
): HTMLElement {
  const accordion = document.createElement('div');
  accordion.className = 'category-accordion';
  for (const row of categoryRows()) accordion.append(buildRow(row, toggles, toggleButtons));
  return accordion;
}

function buildRow(
  row: CategoryRow,
  toggles: CategoryTableToggles | undefined,
  toggleButtons: Map<CategoryKey, HTMLButtonElement>,
): HTMLElement {
  const details = document.createElement('details');
  details.className = 'category-row';

  const summary = document.createElement('summary');
  summary.className = 'category-summary';

  const chevron = document.createElement('span');
  chevron.className = 'category-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  const main = document.createElement('span');
  main.className = 'category-summary-main';
  const name = document.createElement('span');
  name.className = 'category-name';
  name.textContent = row.copy.name;
  const short = document.createElement('span');
  short.className = 'category-short';
  short.textContent = row.copy.short;
  main.append(name, short);

  const marks = document.createElement('span');
  marks.className = 'category-marks';
  for (const preset of PRESET_ORDER) {
    const allowed = row.key === null || categoriesForPreset(preset).includes(row.key);
    marks.append(createMark(allowed, PRESET_COPY[preset].name));
  }

  summary.append(chevron, main, marks);
  if (toggles) summary.append(buildToggleCol(row, toggles, toggleButtons));

  const description = document.createElement('p');
  description.className = 'category-description';
  description.textContent = row.copy.description;

  details.append(summary, description);
  return details;
}

/** 「あなたの設定」列: 「必要なもの」は固定の ✓、A/B/D/E/F/X は ToggleSwitch */
function buildToggleCol(
  row: CategoryRow,
  toggles: CategoryTableToggles,
  toggleButtons: Map<CategoryKey, HTMLButtonElement>,
): HTMLElement {
  const col = document.createElement('span');
  col.className = 'category-toggle-col';

  if (row.key === null) {
    const fixedMark = document.createElement('span');
    fixedMark.className = 'category-fixed-mark';
    fixedMark.textContent = '✓';
    fixedMark.setAttribute('role', 'img');
    fixedMark.title = '常に許可';
    fixedMark.setAttribute('aria-label', `${row.copy.name}: 常に許可`);
    col.append(fixedMark);
    return col;
  }

  const key = row.key;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-checked', toggles.allow[key] === true ? 'true' : 'false');
  toggle.setAttribute('aria-label', row.copy.name);
  const thumb = document.createElement('span');
  thumb.className = 'toggle-thumb';
  toggle.append(thumb);
  toggle.addEventListener('click', (event) => {
    // <summary> の中にあるため、既定動作（アコーディオンの開閉）を止めてからトグルだけ切り替える
    event.preventDefault();
    const next = toggle.getAttribute('aria-checked') !== 'true';
    setToggleState(toggle, next);
    toggles.onToggle(key, next);
  });
  toggleButtons.set(key, toggle);
  col.append(toggle);
  return col;
}

function setToggleState(toggle: HTMLButtonElement, on: boolean): void {
  toggle.setAttribute('aria-checked', on ? 'true' : 'false');
}

function createMark(allowed: boolean, presetName: string): HTMLElement {
  const mark = document.createElement('span');
  mark.className = `category-mark ${allowed ? 'category-mark-allow' : 'category-mark-deny'}`;
  mark.textContent = allowed ? '✓' : '—';
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', `${presetName}: ${allowed ? '許可' : '拒否'}`);
  return mark;
}
