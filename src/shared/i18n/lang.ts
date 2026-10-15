// 言語の判定・保持（docs/SPEC.md §14.10）
//
// 正は chrome.storage.sync の Settings.lang（null = ブラウザの言語で自動判定）。
// ただし拡張ページは storage を await してからでないと設定言語が分からず、その間に
// 別の言語で描画されてしまう。そこで拡張ページだけ localStorage の小さなキャッシュを
// 同期的に読み、await が解決したら正の値で上書きする（initLangCache）。
// content script はページ側の localStorage を汚さないためキャッシュを使わない
// （detectLang のフォールバックで十分）。
//
// 辞書を持たないのは、content script / service worker が「現在の言語」だけを必要とし、
// 拡張ページ用の辞書（ja.ts / en.ts）をバンドルに引き込まないようにするため（§14.10）。

import type { Lang } from './types';

export type { Lang } from './types';

/** ちらつき対策のキャッシュ（正ではない）。拡張ページの localStorage にだけ置く */
const CACHE_KEY = 'cookie-autopilot:lang';

/** ブラウザの UI 言語。拡張として動いていれば chrome.i18n を優先する */
function uiLanguage(): string {
  try {
    const fromChrome = typeof chrome !== 'undefined' ? chrome.i18n?.getUILanguage?.() : undefined;
    if (fromChrome) return fromChrome;
  } catch {
    // 拡張外・権限なし。navigator にフォールバック
  }
  return typeof navigator !== 'undefined' ? navigator.language : '';
}

/** ブラウザの言語による自動判定。ja で始まれば日本語、それ以外はすべて英語 */
export function detectLang(): Lang {
  return uiLanguage().toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/** 保存値があればそれ、無ければブラウザの言語で判定する */
export function resolveLang(saved: Lang | null): Lang {
  return saved ?? detectLang();
}

let current: Lang = detectLang();
/** キャッシュを読み書きしてよいか（拡張ページだけ true） */
let cacheEnabled = false;

function readCache(): Lang | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw === 'ja' || raw === 'en' ? raw : null;
  } catch {
    return null; // localStorage が使えない環境
  }
}

/**
 * 拡張ページ（popup / options / onboarding）が main() の冒頭で呼ぶ。
 * 同期的に読めるキャッシュがあればそれを現在の言語にする（無ければ detectLang のまま）。
 */
export function initLangCache(): Lang {
  cacheEnabled = true;
  const cached = readCache();
  if (cached) current = cached;
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  if (!cacheEnabled) return;
  try {
    localStorage.setItem(CACHE_KEY, lang);
  } catch {
    // 保存できなくてもキャッシュが効かないだけなので無視する
  }
}

export function getLang(): Lang {
  return current;
}
