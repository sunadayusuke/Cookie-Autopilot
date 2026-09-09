// 文言の語彙表（docs/SPEC.md §5-5-d）
//
// 判定対象は normalize() 済みのテキスト（= 空白が除去され小文字化されている）。
// そのため SPEC の語彙にある半角スペースはすべて `\s*` として表現している
// （例: "accept all" → /accept\s*all/ で "acceptall" に一致する）。
// 完全一致の語彙は normalize() を通してから比較する。
//
// 容器の可視テキスト（正規化前）に対する判定は BANNER_WORDS / COOKIE_WORDS /
// DANGEROUS_CONTEXT / AGE_GATE_CONTEXT の 4 つ。COOKIE_WORDS は「Cookie バナーだと
// 言い切れる語」で、非表示（display:none）や汎用文言（OK・はい・閉じる）のクリックは
// これがある容器に限る。AGE_GATE_CONTEXT はその汎用文言を打ち消す側の語。

import { normalize } from '../engine/normalize';

/**
 * バナー語（容器の可視テキストに含まれることを要求する）。
 * 「データの利用」「情報の利用」「data protection」のように cookie / 同意 / プライバシー を
 * 一度も書かない同意画面があるので、容器の入口だけ広げてある。ここを広げても押す・隠すの
 * 条件は `cookieSpecific` のままなので、採用される容器が増えるだけで安全側は変わらない。
 */
export const BANNER_WORDS =
  /cookie|クッキー|同意|consent|プライバシー|privacy|gdpr|トラッキング|tracking|個人情報|データの利用|データ利用|情報の利用|お客様のデータ|data\s*protection/i;

/**
 * Cookie 固有語。バナー語のうち「Cookie バナー以外ではまず出てこない」もの。
 * 同意・privacy・個人情報・consent は規約ダイアログ・フォーム・ヘッダーにも頻出するため含めない。
 */
export const COOKIE_WORDS = /cookie|クッキー|gdpr/i;

/**
 * 強い容器ヒント。id / class / aria-label がこれを含む要素は、それだけで
 * 「Cookie バナーの容器」と言い切れるので、可視テキストの Cookie 固有語を要求しない。
 */
export const CONTAINER_HINT = /cookie|クッキー|gdpr|qc-cmp|cmpbox|cmp-ui|cmp-container|__cmp/i;

/**
 * 汎用の容器ヒント。`consent` `privacy` は規約更新モーダル（`class="consent-modal"`
 * `class="privacy-modal"`）にも使われるため、dialog / position と同じく
 * テキストに Cookie 固有語があるときだけ有効。
 */
export const CONTAINER_HINT_GENERIC = /consent|privacy/i;

/** 弱い容器ヒント。汎用的すぎるので、テキストに Cookie 固有語があるときだけ有効 */
export const CONTAINER_HINT_WEAK = /banner|notice/i;

/**
 * 危険文脈語。容器の可視テキストに含まれていたら、その容器のボタンは 1 つも押さない。
 * 決済・削除・認証などのダイアログを Cookie バナーと取り違えたときの保険。
 * ただし Cookie 固有語のある容器（= Cookie バナーと言い切れる容器）には適用しない（detect.ts）。
 * `order` は英語バナー定番の "We use cookies in order to …" に当たるため、`remove` ともども入れない。
 */
export const DANGEROUS_CONTEXT =
  /削除|delete|支払|payment|購入|注文|パスワード|password|ログアウト|退会|解約|送信|決済/i;

/**
 * 年齢確認・医療従事者確認のゲート語。容器の可視テキストに含まれていたら、その容器では
 * 弱一致（許可の弱一致・拒否の弱一致・閉じる語）を使わない。
 * 酒類・製薬サイトの全面ゲート（"Are you over 18? [Yes] [No]" ＋ 小さく "This site uses
 * cookies…"）は Cookie 固有語を持つので容器として採用されてしまい、そのまま弱一致を許すと
 * reject で "No"（＝サイトから追い出される）、accept で "Yes"（法的な自己申告の代行）を
 * 押してしまうため。`age` は "manage" "storage" "message" に部分一致するので語境界で見る。
 */
