// 言語まわり（docs/SPEC.md §14.10）

import { afterEach, describe, expect, it } from 'vitest';
import { applyI18n, detectLang, resolveLang, setLang } from '../src/shared/i18n';
import { en } from '../src/shared/i18n/en';
import { ja } from '../src/shared/i18n/ja';
import onboardingHtml from '../public/onboarding.html?raw';
import optionsHtml from '../public/options.html?raw';
import popupHtml from '../public/popup.html?raw';

/** navigator.language を差し替える（jsdom の既定は en-US） */
function setNavigatorLanguage(language: string): void {
  Object.defineProperty(window.navigator, 'language', { value: language, configurable: true });
}

afterEach(() => {
  setNavigatorLanguage('en-US');
});

/** ネストしたキーを 'a.b.c' の形で全部並べる（葉の型も添える） */
function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (!value || typeof value !== 'object') {
    out.set(prefix, typeof value);
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    for (const [childPath, type] of flatten(child, path)) out.set(childPath, type);
  }
  return out;
}

describe('辞書（ja / en）', () => {
  it('キーの構造と値の型が完全に一致する', () => {
    const jaKeys = flatten(ja);
    const enKeys = flatten(en);
    expect([...enKeys.keys()].sort()).toEqual([...jaKeys.keys()].sort());
    for (const [key, type] of jaKeys) expect(enKeys.get(key), key).toBe(type);
  });

  it('空の文言を持たない', () => {
    for (const dict of [ja, en]) {
      for (const [key, type] of flatten(dict)) {
        if (type !== 'string') continue;
        // picker.clickPrefix だけは言語によって空（日本語は前置きが無い）
        if (key === 'picker.clickPrefix' || key === 'options.siteHistoryUnit') continue;
        expect(lookup(dict, key), key).not.toBe('');
      }
    }
  });
});

describe('detectLang', () => {
  it('ja で始まるものだけ日本語、それ以外はすべて英語', () => {
    for (const language of ['ja', 'ja-JP']) {
      setNavigatorLanguage(language);
      expect(detectLang(), language).toBe('ja');
    }
    for (const language of ['en-US', 'fr-FR', 'zh-CN', '']) {
      setNavigatorLanguage(language);
      expect(detectLang(), language).toBe('en');
    }
  });
});

describe('resolveLang', () => {
  it('保存値があればそれを使う', () => {
    setNavigatorLanguage('ja-JP');
    expect(resolveLang('en')).toBe('en');
    expect(resolveLang('ja')).toBe('ja');
  });

  it('保存値が無ければブラウザの言語で判定する', () => {
    setNavigatorLanguage('ja-JP');
    expect(resolveLang(null)).toBe('ja');
    setNavigatorLanguage('de-DE');
    expect(resolveLang(null)).toBe('en');
  });
});

