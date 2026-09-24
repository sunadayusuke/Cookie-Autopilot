// 言語の切り替え（docs/SPEC.md §14.10）
//
// options と onboarding の両方で使う共通部品。JA / EN の 2 択セグメントで、
// 見た目は theme.css の ButtonSelect（.btn-select / .btn-select-option）を流用する。
// ButtonSelect はラジオ実装だが、こちらは押した瞬間に保存する 2 択なので
// role="group" + aria-pressed のボタンにする（選択中の見た目は .lang-toggle 側で当てる）。

import type { Lang } from '../shared/i18n';

/** 表示は言語名そのもの（切り替え先が読めるよう、どちらの言語でも同じラベル） */
const LANGS: readonly { lang: Lang; label: string }[] = [
  { lang: 'ja', label: 'JA' },
  { lang: 'en', label: 'EN' },
];

export interface LangToggleOptions {
  /** 現在の言語 */
  lang: Lang;
  /** 選んだときに呼ばれる（保存は呼び出し側の責務） */
  onSelect: (lang: Lang) => void;
}

export interface LangToggleHandle {
  /** 切り替え要素そのもの（呼び出し側がスロットに append する） */
  element: HTMLElement;
  /** 選択状態を外から描き直す */
  setLang: (lang: Lang) => void;
  /** 描き直し中など、一時的に操作を止めたいときに使う（presetPicker と同じ idiom） */
  setDisabled: (disabled: boolean) => void;
}

export function createLangToggle(options: LangToggleOptions): LangToggleHandle {
  const element = document.createElement('div');
  element.className = 'btn-select lang-toggle';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Language');

  const buttons = new Map<Lang, HTMLButtonElement>();
  for (const { lang, label } of LANGS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-select-option';
    button.textContent = label;
    button.setAttribute('aria-pressed', lang === options.lang ? 'true' : 'false');
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      options.onSelect(lang);
    });
    buttons.set(lang, button);
    element.append(button);
  }

  return {
    element,
    setLang(lang) {
      for (const [key, button] of buttons) button.setAttribute('aria-pressed', key === lang ? 'true' : 'false');
    },
    setDisabled(disabled) {
      for (const button of buttons.values()) button.disabled = disabled;
    },
  };
}