export const AGE_GATE_CONTEXT =
  /\b(18|21)\b|\bage\b|of\s*legal|healthcare\s*professional|medical\s*professional|年齢|歳以上|未成年/i;

/**
 * 入口ゲート・年齢ゲートの**属性**（id / class / aria-label）。
 * 可視テキストを見る AGE_GATE_CONTEXT とは別物で、こちらは「この要素は Cookie の容器では
 * なくサイトの入口ゲートだ」と言い切るために使う（detect.ts の evaluateContainer のハード条件）。
 * lego.com の入口選択ダイアログ `DIALOG.AgeGate_age-gate__wrapper__ph949` は
 * 「LEGO.com に入ります［続ける］／プレイゾーン」の目的地選択に Cookie の説明文が添えてある
 * だけで、同意画面ではない。容器にすると決定候補が「続ける」しか無く、`no-reject` の
 * 未処理サイトとして報告してしまう。
 * 先頭を `(?:^|[^a-z])` にしているのは、`manage-gateway` `page-gateway` のような語に
 * `age-gate` が部分一致するのを防ぐため（語の途中から始まる一致は取らない）。
 * 区切りは `[-_\s]?` で、id/class のハイフン・アンダースコアだけでなく、判定対象に含まれる
 * aria-label の**空白区切り**（`aria-label="Age verification"` `"Age gate"` `"Date of birth"`）
 * にも当たるようにしている。`age[-_\s]?gate` が区切りなしの `agegate` も包含するので、
 * 冗長だった `agegate` の選択肢は削除した。
 */
export const AGE_GATE_ATTRIBUTE =
  /(?:^|[^a-z])(?:age[-_\s]?gate|age[-_\s]?verif|age[-_\s]?check|birth[-_\s]?date|date[-_\s]?of[-_\s]?birth|entry[-_\s]?gate)/i;

/**
 * 完了状態の文言。「これから同意を求める画面」ではなく「もう選び終わったことを伝える案内」の印。
 * theguardian.com の「You've chosen to reject third-party cookies while browsing our site.
 * ［Collapse banner］」を Cookie 同意画面として扱うと、押せるボタンが無いまま
 * `unhandled` として報告してしまう（popup で未処理サイトに見える）。
 * 単独では使わず、**決定ボタンが閉じる語・折りたたみ語しか無いこと**と併せて判定する
 * （「…に同意しましたか？［同意する］［同意しない］」のような同意要求に当てないため）。
 */
export const SETTLED_NOTICE =
  /you.?ve\s*chosen\s*to\s*reject|you\s*have\s*rejected|already\s*(?:rejected|accepted)|consent\s*(?:choice\s*)?saved|設定を保存しました|拒否しました|同意しました|受け付けました/i;

/**
 * 禁止語（HARD）。どの経路でも絶対に押さない。
 * 押すと取り返しがつかない操作（購入・決済・削除・認証・送信）だけを入れる。
 */
export const FORBIDDEN_HARD =
  /購入|buy|checkout|pay|支払|決済|payment|注文|order|削除|delete|remove|login|ログイン|sign\s*in|sign\s*up|登録|register|subscribe|購読|unsubscribe|退会|解約|振込|送金|transfer|donate|寄付|送信|submit/i;

/**
 * 禁止語（SOFT）。ヒューリスティックでだけ避ける語。
 * Cookie 設定画面の「保存して閉じる」「Save and exit」「Apply」など正当なボタンにも当たるので、
 * ユーザーが明示的に教えたボタン（カスタムルール）には適用しない。
 */
export const FORBIDDEN_SOFT = /保存|save|apply|申し?込|予約|book|reserve|投稿|post|publish|公開|解除/i;

