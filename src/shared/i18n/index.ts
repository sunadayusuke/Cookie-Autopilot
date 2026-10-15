// 拡張ページ（popup / options / onboarding）の文言と HTML への流し込み（docs/SPEC.md §14.10）
//
// 言語の判定・保持は lang.ts に分けてある。content script / service worker は
// lang.ts と runtime.ts だけを読み、ここ（＝全文言の辞書）は読み込まない。

import type { Lang, Messages } from './types';
import { getLang } from './lang';
import { en } from './en';
import { ja } from './ja';

export type { ImportErrorCode, Lang, Messages } from './types';
export { detectLang, getLang, initLangCache, resolveLang, setLang } from './lang';

const MESSAGES: Record<Lang, Messages> = { ja, en };

export function t(): Messages {
  return MESSAGES[getLang()];
}

/** 'popup.badge.loading' のようなドット区切りのキーで文言を引く。文字列でなければ null */
function lookup(key: string): string | null {
  let value: unknown = t();
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') return null;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : null;
}

/**
 * data-i18n（textContent）/ data-i18n-aria-label / data-i18n-title を流し込む。
 * 引けないキーは何もしない（HTML 側の日本語がそのまま残る）。
 */
export function applyI18n(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const text = lookup(el.getAttribute('data-i18n') ?? '');
    if (text !== null) el.textContent = text;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
    const text = lookup(el.getAttribute('data-i18n-aria-label') ?? '');
    if (text !== null) el.setAttribute('aria-label', text);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const text = lookup(el.getAttribute('data-i18n-title') ?? '');
    if (text !== null) el.setAttribute('title', text);
  }
}

export function applyDocumentLang(): void {
  document.documentElement.lang = getLang();
}
