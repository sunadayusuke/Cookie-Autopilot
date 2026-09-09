// カテゴリのトグル行（docs/SPEC.md §14.9。popup の「このサイトの設定」詳細で使う）
//
// categoryTable.ts はプリセット 3 列のマーク付き横長テーブルなので、幅 320 の popup には
// 収まらない。こちらは「必要なもの」+ CATEGORY_KEYS の 7 行を縦に積むだけの部品で、
// 左に表示名（14px）と一言（12px muted）、右に ToggleSwitch を置く。
// 「必要なもの」は常に許可なので固定の ✓ にする。文言は copy.ts だけを使う。
//
// 表示名＋一言は開閉ボタン（.category-toggle-trigger）にし、押すとその行の直下に
// description を開く。シェブロン（.category-chevron）と説明文（.category-description）は
// categoryTable.ts の <details> アコーディオンと同じクラスを流用する。ただしこちらは
// 右のトグルと独立して開閉できる必要があるため <details> は使わず、aria-expanded 付き
// ボタン + hidden 属性の切り替えで実装する（トグルは別ボタンなので押しても連動しない）。

import type { CategoryCopy } from '../shared/copy';
import { CATEGORY_COPY, ESSENTIAL_COPY } from '../shared/copy';
import type { CategoryKey } from '../shared/types';
import { CATEGORY_KEYS } from '../shared/types';

export interface CategoryTogglesOptions {
  /** 現在の許可状態（A/B/D/E/F/X のみ。「必要なもの」は常に許可なので含まない） */
  allow: Record<CategoryKey, boolean>;
  /** トグルを操作したときに呼ばれる（保存は呼び出し側の責務） */
  onToggle: (key: CategoryKey, on: boolean) => void;
}

export interface CategoryTogglesHandle {
  /** 行をまとめた要素（呼び出し側がスロットに append する） */
  element: HTMLElement;
  /** トグルの状態を外から描き直す */
  setAllow: (allow: Record<CategoryKey, boolean>) => void;
  /** 「このサイトでは動かさない」が ON のときなど、まとめて操作を止める */
  setDisabled: (disabled: boolean) => void;
}

export function createCategoryToggles(options: CategoryTogglesOptions): CategoryTogglesHandle {
  const toggles = new Map<CategoryKey, HTMLButtonElement>();

  const element = document.createElement('div');
  element.className = 'category-toggles';
  element.append(buildFixedRow(ESSENTIAL_COPY));
  for (const key of CATEGORY_KEYS) {
    element.append(buildToggleRow(key, CATEGORY_COPY[key], options, toggles));
  }

  return {
    element,
    setAllow(allow) {
      for (const [key, toggle] of toggles) setToggleState(toggle, allow[key] === true);
    },
    setDisabled(disabled) {
      for (const toggle of toggles.values()) toggle.disabled = disabled;
    },
  };
}

/** 「必要なもの」の行。操作できない固定の ✓（title「常に許可」） */
function buildFixedRow(copy: CategoryCopy): HTMLElement {
  const { item, row } = buildRowShell(null, copy);
  const mark = document.createElement('span');
  mark.className = 'category-fixed-mark';
  mark.textContent = '✓';
  mark.setAttribute('role', 'img');
  mark.title = '常に許可';
  mark.setAttribute('aria-label', `${copy.name}: 常に許可`);
  row.append(mark);
  return item;
}

function buildToggleRow(
  key: CategoryKey,
  copy: CategoryCopy,
  options: CategoryTogglesOptions,
  toggles: Map<CategoryKey, HTMLButtonElement>,
): HTMLElement {
  const { item, row } = buildRowShell(key, copy);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', copy.name);
  setToggleState(toggle, options.allow[key] === true);
  const thumb = document.createElement('span');
  thumb.className = 'toggle-thumb';
  toggle.append(thumb);
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-checked') !== 'true';
    setToggleState(toggle, next);
    options.onToggle(key, next);
  });

  toggles.set(key, toggle);
  row.append(toggle);
  return item;
}

/**
 * 行の共通部分。開閉ボタン（シェブロン＋表示名＋一言）とその直下の説明文までを組み立てて
 * `item`（呼び出し側が `.category-toggles` に append する）として返す。右側のコントロール
 * （✓ 固定 or トグル）は呼び出し側が `row` に append する。
 */
function buildRowShell(key: CategoryKey | null, copy: CategoryCopy): { item: HTMLElement; row: HTMLElement } {
  const item = document.createElement('div');
  item.className = 'category-toggle-item hairline-row';

  const row = document.createElement('div');
  row.className = 'category-toggle-row';

  const descriptionId = `category-desc-${key ?? 'essential'}`;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'category-toggle-trigger';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', descriptionId);

  const chevron = document.createElement('span');
  chevron.className = 'category-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  const main = document.createElement('span');
  main.className = 'category-toggle-main';
  const name = document.createElement('span');
  name.className = 'category-toggle-name';
  name.textContent = copy.name;
  const short = document.createElement('span');
  short.className = 'category-toggle-short';
  short.textContent = copy.short;
  main.append(name, short);

  trigger.append(chevron, main);

  const description = document.createElement('p');
  description.id = descriptionId;
  description.className = 'category-description';
  description.textContent = copy.description;
  description.hidden = true;

  trigger.addEventListener('click', () => {
    const open = trigger.getAttribute('aria-expanded') !== 'true';
    trigger.setAttribute('aria-expanded', String(open));
    description.hidden = !open;
  });

  row.append(trigger);
  item.append(row, description);
  return { item, row };
}

function setToggleState(toggle: HTMLButtonElement, on: boolean): void {
  toggle.setAttribute('aria-checked', on ? 'true' : 'false');
}