/**
 * 非決定語（設定・詳細系。決定ボタンとして扱わない）。
 * `confirm` は OneTrust の設定画面の保存（"Confirm my choices"）に、`確定` は日本語 CMP の
 * 「選択を確定」に使われる Cookie バナーの語なので、禁止語ではなくこちらに置く
 * （= 自動では押さないが、教えたボタンとしては使える）。「注文を確定」は `注文` が HARD 禁止語。
 * `一覧` `list` `各社` `ベンダー` `advanced` は「パートナー一覧」「Vendor list」「詳細設定」の
 * ような**開くだけ**のボタンよけ（`詳細設定` は `詳細`、`パートナー一覧` は `一覧` に当たる）。
 * `オプション`（TrustArc 日本語版の設定導線）はここには入れていない——「オプションのCookieを
 * 拒否」のような**総量マーカーの無い拒否ボタン**まで非決定語にして決定候補から落としてしまう
 * ため（`overridesNonDecision` は `すべて` / `全て` / `all` / `everything` を要求する）。
 * 設定導線を見つけるのに必要なのは下の SETTINGS_BUTTON 側だけで足りる。
 */
export const NON_DECISION =
  /設定|settings?|manage|preferences?|customi[sz]e|詳細|learn\s*more|more\s*(info|options)|詳しく|ポリシー|policy|カスタマイズ|選択|options|confirm|確定|cancel|キャンセル|choose|choices|adjust|configure|purposes|vendors|partners|details|read\s*more|find\s*out\s*more|change|select|show|view|see\s*more|more\s*info|information|privacy\s*cent(er|re)|cookie\s*policy|do\s*not\s*sell|dont\s*sell|personal\s*information|about|why|一覧|list|各社|ベンダー|advanced/i;

/**
 * 非決定語のうち「設定画面を開くボタン」だけを指す語。
 * reject モードで閉じる語（"Continue"）を押してよいかの判断に使う。
 * `learn more` `policy` `about` のような情報リンクは、あっても「選ぶ余地がある」ことには
 * ならないので含めない。
 * `オプション` は英語の `options` に対応する日本語。TrustArc 日本語版の設定導線
 * 「オプションの続き」を設定ボタンとして認識するために足した。IBM の実ログの
 * `panel-aborted` は**パネルを実際に開いたあとの中止**を意味する理由コードなので
 * （`src/engine/run.ts` の `fallbackReason`。設定ボタンが見つからなければ理由は `no-reject`
 * になる）、あのサイトで設定導線（`#truste-show-consent`）自体が見つかっていなかったとは
 * 言えない（実 DOM を取得できないため真因は未確定。docs/SPEC.md の
 * 「実サイト巡回・第2巡の反映」参照）。これは同型の構造——設定導線がカタカナの
 * 「オプション」表記しか無い CMP——への備えとして持つ。
 */
export const SETTINGS_BUTTON =
  /settings?|manage|preferences?|customi[sz]e|options|choices|configure|adjust|設定|カスタマイズ|オプション/i;

/**
 * 総量マーカー。非決定語より決定語を優先してよいのは、
 * 「すべて〜」と総量を明示している文言（"Accept all purposes" "Reject all vendors"）だけ。
 * これが無いと "Manage or reject cookies" のような設定ボタンまで決定ボタンになってしまう。
 */
export const TOTALITY = /all|everything|すべて|全て/i;

/**
 * 否定形。許可語の言い回しを含んでいても拒否ボタンだと言い切れる印
 * （"Do not accept all" "Continue without accepting"）。
 */
export const NEGATION = /donot|dont|without|never/i;

