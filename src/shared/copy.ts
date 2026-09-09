// UI に出す確定コピー（docs/SPEC.md §14.2）
//
// onboarding / popup / options で共用する。文言はここだけに置き、UI 側で書き換えない。
// カテゴリ記号（A/B/…）・CMP・Consent-O-Matic は画面に出さない（§14.7）。

import type { CategoryKey, Preset } from './types';

export interface CategoryCopy {
  /** 表示名 */
  name: string;
  /** 一言 */
  short: string;
  /** 初心者向けの説明 */
  description: string;
}

/** 必須 Cookie。カテゴリではなく常に許可するので、一覧の先頭に固定で並べる */
export const ESSENTIAL_COPY: CategoryCopy = {
  name: '必要なもの',
  short: '常に許可',
  description: 'ログイン状態やカートの中身など、サイトが動くために欠かせないもの。これが無いとサイトが使えないので、常に許可します。',
};

export const CATEGORY_COPY: Record<CategoryKey, CategoryCopy> = {
  A: {
    name: '設定の記憶',
    short: '実害はほぼなし',
    description: '言語・文字サイズ・地域などの設定を次回も覚えておくためのもの。渡るのは「あなたが選んだ設定」だけで、他社に渡ることはほとんどありません。',
  },
  B: {
    name: 'アクセス解析',
    short: '匿名の利用データ',
    description: 'どのページが何回見られたかをサイト運営者が知るためのもの（Google アナリティクスなど）。閲覧したページ・滞在時間・おおまかな地域・端末の種類が解析会社に渡ります。多くは個人が特定されない形に加工されます。',
  },
  D: {
    name: '端末への保存',
    short: '分析や広告の土台',
    description: '端末に識別用の番号を保存し、あとから読み出す仕組み。それ自体に用途はなく、分析や広告の土台になります。用途が絞れないので、断っておくのが安心です。',
  },
  E: {
    name: 'おすすめの表示',
    short: '行動が記録される',
    description: 'あなたがサイト内で何を見たかから、おすすめの記事や動画を選び、その効果を測るためのもの。広告ではありませんが、サイト内での行動が記録されます。',
  },
  F: {
    name: '追跡型の広告',
    short: '最も避けたい',
    description: '一度見た商品の広告が別のサイトでも追いかけてくる仕組み。閲覧履歴や興味関心が広告会社（数十〜数百社）に共有され、長期間保持されます。',
  },
  X: {
    name: 'その他',
    short: '用途が不明',
    description: '上のどれにも当てはまらない用途。中身が分からないので断っておくのが安全です。',
  },
};

export interface PresetCopy {
  name: string;
  /** 「おすすめ」バッジを出すか */
  recommended?: boolean;
  description: string;
}

export const PRESET_COPY: Record<Preset, PresetCopy> = {
  strict: {
    name: 'しっかり守る',
    description: '必要なもの以外はすべて断ります。いちばん安心ですが、サイトによっては表示の設定が次回に引き継がれません。',
  },
  minimal: {
    name: 'ほどよく守る',
    recommended: true,
    description: 'サイトを快適に使うための「設定の記憶」だけ許可し、分析や広告は断ります。',
  },
  relaxed: {
    name: 'ゆるく守る',
    description: 'サイト運営者のアクセス解析とおすすめ表示も許可します。追跡型の広告と用途不明のものは断ります。',
  },
  none: {
    name: 'すべて拒否',
    description:
      '断るボタンがあれば断り、「OK」しかない画面では何も押さずに画面を消します。サイトに答えを返さないぶん、同じ画面が何度も出たり、一部の機能が使えないことがあります。',
  },
};

/** どの画面でも添える共通の注意書き（§14.2 / §14.1） */
export const NOTES = {
  /** どのプリセットでも拒否するカテゴリがあること */
  alwaysRejected: '追跡型の広告と用途が不明なものは、どの設定でも断ります。',
  /** プリセットの差が出るのは細かく選べるサイトだけ、ということ */
  granularOnly:
    'サイトが細かく選べるようになっている場合は、この設定どおりに選びます。選べないサイトでは、必要なもの以外を断ります。',
} as const;
