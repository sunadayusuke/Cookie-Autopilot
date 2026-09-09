// データモデル（docs/SPEC.md §3 / §14.1）

export type Mode = 'reject' | 'accept' | 'off';
/**
 * reject = 必要なもののみ（拒否）, accept = すべて許可, off = 何もしない。
 * 実効モードは off か reject のどちらかで、accept はエンジン内部と fixtures（`?mode=accept`）
 * のためだけに残している（UI からは作れない。§14.1）。
 */
export const MODES = ['reject', 'accept', 'off'] as const;

/** Consent-O-Matic のカテゴリ */
export type ComCategory = 'A' | 'B' | 'D' | 'E' | 'F' | 'X';
export const COM_CATEGORIES = ['A', 'B', 'D', 'E', 'F', 'X'] as const;

/** 設定・UI で使うカテゴリ。実体は ComCategory と同じ（§14.1） */
export type CategoryKey = ComCategory;
export const CATEGORY_KEYS = COM_CATEGORIES;

/** 許可の強さのプリセット。しっかり守る / ほどよく守る / ゆるく守る / すべて拒否 */
export type Preset = 'strict' | 'minimal' | 'relaxed' | 'none';
/** UI に 3 枚のカードとして並べる主要なプリセット（弱い順） */
export const PRESET_KEYS = ['strict', 'minimal', 'relaxed'] as const;
/**
 * 4 つ目のプリセット（§14.1）。許可するカテゴリは strict と同じで、
 * 「同意を意味するボタンを一切押さない」（＝閉じる語も押さない）だけが差分。
 * 主要な 3 つとは別扱いなので PRESET_KEYS には入れず、UI では 3 枚の下に小さく置く。
 */
export const EXTRA_PRESET = 'none' as const;

/** 拒否できなかったときの挙動（'accept' は §14.1 で廃止） */
export type Fallback = 'leave' | 'hide';

export interface Settings {
  /** 既定 'minimal'。詳細設定でトグルを個別に変えると 'custom' */
  preset: Preset | 'custom';
  /** 実効の許可カテゴリ。preset を選ぶとこの値も書き換える */
  allowCategories: Record<CategoryKey, boolean>;
  /**
   * 選択肢のないお知らせ（「OK」しか無い画面）で閉じるボタンを押すか。既定 true。
   * プリセット 'none'（すべて拒否）を選んだときだけ false になり、サイトに答えを返さず
   * 「断れなかったとき」の設定（既定は非表示）に落とす。サイトごとの override は
   * このフラグを持たない＝全体の設定にだけ効く（§14.9）
   */
  pressCloseOnNotice: boolean;
  /** 初期設定（onboarding）を完了したか。既定 false */
  onboarded: boolean;
  /** 既定 'hide'（同意画面を見せないのが目的） */
  fallbackWhenNoReject: Fallback;
  showBadge: boolean;
  debug: boolean;
  /** 同意画面の出現を監視する秒数 */
  observeSeconds: number;
}

/**
 * サイトごとの設定（§14.9）。未設定（キーが無い）= 全体の設定に従う。
 * custom = このサイトだけ項目ごとに調整した / off = このサイトでは動かさない。
 * 旧形式（プリセット名 'strict'|'minimal'|'relaxed' と 'off'）は読み込み時に変換する。
 */
export type SiteOverride =
  | { kind: 'custom'; allow: Record<CategoryKey, boolean> }
  | { kind: 'off' };
/** key = siteKey(hostname) */
export type SiteOverrides = Record<string, SiteOverride>;

export interface CustomRule {
  id: string;
  /** siteKey */
  host: string;
  action: 'reject' | 'accept';
  /** 安定セレクタ（無い場合あり） */
  selector?: string;
  /** 正規化済みボタン文言（フォールバック。shadow DOM 内でも効く） */
  text?: string;
  createdAt: number;
}

export interface ComRulesPayload {
  fetchedAt: number;
  source: string;
  rules: Record<string, ComRule>;
}

export interface ComRulesStatus {
  updatedAt: number;
  count: number;
  ok: boolean;
  error?: string;
  /** 直近の更新で取得に失敗したルールファイルの件数（M6: 部分失敗しても既存ルールとマージするため） */
  failed?: number;
  /** 取得に失敗したルールファイルの識別名（rules-list.json のファイル名相当） */
  failedNames?: string[];
}

/** watching = 監視窓を開いた直後（まだ結果が出ていない）。popup の「監視中…」表示に使う */
export type TabStatusKind = 'handled' | 'unhandled' | 'none' | 'off' | 'watching';

/**
 * そのサイトで何をしたか（§14.6）。popup の「このサイトでの結果」はこれだけで組み立てる。
 * granular   = サイトの選択画面でカテゴリごとに選んだ
 * reject-all = 拒否・必要最小のボタンを押した
 * custom     = 教えたボタンを押した
 * dismissed  = 選択肢のないお知らせを閉じた
 * hidden     = 同意画面を非表示にした
 */
export type Decision = 'granular' | 'reject-all' | 'custom' | 'dismissed' | 'hidden';