/**
 * 拒否語（強一致）。
 * `don't accept` は normalize が `'` を落とすので `dont\s*accept` で受ける。
 * `do not consent` / `dont consent` / `withdraw consent` は Google Funding Choices の
 * 拒否ボタン文言そのもの。`object to` は IAB TCF の「Object to legitimate interest」に当たる。
 * これらが無いと ACCEPT_STRONG_BARE の `consent` に部分一致してしまい、
 * isAcceptStrong の拒否語ガード（下記）をすり抜けて許可語として押されてしまう。
 * `disable` / `turn off` は「Disable non-essential cookies」「Turn off all」のような
 * トグル型の拒否ボタン向け（`disable\s*all` は `disable` に包含されるので置き換えた）。
 * `disable` は過去形を除く（`disable(?!d)`）。"I've disabled my ad blocker" のような
 * 「もう切ってある」文言を拒否ボタンにしないため。
 * `オフにする` `無効にする` `利用しない` `使用しない` は日本語のトグル型の拒否ボタン、
 * `turn all off` は "Turn all off"（`turn\s*off` は空白を挟まない並びしか見ないので別に要る）、
 * `without accepting` は "Browse without accepting"（`continue without` の変種）向け。
 * `reject non-essential` `decline all` `deny all` `refuse all` `opt out of all` は
 * すでに裸の `reject` `decline` `deny` `refuse` `opt out` に当たるので足していない。
 */
export const REJECT_STRONG =
  /拒否|拒絶|お断り|同意しない|許可しない|承諾しない|承認しない|受け入れない|利用しない|使用しない|オフにする|無効にする|同意せずに(?:続ける|進む)|(?:すべて|全て)解除|選択を解除|オプトアウト|辞退|reject|decline|deny|refuse|disagree|opt\s*out|do\s*not\s*accept|dont\s*accept|do\s*not\s*agree|dont\s*agree|do\s*not\s*allow|dont\s*allow|do\s*not\s*consent|dont\s*consent|withdraw\s*consent|object\s*to|disable(?!d)|turn\s*off|turn\s*all\s*off|continue\s*without|without\s*accepting/i;

/**
 * 拒否語（必要最小系）。語順は問わない
 * （"Necessary cookies only" も "Accept only necessary" も同じ意味）。
 * `(accept|allow|use|enable)…(necessary|essential|required)` は "Accept necessary cookies"
 * のように `only` が付かない必要最小ボタン向け（正規化で空白は消えるので `\s*` は形式上）。
 * 直後に `all` が来る "Accept all necessary and optional" には当たらない。
 * `必要な項目のみ` `必須のみ` `only the strictly necessary` `necessary cookies only` は
 * すでに `必要な.*のみ` `必須.*のみ` `only.*necessary` `necessary.*only` に当たるので足していない。
 */
export const REJECT_MINIMAL =
  /必要なもののみ|必要な.*のみ|必要最小限|必須.*のみ|必要不可欠.*のみ|最低限.*(?:のみ|だけ)|基本的な.*のみ|necessary.*only|only.*necessary|essential.*only|only.*essential|required.*only|only.*required|strictly\s*necessary|minimum\s*(?:only|cookies)|(?:accept|allow|use|enable)\s*(?:the\s*)?(?:strictly\s*)?(?:necessary|essential|required)(?!.*(?:optional|analytic|marketing|advertis|performance|targeting|statistic|preference|all|everything|non))|functional.*only|only.*functional|technical.*only|mandatory.*only|only.*mandatory/i;

/**
 * 拒否語（弱一致。完全一致のみ）。容器に Cookie 固有語があるときだけ有効。
 * "No thanks" "Not now" はニュースレター・通知の許可ダイアログにも頻出するため、
 * ACCEPT_WEAK_EXACT と対称に Cookie 固有語ゲートの内側でだけ候補にする。
 * 裸の `no` は入れない（ACCEPT_WEAK_EXACT の `yes` と対称）。酒類・製薬サイトの
 * 年齢確認ゲート「Are you over 18? [Yes] [No]」で "No" を押すとサイトから追い出されるため。
 */
export const REJECT_WEAK_EXACT: readonly string[] = [
  // "No, thanks" は normalize でカンマが落ちて 'no thanks' と同じになる
  'no thanks',
  'no thank you',
  'not now',
  'later',
  'maybe later',
  'skip',
].map((w) => normalize(w));

