// content script / service worker から文言を引く入口（docs/SPEC.md §14.10）
//
// 拡張ページの辞書（ja.ts / en.ts）はここからは参照しない。全サイト・全フレームに注入される
// content バンドルに popup / options の文言まで入れないため、必要な分だけを別の定数にしてある。
// 現在の言語は lang.ts が持つので、拡張ページ側の t() と同じ値で切り替わる。

import type { Lang, RuntimeMessages } from './types';
import { getLang } from './lang';
import { backgroundEn, pickerEn } from './runtime.en';
import { backgroundJa, pickerJa } from './runtime.ja';

const PICKER: Record<Lang, RuntimeMessages['picker']> = { ja: pickerJa, en: pickerEn };
const BACKGROUND: Record<Lang, RuntimeMessages['background']> = { ja: backgroundJa, en: backgroundEn };

export function tPicker(): RuntimeMessages['picker'] {
  return PICKER[getLang()];
}

export function tBackground(): RuntimeMessages['background'] {
  return BACKGROUND[getLang()];
}