/**
 * `unhandled` で終わった理由（§5-8）。popup の説明文の出し分けとデバッグログに使う。
 * no-candidates = 同意画面は見つかったが押せるボタンの候補が集まらなかった
 * no-reject     = 候補はあるが断るボタンが無かった（従来の主因）
 * panel-aborted = 設定パネルを開いたが操作できずに中止した
 * click-failed  = ボタンを押したのに同意画面が消えなかった
 */
export type UnhandledReason = 'no-candidates' | 'no-reject' | 'panel-aborted' | 'click-failed';

export interface TabStatus {
  host: string;
  status: TabStatusKind;
  /** 'custom' | 'quick:<name>' | 'com:<ruleName>' | 'heuristic' | 'panel' | 'hide' */
  method?: string;
  action?: 'reject' | 'accept';
  /** 押したボタンの正規化済み文言 */
  clickedText?: string;
  /** 押したボタンの表示用ラベル（popup はこちらを出す。無ければ clickedText） */
  clickedLabel?: string;
  decision?: Decision;
  /** decision === 'granular' のときに許可したカテゴリ */
  allowed?: CategoryKey[];
  /** status === 'unhandled' のときの理由（§5-8） */
  reason?: UnhandledReason;
  at: number;
}

export interface ExportBundle {
  settings: Settings;
  siteOverrides: SiteOverrides;
  customRules: CustomRule[];
}

/**
 * サイトごとの対応記録（chrome.storage.local の siteHistory。§14.8）。
 * 一度 handled になったサイトは次回以降 Cookie の同意画面自体が出ないため、
 * 「前回どう答えたか」を popup / options で振り返れるようにする。
 * `hidden`（method: 'hide'）は同意していないので記録しない。
 * バックアップ（ExportBundle）には含めない（設定ではなく履歴のため）。
 */
export interface SiteHistoryEntry {
  /** siteKey。record 側の key（host）と同じ値を持つ */
  host: string;
  decision?: Decision;
  /** decision === 'granular' のときに許可したカテゴリ */
  allowed?: CategoryKey[];
  clickedLabel?: string;
  /** 'custom' | 'quick:<name>' | 'com:<ruleName>' | 'heuristic' | 'panel' */
  method?: string;
  at: number;
}
/** key = siteKey(hostname) */
export type SiteHistory = Record<string, SiteHistoryEntry>;

// ---------------------------------------------------------------------------
// Consent-O-Matic ルールの内部型（実ルール JSON のフィールド名に合わせたもの）
//
// 実データで確認した構造:
//   rule = { detectors: [...], methods: [{ name, action }] }
// 「要素の探索設定」は { parent?, target } の組（ComFindConfig）で、matcher と action は
// それ自身が探索設定を兼ねる（例: { type:'click', target:{...}, parent:{...} }）。
// SPEC では parent を DomSelector のフィールドとして書いているが、実ルールでは
// target と並ぶ位置にあるため実ルール側に合わせている。
// ---------------------------------------------------------------------------

export interface ComStyleFilter {
  option: string;
  value: string;
  negated?: boolean;
}

export interface ComDomSelector {
  selector?: string;
  /** 文字列 or 配列。部分一致・小文字比較 */
  textFilter?: string | string[];
  /** true: offsetHeight !== 0 のみ, false: === 0 のみ */
  displayFilter?: boolean;
  /** true: 別ドキュメント（iframe）内のみ, false: 同一ドキュメントのみ */
  iframeFilter?: boolean;
  childFilter?: ComFindConfig;
  childFilterNegate?: boolean;
  styleFilters?: ComStyleFilter[];
  /** 入れ子の探索設定（slide 等） */
  target?: ComDomSelector;
}

export interface ComFindConfig {
  parent?: ComDomSelector | null;
  target?: ComDomSelector;
}

export interface ComMatcher extends ComFindConfig {
  type?: string;
  onMatcher?: ComFindConfig;
  offMatcher?: ComFindConfig;
  url?: string | string[];
  /** 結果を反転する（css / checkbox のみ。未知 type は否定しない） */
  negated?: boolean;
}

export interface ComAction extends ComFindConfig {
  type?: string;
  actions?: ComAction[];
  action?: ComAction;
  trueAction?: ComAction;
  falseAction?: ComAction;
  consents?: ComConsent[];
  method?: string;
  waitTime?: number;
  retries?: number;
  negated?: boolean;
  noTimeout?: boolean;
  forceHide?: boolean;
  hideFromDetection?: boolean;
  ignoreOldRoot?: boolean;
  openInTab?: boolean;
}

export interface ComConsent {
  type?: string;
  matcher?: ComMatcher;
  toggleAction?: ComAction;
  trueAction?: ComAction;
  falseAction?: ComAction;
  description?: string;
}

export interface ComMethod {
  name?: string;
  action?: ComAction;
}

export interface ComDetector {
  presentMatcher?: ComMatcher | ComMatcher[];
  showingMatcher?: ComMatcher | ComMatcher[];
}

export interface ComRule {
  detectors?: ComDetector[];
  methods?: ComMethod[];
}