/**
 * 許可語（強一致）のうち、Cookie バナー以外ではまず使われない具体的な言い回し。
 * 容器に Cookie 固有語が無くても押してよいのはこちらだけ。
 * 「すべて〜」の総量を明示する言い回しに限る（Cookie バナー以外の同意ダイアログは
 * 対象が 1 つなので「すべて」とは言わない）。cookie を名指しする "Accept cookies"
 * "Allow cookies" もここに入れる（`isAcceptStrongSpecific` は COOKIE_WORDS でも真に
 * なるが、`isAmbiguousReject` はこの正規表現だけを見るため。連結テキストで拒否語に
 * 化けた許可ボタンを reject モードの候補から外すのに要る）。
 * `すべてを受け入れる` `i accept all` は先頭の言い回し・`accept all` に当たるので足していない。
 */
export const ACCEPT_STRONG_SPECIFIC =
  /(?:すべて|全て)(?:の(?:cookie|クッキー))?(?:に|を)?(?:同意|許可|受け入れる)|全部(?:に)?(?:同意|許可)|accept\s*all|allow\s*all|enable\s*all|agree\s*(?:to\s*)?(?:all|everything)|accept\s*everything|allow\s*everything|yes\s*to\s*all|enable\s*cookies|accept\s*(?:all\s*)?cookies|allow\s*(?:all\s*)?cookies/i;

/**
 * 許可語（強一致）のうち、対象を限定しない言い回し。
 * 「同意する」「Accept」は規約更新モーダルやフォームの決定ボタンにも使われるため、
 * 容器に Cookie 固有語があるか、文言自体が cookie を含むときだけ押す。
 * `enable` は裸では入れない（"Enable notifications" のような Cookie と無関係な
 * トグルまで拾ってしまうため）。"Enable cookies" は ACCEPT_STRONG_SPECIFIC 側の
 * `enable\s*cookies` で拾う（"Enable all" は同じく specific 側の `enable\s*all`）。
 */
export const ACCEPT_STRONG_BARE =
  /同意する|同意します|承諾する|承諾|許可する|受け入れる|agree|i\s*agree|accept|allow|consent/i;

/** 許可語（強一致） */
export const ACCEPT_STRONG = new RegExp(
  `${ACCEPT_STRONG_SPECIFIC.source}|${ACCEPT_STRONG_BARE.source}`,
  'i',
);

/**
 * 許可語（弱一致。完全一致のみ）。容器に Cookie 固有語があるときだけ有効。
 * `continue` は「次へ」の意味でフォームにも頻出するので一度外していたが、
 * 現在は ①容器の Cookie 固有語ゲート ②テキスト入力を含む容器の除外（detect.ts の
 * wrapsTextInput）で守られているため、Cookie 語のある容器の中に限って戻している。
 * "By continuing to browse, you accept our use of cookies. [Continue]" のような
 * 英語バナーがこれで押せる。
 * 裸の `yes` は入れない。酒類・製薬サイトの年齢確認ゲート「Are you over 18? [Yes] [No]」で
 * "Yes" を押すのは法的な自己申告の代行になるため。
 * "Agree and continue" は isAcceptStrong が先に当たる（採点でここまで来ない）ので入れない。
 */
export const ACCEPT_WEAK_EXACT: readonly string[] = [
  '同意',
  '許可',
  'ok',
  'okay',
  'はい',
  'got it',
  'understood',
  'i understand',
  'continue',
  'sure',
  'fine',
  'alright',
  'thats fine',
].map((w) => normalize(w));

/**
 * 通知のみバナーの閉じる語（完全一致）。容器に Cookie 固有語があるときだけ有効。
 * "OK, got it" は normalize でカンマが落ちて `okgotit` になる。
 * `内容を理解した` `理解した` `了承しました` `確認しました` は、拒否ボタンも設定ボタンも
 * 持たない日本語の通知型 Cookie ダイアログ（dailymotion.com 型）の唯一のボタン。
 * `わかりました` `understood` と同じ「読んだことを伝えるだけ」の語で、完全一致かつ
 * Cookie 固有語ゲートの内側でしか使わない。
 */