/** applyI18n と同じ引き方（ドット区切り。文字列でなければ null） */
function lookup(dict: unknown, key: string): string | null {
  let value: unknown = dict;
  for (const part of key.split('.')) {
    if (!value || typeof value !== 'object') return null;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : null;
}

const I18N_ATTRS = ['data-i18n', 'data-i18n-aria-label', 'data-i18n-title'] as const;

/** 3 画面の HTML（?raw は test/globals.d.ts で宣言している） */
const PAGES: readonly { name: string; html: string }[] = [
  { name: 'popup.html', html: popupHtml },
  { name: 'options.html', html: optionsHtml },
  { name: 'onboarding.html', html: onboardingHtml },
];

function i18nKeysOf(html: string): { attr: string; key: string }[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const found: { attr: string; key: string }[] = [];
  for (const attr of I18N_ATTRS) {
    for (const el of doc.querySelectorAll(`[${attr}]`)) {
      found.push({ attr, key: el.getAttribute(attr) ?? '' });
    }
  }
  return found;
}

describe('HTML の data-i18n', () => {
  for (const { name, html } of PAGES) {
    it(`${name} のキーは ja / en どちらでも引ける`, () => {
      const keys = i18nKeysOf(html);
      expect(keys.length).toBeGreaterThan(0);
      for (const { attr, key } of keys) {
        expect(lookup(ja, key), `${name} ${attr}="${key}" (ja)`).not.toBeNull();
        expect(lookup(en, key), `${name} ${attr}="${key}" (en)`).not.toBeNull();
      }
    });
  }

  /**
   * HTML に書いてある日本語（fixtures のプレビュー用のフォールバック）と ja.ts が食い違うと、
   * 日本語表示が applyI18n を通った瞬間に変わってしまう。全キーを突き合わせて防ぐ。
   * 整形のための改行とインデントだけは詰めて比較する（意図的な前後の空白は残す）。
   */
  function htmlText(raw: string): string {
    return raw.replace(/\s*\n\s*/g, '');
  }

  for (const { name, html } of PAGES) {
    it(`${name} のフォールバックの日本語は ja.ts と完全一致する`, () => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let checked = 0;
      for (const el of doc.querySelectorAll('[data-i18n]')) {
        const key = el.getAttribute('data-i18n') ?? '';
        expect(htmlText(el.textContent ?? ''), `${name} data-i18n="${key}"`).toBe(lookup(ja, key));
        checked++;
      }
      for (const attr of ['aria-label', 'title'] as const) {
        for (const el of doc.querySelectorAll(`[data-i18n-${attr}]`)) {
          const key = el.getAttribute(`data-i18n-${attr}`) ?? '';
          expect(el.getAttribute(attr), `${name} data-i18n-${attr}="${key}"`).toBe(lookup(ja, key));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});

describe('applyI18n', () => {
  /** root だけを対象にするため、document ではなく切り離した要素に流し込む */
  function render(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    applyI18n(root);
    return root;
  }

  it('data-i18n は textContent、data-i18n-aria-label / -title は属性に入れる', () => {
    setLang('en');
    const root = render(
      '<p data-i18n="onboarding.doneHeading">設定しました</p>' +
        '<button data-i18n-aria-label="options.debugAria" aria-label="デバッグログをコンソールに出力する"></button>' +
        '<button data-i18n-title="common.saved" title="保存しました"></button>',
    );
    expect(root.querySelector('p')?.textContent).toBe(en.onboarding.doneHeading);
    expect(root.querySelector('[data-i18n-aria-label]')?.getAttribute('aria-label')).toBe(en.options.debugAria);
    expect(root.querySelector('[data-i18n-title]')?.getAttribute('title')).toBe(en.common.saved);
  });

  it('引けないキーでは DOM に触らない（HTML の日本語がそのまま残る）', () => {
    setLang('en');
    const root = render(
      '<p data-i18n="options.nope">そのまま</p>' +
        '<button data-i18n-aria-label="nope" aria-label="そのまま"></button>' +
        '<button data-i18n-title="nope.nope.nope"></button>',
    );
    expect(root.querySelector('p')?.textContent).toBe('そのまま');
    expect(root.querySelector('[data-i18n-aria-label]')?.getAttribute('aria-label')).toBe('そのまま');
    expect(root.querySelector('[data-i18n-title]')?.hasAttribute('title')).toBe(false);
  });

  it('値が関数・オブジェクトのキーでも DOM に触らない', () => {
    setLang('en');
    const root = render(
      '<p data-i18n="common.saveFailed">そのまま</p>' + '<span data-i18n="popup.badge">そのまま</span>',
    );
    for (const el of root.children) expect(el.textContent, el.getAttribute('data-i18n') ?? '').toBe('そのまま');
  });

  it('空文字の文言は空文字として入れる', () => {
    setLang('ja');
    const root = render('<span data-i18n="picker.clickPrefix">そのまま</span>');
    expect(ja.picker.clickPrefix).toBe('');
    expect(root.querySelector('span')?.textContent).toBe('');
  });
});
