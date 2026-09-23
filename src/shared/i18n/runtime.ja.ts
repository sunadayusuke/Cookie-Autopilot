// content script / service worker が使う日本語の文言（docs/SPEC.md §14.10）
//
// 拡張ページの辞書（ja.ts）はここを取り込んで Messages を組み立てる。
// picker と background を別の定数にしているのは、使っていない側をバンドルから落とすため。

import type { RuntimeMessages } from './types';

export const pickerJa: RuntimeMessages['picker'] = {
  rejectForbidden: 'このボタンは登録できません（購入・削除など危険な操作に見えます）',
  rejectNoText: '文言のないボタンは登録できません。文字の入ったボタンを選んでください',
  rejectLabel: '断るボタン',
  acceptLabel: '許可ボタン',
  clickPrefix: '',
  clickSuffix: 'をクリックしてください（Esc で中止）',
};

export const backgroundJa: RuntimeMessages['background'] = {
  emptyRuleList: 'ルール一覧が空です',
  noRulesFetched: '取得できたルールがありません',
};