export const CLOSE_EXACT: readonly string[] = [
  'ok',
  'okay',
  '閉じる',
  '了解',
  'わかりました',
  '内容を理解した',
  '理解した',
  '了承しました',
  '確認しました',
  'got it',
  'understood',
  'i understand',
  'close',
  'dismiss',
  'continue',
  'ok got it',
  'okay got it',
  'hide',
  'hide this message',
  'hide notice',
  'hide notification',
  'close this notice',
  'no problem',
  'fine',
  'sure',
  'alright',
  '×',
  '✕',
  'x',
].map((w) => normalize(w));

/**
 * 折りたたみ語（完全一致）。**完了状態の案内かどうかの判定にしか使わない**
 * （SETTLED_NOTICE と組で見る。isCollapseWord）。
 * CLOSE_EXACT には入れない——「折りたたむ」は同意画面を閉じる操作とは限らず、
 * 自動で押してよい語だとは言い切れないため。
 */
export const COLLAPSE_EXACT: readonly string[] = [
  'collapse',
  'collapse banner',
  'collapse this banner',
  'hide banner',
  '折りたたむ',
  'バナーを折りたたむ',
].map((w) => normalize(w));

export interface ForbiddenOptions {
  /**
   * true（既定）= ヒューリスティックの判定。HARD + SOFT の両方を見る。
   * false = ユーザーが明示的に教えたボタン（カスタムルール・picker）の判定。HARD だけを見る。
   */
  strict?: boolean;
}

/** 正規化済みテキストが禁止語を含むか */
export function isForbidden(normalized: string, options: ForbiddenOptions = {}): boolean {
  if (normalized === '') return false;
  if (FORBIDDEN_HARD.test(normalized)) return true;
  if (options.strict === false) return false;
  return FORBIDDEN_SOFT.test(normalized);
}

/** どの経路でも押してはいけない語か（カスタムルール・picker で使う） */
export function isForbiddenHard(normalized: string): boolean {
  return isForbidden(normalized, { strict: false });
}

/** 正規化済みテキストが非決定語（設定・詳細系）か */
export function isNonDecision(normalized: string): boolean {
  return normalized !== '' && NON_DECISION.test(normalized);
}

/** 正規化済みテキストが設定画面を開くボタンか（reject モードの閉じる語の判断に使う） */
export function isSettingsButton(normalized: string): boolean {
  return normalized !== '' && SETTINGS_BUTTON.test(normalized);
}

export function isRejectStrong(normalized: string): boolean {
  return normalized !== '' && REJECT_STRONG.test(normalized);
}

export function isRejectMinimal(normalized: string): boolean {
  return normalized !== '' && REJECT_MINIMAL.test(normalized);
}

/** 拒否語（弱一致。完全一致のみ）。Cookie 固有語のある容器の中でしか使わない */
export function isRejectWeak(normalized: string): boolean {
  return REJECT_WEAK_EXACT.includes(normalized);
}

/**
 * 許可語（強一致）。ただし拒否語に一致するものは許可語として扱わない。
 * 「承諾しない」が ACCEPT_STRONG の `承諾` に部分一致してしまうため
 * （accept モードで拒否ボタンを押さないための保護）。
 */
export function isAcceptStrong(normalized: string): boolean {
  if (normalized === '') return false;
  if (isRejectStrong(normalized) || isRejectMinimal(normalized)) return false;
  return ACCEPT_STRONG.test(normalized);
}

/**
 * 容器に Cookie 固有語が無くても押してよい許可語か。
 * 具体的な言い回し（「すべて許可」「Accept all」）か、文言自体が cookie を含むもの（"Accept cookies"）。
 * 「同意する」だけの規約更新モーダルを押さないための最後の砦なので、ここは絞ったままにする。
 */
export function isAcceptStrongSpecific(normalized: string): boolean {
  if (!isAcceptStrong(normalized)) return false;
  return ACCEPT_STRONG_SPECIFIC.test(normalized) || COOKIE_WORDS.test(normalized);
}

export function isAcceptWeak(normalized: string): boolean {
  return ACCEPT_WEAK_EXACT.includes(normalized);
}

/**
 * 拒否候補にしてはいけない曖昧な文言か。
 * 「すべて許可」系の言い回し（ACCEPT_STRONG_SPECIFIC）を含むのに否定形が無いもの。
 * `<button>Accept all<small>You can opt out at any time</small></button>` のような
 * サブキャプション付きの許可ボタンが、連結テキストの `optout` で拒否語に化けるのを防ぐ。
 * "Do not accept all" のように否定形があるものは拒否ボタンなので除かない。
 */
export function isAmbiguousReject(normalized: string): boolean {
  if (normalized === '') return false;
  if (NEGATION.test(normalized)) return false;
  return ACCEPT_STRONG_SPECIFIC.test(normalized);
}

/**
 * 非決定語（設定・詳細系）を無視してよい決定語か。
 * 必要最小系（"Accept only necessary"）か、総量マーカーを伴う許可の specific 一致・
 * 拒否の強一致（"Accept all purposes" "Reject all vendors"）だけを決定ボタンに戻す。
 * 総量マーカーを要求しないと "Manage or reject cookies"（押しても設定パネルが開くだけ）
 * まで決定ボタンになってしまう。
 */
export function overridesNonDecision(normalized: string): boolean {
  if (isRejectMinimal(normalized)) return true;
  if (!TOTALITY.test(normalized)) return false;
  return isAcceptStrongSpecific(normalized) || isRejectStrong(normalized);
}

export function isCloseWord(normalized: string): boolean {
  return CLOSE_EXACT.includes(normalized);
}

/** 折りたたみ語（完全一致）。完了状態の案内かどうかの判定にだけ使う（自動では押さない） */
export function isCollapseWord(normalized: string): boolean {
  return COLLAPSE_EXACT.includes(normalized);
}

/** 汎用文言（OK・はい・閉じる・No thanks 等）。Cookie 固有語のある容器の中でしか押さない */
export function isGenericPhrase(normalized: string): boolean {
  return isAcceptWeak(normalized) || isCloseWord(normalized) || isRejectWeak(normalized);
}

/** 容器の可視テキストがバナー語を含むか */
export function hasBannerWord(text: string): boolean {
  return BANNER_WORDS.test(text);
}

/** 容器の可視テキストが Cookie 固有語を含むか */
export function hasCookieWord(text: string): boolean {
  return COOKIE_WORDS.test(text);
}

/** 容器の可視テキストが危険文脈語を含むか */
export function hasDangerousContext(text: string): boolean {
  return DANGEROUS_CONTEXT.test(text);
}

/** 容器の可視テキストが年齢確認・医療従事者確認のゲート語を含むか */
export function hasAgeGateContext(text: string): boolean {
  return AGE_GATE_CONTEXT.test(text);
}

/** 容器の可視テキストが完了状態（もう選び終わった）の文言を含むか */
export function hasSettledNotice(text: string): boolean {
  return SETTLED_NOTICE.test(text);
}

/** id / class / aria-label が強い容器ヒント（cookie 系）を含むか */
export function hasContainerHint(value: string): boolean {
  return CONTAINER_HINT.test(value);
}

/** id / class / aria-label が汎用の容器ヒント（consent / privacy）を含むか */
export function hasGenericContainerHint(value: string): boolean {
  return CONTAINER_HINT_GENERIC.test(value);
}

/** id / class / aria-label が弱い容器ヒント（banner / notice）を含むか */
export function hasWeakContainerHint(value: string): boolean {
  return CONTAINER_HINT_WEAK.test(value);
}

/** id / class / aria-label が入口ゲート・年齢ゲートの印を含むか（容器にしない判断に使う） */
export function hasAgeGateAttribute(value: string): boolean {
  return AGE_GATE_ATTRIBUTE.test(value);
}
