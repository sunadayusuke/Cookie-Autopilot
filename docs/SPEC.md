# Cookie Autopilot — 仕様 v1

Cookie 同意バナーを、ユーザーが一度決めた方針どおりに自動で処理し、**バナーをサイト上に見せない** Chrome 拡張（Manifest V3。Arc 等 Chromium 系でも動作）。
3 層で拾う: ① Consent-O-Matic の公開ルール（MIT）を流用した CMP 精密処理、② 「Cookie・同意」などの文言ヒューリスティック（独自実装向け）、③ ユーザーがボタンを教える機能。UI はすべて日本語。

## 1. 技術スタック

- TypeScript（strict）、パッケージマネージャは pnpm
- バンドル: esbuild（`scripts/build.mjs`、`--watch` 対応）。エントリは content / background / popup / options の 4 つ。`public/` を `dist/` にコピー
- テスト: Vitest + jsdom。エンジンは DOM とオプション（可視判定などの関数）を注入できる純粋関数として実装し、jsdom で検証できるようにする
- UI: フレームワークなし。素の HTML + CSS + TS。CSS はカスタムプロパティでトークン化（ユーザーはデザイナーで、後から自分で調整する）
- 依存は最小限: `esbuild` `typescript` `vitest` `jsdom` `@types/chrome` `pngjs`（アイコン生成のみ）
- `git init` と `.gitignore` は行うが **commit はしない**
- ネットワーク取得は curl ではなく Node スクリプト（`fetch`）で行う

## 2. ディレクトリ構成（目安）

```
cookie-autopilot/
  public/            manifest.json, popup.html, options.html, *.css, icons/, rules/consent-o-matic.json
  src/
    shared/          types.ts, storage.ts（読み書き・デフォルト）, siteKey.ts, messages.ts, phrases.ts
    engine/          normalize.ts, deepQuery.ts（shadow DOM 横断）, detect.ts（容器検出）, candidates.ts（ボタン候補と採点）,
                     cmpQuick.ts（既知 CMP の即決セレクタ表 = cloak にも使う）, com/（Consent-O-Matic ルール解釈器: tools.ts, actions.ts, engine.ts）,
                     cloak.ts（バナーを見せない制御）, panel.ts（設定パネルを開いてチェックを外す層）, run.ts（処理パイプライン）
    content/         index.ts（起動・MutationObserver・メッセージ受信）, picker.ts（ボタンを教える UI）
    background/      index.ts（service worker: ステータス保存・バッジ・ルール取得と更新）
    popup/           popup.ts
    options/         options.ts
    ui/              presetPicker.ts, categoryTable.ts（onboarding / options 共用の UI 部品）
  fixtures/          動作確認用の静的 HTML（後述）
  scripts/           build.mjs, gen-icons.mjs, fetch-com-rules.mjs, serve-fixtures.mjs
  third_party/consent-o-matic/LICENSE   （MIT ライセンス本文と出典 URL）
  test/              *.test.ts
  docs/SPEC.md       本ファイル
  README.md          日本語。インストール手順（chrome://extensions → デベロッパーモード → dist を読み込む）、使い方、仕組み、既知の限界、Consent-O-Matic との併用可否
```

## 3. データモデル

用語とプリセットの定義は §14.1、カテゴリの表示名は §14.2 を参照（本節は §14 に合わせてある）。

```ts
type Mode = 'reject' | 'accept' | 'off';
// reject = 必要なもののみ（断る）, accept = すべて許可, off = 何もしない
// 実効モードは off か reject のどちらかで、accept はエンジン内部と fixtures（`?mode=accept`）
// のためだけに残す。UI からは作れない（§14.1）

// カテゴリ（Consent-O-Matic のカテゴリと同じ。記号は UI に出さない。表示名は §14.2）
// A: 設定の記憶, B: アクセス解析, D: 端末への保存, E: おすすめの表示, F: 追跡型の広告, X: その他
type CategoryKey = 'A' | 'B' | 'D' | 'E' | 'F' | 'X';  // = ComCategory
type Preset = 'strict' | 'minimal' | 'relaxed';        // しっかり守る / ほどよく守る / ゆるく守る

interface Settings {                        // chrome.storage.sync
  preset: Preset | 'custom';                // 既定 'minimal'。カテゴリを個別に変えると 'custom'
  allowCategories: Record<CategoryKey, boolean>; // 実効の許可カテゴリ。既定は A だけ true（= minimal）
  onboarded: boolean;                       // 初期設定を終えたか。既定 false
  fallbackWhenNoReject: 'leave' | 'hide';   // 断れなかったときの挙動。既定 'hide'（同意画面を見せないのが目的）
  showBadge: boolean;                       // 既定 true
  debug: boolean;                           // 既定 false。console.debug('[cookie-autopilot] ...')
  observeSeconds: number;                   // 同意画面の出現を監視する秒数。既定 20
}
type SiteOverride =                         // サイトごとの設定（§14.9）。未設定 = 全体の設定に従う
  | { kind: 'custom'; allow: Record<CategoryKey, boolean> }  // このサイトだけ項目ごとに調整
  | { kind: 'off' };                        // このサイトでは動かさない
type SiteOverrides = Record<string, SiteOverride>; // chrome.storage.sync。key = siteKey(hostname)
interface CustomRule {                      // chrome.storage.sync の cr:<host> = CustomRule[]
  id: string; host: string;                 // host = siteKey
  action: 'reject' | 'accept';              // accept は既存データ用（UI からは作れない）
  selector?: string;                        // 安定セレクタ（無い場合あり）
  text?: string;                            // 正規化済みボタン文言（フォールバック。shadow DOM 内でも効く）
  createdAt: number;
}
// chrome.storage.local: comRules = { fetchedAt: number, source: string, rules: Record<string, ComRule> }
// chrome.storage.session: tab:<tabId> = { host, status, method, action, clickedText, decision, allowed, at }
// 単一キー（customRules / tabStatus）は使わない。前者は 8KB/item の QUOTA_BYTES_PER_ITEM に
// 触れるため host 単位に、後者は read-modify-write が競合するためタブ単位に分割している。
// storage.onChanged の購読側は 'cr:' / 'tab:' の前方一致で判定する
type TabStatusKind = 'handled' | 'unhandled' | 'none' | 'off' | 'watching';
// watching = 監視窓を開いた直後（結果はまだ）。トップフレームだけが送る
type Decision = 'granular' | 'reject-all' | 'custom' | 'dismissed' | 'hidden';  // 何をしたか。§14.6
```

- **実効モード** `effectiveMode(host)`: `siteOverrides[siteKey]` が `'off'` なら `'off'`、それ以外は常に `'reject'`
- **実効カテゴリ** `effectiveCategories(host)`: `siteOverrides[siteKey]` がプリセットならそのカテゴリ（§14.1 の表）、無ければ `settings.allowCategories` の true 集合
- 保存済みデータの移行は §14.1 の「移行」に従う（旧 `defaultMode` / `rejectAllowCategories` は捨て、`fallbackWhenNoReject: 'accept'` は `'hide'`、override の `'reject'` は `'strict'`、`'accept'` は削除）
- `siteKey(hostname)`: 登録可能ドメイン（eTLD+1）の近似。`co.jp ne.jp or.jp ac.jp go.jp lg.jp ed.jp co.uk org.uk ac.uk com.au net.au com.br com.cn co.kr co.nz co.in` 等の 2 段 TLD リストを持ち、それらは 3 ラベル、それ以外は 2 ラベル残す。`www.tesla.com` → `tesla.com`、`shop.example.co.jp` → `example.co.jp`、`localhost` → `localhost`

## 4. Consent-O-Matic ルールの流用

- 出典: https://github.com/cavi-au/Consent-O-Matic （MIT）。`rules-list.json`（各ルール JSON への URL 配列、約 360 件）
- `scripts/fetch-com-rules.mjs`: rules-list を取得 → 各ルールを並列 8 で取得 → 1 つのオブジェクト `{ [ruleName]: rule }` に統合 → `public/rules/consent-o-matic.json` に `{ fetchedAt, source, rules }` で保存。取得失敗は名前を列挙して警告し、成功分だけ保存。LICENSE も取得して `third_party/consent-o-matic/LICENSE` に保存。`pnpm rules:fetch` で実行し、初回ビルド前に一度実行して同梱する
- **解釈器（`src/engine/com/`）**: 実際のルール JSON を数件読み、フィールド名を確認してから実装する。必要な範囲:
  - `detectors[]`: `presentMatcher` と `showingMatcher`（`showingMatcher` 省略時は present と同義）。CMP を「検出」= いずれかの detector で present かつ showing
  - Matcher `type`: `css`（target が見つかれば真）, `checkbox`（`checked` を返す）, `onoff`（`onMatcher` の対象が見つかれば真、`offMatcher` の対象が見つかれば偽。両方見つかれば真・どちらも見つからなければ偽で、いずれも debug ログ。`onMatcher` / `offMatcher` の中身は `css` と同じ探索設定）, `url`（`url` は文字列 or 配列。`location.href` にいずれかが部分一致すれば真。実ルールでは「対象ドメインの絞り込み」として `presentMatcher` の中で css matcher と AND で使われる）。未知の type は偽 + debug ログ
  - Matcher の `negated: true`（`css` / `checkbox` のみ）は結果を反転する。未知 type は `negated` でも真にしない（誤検出を増やさないため）
  - DomSelector: `selector`, `textFilter`（文字列 or 配列、部分一致・小文字比較）, `styleFilters[{option,value,negated}]`, `displayFilter`（`offsetHeight !== 0`）, `iframeFilter`, `childFilter`, `parent`。ルート（base）を差し替えられるようにする（foreach / runrooted 用）。querySelectorAll は shadow DOM を横断しない（Consent-O-Matic と同じ挙動で構わない）
  - `iframeFilter` は **要素**ではなく「**今の content script が動いているフレームが iframe か**」を見る（Consent-O-Matic 本体と同じ）。`iframeFilter: true` の探索設定はトップフレームでは常に 0 件、サブフレームでは素通し。`false` はその逆
  - Action `type`: `click`, `list`, `consent`, `ifcss`, `waitcss`（retries 既定 10, waitTime 既定 250ms, negated）, `foreach`, `hide`, `wait`, `ifallowall`, `ifallownone`, `runmethod`, `runrooted`, `multiclick`。`slide`・`close` は no-op + debug ログ。未知の type も no-op で例外を投げない
  - 暴走防止: 1 ルールの実行時間の上限は 15 秒。アクション開始時だけでなく **`waitcss` の待ちループの中でも** 上限と打ち切り要求（§5-7）を見る（実ルールには `retries: 100` × 250ms = 25 秒のものがある）
  - `consent` の各エントリ: `type`（カテゴリ）, `matcher` + `toggleAction`（現状 ≠ 望む状態なら toggle）または `trueAction` / `falseAction`（matcher があり既に一致していればスキップ）。望む状態 = accept モードなら true、reject モードなら実効カテゴリ（§3）に含まれるか
  - 「カテゴリごとに選べた」（§14.6 の `granular`）と数えるのは、**`matcher` が実際に要素へ解決したとき**（＝望む状態と同じでトグルを押さなかった場合を含む）か、**トグル / trueAction / falseAction で実際にクリックできたとき**だけ。consent エントリを通っただけでは数えない（そのカテゴリの UI が無いルールまで granular になってしまうため）
  - `ifallowall`: すべてのカテゴリの望む状態が true なら trueAction
  - `ifallownone`: すべてのカテゴリの望む状態が false（= 何も許可しない）なら trueAction、それ以外は falseAction
  - メソッド実行順: `HIDE_CMP`（無ければ present 要素を cloak）→ `OPEN_OPTIONS` → `DO_CONSENT` → `SAVE_CONSENT`。存在しないメソッドはスキップ。`UTILITY` は runmethod から呼ばれる
  - **この 4 メソッドのどれにも action が無いルール（`onetrust_banner` のように `UTILITY` だけを持つもの）は検出も実行もしない**（debug ログ）。実行しても必ず失敗し、成功判定の 1.5 秒を捨てるだけになるため
  - **cloak の制限**: `hide` アクションと present 要素の cloak では、`html` / `body`、および `main, [role=main], article, nav` を内包する要素を**拒否する**（debug ログ）。同梱ルールには `fastcmp` のように `HIDE_CMP = hide { selector: 'html' }` = ページごと隠すものがあり、そのまま従うとルールが空振りしたときにページが最大 `observeSeconds` 秒まるごと白紙になる
  - **失敗時の巻き戻し**: ルール単位で cloak した要素を覚えておき、`runRule` が失敗したらその集合を即 uncloak する（空振りしたルールの cloak を監視窓の終わりまで残さない）
  - 成功判定: 実行後 1.5 秒以内に showingMatcher が偽になる。偽にならなければ失敗として次の層へ
  - 1 回のページ処理で同じ CMP ルールは 1 度だけ試す
- **配布と更新**: `onInstalled` で同梱 JSON を `chrome.storage.local.comRules` にコピー（未保存のときのみ）。options の「ルールを更新」ボタンと `chrome.alarms` の週 1 回で GitHub から再取得して差し替える（raw.githubusercontent.com は CORS 許可されているので host_permissions 不要）。content script は `storage.local` から読む。`chrome` API が無い環境（fixtures）では `/rules/consent-o-matic.json` を相対 fetch し、失敗は無視

## 5. Content script の処理パイプライン

`manifest.content_scripts`: `matches: ["<all_urls>"]`, `run_at: "document_start"`, `all_frames: true`（Sourcepoint 等は iframe 内にバナーを出す）。

1. **cloak（見せない）**: document_start で、モードが off でなければ `<style data-cookie-autopilot>` を注入し、`cmpQuick.ts` の容器セレクタ群を `opacity:0 !important; pointer-events:none !important` にする（display:none にはしない。offsetHeight 判定と click を壊さないため）。ヒューリスティックや COM で検出した容器にも同じ cloak クラス（`data-cookie-autopilot-cloak` 属性）を付ける。容器を検出したのに押せる候補が無いときは即座に fallback せず、**初検出から `FALLBACK_GRACE_MS`（1 秒）は cloak したまま再試行する**（拒否ボタンが遅れて描画されるサイトで先に hide しないため）。1 秒経っても成功しなければ fallback を適用する（監視窓 `observeSeconds` が先に切れる場合はその時点）。
   処理が終わったら: 成功 → 属性と style を外す（サイト側が消している）。失敗 & `fallback=hide` → 下の条件を満たす場合だけ容器を `display:none !important` にする（`status:'handled', method:'hide'`）。失敗 & `fallback=leave`（および hide の条件を満たさないとき）→ cloak を外して見せ `status:'unhandled'`。監視時間切れで何も検出しなければ style を外す
   - **hide してよい条件**（Cookie バナー以外の固定 UI を消さないため。誤って消すと「サイトを壊す」ので厳しくする）:
     ① 容器の可視テキストに **Cookie 固有語** `/cookie|クッキー|gdpr/i` がある（`同意` `privacy` `個人情報` `consent` は規約ダイアログ・フォーム・ヘッダーにも頻出するので根拠にしない）
     ② その容器に「押さずに残した許可ボタン」がある（`scoreCandidates(容器のボタン, 'accept')` が 1 件以上）。拒否も許可も無い固定 UI はそもそもバナーではない
   - **hide の対象**: クリック候補を探すのは最小容器だが、消すのは **`findContainers()` の結果のうち採用容器を内包する最も外側の容器**（BEM の `.cookie-consent > .cookie-consent__actions` ではボタン行が最小容器になるため、そのまま消すとバナー本文だけが残る）。ただし**外側へ登る先は「①強い属性ヒント / ②汎用属性ヒント」を理由に候補になった容器に限る**（③dialog / ④position 起点の外側には登らない。`position: sticky` なヘッダーの中に cookie notice があるだけで、ヘッダーごと消してしまうため）。そこからさらに親方向へ「テキストが容器と同じ（＝他に中身がない）で computed position が fixed / absolute」の祖先を最大 5 階層辿った最上位を消す（モーダル型のバックドロップごと消すため）。`body` / `html` には決して達しない
     - 祖先まで登ったときは**容器自身も `display:none` にしたうえで**、その祖先を `childList` の MutationObserver で見張り、**バナー容器以外の要素が子に追加されたら祖先の hide だけ解除する**（`#modal-root` のようなポータルルートにサイトが後からモーダルを描くケースを壊さない。容器自身は消したままなのでバナーは戻らない）
     - hide するときは**その要素の inline `display` を覚えておき**（`data-cookie-autopilot-display`）、hide を解除するときはそこへ戻す（`#modal-root { display: flex }` のようにサイトが inline で持っていた指定を失わないため）
   - **候補も hide の見込みも無いまま層を抜けるとき**は cloak を外して見せる（見えないのに居座る状態にしない）。cloak を残してよいのは **reject モードで `fallback=hide`、かつ hide してよい条件（下記）を満たす容器**のときだけ（猶予後に消しうるため）。accept モードや `fallback=leave` では消える見込みが無いので必ず外す
   - **スクロールロックの復帰**: 最初のパスの冒頭（容器を触る前）に html / body の computed overflow と inline 値を記録し、hide の時点で「記録時は hidden でなかったのに今は hidden」の場合だけ解除する。まず記録した inline 値へ戻し、それでも hidden のまま（`body.modal-open` のようなクラス付与が原因で、inline に復元できる値が無い）なら inline に `overflow: auto !important` を当てて解除する。override を当てた要素は `class` / `style` 属性を MutationObserver で**一度だけ**見張り、サイト側が変更したら override を外して身を引く（サイトが自分のモーダル用にロックし直すのを邪魔しない。値をサイトが上書きしていたら触らない）。記録時から hidden だったもの（サイト設計の内部スクロール）は原則触らないが、**`document.scrollingElement.scrollHeight > innerHeight + 1`（スクロールすべき中身がある）** ときだけは SSR で最初から `body.no-scroll` が付いた cookie wall とみなし、記録の有無に関わらず同じ inline override を当てる。`scrollHeight <= innerHeight`（内部スクロール設計）なら触らない
2. 設定を読む。`chrome` 参照はすべてガードし、無ければ既定値で動く
3. 実効モード（§3）: `siteOverrides[siteKey]` が `'off'` なら `'off'`、それ以外は `'reject'`。`off` なら cloak を外し `status:'off'` を報告して終了。同時に実効カテゴリも決めてエンジンに渡す
4. 検出と操作: DOMContentLoaded 後に初回、その後 MutationObserver（トレーリング throttle。タイマーが張られていない間の変異でだけ張り直す。最短間隔 500ms・最短待ち 300ms）で `observeSeconds` 秒間再試行。パスの実行中に来た変異は `pending` にして完了後に 1 度だけ拾う（連続して変異するページでも再パスが走るようにする）。処理済みになったら監視終了。popup からの `rerun` で監視窓をやり直す
   - **画面遷移（SPA）でのやり直し**: `history.pushState` / `replaceState` を包み、`popstate` も聞いて、**URL のパス部分（`location.pathname`）が変わったら監視窓をやり直す**（`rerun` と同じ経路。設定も読み直す）。監視窓が終わったあとに遷移した先で出る同意画面を取りこぼさないため。クエリ・ハッシュだけの変化（絞り込み・タブ切り替え）では**やり直さない**。連続する遷移で暴発しないよう **1 秒のデバウンス**を掛け、**ページ滞在中のやり直しは 5 回まで**。`picker` 実行中は無視し、実効モードが `off`（＝ deps が無い）なら何もしない
     - content script は isolated world で動くので、`history` の差し替えが捕まえるのは**同じ world からの呼び出し**（＝ `content.js` をページのスクリプトとして読む fixtures）だけ。拡張として動いているときにページ側の `pushState` まで拾うには `chrome.webNavigation.onHistoryStateUpdated` か Navigation API が要る（未実装）
   - **`rerun` では設定（`settings` / `siteOverrides` / 教えたボタン / ルール）を storage から読み直してエンジンの引数を組み直す**。popup で「このサイトの設定」を変えてすぐ再実行したときに、起動時のプリセットのまま走らないようにするため。読み直した結果が `off` なら、監視せず cloak を外して `status:'off'` を報告する
   - 監視の開始時にパスが実行中なら、そこでは走らせず `pending` にして完了後に 1 度だけ走らせる（`rerun` と進行中パスが二重に走らないようにする）
   - **picker 中の `rerun` は無視する**（ユーザーがボタンを選んでいる最中に自動処理を再開しない）
5. **層の順序**（成功したら終了。各層は非同期で、前の層の失敗を待って次へ）:
   a. **カスタムルール**（教えたボタン）: どちらの経路でも **`text`（正規化文言）の一致・可視・禁止語（HARD）なし** を必ず確認してから押す（サイト更新でセレクタが別のボタンに当たるため。`text` は必ず保存されているので、無いルールは使わない）。禁止語は HARD だけで見る（「保存して閉じる」のような SOFT 禁止語は、ユーザーが明示的に教えている以上押してよい）
      - `selector` が document 内でちょうど 1 要素 → 上の条件を満たせばそれ
      - 満たさなければ `text` で探索。ただし **`findContainers()` が返した容器の中にある要素だけ**を対象にし、`OK` `はい` `閉じる` のような汎用文言（弱一致 / 閉じる語）はその容器に Cookie 固有語があるときだけ許す
   b. **即決 CMP 表（`cmpQuick.ts`）**: 「容器 / reject / accept」セレクタ表。容器があれば対象アクションのセレクタを **容器の中だけ** deepQuery で探しクリックする。**document 全体へのフォールバックはしない**（`#deny` `#accept` `#declineButton` `button[action-type="DENY"]` のような汎用セレクタが無関係な要素に当たるため）。容器の中に 1 件も無ければその CMP は失敗として次の CMP・次の層へ進む。**ただしそのとき見つけた容器は覚えておき**（`RunState.quickContainers` と `RunState.cmp`）、ヒューリスティックの容器選び（d）に使う。**ヒューリスティックが拾った最小容器を内包する即決表の容器があれば、大きさの下限だけ緩めて**（`evaluateContainer(el, env, { relaxSize: true })`）**先頭に据える**（残りの候補は後ろに残す。hide の範囲を決める `outermostContainer` が使うため）。**1 つも拾えなかったときは、その即決表の容器をそのまま**容器として扱い、fallback（hide / leave）の判断まで進める。「その CMP だと言い切れる」セレクタに一致した要素に限った緩和で、Cookie 固有語・決定ボタンの有無・入力欄やサイト本体を内包しないことといった他の条件はそのまま課す（deepl.com の Usercentrics は拒否ボタンが無く、ホストの大きさも 0 なので、これが無いと 20 秒後も同意画面が残る）。ただし reject モードで実効カテゴリが 1 つでもあるときはこの層を飛ばして c を先に（カテゴリ別設定を効かせるため。既定のプリセット `minimal` は A を許可するので、既定でも c が先になる）。**容器セレクタは「その CMP だと言い切れる」ものに絞る**（容器セレクタは document_start の cloak にもそのまま使われ、一致した要素を監視窓のあいだ不可視にするため。`.consent-form` のような汎用 class 単独は使わない）。少なくとも以下を収録（実装時に可能な範囲で確認。複数候補はカンマ区切り）:
      OneTrust `#onetrust-banner-sdk` / `#onetrust-reject-all-handler` / `#onetrust-accept-btn-handler`;
      Cookiebot `#CybotCookiebotDialog` / `#CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll` / `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept`;
      Didomi `#didomi-host, #didomi-notice` / `#didomi-notice-disagree-button, .didomi-continue-without-agreeing` / `#didomi-notice-agree-button`;
      Usercentrics（shadow）`#usercentrics-root, #usercentrics-cmp-ui` / `[data-testid="uc-deny-all-button"], #deny` / `[data-testid="uc-accept-all-button"], #accept`;
      Quantcast `.qc-cmp2-container`（ボタンは文言で）; TrustArc `#truste-consent-track` / `#truste-consent-required` / `#truste-consent-button`;
      Osano `.osano-cm-dialog` / `.osano-cm-denyAll, .osano-cm-deny` / `.osano-cm-accept-all, .osano-cm-accept`;
      CookieYes `.cky-consent-container` / `.cky-btn-reject` / `.cky-btn-accept`;
      Termly `#termly-code-snippet-support, .t-consentPrompt` / `[data-tid="banner-decline"]` / `[data-tid="banner-accept"]`;
      Iubenda `#iubenda-cs-banner` / `.iubenda-cs-reject-btn` / `.iubenda-cs-accept-btn`;
      Klaro `.klaro .cookie-notice, .klaro .cookie-modal` / `.cm-btn-decline, .cm-btn-danger` / `.cm-btn-accept-all, .cm-btn-success`;
      Complianz `#cmplz-cookiebanner-container` / `.cmplz-deny` / `.cmplz-accept`;
      Borlabs `#BorlabsCookieBox` / `[data-cookie-refuse]` / `[data-cookie-accept-all]`;
      Google Funding Choices `.fc-consent-root` / `.fc-cta-do-not-consent` / `.fc-cta-consent`;
      Sourcepoint（iframe 内）`.message-container` / `.sp_choice_type_13, button[title="Reject All"]` / `.sp_choice_type_11`;
      HubSpot `#hs-eu-cookie-confirmation` / `#hs-eu-decline-button` / `#hs-eu-confirmation-button`;
      Cookie Notice(WP) `#cookie-notice` / `#cn-refuse-cookie` / `#cn-accept-cookie`;
      Moove GDPR `#moove_gdpr_cookie_info_bar` / `.moove-gdpr-infobar-reject-btn` / `.moove-gdpr-infobar-allow-all`;
      consentmanager `#cmpbox` / `.cmpboxbtnno` / `.cmpboxbtnyes`;
      tarteaucitron `#tarteaucitronAlertBig` / `#tarteaucitronAllDenied2` / `#tarteaucitronPersonalize2`;
      Axeptio（shadow）`#axeptio_overlay` / `#axeptio_btn_dismiss` / `#axeptio_btn_acceptAll`;
      Wix `[data-hook="consent-banner-root"]` / `[data-hook="consent-banner-decline-button"]` / `[data-hook="consent-banner-apply-button"]`
      英語圏・グローバル向けの追加分（COM ルールで裏取りできたものは実装のコメントに「COM で確認済み / 未確認」を明記する）:
      Insites cookieconsent `.cc-window` / `.cc-deny` / `.cc-allow, .cc-btn.cc-dismiss`;
      CookieFirst `.cookiefirst-root, [data-cookiefirst-widget="banner"]` / `[data-cookiefirst-action="reject"]` / `[data-cookiefirst-action="accept"]`;
      Cookie Script `#cookiescript_injected` / `#cookiescript_reject` / `#cookiescript_accept`;
      Cookie Law Info `#cookie-law-info-bar, .wt-cli-cookie-bar-container` / `#cookie_action_close_header_reject, #wt-cli-reject-btn, [data-cli_action="reject"]` / `#cookie_action_close_header, #wt-cli-accept-all-btn, [data-cli_action="accept"]`;
      Civic Cookie Control `#ccc[open]`（閉じていても `#ccc` は DOM に残るので `[open]` まで見る）/ `#ccc-notify-reject, #ccc-reject-settings` / `#ccc-notify-accept, #ccc-recommended-settings`;
      Cookie Information `#coiOverlay, #Coi-Renew` / `#coiOverlay #declineButton, #coiOverlay .coi-banner__decline, #Coi-Renew #declineButton, #Coi-Renew .coi-banner__decline` / `#coiOverlay #acceptButton, #coiOverlay .coi-banner__accept, #Coi-Renew #acceptButton, #Coi-Renew .coi-banner__accept`（`#declineButton` `#acceptButton` は汎用的すぎるので容器スコープ付きで書く）;
      Piwik PRO `.ppms_cm_popup_overlay, #ppms_cm_popup_overlay` / `#ppms_cm_reject-all` / `#ppms_cm_agree-to-all`;
      Shopify `#shopify-pc__banner` / `#shopify-pc__banner__btn-decline` / `#shopify-pc__banner__btn-accept`;
      Amazon `#sp-cc` / `#sp-cc-rejectall-link` / `#sp-cc-accept`;
      eBay `#gdpr-banner` / `#gdpr-banner-decline` / `#gdpr-banner-accept`;
      LinkedIn `.artdeco-global-alert[type="COOKIE_CONSENT"]` / `button[action-type="DENY"]` / `button[action-type="ACCEPT"]`;
      Yahoo consent `#consent-page .consent-form`（`.consent-form` 単独は任意サイトの同意フォームに当たるので使わない）/ `button[name="reject"]` / `button[name="agree"]`;
      Evidon `#_evidon_banner` / `#_evidon-decline-button` / `#_evidon-accept-button`;
      Finsweet `[fs-cc="banner"]` / `[fs-cc="deny"]` / `[fs-cc="allow"]`;
      Squarespace `.sqs-cookie-banner-v2` / （拒否ボタン無し）/ `.sqs-cookie-banner-v2-accept`;
      adidas（Glass）`.cookie-consent-modal` / `[id^="glass-gdpr-default-consent-reject-button"]` / `#glass-gdpr-default-consent-accept-button`（Amazon / eBay / LinkedIn と同じくサイト・デザインシステム固有のもの。拒否は `-central` 以外の派生も拾えるよう前方一致で書く。§5-5-d の「操作要素は容器にしない」だけでも兄弟の `Reject all` は押せるようになるが、容器を名指しすれば猶予を待たずに即決できる）
   c. **Consent-O-Matic ルール**（§4）
   d. **ヒューリスティック**（独自実装向け）:
      - **容器検出**（要素 1 つ分の判定は `evaluateContainer()`。`findContainers()` は全要素をこれに掛ける）: 判定は **①入口の足切り → ②ハード条件 → ③加点と閾値** の 3 層。採用したものが複数あれば最も内側（最小）を優先する。shadow DOM は deepQuery で横断（**root として渡された要素自身の `shadowRoot` にも入る**。`querySelectorAll('*')` は root 自身を含まないので、`#usercentrics-root` のような CMP のマウント点がそのまま容器になったときに中のボタンを 1 つも拾えなかった）。採用した容器は即 cloak
      - **① 入口の足切り**: 安価な条件だけで「そもそも容器になり得るか」を見る。次のいずれかに該当すれば通す — ⒜ id/class/aria-label に **強い属性ヒント** `cookie|クッキー|gdpr|qc-cmp|cmpbox|cmp-ui|cmp-container|__cmp`・**汎用属性ヒント** `consent|privacy`・**弱いヒント** `banner|notice` のいずれかを含む（大文字小文字無視）、⒝ `role="dialog"` または `aria-modal="true"`、⒞ computed `position` が fixed / sticky。`position` の判定は重いので、容器になり得ないタグ（`span a svg path g img li td th label i b strong em small br hr input button textarea select` 等）では見ない。**該当した種別は覚えない**（採否は③の加点で決めるので、返すのは真偽だけ）
        - **足切りを残している理由は 2 つ**。**性能** — 属性も role も position も持たない要素にまで `innerText` を読みに行くと、大きなページで重い（本文を読むのはここを通った要素だけ）。**安全** — プライバシーポリシー本文中の「Cookie の説明 ＋ 同意ボタン」のような**ページ内セクション**を容器にしてしまわないため。加点方式にしてもこの 2 つは変わらないので、入口だけは据え置いてある
      - **② ハード条件**（1 つでも欠けたら容器にしない。この順に見る）:
        1. `SKIP_TAGS`（`html` `body` `head` `script` `style` `link` `meta` `title` `template`）でない
        2. **自身が操作要素でない**（`BUTTON` `A` `INPUT` `SELECT` `TEXTAREA` `OPTION` `LABEL` `SUMMARY` と、`role="button"` / `role="link"` を名乗る要素）。属性ヒントがどれだけ強くても、押す対象そのものはバナーの入れ物ではない（adidas の `BUTTON#glass-gdpr-default-consent-accept-button`。ROUND2-001）
        3. **入口ゲート・年齢ゲートの属性**（`AGE_GATE_ATTRIBUTE`）を持たない。見るのは**その要素自身の属性だけ**で祖先は辿らない（年齢ゲートのオーバーレイの中に別途 Cookie バナーが入っている構造まで捨ててしまわないため。ROUND2-003）
        4. ①の入口を満たす
        5. 可視
        6. 幅 ≥ 200px・高さ ≥ 40px（`relaxSize` を渡したときは課さない＝即決 CMP 表が名指しで見つけた容器だけ。§5-5-b）
        7. テキスト長が上限未満。上限は 3 段 — **①`attr-cookie` の signal が付く容器（自身の id/class/aria-label が強い属性ヒントに当たる）は 20000 文字**、**②可視テキストに Cookie 固有語がある容器は 8000 文字**、**それ以外は従来どおり 3000 文字**（① 設定パネルを開いたあとの容器は「本文 + 全カテゴリの説明 + 数十件のサービス名」になって 3000 文字を軽く超えるが、cookie を名指ししている容器を長さだけで捨てるとパネルを見つけられない。② `position: fixed` だけが手がかりで、本文に規約の抜粋や目的ごとの説明を並べた同意ダイアログが 3000 文字を超えて丸ごと捨てられていた。cookie を名指ししている本文なら誤検出の危険は小さいので ① と従来値の中間を許す）
          - **shadow ホストの大きさとテキスト**: CMP のマウント点がそのまま容器になるとき、**ホスト自身の高さが 0**（中身は `position: fixed` な shadow の子だけ）で、`innerText` も空（光の DOM しか見ないため）ということがある（deepl.com の `ASIDE#usercentrics-cmp-ui`）。そこで **`shadowRoot` を持つ要素に限り**、① 自身の矩形が下限に届かないときは **shadow root 直下の可視な子の幅・高さの最大**で測り直し（上の 6.）、② 自身のテキストが空のときは **同じ子のテキスト**を本文として使う。`<style>` などの描画されない子は必ず除く（`innerText` は描画されない要素では textContent に落ちるので、CSS の中身を本文として読んでしまう）。shadow root を持たない要素の判定は一切変えない
        8. **自身の属性が Cookie を名指ししていないなら、自身の可視テキストにバナー語（`hasBannerWord`）があること**。免除されるのは `attr-cookie` の signal が付く容器（自身の id/class/aria-label が `CONTAINER_HINT` に当たる）だけで、これは加点方式にしたときに広げたかったぶん——`class="cookie-consent"` ＋ アイコンだけで説明文を持たないバナー（fixture `en-icon-banner`）——にちょうど一致する。**バナー語を無条件に必須から外すと安全側が崩れる**: 次の 9. の⒞（祖先の本文の Cookie 固有語）は、`main` / `nav` / `article` を使わない div soup のページでは**フッターの「Cookie Policy」リンク 1 本で 5 階層ぶんの子孫すべてに当たりうる**（サイト構造タグを内包する祖先しか止めていなかった。現在は⒞ で本文を根拠にしてよい祖先を「バナーらしい名乗りを持つもの」に絞った `canUseAncestorText()` が二重に止める）。その結果、自身は Cookie についても同意についても一言も書いていない要素——「利用規約を更新しました…［I agree］［Decline］」（reject で Decline を押す）・「この記事を削除しますか？［はい］［いいえ］」（fallback で `display:none`）・`position: fixed` なプロモやニュースレター（［OK］［No thanks］を押す）——が軒並み容器として採用されてしまう
          - **置く位置は 9.（`isCookieSpecific()`）の前**。安全のためだけでなく性能上もここでなければならない——9. は祖先の本文を読みに行く（`getText` ＝ `innerText` ＝レイアウトの強制）ので、バナー語の無い要素をここで落とさないと div soup のページで読み取り量が桁違いに増える（`findContainers()` は fallback の猶予ループで 250ms ごとに回る）
        9. **Cookie バナーだと言い切れること**（`cookieSpecific`。`isCookieSpecific()`）。すなわち **⒜ 可視テキストに Cookie 固有語** `/cookie|クッキー|gdpr/i` **がある**、または **⒝ 自身か 5 階層以内の祖先の id/class/aria-label が強い属性ヒント**（`CONTAINER_HINT`）**に当たる**、または **⒞ バナーらしい名乗りを持つ 5 階層以内の祖先の本文に Cookie 固有語がある**。`position` が fixed なだけ・`class="consent-modal"` `class="privacy-modal"` なだけの「利用規約を更新しました…[同意する][同意しない]」モーダルを容器にすると、accept で「同意する」を・reject で「同意しない」（英語なら "Decline"）を押してしまうため、**汎用ヒント（`consent` / `privacy`）と弱ヒント（`banner` / `notice`）は⒝の判定に入れない**（③の加点では別の signal として数える）
          - **⒞ で本文を根拠にしてよい祖先**（`canUseAncestorText()`）は次の 2 つを**両方**満たすものだけ — ① **その祖先自身がバナーらしい名乗りを持つ**（`hasBannerLikeName()`。id/class/aria-label が強い `CONTAINER_HINT`・汎用 `CONTAINER_HINT_GENERIC`・弱い `CONTAINER_HINT_WEAK` のいずれかに当たる、または `role="dialog"` / `aria-modal="true"`）② **ページ全体・サイト構造の入れ物でない**（`body` / `html` と、`main` / `nav` / `article` / `[role=main]` を内包する祖先）。②だけでは足りない——`#root` `.content` のような**ただの入れ物**の `innerText` には**別の枝**にあるフッターの「Cookie Policy」まで含まれるので、`main` / `nav` / `article` を使わない div 入れ子のサイトでは、リンク 1 本で周辺の要素がまとめて Cookie バナー扱いになる（「利用規約とプライバシーポリシーを改定しました…［同意する］［拒否］」の規約更新モーダルが reject で「拒否」を押される。下記「祖先の本文を根拠にしてよい範囲を絞る」）
            - **①の判定は属性の読み取りだけで完結させる**（`position: fixed` は根拠に足さない）。`EngineEnv`（`getComputedStyle`）を `isCookieSpecific()` まで引き回さずに済ませるためで、取りこぼしにもならない——`position: fixed` な無名の祖先はそれ自身が容器の条件（`overlay` ＋ 本文の Cookie 固有語）を満たすので、**容器がボタン行から祖先に移るだけ**でクリックも hide も従来どおり効く
            - 強いヒント（`CONTAINER_HINT`）を名乗る祖先は⒝の属性判定で先に真になるので⒞には来ない。**⒞で実際に効くのは「`consent` / `privacy` / `banner` / `notice` を名乗る祖先」と「`dialog` を名乗る祖先」**である
          - ⒝⒞ で祖先まで見るのは、`<div class="cmm-cookie-banner__actions">[設定][全てに同意][プライバシーポリシー]</div>` のように**ボタン行だけが最小容器になる**構造（mercedes-benz.co.jp 型）のため。その行のテキストには Cookie 固有語が無いので、テキストだけで判定すると `cookieSpecific` が偽になり、非表示（`canHide`）にも設定パネル層（§5-5-e）にも進めないまま `unhandled` で残ってしまう。採用条件・採点・`canHide`・パネル層の発動条件は**すべて同じ `cookieSpecific` を見る**。なお⒞ は容器になり得る範囲を広げる経路なので、**8. のバナー語**と**上記の「本文を根拠にしてよい祖先」の限定**の 2 つと組でしか使わない（この構造で⒞ が効くのは、`.cmm-cookie-banner__actions` の親が `cookie` を名乗っている場合や `role="dialog"` を名乗るモーダルの中のボタン行のような、**祖先自身がバナーだと名乗っている**ときである）
          - **危険文脈語**（`/削除|delete|支払|payment|購入|注文|パスワード|password|ログアウト|退会|解約|送信|決済/i`）を可視テキストに含む要素は、**自身に Cookie の根拠が無いとき**（`attr-cookie` も `text-cookie` も付かない＝根拠が祖先由来だけ）に限って容器にしない。自身が Cookie を名指ししている容器は Cookie バナーとみなし、ボタン単位の禁止語だけで守る（`order` は英語バナー定番の "We use cookies **in order to** …" に当たるので `remove` ともども危険文脈語に入れない）。加点方式にした当初はこの条件が `!cookieSpecific` で、9. と重なって**永久に到達しない死んだガード**になっていた（コメントは「将来の保険」と書いてあったが保険になっていない）。⒞ で祖先の Cookie 語だけでも 9. を通れる以上、ここは 8. と並ぶ**二重の歯止め**として効かせる（「この記事を削除しますか？［はい］［いいえ］」型のダイアログよけ）
        10. `main, [role=main], article, nav` を内包しない・自身でもない（サイト本体を巻き込む要素はバナーではない）。テキスト入力（`input:not([type=button|submit|checkbox|radio|hidden]), textarea, select`）も内包しない（チャットウィジェット・フォームよけ）
        11. **配下に決定ボタン候補が 1 つ以上ある**（`decisionCandidates(collectButtons(…))`。自身がボタンの場合は 2. で既に落ちている）
        12. **もう選び終わったことを伝えるだけの案内でない**こと。可視テキストに **完了状態の文言** `/you.?ve chosen to reject|you have rejected|already (rejected|accepted)|consent (choice )?saved|設定を保存しました|拒否しました|同意しました|受け付けました/i` があり、**決定ボタンが閉じる語（`CLOSE_EXACT`）か折りたたみ語（`COLLAPSE_EXACT` = `collapse` `collapse banner` `hide banner` `折りたたむ` 等）しか無い**容器は、同意を求める画面ではないので**容器にしない**（＝何も押さず、hide もせず、`unhandled` にもしない）。theguardian.com の「You've chosen to reject third-party cookies while browsing our site.［Collapse banner］」を同意画面として報告してしまっていたため。文言だけでは「…に同意しましたか？［同意する］［同意しない］」のような同意要求にも当たるので、**必ず決定ボタンの側と組で見る**。`COLLAPSE_EXACT` はこの判定にしか使わず、閉じる語（自動で押す語）には入れない
      - **③ 加点と閾値**: ②をすべて満たした要素に次の signal を付け、点数を合算する。**合計 4 点以上（`CONTAINER_SCORE_THRESHOLD`）で採用**。従来の「入口の種別による分岐」と「バナー語が必須」はここに置き換わっていて、**バナー語は必須から 1 点の signal（`text-banner`）に降格**している

          | signal | 条件 | 点 |
          |---|---|---|
          | `attr-cookie` | 自身の id/class/aria-label が `CONTAINER_HINT`（cookie・クッキー・gdpr 等）に一致 | 3 |
          | `text-cookie` | 自身の本文に Cookie 固有語（`hasCookieWord`） | 3 |
          | `ancestor-cookie` | `isCookieSpecific` が真だが `attr-cookie` も `text-cookie` も付かない（＝祖先由来） | 2 |
          | `attr-consent` | 自身の属性が `CONTAINER_HINT_GENERIC`（consent・privacy） | 2 |
          | `decision-strong` | **子孫の**決定候補に拒否の強一致・必要最小系・許可の specific 一致がある | 2 |
          | `attr-banner` | 自身の属性が `CONTAINER_HINT_WEAK`（banner・notice） | 1 |
          | `overlay` | `role="dialog"` / `aria-modal="true"` / `position: fixed` / `sticky`（ただし `NON_CONTAINER_TAGS` = span / a / img / li / button 等では `position` を見ない＝ role / aria-modal でしか当たらない。①の足切りと同じ `isOverlay()` なので条件も同じ） | 1 |
          | `text-banner` | 自身の本文にバナー語（`hasBannerWord`） | 1 |
          | `decision-weak` | 子孫の決定候補に上記以外のもの（同意・OK・閉じる等）しかない | 1 |

        - **閾値 4 は「今日採用されている容器を 1 つも落とさない」ための値**。②のハード条件だけで、入口（①より属性ヒントか overlay で ≥1 点）・Cookie の名指し（9. より `attr-cookie` 3 / `text-cookie` 3 / `ancestor-cookie` 2 のいずれかで ≥2 点）・決定ボタン（11. より ≥1 点）が保証されるので、**バナー語（1 点）が 8. の免除で欠けても 4 点には届く**
          - 裏を返すと、**採用されうる構成の下限は `attr-cookie` 3 ＋ `decision-weak` 1 = 4 点＝閾値と同値**で、**閾値はいま 1 件も足切りしていない**（8. でバナー語が免除されるのは `attr-cookie` の容器だけなので、それ以外は `text-banner` 1 ＋ Cookie の名指し ≥2 ＋ 入口 ≥1 ＋ 決定 ≥1 で必ず 5 点以上になる）。ハード条件を緩めたときに効く安全網として置いてあり、そのときは配点の見直しも要る（例: 9. の Cookie の名指しを外すと、`ancestor-cookie` の 2 点が消えて閾値が意味を持つ）
          - 加点の `attr-cookie` / `attr-consent` / `attr-banner` / `overlay` は、**①の入口の足切りが見た値をそのまま使う**（`evaluateContainer()` が 1 度だけ求めて `ContainerFacts` で渡す）。同じ述語を両側で計算し直していると、片方の条件だけを変えたときに「入口を通ったのに 1 点も付かない」という食い違いが静かに生まれ、上の「入口 ≥1 点」の前提が崩れるため
        - **バナー語**（`text-banner`）= `/cookie|クッキー|同意|consent|プライバシー|privacy|gdpr|トラッキング|tracking|個人情報|データの利用|データ利用|情報の利用|お客様のデータ|data protection/i`。「データの利用」「情報の利用」「data protection」を足してあるのは、cookie / 同意 / プライバシー を一度も書かない同意画面があるため。**押す・隠すの条件は `cookieSpecific` のまま**なので、ここを広げても採用される容器が増えるだけで安全側は変わらない
        - 加点の内訳（`DetectedContainer.signals`）は診断ログ（§5-8）にそのまま出す。`score=8 [attr-cookie/text-cookie/overlay/decision-weak]` の形で、**どの手がかりで容器と判断したか**が利用者の報告だけで分かるようにするため
      - **ボタン候補**: 容器内の `button, [role="button"], input[type="button"], input[type="submit"], a` のうち可視なもの。`a` は `href` が空・`#`・`javascript:` か `role="button"` の場合のみ（実ページへのリンクは除外。ただし下の**実リンクの緩和**に当たるものは例外）。加えて **容器の中に限り** `[onclick]` とボタンらしい class を持つ要素も候補にする（`<div class="cc-btn">Got it!</div>` のように `button` タグも `role="button"` も持たない独自バナーがあるため。汎用的すぎるので容器の外では使わない＝ `collectButtons()` は必ず容器を root に呼ぶ）。可視・禁止語・非決定語・文言の判定はふつうのボタンと同じ経路を通る
        - **class は部分一致ではなくトークンで見る**: クラス名そのものが `btn` / `button`、または `-btn` `_btn` `__btn` `-button` `_button` `__button` で終わるものだけ（`[class*="btn"]` だと `<div class="cookie-banner__buttons">` `<div class="btn-group">` のようなボタンの**親ラッパー**に一致する）。実装は `[class]` で拾って `classList` を走査して絞る
        - **拡張セレクタ（`[onclick]` / class トークン）で拾った要素は、内側に他のクリック候補を含んでいたら候補にしない**。ラッパーは子要素より先に出てくるうえ、テキストが子の連結（`acceptallrejectallcookiesettings`）になって決定語に化け、押しても効かないまま候補枠（最大 3）を食う。`onclick="acceptAll()"` を持つ内側ラッパーだと reject モードで同意が走る。通知のみバナーの `<div class="buttons"><button>Got it</button></div>` でも決定ボタンが 2 つに数えられ、閉じる語の経路が塞がる
          - **このラッパー判定で見るのは光の DOM だけで、その要素自身の shadow root は覗かない**（`deepQueryAll(el, …, { ownShadow: false })`）。web components 製のデザインシステムのボタン（Stencil の `shadow: true`。`<wb7-button class="button …">設定</wb7-button>` が shadow root に `<button><slot></slot></button>` を持つ形）は**ホストがボタン本体**で、shadow の中はその実装にすぎない。中を覗くとホストがラッパー扱いで落ち、残った実装の `<button>` は文言がスロット越し（＝ `innerText` が空）なので決定ボタンにもならず、**バナーからボタンが 1 つも見つからなくなる**（mercedes-benz.co.jp で `unhandled` になっていた原因）。子孫が持つ shadow root には従来どおり入るので、ふつうのラッパー判定は変わらない
        - **実ページへのリンク（`isEligibleAnchor` が偽の `a`）の中にある要素も、原則として候補にしない**。`<a href="/leave"><div class="btn">Decline</div></a>` の div を押すとクリックが `a` にバブルして遷移してしまう
        - **実リンクの緩和**: ただし決定ボタンを `<a href="/consent/all">全てに同意</a>` のようにリンクで作っているサイトがあり、一律に外すと候補が 1 つも集まらず、hide の条件（②押さずに残した許可ボタンがある）すら満たせないまま `unhandled` になる。そこで**次をすべて満たすときだけ**、実リンクの `a` 自身とその中の要素を候補にする — ① 容器の可視テキストに **Cookie 固有語**がある（`CandidateContext.cookieSpecific`）② 文言が**拒否の強一致・必要最小系・許可の specific 一致**のいずれかに当たる③ **HARD 禁止語**に当たらない。弱一致・閉じる語・非決定語は対象外なので、「プライバシーポリシー」「インプリント」「詳細」のような情報リンクは従来どおり候補にならない。`a` 自身を候補にできたときは、その中の要素は重ねて候補にしない（押す先はどのみち `a` で、候補の枠（最大 3）を二重に使うだけのため）。遷移という副作用を負う代わりに、断るボタンがリンクのサイトでは**断れる**ようになり、「全てに同意」しかリンクで置いていないサイトでも**非表示にできる**ようになる。なお `collectButtons()` に文脈を渡さない経路（設定パネル内の保存ボタン探索など）では従来どおり実リンクを一切候補にしない
        - **緩い候補（カスタム要素・`data-*` だけのボタン）**: `<wb7-button>` のようなカスタム要素、`<div data-testid="reject-all">`、`<span class="cc-link">` は tag も `role` も class トークンも手がかりにならず、上のどの網にも掛からない。そこで **容器が `cookieSpecific` のときに限り**、容器内の全要素から**次をすべて満たすもの**を候補に足す — ① 可視で `disabled` / `aria-hidden="true"` でない ② **押せる見た目・振る舞い**（computed `cursor` が `pointer` ／ `tabindex="0"` ／ `data-*` の値が `/accept|reject|deny|decline|consent|cookie|agree|allow|save|confirm/i` に当たる。`cursor` は `EngineEnv.getCursor()` 経由で読む＝ jsdom では注入する）③ 文言が**強い決定語**（拒否の強一致・必要最小系・許可の specific 一致）・**設定ボタン**（`isSettingsButton`。パネル層が使う。非決定語なので `decisionCandidates` では落ちる）・**弱一致**（許可の弱一致・拒否の弱一致・閉じる語。`ACCEPT_WEAK_EXACT` / `REJECT_WEAK_EXACT` / `CLOSE_EXACT` の**完全一致のみ**。ただし**容器が年齢確認ゲート（`context.ageGate`）のときは弱一致・閉じる語を対象にしない**。強い決定語・設定ボタンは引き続き対象）のいずれかに当たる ④ **HARD 禁止語**に当たらない。**裸の許可語**（`ACCEPT_STRONG_BARE` の「同意する」「accept」等）はこの経路でも対象外のまま（`isAcceptStrongSpecific` の条件は変えていない）。弱一致まで広げても誤クリックの代償が大きくならないのは、① この経路が `cookieSpecific` な容器の外では使われないことに加え、② reject モードでは許可の弱一致（「同意」「OK」等）が `scoreCandidates` の採点（拒否の強一致 → 必要最小系 → 弱一致の 3 つしか見ない）に一切乗らず**押されない**ため、③ 年齢確認ゲートの容器では上記のとおり弱一致・閉じる語をそもそも候補にしない（`isLooseText` が `ageGate` を見る。下記「年齢確認ゲートの無効化」と同じ判断基準。これが無いと、酒類・製薬サイトの年齢確認ゲートが `cursor: pointer` の緩い要素だけで組まれていたとき、`scoreCandidates` が弱一致を押しはしなくても、候補が生まれること自体で同意画面ではない容器が検出扱いになってしまう）ためで、ここで拾う目的は「同意」を押すことではなく、容器を成立させる（決定ボタン候補を 0 件にしない）ことと `canHide()`（許可側の採点が空でないこと）を満たして**非表示にできるようにする**ことの 2 つだけである（gakken.co.jp の `<div class="title4 highlight"><h4>同意</h4></div>` がこの経路で拾われるようになった実例）。実リンクの緩和・ラッパー除外はそのまま効く
          - `cursor` は継承するので `<button><span>Reject all</span></button>` の span も `<div data-testid="reject-all"><span>…</span></div>` の div も条件を満たしてしまう。同じボタンで候補の枠（最大 3）を二重に使わないよう、緩い候補のうち **⒜ ふつうの候補（tag / role / class トークン）の内側にあるもの**と **⒝ ほかの候補を内側に持つもの（ラッパー）** を落とす（＝いちばん内側の 1 つだけを残す）
      - **正規化**（`normalize()`）: trim → 小文字化 → 全角英数記号（U+FF01–U+FF5E）を半角へ → 空白（全角スペース含む）を除去 → 約物 `。！!.,、'’‘"“”?？…:：;；‐–—-()（）[]【】&＆+＋・»›«‹→` を除去。英語ボタンの揺れを語彙の正規表現で書き分けずに済ませるための処理で、"Don’t accept"→`dontaccept` / "opt-out"→`optout` / "Accept & Close"→`acceptclose` / "Why?"→`why` になる。閉じるボタンの `×` `✕` は語彙（CLOSE_EXACT）なので残す
      - **禁止語**は 2 段。`isForbidden(text, { strict })` で使い分ける（`strict` 既定 true = ヒューリスティック、false = ユーザーが明示的に教えたボタン）
        - **HARD**（どの経路でも絶対に押さない。カスタムルール・picker にも適用）= `/購入|buy|checkout|pay|支払|決済|payment|注文|order|削除|delete|remove|login|ログイン|sign ?in|sign ?up|登録|register|subscribe|購読|unsubscribe|退会|解約|振込|送金|transfer|donate|寄付|送信|submit/i`
        - **SOFT**（ヒューリスティックのみ。カスタムルール・picker には適用しない）= `/保存|save|apply|申し?込|予約|book|reserve|投稿|post|publish|公開|解除/i`。Cookie 設定画面の「保存して閉じる」「Save and exit」「Apply」など正当なボタンにも当たるので、ユーザーが明示的に教えたボタンまでは塞がない
      - **非決定語**（設定・詳細系。決定ボタンとして扱わない）: `/設定|settings?|manage|preferences?|customi[sz]e|詳細|learn more|more (info|options)|詳しく|ポリシー|policy|カスタマイズ|選択|options|confirm|確定|cancel|キャンセル|choose|choices|adjust|configure|purposes|vendors|partners|details|read more|find out more|change|select|show|view|see more|more info|information|privacy cent(er|re)|cookie policy|do not sell|dont sell|personal information|about|why|一覧|list|各社|ベンダー|advanced/i`。`confirm` は OneTrust の "Confirm my choices"、`確定` は日本語 CMP（OneTrust 等）の設定画面「選択を確定」に使われる Cookie バナーの語なので、禁止語ではなくこちらに置く（自動では押さないが、教えたボタンとしては使える）。「注文を確定」は `注文` が HARD 禁止語なので引き続き押さない。英語の追加分は "Show purposes" "Vendors" "Our partners" "Allow selection" "Do Not Sell or Share My Personal Information" "Why?" のような**設定画面を開くだけ・部分許可・情報リンク**のボタンを決定ボタンにしないためのもの。ただし次のどちらかに当たる文言は、ここに挙げた設定系の語（`purposes` `vendors` 等）を含んでいても非決定語として扱わない（decisionCandidates が非決定語より決定語を優先する）: ①**必要最小系**に一致する、②**総量マーカー** `/all|everything|すべて|全て/` を含み、かつ**許可の specific 一致**または**拒否の強一致**に当たる。総量マーカーを要求しないと "Manage or reject cookies"（押しても設定パネルが開くだけ）まで決定ボタンになってしまう。"Accept all purposes" "Reject all vendors" は決定ボタンとして扱い、"Manage consent preferences" "Confirm my choices" "Manage or reject cookies" "Allow selection" は引き続き非決定語のまま。`一覧` `list` `各社` `ベンダー` `advanced` は「パートナー一覧」「Vendor list」「詳細設定」のような**開くだけ**のボタンよけ（`詳細設定` は `詳細`、`パートナー一覧` は `一覧` に当たる）
      - **拒否語（reject）**: 強一致（含んでいれば可）= `拒否|拒絶|お断り|同意しない|許可しない|承諾しない|承認しない|受け入れない|利用しない|使用しない|オフにする|無効にする|同意せずに(続ける|進む)|(すべて|全て)解除|選択を解除|オプトアウト|辞退|reject|decline|deny|refuse|disagree|opt out|do not accept|dont accept|do not agree|dont agree|do not allow|dont allow|do not consent|dont consent|withdraw consent|object to|disable(?!d)|turn off|turn all off|continue without|without accepting`（`オフにする` `無効にする` `利用しない` `使用しない` は日本語のトグル型の拒否ボタン、`turn all off` は "Turn all off"（`turn off` は空白を挟まない並びしか見ないので別に要る）、`without accepting` は "Browse without accepting" 向け。`reject non-essential` `decline all` `deny all` `refuse all` `opt out of all` はすでに裸の `reject` `decline` `deny` `refuse` `opt out` に当たるので足していない。**`解除` は SOFT 禁止語なので、「すべて解除」はヒューリスティックでは押さず、ユーザーが教えたボタンとしてだけ使える**。アポストロフィは正規化で落ちるので `don't` は `dont` で受ける。`do not consent` `withdraw consent` は Google Funding Choices の拒否ボタン文言そのもの、`object to` は IAB TCF の「Object to legitimate interest」に当たる。これらが無いと許可語の裸の `consent` に部分一致して許可語に化けてしまう。`disable` `turn off` はトグル型の拒否ボタン——"Disable non-essential cookies" "Turn off all"——向け。`disable` は過去形を除く `disable(?!d)` にする。"I've disabled my ad blocker" のような「もう切ってある」文言を拒否ボタンにしないため）; 必要最小系（**語順を問わない**。"Necessary cookies only" も "Only allow essential cookies" も同じ意味）= `必要なもののみ|必要な.*のみ|必要最小限|必須.*のみ|必要不可欠.*のみ|最低限.*(のみ|だけ)|基本的な.*のみ|necessary.*only|only.*necessary|essential.*only|only.*essential|required.*only|only.*required|strictly necessary|minimum (only|cookies)|(accept|allow|use|enable) ?(the )?(strictly )?(necessary|essential|required)(?!.*(optional|analytic|marketing|advertis|performance|targeting|statistic|preference|all|everything|non))|functional.*only|only.*functional|technical.*only|mandatory.*only|only.*mandatory`（`(accept|allow|use|enable)…(necessary|essential|required)` は `only` の付かない "Accept necessary cookies" 型向け。`accept` の直後が `all` の "Accept all necessary and optional" や、optional・marketing など別カテゴリを含む "Allow necessary and optional cookies" には当たらない＝押すと全許可になる文言を必要最小系から外す。`必要な項目のみ` `必須のみ` `only the strictly necessary` `necessary cookies only` はすでに `必要な.*のみ` `必須.*のみ` `only.*necessary` `necessary.*only` に当たるので足していない）; 弱一致（完全一致のみ）= `no thanks|no, thanks|no thank you|not now|later|maybe later|skip`。弱一致は "No thanks" "Not now" がニュースレター・通知の許可ダイアログにも頻出するため、許可の弱一致と対称に **Cookie 固有語ゲートの内側**でだけ候補にする。**裸の `no` は入れない**（許可の弱一致から `yes` を外したことと対称。酒類・製薬サイトの年齢確認ゲート「Are you over 18? [Yes] [No]」で "No" を押すとサイトから追い出される）
      - **許可語（accept）**: 強一致のうち **容器の文脈なしで押してよい具体的な言い回し** = `(すべて|全て)(の(cookie|クッキー))?(に|を)?(同意|許可|受け入れる)|全部(に)?(同意|許可)|accept all|allow all|enable all|agree (to )?(all|everything)|accept everything|allow everything|yes to all|enable cookies|accept (all )?cookies|allow (all )?cookies`（Cookie バナー以外の同意ダイアログは対象が 1 つなので「すべて」とは言わない。cookie を名指しする "Accept cookies" "Allow cookies" もここに入れる——`isAcceptStrongSpecific` は文言に cookie があれば元から真だが、`isAmbiguousReject` はこの正規表現だけを見るため、連結テキストで拒否語に化けた許可ボタンを reject の候補から外すのに要る。`すべてを受け入れる` `i accept all` は先頭の言い回し・`accept all` に当たるので足していない）、**Cookie 固有語ゲートの側** = `同意する|同意します|承諾する|承諾|許可する|受け入れる|agree|i agree|accept|allow|consent`（`enable` は裸では入れない。"Enable notifications" のような Cookie と無関係なトグルまで拾ってしまうため。"Enable cookies" "Enable all" は具体的な言い回し側の `enable cookies` `enable all` で拾う）; 弱一致（完全一致のみ）= `同意|許可|ok|okay|はい|got it|understood|i understand|continue|sure|fine|alright|thats fine`。`continue` は「次へ」の意味でフォームにも頻出するので一度は外していたが、①容器の Cookie 固有語ゲート ②テキスト入力を内包する容器の除外 の 2 つで守られているため、Cookie 語のある容器の中に限って戻している（"By continuing to browse, you accept our use of cookies. [Continue]" 型の英語バナー用）。**裸の `yes` は入れない**（年齢確認ゲートの "Yes" を押すのは法的な自己申告の代行になる。"Yes to all" は具体的な言い回し側で拾う）。`agree and continue` も入れない（`isAcceptStrong` が先に当たるので採点では到達しない）。なお**拒否語（強一致・必要最小系）に当たる文言は許可語として扱わない**ので、"Accept only essential cookies" を accept モードで押すことはない
      - **通知のみバナーの閉じる語**（完全一致）= `ok|okay|閉じる|了解|わかりました|内容を理解した|理解した|了承しました|確認しました|got it|understood|i understand|close|dismiss|continue|ok got it|okay got it|hide|hide this message|hide notice|hide notification|close this notice|no problem|fine|sure|alright|×|✕|x`（"OK, got it" は正規化でカンマが落ちて `okgotit` になる）。`内容を理解した` `理解した` `了承しました` `確認しました` は、拒否ボタンも設定ボタンも持たない日本語の通知型ダイアログ（dailymotion.com の「内容を理解した」だけの Cookie ダイアログ）の唯一のボタン。`わかりました` `understood` と同じ「読んだことを伝えるだけ」の語で、**完全一致かつ Cookie 固有語ゲートの内側**でしか使わない（「内容を理解して同意する」のような決定を伴う言い回しには当たらない）
      - **Cookie 固有語ゲート**: 「すべて〜系以外の許可語」「許可の弱一致」「拒否の弱一致」「閉じる語」は、規約更新モーダルやフォームの決定ボタンにも使われるため、**容器が Cookie バナーだと言い切れるとき（`cookieSpecific`）だけ**候補にする。判定は上の ⒜⒝（可視テキストの Cookie 固有語 / 自身・5 階層以内の祖先の強い属性ヒント）。文言自体が cookie を含む場合（"Accept cookies"）も可。拒否語のうち**強一致と必要最小系**は容器の文脈に関係なく押してよい（"No thanks" のような弱一致だけはゲートの内側）。②汎用属性ヒント（`consent` / `privacy`）・③dialog・④position・⑤弱いヒントだけの容器は Cookie 固有語が無ければ**そもそも採用しない**ので、`class="consent-modal"` の規約更新モーダルで「同意しない」「Decline」を押すことはない
      - **年齢確認ゲートの無効化**: 容器の可視テキストに **ゲート語** `/\b(18|21)\b|\bage\b|of legal|healthcare professional|medical professional|年齢|歳以上|未成年/i` があるときは、その容器では**弱一致（許可の弱一致・拒否の弱一致・閉じる語）を一切使わない**。酒類・製薬サイトの全面ゲート（"Are you over 18? [Yes] [No]" ＋ 小さく "This site uses cookies…"）は Cookie 固有語を持つので容器として採用されてしまい、reject で "No"（＝サイトから追い出される）、accept で "Yes"（法的な自己申告の代行）を押してしまうため。`age` は "manage" "storage" "message" に部分一致するので**語境界（`\bage\b`）で見る**（部分一致にすると "Manage settings" のあるふつうのバナーまで無効化される）
      - **採点**: reject モードは「拒否語の強一致（3）」＞「必要最小系（2）」＞「弱一致（1）」＞（無ければ fallback）。accept モードは「許可語の強一致（3）」＞「弱一致（2）」。拒否・許可の弱一致はどちらも Cookie 固有語ゲートの内側（かつ年齢確認ゲートでない容器）でだけ候補にする。同点なら容器内で先に出現したもの
        - **拒否側の曖昧な文言は候補から外す**: 文言が**許可の specific 一致**（「すべて許可」系の言い回し）に当たり、かつ**否定形** `/donot|dont|without|never/` を含まないものは reject モードの候補にしない。`<button>Accept all<small>You can opt out at any time</small></button>` のようなサブキャプション付きの許可ボタンが、連結テキストの `optout` `withdraw consent` `disable` で拒否語に化けるため（許可側には「拒否語に当たる文言は許可語にしない」ガードが元からある。その対称）。"Do not accept all" は否定形があるので従来どおり拒否
        - **閉じる語**: どちらのモードでも、容器内の決定ボタンが 1 つだけでそれが「閉じる語」なら（選択肢のない通知バナー）クリックしてよい（1）。ただし **reject モードで `settings.pressCloseOnNotice` が false のとき（プリセット「すべて拒否」。§14.1）はこの経路を使わない**（何も押さずに fallback へ落とす。accept モードは従来どおり）。同じく **reject モードでは、容器内に設定系の非決定ボタン** `/settings?|manage|preferences?|customi[sz]e|options|choices|configure|adjust|設定|カスタマイズ/i` **があるときは使わない**（`[Continue] [Manage settings]` は "Manage settings" が非決定語で落ちて決定ボタンが 1 つになるが、ここでの Continue は同意ボタン。既定 fallback の hide に落とす）。`learn more` `policy` `read more` `about` `why` のような情報リンクは「選ぶ余地」ではないのでこの語には含めない（`[Got it!] [Learn more]` は従来どおり閉じる）。accept モードは従来どおり
      - **fallback**（reject モードで断るボタンが無いとき）: §5-1 のとおり `hide`（既定）/ `leave` の 2 つ（「許可して閉じる」は §14.1 で廃止）。いずれも §5-1 の猶予（1 秒）を待ってから適用する。猶予の起点は「その容器を最初に見た時刻」で、**採用容器が別の要素に差し替わったら起点をやり直す**
   e. **設定パネル（`engine/panel.ts`）**: d の fallback を適用する直前に 1 度だけ挟む層。「設定」と「全てに同意」しか無い同意画面で、人間がやっている「設定を押す → 分析・広告のチェックを外す → 選択を保存」を、サイト固有のセレクタを持たずに汎用の手順として行う（Consent-O-Matic ルールのある CMP はそちらが先に効くので、これは独自実装のサイト向け）。誤操作の代償が大きいので、少しでも怪しければ**トグルに一切触れず**に中止して fallback へ落とす
      - **発動条件**（すべて満たすときだけ）: ① reject モード（accept モードは従来どおり許可ボタンを押す）② 容器が検出済みで `cookieSpecific` ③ 拒否の強一致・必要最小系の候補が無い ④ 猶予（`FALLBACK_GRACE_MS`）を過ぎて fallback を適用する直前 ⑤ 容器内に設定ボタン（`isSettingsButton`。**実リンクの `a` とその中の要素**（`navigatesAway`）と `isForbiddenHard` は除く。上の実リンクの緩和は設定ボタンには波及させない——押すと設定パネルではなく別ページが開いてしまうため）がある ⑥ 1 ページにつき 1 回だけ（`RunState.panelTried`）⑦ **監視窓の残りが時間予算（6 秒）以上ある**（途中で打ち切られると、開いた設定パネルを見せたまま監視窓が終わってしまうため）
      - **手順**: ① 設定ボタンをクリック（消滅を期待しないクリック。`clickAndVerify` は使わない）② パネルの出現を最大 2500ms・250ms 間隔で待つ ③ 中止条件を確認 ④ トグル・ラジオを望む状態に揃える ⑤ 保存（無ければ「閉じる」）ボタンを押す ⑥ 元の容器とパネルの両方が消えたら成功。全体の時間予算は 6000ms で、各待ちループで `state.cancelled` と予算を見る
      - **パネルの見つけ方**: 部品（トグル `input[type="checkbox"]` / `[role="switch"]` / `[aria-checked]` と、ラジオ `input[type="radio"]`）が (a) 元の容器の中に現れたら**その場展開**として容器自身をパネルとみなす、(b) 無ければ部品の祖先を辿り「`findContainers()` が拾った容器」または「`role=dialog` / `aria-modal` / `position:fixed` で面積が容器の最小サイズ以上」の可視要素をパネルとする。**設定ボタンを押す前から見えていた候補は除く**（ページに元からある固定ウィジェット——通知設定のパネルなど——を Cookie の設定パネルと取り違えて操作しないため）。候補が複数あるときは**保存（無ければ「閉じる」）に使えるボタンも含む最小の容器**を選ぶ（トグルだけを囲む内側の div を選ぶと保存ボタンが外に出て中止になるため）。見つけたパネルは即 cloak し、中止したときも hide / cloak の対象に含める
        - (c) **アコーディオン型**: (b) は「新しく見えるようになった容器」なので、`height: 0 → auto` や `aria-expanded` の切り替えだけで開くパネル（＝**容器としては元から可視**）を拾えない。そこで「設定ボタンを**押す前に操作できた部品の数**より増えたか」も検出条件にする（操作できる = 押す先——不可視の `input` なら `label`——が可視）。増えていれば**新しく現れた部品の最小の共通祖先**から上へ辿り、保存・閉じるボタンを含む最初の祖先をパネルとする。登れるのは 6 階層まで（`html` / `body` とサイト本体を内包する要素には達しない）
      - **中止条件**（該当したら**トグルに一切触れずに**中止し fallback へ）: ① パネルが出ない ② パネルに `input[type=password|email|text|tel|number]` か `textarea` がある（フォームの誤操作よけ）③ パネルのテキストが危険文脈語（`hasDangerousContext`）を含む ④ 保存にも「閉じる」にも使えるボタンが 1 つも無い（**触る前に確認する**）⑤ 触れるトグル・ラジオが 0 個 ⑥ 保存ボタンが無く「閉じる」しかないのに、必須系でない**操作できないトグル**（`disabled` 等）が残っている（結果を確かめようが無いため）
      - **トグルの分類と操作**（最大 30 個、1 個ごとに 60ms 待つ）:
        - **行テキスト**: トグルから最大 4 階層上まで祖先を辿り、「他のトグルを含まない」「テキストが取れる（400 文字未満）」最小の祖先のテキストを使う。取れなければ `aria-label` / `title` / `name` / `id`
        - **「すべて選択する」系は絶対に触らない**: 行テキストが `/すべて選択|全て選択|全部選択|select\s*all|すべてを?許可|全てを?許可|すべて同意|全て同意/i` に当たるトグル、または `data-test` / id / class が `/select[-_ ]?all/i` を含むトグル。部分選択の状態でこれを押すと**全部オン（＝全許可）になる**ため（カテゴリ側の `selected-all` のような状態 class には当たらない）
        - **カテゴリ級だけを操作する**（入れ子のパネル対策）: トグルの「**区画**」= そのトグルから 4 階層以内で**ほかのトグルを含む最小の祖先**。区画の**最初**のトグルで、かつ**同じ区画のほかのトグルがすべて自分より深い**ものを**カテゴリ級**とみなす。カテゴリ級が 1 つ以上見つかったら**カテゴリ級だけ**を操作し、その配下の個別トグル（サービス単位のチェックボックス数十件）は触らない（カテゴリを切れば配下も一緒に落ちる。実サイトも同じ挙動）。カテゴリ級が無い＝同じ深さで並ぶだけの 1 段パネルなら従来どおり全トグルを対象にする
        - `disabled` / `aria-disabled="true"` / `readonly` は触らない。**必須系** `/必須|必要|不可欠|essential|necessary|strictly|required|always\s*(active|on)|常に(有効|オン)/i` も触らない
        - **カテゴリ推定**（最初に一致したもの。`CategoryKey` に対応）: A `/設定|機能|functional|preference|comfort|パーソナライズ設定/i`、B `/分析|解析|統計|パフォーマンス|analytic|statistic|performance|measurement|測定/i`、D `/端末|保存|ストレージ|storage|device|情報の保存/i`、E `/コンテンツ|おすすめ|レコメンド|personali[sz]|content\s*selection/i`、F `/広告|マーケティング|advertis|marketing|targeting|ad\s*(selection|delivery)/i`。どれにも当たらなければ X
        - **望む状態** = 実効カテゴリ（§3）に含まれるか。**X は含まれていても false**（分類できなかった行を許可してよいという意味ではないため）。**現在の状態** = checkbox は `.checked`、それ以外は `aria-checked === 'true'`。違うときだけクリックする。`input` が不可視（カスタムスイッチ）なら `label[for=id]` か祖先の `label`、無ければ `input` 自身を押す
      - **許可 / 拒否のラジオ**（トグルと同じ上限・待ちで、トグルとは別に扱う）: `input[type="radio"]` を同じ `name` でグループ化し、**ちょうど 2 択**で、片方の行文言が許可寄り `/許可|有効|オン|同意|accept|allow|on\b|enable/i`、もう片方が拒否寄り `/拒否|無効|オフ|不同意|reject|deny|off\b|disable/i` のときだけ扱う。**3 つ以上の選択肢・片側しか読み切れないグループは触らない**（どちらを選べば拒否なのかを決められないため）
        - **否定形は拒否側**: 「許可しない」「同意しない」は許可寄りの語に部分一致するので、**拒否寄りの判定を先に**行う（`REJECT_STRONG` も併せて見る）。取り違えると「拒否したつもりで同意」になる
        - **グループの行テキスト**: 2 つのラジオの**共通祖先**から最大 4 階層上まで辿り、ほかのグループのラジオ・トグルを含まない範囲で**カテゴリが引ける最初のテキスト**を使う（共通祖先が `[許可][拒否]` だけを囲んでいることがあるため、トグルの行テキストと違って引けるまで登る）。引けなければいちばん外側のテキスト（＝カテゴリは X）。必須系・「すべて選択する」・`disabled` 等はトグルと同じ条件で触らない
        - 望むカテゴリなら**許可側**、そうでなければ**拒否側**のラジオを選ぶ。既に選ばれていれば触らない
      - **保存ボタン**（パネル内から探す。優先順）: a. 拒否語・必要最小系（「全て拒否」「必要なもののみ」"Reject all" など）と、**「すべてオフ」系** `/(すべて|全て).*(オフ|無効|解除)|turn\s*all\s*off|disable\s*all/i`（`REJECT_STRONG` が拾えない「すべてオフにする」「全ての項目を無効にする」向け。保存語とは別の定数）→ **これがあればトグルを触らずにこれを押す**（より確実で安全）b. 保存語 `/選択を保存|設定を保存|設定の保存|選択の保存|選んだ設定を保存|この設定で保存|保存する|保存して閉じる|選択を許可|選択した.*を許可|選択を確定|確定|適用|save|apply|confirm|allow\s*selection|save\s*(and|&)\s*(close|exit)|選択を反映/i`。**この経路に限り `FORBIDDEN_SOFT`（保存・save・apply）は適用しない**が `FORBIDDEN_HARD`（購入・削除・送信 submit・ログイン等）は適用する。どちらも「すべて許可」の言い回しを含むのに否定形が無いもの（`isAmbiguousReject`。"すべて許可して保存"）は押さない
        - c. **最後の手段の「閉じる」**: a も b も無いが**閉じる語（`CLOSE_EXACT` の完全一致）**のボタンがあるときに限り、トグルを望む状態にしてから「閉じる」を押す（トグルを切ると即座に反映され、保存ボタンを持たない CMP 向け）。ただし中止条件 ⑥ のとおり、操作できないトグルが残っているなら使わない。閉じる語も無ければ従来どおり**トグルに一切触れずに**中止する
      - **検証と報告**: 保存クリック後 1500ms 以内（250ms ごとに確認）に元の容器とパネルの両方が消えた／不可視なら成功。`method: 'panel'`、`decision: 'granular'`、`allowed` = オンのまま残したカテゴリ（許可側を選んだラジオのカテゴリを含む。拒否ボタンを押した a の経路は `allowed: []`）、`clickedLabel` = 押したボタンの表示ラベル（「選択を保存」「全て拒否」「閉じる」など）。失敗したら fallback（既定は hide）へ落とし、パネルも hide の対象に含める
6. **クリック手順**: `el.click()` → 800ms 待ち → 退場していれば成功。まだ見えていれば同じ要素に pointerdown→mousedown→pointerup→mouseup→click を `dispatchEvent` → 800ms 待ち。それでも見えていれば次の候補（最大 3 候補）。成功したら `status:'handled'` を報告し監視終了
   - **退場の判定**（押した要素と容器の両方について）: ① DOM から外れた／可視でない（display / visibility）、② `getBoundingClientRect()` が viewport の外（下端 ≤ 0、上端 ≥ innerHeight、右端 ≤ 0、左端 ≥ innerWidth）。`transform: translateY(100%)` で退場するバナー用、③ computed `opacity === '0'` または `visibility === 'hidden' | 'collapse'`。`opacity` は**自身だけでなく `body` の手前までの祖先も見る**（`.modal-wrap { opacity: 0 }` のように親側をフェードさせて退場するバナーがある）。`visibility` は継承されるので**要素自身の computed だけ**を見る（祖先まで辿ると `.wrap { visibility: hidden } .banner { visibility: visible }` の見えているバナーを退場と誤判定する）。②③を見ないと「断ったのに失敗扱い」になり、消えたはずの同意画面に hide まで掛けてしまう
   - ③ は自前の cloak も `opacity:0` なので、判定の間だけ cloak の `<style>` を `disabled = true` にして computed style を読み、**同じタスクの中で**戻す（paint を挟まないので画面は点滅しない）
7. **ループ防止と打ち切り**: ページ読み込みごとに一度成功したら再実行しない。同じ要素は 1 回のみ試す。監視は `observeSeconds` 経過で必ず止める（cloak も解除）
   - 監視窓が切れたときにパスが実行中なら、その場では確定せず **打ち切り要求（`state.cancelled`）を立ててパスの完了を待つ**。候補のクリックループ・fallback の猶予ループ・層の切り替え・COM のアクションと `waitcss` はこのフラグを見て打ち切る
   - 確定はパスの `finally` で行う: 結果があれば `handled` を報告、無ければ `unhandled`（何か検出していた場合）/ `none`。**`handled` は監視窓を閉じたあとでも必ず報告する**（間に合った操作を捨てない）
8. **ステータス報告**: `chrome.runtime.sendMessage({ type:'status', host, status, method, action, clickedText, clickedLabel, decision, allowed, reason })`。`host` はサブフレームでは `location.ancestorOrigins` の最後（＝トップフレームのオリジン）のホスト名を使う（取れない環境では自分のホスト名）。CMP ベンダーの iframe が自分のドメインでサイト設定を引かないようにするため。`status` は `'handled' | 'unhandled' | 'none' | 'off'`。`none` はトップフレームのみが監視終了時にバナー未検出だった場合に送る。`method` は `'custom' | 'quick:<name>' | 'com:<ruleName>' | 'heuristic' | 'panel' | 'hide'`。`decision` と `allowed`（granular のときの許可カテゴリ）は §14.6 のとおり
   - **`reason`（`status:'unhandled'` のときだけ）**: 何が起きて処理できなかったのかを 1 語で残す。`'no-candidates'`（同意画面は検出したが押せるボタンの候補が 1 つも集まらなかった。層をすべて抜けても `detectedAny` が真のとき）/ `'no-reject'`（候補はあるが断るボタンが無い。従来の主因）/ `'panel-aborted'`（設定パネル層がパネルを開いたのに操作できずに中止した）/ `'click-failed'`（候補を押したのに同意画面が消えなかった）。エンジン側は `RunState.reason` に持ち、fallback の結果（`RunOutcome.reason`）と監視時間切れの報告の両方で使う。popup の文言は §14.4-2
   - **デバッグログ**: 設定の「デバッグログ」が有効なときは、`unhandled` で終わった時点で `console.info` に 1 行の要約（`reason` ・ **即決 CMP 表で分かった CMP 名（`cmp`）** ・ 容器の tagName/id/class ・ 候補数 ・ 決定ボタン数 ・ 候補の文言）を出す。**即決 CMP 表が容器を見つけた時点で診断（容器・ボタン・CMP 名）を残す**ので、ヒューリスティックが容器を拾えなくても `container:null / buttons:0` にはならない（`Usercentrics / ASIDE#usercentrics-cmp-ui / ["さらに詳しく","すべて許可"]` まで分かる）。利用者がコンソールを見てそのまま報告できるようにするためなので、既定のログレベルで表示されない `console.debug` は使わない（`unhandledSummary()`）
   - **進行ログ**: 同じく「デバッグログ」が有効なときは、**成功しても失敗しても**各層が何をしたかを `console.info` に 1 行ずつ出す（`EngineEnv.trace()`。細かい経過は従来どおり `console.debug` の `EngineEnv.debug()`）。出すのは次のもの:
     - 容器を採用したとき（別要素に差し替わるたび）: `容器: <TAG#id.class> 文字数 N ボタン M 件 [文言 …] cookieSpecific=真偽`。文言の無い候補は `文言なし K 件` にまとめる（web components の shadow root にある実装の `<button>` がここに出るので、数自体が手がかりになる）
     - 各層の結果: `教えたボタン: …` / `即決表: 一致なし` / `即決表: <CMP 名> を試行 → 失敗（容器の中にボタンが無い）` / `COM: <ルール名> を試行 → 失敗` / `ヒューリスティック: 候補 0` / `ヒューリスティック: 「<文言>」を押した → 成功` / `設定パネル: 中止（<理由>）` / `fallback: 非表示にした（理由: no-reject）` など
     - **同じ内容の行は 1 監視窓につき 1 回だけ**出す（`RunState.traced` で既出を覚える）。監視中はパスが 1 秒ごとに回るので、`即決表: 一致なし` `COM: 一致なし` `ヒューリスティック: 容器なし` `ヒューリスティック: 候補 N 件 …` `即決表: <CMP 名> を試行 → 失敗（容器の中にボタンが無い）` と、実行できない COM ルールの `スキップ`（`console.debug`）をそのまま出すと、実際に起きたことがログに埋もれる。状態が変われば文言も変わるので、変化した行は毎回出る
     - パスの締めくくり: `パス: custom 0ms / com 3ms / quick 1ms / heuristic 6665ms 合計 6669ms → panel`。層は要素数に比例して重くなるので、監視窓（既定 20 秒）を使い切って打ち切られたときに**どの層で時間を使ったか**が分かるようにする
   - **診断属性**: `<html data-cookie-autopilot="…">` に現在の状態を書く（デバッグログが無効でも残る。実サイトで「そもそも動いているか」を `document.documentElement.dataset.cookieAutopilot` で確かめられるようにするため）。値は `loading` / `watching` / `watching+debug` / `handled` / `unhandled` / `none` / `off` で、**状態が変わるたびに書き直す**。`document_start` では `<html>` がまだ無くて書けないことがあり、フレームワークのハイドレーションで属性ごと消えることもあるので、**最後に書いた状態を覚えておき、DOM の準備ができた時点（`domReady()` の直後）と監視窓を開くたびに必ず付け直す**
9. **メッセージ受信**（popup → content）: `{type:'rerun'}`, `{type:'startPicker', action}`, `{type:'cancelPicker'}`

## 6. ボタンを教える（picker）

- popup の「断るボタンを教える」で開始。トップフレームの content script に送る（「許可ボタンを教える」は §14.1 で廃止）
- 画面右上に固定トースト「**断るボタン**をクリックしてください（Esc で中止）」。`mousemove` で `composedPath()[0]` から最も近いクリック可能要素（button / a / [role=button] / input、最大 3 階層上）を求め、`position:fixed; pointer-events:none; z-index:2147483647` のハイライト枠を重ねる。picker 中は cloak を一時解除して見える状態にする
- クリックは capture フェーズで捕まえ `preventDefault` + `stopPropagation` + `stopImmediatePropagation`。`mousedown` `pointerdown` `mouseup` `pointerup` も同じく capture で握りつぶす（押下で反応するサイトの誤操作よけ）。Esc で中止
- **開始したとき**は自動処理を止めるだけでなく、**進行中のパスに打ち切り要求（`state.cancelled`）を立てる**（ユーザーが自分でボタンを選んでいる最中に fallback で hide されないようにする）
- **中止したとき**（Esc / popup の `cancelPicker`）は cloak（`<style>` と属性）を外し、そのうえで **`rerun` と同じ経路で監視をやり直す**（`RunState` を作り直し、cloak の `<style>` を張り直し、猶予付きで再開する）
- **セレクタ生成**（順に試し、document 内でちょうど 1 件にマッチしたものを採用）: ① `#id`（英字始まり・40 文字未満・数字が 3 文字以上連続しない）② `tag[data-testid|data-test|data-tid|data-cy|data-hook|name|aria-label="…"]` ③ tag + 安定クラス（ハッシュ風 `css-xxxx` / 3 桁以上の数字含み / 30 文字超のクラスは除外）、一意でなければ id 持ちの祖先または安定クラス持ちの祖先を最大 3 階層まで前置。いずれも一意にならなければ `selector` は省略
  - ③ で残ったクラスが `btn|button|primary|secondary|tertiary|active|selected|open|show|shown|visible|hidden|disabled|default|link|large|small|medium|is-*|js-*` のような**汎用・状態クラスだけ**のとき（およびクラスが 1 つも無いとき）は、たまたま 1 件でも別の要素に化けやすいので**祖先の前置を必須**にする（前置しても一意にならなければ `selector` は省略し `text` だけで運用する）
- **HARD 禁止語に当たるボタンは登録を断る**: クリックされた要素の文言が HARD 禁止語（購入・削除など）に一致したら保存もクリックもせず、トーストを「このボタンは登録できません（購入・削除など危険な操作に見えます）」に差し替えて 2.4 秒後に元へ戻す。picker は続いたままなので、別のボタンを選び直せる
- **正規化文言が空のボタンも登録を断る**（`innerText` も `value` も `aria-label` も `title` も無いアイコンボタン）。`text` はどの経路でも照合に使うので、空のまま登録しても二度と押せない。トーストを「文言のないボタンは登録できません。文字の入ったボタンを選んでください」に差し替えて 2.4 秒後に元へ戻す
- 必ず `text`（正規化文言）も保存。shadow DOM 内の要素は `selector` なし・`text` のみになる
- 保存後、その要素を即クリックし `status:'handled', method:'custom'` を報告。既存の同 host・同 action のルールは置き換える。保存に失敗しても（storage の上限など）クリックと報告は続ける（`console.warn` だけ出す）

## 7. Service worker

- `status` メッセージ → `chrome.storage.session` の `tab:<tabId>` に保存し（`decision` / `allowed` もそのまま保存する。§14.6）、バッジ更新: handled → `✓`（緑 `#16a34a`）、unhandled → `!`（橙 `#f59e0b`）、none/off/watching → 空。`showBadge=false` なら常に空
- `watching` はトップフレームが監視窓を開いた時点で送る経過報告。保存するだけでバッジは変えず、`handled` / `unhandled` で上書きされる（既存の `handled` は watching で上書きしない = 従来の handled 優先ルールがそのまま効く）
- `tabs.onUpdated` の `loading` で該当タブのステータスとバッジをクリア
- iframe から `handled` が来たらそれを優先（トップの `none` で上書きしない）
- `onInstalled`: 同梱ルールを `storage.local` にコピー（未保存時）。週 1 回の alarm と `{type:'updateRules'}` メッセージで GitHub から再取得。結果（件数・日時・エラー）を `storage.local.comRulesStatus` に保存
- `onInstalled` で `reason === 'install'`、または `reason === 'update'` かつ `settings.onboarded === false` かつ **まだ一度も自動で開いていない**とき、`chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })` で初期設定ページを開く（§14.3）。自動で開いたら `storage.local.onboardingShownAt` に時刻を記録し、以降の更新では開かない（更新のたびに開かないため）。`{type:'openOnboarding'}` メッセージでも開く（popup / options の「はじめの設定をもう一度見る」。この経路は記録しない）

## 8. Popup（幅 320px、日本語）

> 画面構成の確定版は **§14.4**（プリセット導入後）。以下は改修前の記述で、矛盾する場合は §14.4 が優先。

上から順に:
1. サイト名（siteKey）と現在の状態: 「✓ 処理しました（拒否・Consent-O-Matic ルール）」「✓ バナーを非表示にしました」「拒否ボタンが見つかりませんでした」「Cookie バナーは検出されませんでした」「このサイトでは無効」「確認中」（`watching`。neutral 表示で、タイムアウト扱いにはしない）
2. **このサイトの設定**: セグメント「全体設定に従う / 必要なもののみ / すべて許可 / 何もしない」（`siteOverrides` を即保存。「全体設定に従う」でキー削除）
3. **全体の既定**: セグメント「必要なもののみ / すべて許可 / 何もしない」
4. ボタン行: 「拒否ボタンを教える」「許可ボタンを教える」「このページで再実行」
   - 「このページで再実行」を押したら、押下時刻を覚えて **popup 側で「確認中」（neutral）を表示**し、`tab:<id>` に押下時刻以降の新しいステータスが届くまでは「状態を取得できません」を出さない（直前が `handled` のタブでは service worker が `watching` を保存しない＝ storage が変化しないため、この経路は popup の表示で吸収する）。content script に届かなかった場合（`chrome.tabs.sendMessage` が応答しないページ）は従来どおり 1.5 秒で「状態を取得できません」にする
5. フッター: 「詳細設定」リンク（options ページ）
- `chrome://` 等の非対応ページでは「このページでは使えません」
- デザイン: 余白と行間を十分に、フォントは `system-ui, -apple-system, "Hiragino Sans", sans-serif`。色・余白は `:root` のカスタムプロパティに集約。**ライト固定**（ダークモードには対応しない）。トークンと配色の実体は `docs/DESIGN.md` を参照

## 9. Options（詳細設定）

> 画面構成の確定版は **§14.5**（プリセット導入後）。以下は改修前の記述で、矛盾する場合は §14.5 が優先。

- 全体の既定モード、拒否できなかったときの挙動（バナーを非表示 / そのまま残す / 許可して閉じる）、「必要なもののみ」でも許可するカテゴリ（A/B/D/E/F/X を日本語ラベルで。対応 CMP のみ有効と注記）、バッジ表示、監視秒数、デバッグログ
- Consent-O-Matic ルール: 収録件数・最終更新日時・「今すぐ更新」ボタン・出典と MIT 表記。`storage.onChanged`（`sync` の `siteOverrides` / `cr:*` に加えて `local` の `comRules` / `comRulesStatus`）を購読し、週次の自動更新や「今すぐ更新」の結果で件数・日時・失敗表示を描き直す
- サイト別設定の一覧（削除付き）、教えたボタンの一覧（host・action・selector/text・削除）
- JSON のエクスポート／インポート（settings + siteOverrides + customRules）。`customRules` の全置換は **新しい `cr:*` を 1 回の `set` で書いてから、不要になった旧キーを削除する**順序で行う（先に消してから host ごとに直列で書くと、途中で失敗したときに旧データも新データも無い状態になるため）

## 10. manifest.json

- `manifest_version: 3`、`name: "Cookie Autopilot"`、日本語 `description`
- `permissions: ["storage", "activeTab", "alarms"]`。`host_permissions` は追加しない（content_scripts の matches で足りる）
- `action.default_popup`、`options_ui: { page, open_in_tab: true }`、`background.service_worker`（`type: "module"`）
- `icons`: 16/32/48/128。`scripts/gen-icons.mjs` で仮アイコン（丸いクッキー風）を生成。README に「デザイナーが差し替える前提」と明記

## 11. fixtures/（動作確認用の静的ページ）

`chrome` API 無しでも content script が動くので、`<script src="/content.js">` を読み込むだけで確認できるページを用意する。各ページは押されたボタンと時刻を `<pre id="log">` に記録し、バナーはクリック後に自分で消える（実サイトの挙動を模す）:
- `custom-ja.html` 独自実装の日本語バナー（fixed 下部、「すべて許可」「拒否」「Cookie の設定」）→ reject で「拒否」が押されて消える
- `notice-only.html` 選択肢のない通知バナー（「OK」のみ）→ 押されて消える
- `shadow.html` shadow DOM 内のバナー（「Accept all」「Reject all」）
- `onetrust-like.html` OneTrust の id 構造を模したもの（即決表の確認）
- `com-rule.html` Consent-O-Matic ルールのいずれか 1 件（例: cookiebot 系の簡単なもの）の DOM 構造を模し、解釈器が OPEN_OPTIONS → DO_CONSENT → SAVE_CONSENT を実行することを確認できるもの
- `no-reject.html` 「同意する」と「設定」しかないバナー → 既定 fallback（hide）で非表示になり、`display:none` が付く
- `trap.html` 誤クリック防止: fixed でない会員登録フォーム（「同意する」チェックボックスと「送信」ボタン）と、本文中の「Cookie ポリシー」リンク。**何も押されない**
- `trap-chat.html` Cookie バナーではない固定 UI: 固定チャットウィジェット（"We are committed to protecting your privacy" + 入力欄 + "Send us a message"）と、`nav` を含む sticky ヘッダー。**何も押されず、非表示にもされない**
- `dialog-tos.html` Cookie バナーではない `role="dialog"`: 「利用規約と個人情報の取り扱いを更新しました…[はい][いいえ]」。accept モードでも**「はい」を押さない**
- `dialog-tos-fixed.html` `role` も Cookie 語も無く、**fixed であることだけ**が容器候補の理由になる規約更新モーダル: 「…新しい規約に同意しますか？[同意する][同意しない]」。reject / accept のどちらでも**何も押さない・消さない**
- `dialog-tos-consent-class.html` Cookie 語は無いが `class="consent-modal"`（**汎用属性ヒントだけ**）を持つ規約更新モーダル: 「…新しい規約に同意しますか？[同意する][同意しない]」。reject / accept のどちらでも**何も押さない・消さない**
- `link-buttons-ja.html` 決定ボタンがすべて実リンクの同意画面（`role="dialog"` の大きなモーダル、本文に「Cookie を使用します」、`<a href="/settings">設定</a>` と `<a href="/consent/all">全てに同意</a>`、下に「プライバシーポリシー」「インプリント」）→ reject では断るボタンが無いので**何も押さずに非表示**（ポリシー・インプリントのリンクは押さない）、accept では「全てに同意」を押す
- `link-reject-ja.html` 同じ形で `<a href="/consent/reject">全て拒否</a>` がある → reject でそれが押される

取りこぼしの緩和（§5-5-d の緩い候補・テキスト長・shadow）向け:
- `custom-element-buttons.html` 決定ボタンが `<x-btn class="fx-deny">`（カスタム要素。`button` タグも `role` もボタンらしい class トークンも無く、手がかりは `cursor: pointer` だけ）→ reject で「すべて拒否」、accept で「すべて許可」
- `long-dialog-ja.html` `position: fixed` だけが手がかりで、本文に規約の抜粋が並んで **5000 文字弱**ある同意ダイアログ（「同意しない」「同意する」）→ reject で「同意しない」、accept で「同意する」（従来の 3000 文字の上限だと丸ごと捨てられていた）
- `shadow-host-root.html` 空のマウント点 `#fx-cookie-root`（`position: fixed` と id だけを持つ）に shadow root が付き、その直下にバナーがある → **容器はホスト自身**になるので、ホストを起点に自分の shadow root の中まで探せないとボタンが見つからない。reject で「すべて拒否」
- `trap-custom-element.html` 誤クリック防止: `custom-element-buttons.html` と同じ形の `<x-btn>` を持つが **Cookie 固有語の無い**アカウント設定モーダル（「削除する」「キャンセル」）。reject / accept のどちらでも**何も押さない・消さない**

設定パネル層（§5-5-e）向け:
- `panel-ja.html` 「設定」と「全てに同意する」しか無いバナー → 「設定」を押すと必須（常に有効・disabled）・機能・分析・広告のチェックボックスと「選択を保存」があるパネルが開く。既定（ほどよく守る = A 許可）で**機能は on のまま、分析と広告が off、必須は触られず、「選択を保存」が押される**
- `panel-reject-all.html` パネルの中に「全て拒否」がある → **トグルに触れず**それを押す
- `panel-no-save.html` 保存ボタンが無く「閉じる」だけのパネルで、**閉じても同意画面が残る**（＝その場で反映されない）→ 望む状態にしてから「閉じる」を押すが確定できないので、バナーとパネルの両方が非表示になる
- `panel-close-only.html` 保存ボタンが無く「閉じる」だけのパネルで、**トグルがその場で反映される**→ 分析と広告を外してから「閉じる」を押し、バナーとパネルが消える（`method: 'panel'`）
- `radio-panel.html` カテゴリごとの選択が「許可 / 拒否」のラジオ 2 択で出るパネル → 設定の記憶は「許可」のまま、分析と広告は「拒否」を選んで「選択を保存」。必須（操作できない）と選択肢が 3 つある行には触らない
- `accordion-panel.html` 設定パネルがページの一部として**元から見えている**（「設定」で中のトグルと保存ボタンが開くだけ）→ 「操作できるトグルが増えた」ことで検出し、分析と広告を外して「選択を保存」
- `spa-banner.html` 1 枚目を処理したあと `history.pushState` でパスを変えると 2 枚目のバナーが出る → 1 秒後に監視がやり直されて 2 枚目も処理される。クエリだけを変えるボタンでは再実行しない（§5-4）
- `trap-panel.html` Cookie 語の無い会員設定モーダル（「設定」ボタン・トグル・入力欄あり）→ **何も起きない**（reject / accept どちらでも）
- `mercedes-like.html` 実サイト（mercedes-benz.co.jp）の構造を写したもの。決定ボタンはすべてカスタム要素 `<wb7-button class="button …">`、最小の容器になる `.cmm-cookie-banner__actions` のテキストには Cookie 語が無く **class だけが手がかり**。「設定」を押すと `.cmm-cookie-banner__content` に `settings-expanded` が付いて `cmm-cookie-settings`（カテゴリ 4 件 + その配下に個別サービスのチェックボックス、先頭に「すべて選択する」）が開く → reject では**カテゴリのチェックだけ**（分析と統計・マーケティング・データ共有）を外して「設定の保存」を押す。必須・個別サービス・「すべて選択する」には触らない。accept では「全てに同意」
- `mercedes-real.html` / `mercedes-real-shadow.html` 同じサイトの**構造（要素名・class・属性・ボタンの文言・`consent-item` の繰り返し）を実 HTML のまま保持し、説明文はこちらで書き直したもの**。`mercedes-like.html` との違いは次の 4 点で、いずれも簡略化の過程で落ちていた条件:
  - `wb7-*` / `cmm-*` は **Stencil の shadow: true**（`class="hydrated"` があり `sc-<tag>` の scope class が無いことから分かる）。`<wb7-button>` は shadow root に `<button><slot></slot></button>` を持つので、**ラッパー判定が shadow を覗くとボタンが全滅する**（上記のラッパー判定の但し書き）
  - `innerHTML` の書き出しには `checked` が載らないので、CMP が付けている `selected-all` / `selected-partial` の class から生きた DOM の状態を復元する（`selected-partial` は「一部だけオン」＝オン + 中間表示）
  - 個別 consent の `aria-label` はサービス名そのもの（「詳細を表示する」ではない）で、`Mercedes Me Login` は HARD 禁止語 `login` に、`Content-Management-System` は非決定語 `manage` に当たる
  - カテゴリの詳細（`.consent-list`）は「詳細を表示する」を押すまで畳まれている
  - `mercedes-real-shadow.html` は同じ中身を `<cmm-cookie-banner>` の **open shadow root** に入れた版（バナーごと shadow に入っていても動くことの確認）

英語バナー向け（語彙・候補要素・容器検出の英語対応をブラウザでも確認できるようにしたもの）:
- `custom-en.html` 独自実装の英語バナー（fixed 下部、"Accept all cookies" / "Reject non-essential" / "Cookie settings"）→ reject で "Reject non-essential"、accept で "Accept all cookies" が押されて消える
- `notice-en.html` 選択肢のない英語の通知バナー（"Got it!" のみ）→ 両モードで押されて消える
- `en-necessary-only.html` 拒否が必要最小系だけの英語バナー（"Accept all" / "Necessary cookies only" / "Manage preferences"）→ reject で "Necessary cookies only"、accept で "Accept all"
- `en-continue.html` "By continuing to browse, you accept our use of cookies." + [Continue] だけのバナー → 両モードで "Continue"（許可の弱一致 = Cookie 固有語ゲートの内側）
- `en-div-buttons.html` `<div class="cc-btn">` だけで作られた英語バナー（role も `button` タグも無い）→ 容器内限定のクリック候補で reject は "Decline"、accept は "Allow cookies"
- `en-static-banner.html` `position: static` な英語バナー（`id="cookie-banner"` の属性ヒントだけが容器候補の理由）→ reject で "Reject"、accept で "Accept"
- `en-icon-banner.html` 説明文がアイコン（インライン SVG）で済まされていて、**可視テキストがボタンの文言だけ**の英語バナー（`class="cookie-consent"` の `position: fixed` な小さいカード。中身は [Reject] [Accept]）→ 本文に**バナー語が 1 つも無い**ので加点方式にする前は容器として採用できなかった。reject で "Reject"、accept で "Accept"
- `trap-newsletter-en.html` 誤クリック防止: Cookie 語の無いニュースレター購読モーダル（"Subscribe" / "No thanks"）。**何も押されず、非表示にもされない**（拒否の弱一致は Cookie 固有語ゲートの内側）
- `trap-tos-en.html` 誤クリック防止: 英語の規約更新モーダル（"We have updated our terms… [I agree][Decline]"）。reject / accept のどちらでも**何も押さない・消さない**
- `trap-ancestor-cookie.html` 誤クリック防止: `main` / `nav` / `article` を使わない div soup のページ（フッターに「Cookie Policy」リンクが 1 本）の中に、祖先の本文の Cookie 固有語だけで `cookieSpecific` になる 5 つの UI を置いたもの。①〜④は**自身の本文にバナー語が 1 つも無い**——規約更新モーダル（`role="dialog"` ＋ [I agree][Decline]）・削除確認ダイアログ（[はい][いいえ]）・固定プロモ（[OK]）・ニュースレター（[Subscribe][No thanks]）——ので、§5-5-d のハード条件 8. が無いと**4 つとも容器として採用され**、reject で Decline / OK / No thanks が押され、削除確認は `display:none` にされていた。⑤は**バナー語だけを持ち Cookie 固有語を持たない**規約更新モーダル（`role="dialog"` ＋「利用規約とプライバシーポリシーを改定しました…」＋ [同意する][拒否]）で、8. は通ってしまうため⒞ の祖先の限定（`canUseAncestorText()`）で止める（無いと reject で「拒否」＝規約に同意しない、が押される）。reject / accept のどちらでも**1 つも押さず・1 つも消さず・検出もしない**（`detectedAny` も立たない）
実サイト巡回（`docs/real-site-audit-2026-09-07.md`）で見つかった取りこぼし向け:
- `usercentrics-shadow.html` deepl.com の Usercentrics。`ASIDE#usercentrics-cmp-ui` は**自身の高さが 0**（実測 1280x0・`innerText` も空）で、open shadow root の中に `DIV#uc-main-dialog[role=dialog]`（説明文だけ）・`A#uc-more-link[role=button]`「さらに詳しく」・`BUTTON#accept`「すべて許可」が**兄弟として**並ぶ。拒否ボタンは無い → reject では `#accept` を**押さずに**ホストごと非表示、accept では即決 CMP 表が `#accept` を押す
- `dailymotion-like.html` dailymotion.com の独自 React UI。`DIV.CookiePopup__desktopContainer___ZCIMO[role=dialog]` の中に説明文・`A.CookiePopup__link___bJ2ng`「当社のクッキーに関する方針。」・`BUTTON`「内容を理解した」 → 既定（ほどよく守る）では「内容を理解した」を押して `dismissed`、プリセット「すべて拒否」（`pressCloseOnNotice: false`）では押さずに非表示。リンクは押さない
- `notice-already-rejected-en.html` theguardian.com の**拒否済みの案内**。`ASIDE.dcr-17eqobb` に「You've chosen to reject third-party cookies while browsing our site.」と `BUTTON`「Collapse banner」 → 同意を求める画面ではないので reject / accept のどちらでも**何も押さず・消さず・`unhandled` にもしない**（監視終了時の報告は `none`）

実サイト巡回・第2巡（`docs/real-site-audit-2026-09-07-round2.md`）で見つかった取りこぼし向け（**3 件とも実 HTML ではなく、監査レポートに載っている DOM 断片とログからの再現**。対象サイトをこの環境で開けないため、一字一句の実 HTML は取れていない）:
- `adidas-like.html` adidas.co.uk の Glass デザインシステム。`DIV.cookie-consent-modal` の中に `DIV#gl-modal__content[role=dialog]`（説明文）・`BUTTON#glass-gdpr-default-consent-accept-button`「Accept all cookies」・`BUTTON#glass-gdpr-default-consent-reject-button-central`「Reject all」が並ぶ。accept ボタンの id に `gdpr` / `consent` が入っているので、**そのボタン自身が最小の容器**として採用され、中に拒否ボタンが無いまま候補 0 → 非表示に落ちていた → reject では即決 CMP 表が兄弟の `Reject all` を押す（`quick:adidas (Glass)`）、accept では `Accept all cookies`。ボタンの中の `<span>` に `cursor: pointer` を明示しているのは、実ブラウザの継承（＝ span が候補になり、ボタンが容器の条件を満たす状態）を jsdom で再現するため
- `trustarc-ibm.html` ibm.com の TrustArc（日本語）。`DIV#truste-consent-track` の中に、説明文と「すべて承諾」だけの `DIV#truste-consent-text` と、`A#truste-cookie-link`「Cookie設定」（実リンク）・`BUTTON#truste-show-consent`「オプションの続き」を持つ `DIV#truste-button-track` が並ぶ。id は監査ログの実測（`DIV truste-consent-text`）に合わせてある。即決表の reject セレクタ `#truste-consent-required` は存在せず、ヒューリスティックは中の最小容器を採るので設定導線が容器の外に出てしまう → reject では即決表が見つけた `#truste-consent-track` を優先して採用し、「オプションの続き」で設定パネルを開き、分析と広告を外して保存する（`method: 'panel'` / `decision: 'granular'` / `allowed: ['A']`）。「すべて承諾」は一度も押さない。accept では即決表が `#truste-consent-button` を押す
- `lego-agegate.html` lego.com の**入口選択ダイアログ**。`DIALOG.AgeGate_age-gate__wrapper__ph949`（jsdom は dialog の UA スタイルを持たないので `position: fixed` を CSS で明示）に「LEGO.comに入ります［続ける］」「プレイゾーン［プレイを楽しむ］」と Cookie 使用の説明文がある → Cookie 同意画面ではないので reject / accept のどちらでも**何も押さず・消さず・検出もしない**（監視終了時の報告は `none`）

独自ボタンの取りこぼし（2026-09-08）で見つかったもの:
- `gakken-like.html` gakken.co.jp（学研ホールディングス）の Cookie バナー。決定ボタンが `<h4>同意</h4>`（`button` タグも `role="button"` も `onclick` もボタンらしい class トークンも持たない）だけで、拒否ボタンは無い → reject では「同意」を押さずに非表示、`fallbackWhenNoReject: 'leave'` では unhandled

- `?mode=accept` のクエリで accept モードを試せるようにする（chrome 無し時の設定上書き）
- `pnpm fixtures` で `dist` と `fixtures` を配信する簡易サーバ（Node 標準 http、ポート 4173、`scripts/serve-fixtures.mjs`）を起動

## 12. テスト（Vitest + jsdom）

- `normalize`: 全角→半角、空白・句読点除去、小文字化。約物の除去は英語ボタン向けに 1 種類ずつ検証する（"Don’t accept"→`dontaccept` / "opt-out"→`optout` / "Accept & Close"→`acceptclose` / "Reject all (recommended)"→`rejectallrecommended` / "Why?"→`why`）。`×` `✕` は残ること
- 文言分類: 拒否語／許可語／閉じる語／非決定語／禁止語の判定（日英）。禁止語は HARD / SOFT の 2 段（SOFT は `strict: false` では禁止にならない）、`確定` が非決定語であること、`order` / `remove` が危険文脈語でないこと、"Accept only essential cookies" が必要最小系として扱われ許可語にはならないこと
- **英語ボタン文言の分類表**: 実サイトでよく見る英語ボタン 60 件以上を `forbidden-hard / forbidden-soft / non-decision / reject-strong / reject-minimal / reject-weak / accept-specific / accept-bare / accept-weak / close` に分類する表を持ち、1 件ずつ検証する。語彙を広げたときに「どのゲートで守られているか」が崩れていないことを見るのが目的なので、期待値は候補の並び順ではなく判定関数の組み合わせそのもの
- 容器検出と候補採点: fixtures 相当の DOM を組み、`isVisible` と `getPosition` を注入して reject / accept 各モードで選ばれるボタンを検証。trap では候補ゼロを検証
- 英語バナーの候補収集: 容器の中に限り `[onclick]` とボタンらしい class トークン（`.cc-btn` `.btn` `.cmp__button`）も候補にすること（`<div class="cc-btn">Got it!</div>`）、容器の外の `.btn` は拾わないこと。reject モードの並び順が「強一致 > 必要最小 > 弱一致」であること、拒否の弱一致（"No thanks"）は Cookie 固有語のある容器でだけ候補になること
- ボタンの親ラッパーを候補にしないこと: BEM の 2 段ラッパー（`.cookie-banner__buttons > .btn-group`）の中の "Reject all" が第 1 候補になる／`onclick` 付きの内側ラッパーがあっても reject モードで同意が走らない／`.buttons` `.btn-group` はトークン一致しない／`<div class="buttons"><button>Got it</button></div>` の決定ボタンが 1 つに数えられて閉じる語が押せる／`<a href="/leave"><div class="btn">Decline</div></a>` の div は候補にならない／**shadow root の中に実装の `<button>` を持つ web components 製ボタン（`<x-button class="button">Reject all</x-button>`）はラッパー扱いにせず、ホストが候補になる**（`deepQueryAll` の `ownShadow: false` も単体で検証する）
- 実リンクの決定ボタン（§5-5-d の緩和）: Cookie の容器なら `<a href="/consent/all">全てに同意</a>` は候補になるが、「プライバシーポリシー」「インプリント」「詳細」「OK」「No thanks」のリンクは候補にならない／Cookie 固有語の無い容器では `<a>全て拒否</a>` も候補にならない／HARD 禁止語のリンクは候補にしない／リンクの中の要素は `a` 自身と重ねて候補にしない／文脈を渡さない `collectButtons()` では従来どおり実リンクを拾わない。設定パネル層は実リンクの「設定」を設定ボタンにしないこと。fixtures（`link-buttons-ja` `link-reject-ja`）は両モードで統合検証する
- 緩い候補（§5-5-d のカスタム要素・`data-*` ボタン）: Cookie 固有語のある容器なら `cursor: pointer` の `<my-button>すべて拒否</my-button>` が候補になるが、Cookie 固有語の無い容器では同じものが候補にならない／`cursor: pointer` でも「削除する」のような決定語でない文言は候補にしない／`tabindex="0"` と `data-*` ヒントの経路／緩い候補どうしが入れ子なら内側だけ・ふつうのボタンの中の要素は候補にしない／`disabled` `aria-hidden` `display:none` は拾わない／設定ボタンは候補にはなるが決定ボタンにはならない／実リンクの中の緩い候補は従来どおり除く。fixtures（`custom-element-buttons` `trap-custom-element`）は両モードで統合検証する
- 容器のテキスト長（§5-5-d）: 本文に Cookie 固有語のある fixed な容器は 5000 文字でも採用し、8000 文字を超えたら採用しない／Cookie 固有語が無ければ（祖先の属性ヒントで `cookieSpecific` になる容器でも）従来どおり 3000 文字で切る。fixture は `long-dialog-ja`
- root 自身の shadow root（§5-5-d）: `deepQueryAll` / `deepQueryFirst` / `deepElements` にホスト要素を渡したとき、その shadow の中の要素が取れること／ホストが容器になっても候補を拾えること。fixture は `shadow-host-root`
- 高さ 0 の shadow ホスト（§5-5-d）: ホスト自身の矩形が下限に届かなくても shadow root 直下の可視な子で測り直すこと／ホストの `innerText` が空でも shadow の中の本文でバナー語・Cookie 固有語を判定すること／**shadow root を持たない要素の下限は変わらない**こと／shadow の中の子も小さければ容器にせず、`relaxSize` を渡したときだけ採用すること。fixture は `usercentrics-shadow`（reject で `#accept` を押さずに hide・accept で `#accept` を押す・`leave` なら `no-reject`）
- 即決 CMP 表の取りこぼし（§5-5-b）: 拒否ボタンが無い CMP でも、その容器が fallback（hide）に渡ること／失敗要約に `cmp`（CMP 名）と容器・見つかった許可ボタンが残ること（`container:null` にしない）
- 拒否済みの案内（§5-5-d）: 完了状態の文言 + 折りたたみボタンだけの容器は採用しないこと／同じ文言でも「Reject all / Accept all」があれば従来どおり採用すること／完了状態の文言が無ければ閉じる語だけの通知は従来どおり採用すること。fixture は `notice-already-rejected-en`（両モードで何も起きず `detectedAny` も立たない）
- 通知型ダイアログの日本語（§5-5-d の閉じる語）: `内容を理解した` `理解した` `了承しました` `確認しました` が完全一致で閉じる語になり、「内容を理解して同意する」は当たらないこと。fixture は `dailymotion-like`（既定で `dismissed`・`pressCloseOnNotice: false` で hide・accept でも押す）
- 進行ログの重複（§5-8）: 同じ内容の行は 1 監視窓に 1 回だけ出て、パスの締めくくり行は毎回出ること
- 診断属性（§5-8）: `watching` / `watching+debug` / `handled` / `unhandled` / `none` / `off` が状態の変化どおりに `<html data-cookie-autopilot>` に書かれること／サイト側に消されても次の状態変化と `DOMContentLoaded` の後に付け直すこと
- `unhandled` の理由（§5-8）: 断る候補が無いだけなら `no-reject`／押しても消えなければ `click-failed`／容器は検出したのに候補が集まらなければ `no-candidates`／パネルを開いて中止したら `panel-aborted`／何も検出しなければ理由を付けないこと
- 拒否側の曖昧な文言: `<button>Accept all<small>You can opt out at any time</small></button>` は reject 候補にならず、"Do not accept all" は従来どおり拒否候補になること
- 年齢確認ゲート: "Are you over 18? …cookies…" の容器では `[Yes] [No]` も `[Continue]` も両モードで候補ゼロになること。"Manage" "storage" "message" を含むだけのふつうのバナーはゲート扱いにしないこと
- reject モードの閉じる語: `[Continue] [Manage settings]` は reject で候補ゼロ（fallback の hide に落ちる）・accept では Continue を押すこと。`[Got it!] [Learn more]` は従来どおり閉じる語を押すこと。`pressCloseOnNotice: false`（すべて拒否）では `notice-only.html` / `notice-en.html` のボタンを押さず hide（`decision: 'hidden'`）になり、`leave` なら `unhandled` になること
- 即決 CMP 表: 容器の中にボタンが無くても document 全体へは広げないこと（`#usercentrics-root` の外にある `#deny` を押さない）。容器セレクタが cloak に使われるので、`#consent-page` の外の `.consent-form` や `[open]` の無い `#ccc` には一致しないこと
- `position: static` なバナー: `id="cookie-banner"` の強い属性ヒントだけで検出し（`signals` に `attr-cookie` があり `overlay` は無い）、reject / accept 各モードで期待どおりのボタンが押されること（`detect` と `run` の両方）
- 容器の加点（§5-5-d の③）: `containerScore()` を **signal ごとに 1 件ずつ**、その signal だけを立てた `ContainerFacts` で点数と `signals` を検証する（`text-cookie` だけは `COOKIE_WORDS ⊂ BANNER_WORDS` なので `text-banner` を必ず伴う）。加えて、閾値ちょうど（4 点＝採用されうる下限の `attr-cookie` ＋ `decision-weak`）の容器が採用されること・`ancestor-cookie` ＋ `decision-weak` の 3 点では閾値に届かないこと・`ancestor-cookie` は `attr-cookie` / `text-cookie` があるときは加算しないこと・`decision-strong` / `decision-weak` が**子孫の**ボタンから決まり、ボタン自身は容器にならないこと・`overlay` が `role="dialog"` / `aria-modal` / fixed / sticky から（＝入口の足切りが見た値から）付くこと。fixture は `en-icon-banner`（本文にバナー語が無い＝加点方式にして初めて採用される形）
- 自身の本文のバナー語（§5-5-d のハード条件 8.）: 祖先の本文にだけ Cookie 語がある div soup で、自身の本文にバナー語が無い規約更新モーダルを**採用しないこと**／自身の属性が Cookie を名指ししていれば本文にバナー語が無くても採用すること（`signals` に `attr-cookie` があり `text-banner` は無い）。fixture は `trap-ancestor-cookie`（5 パターンとも両モードで何も押さず・消さず・`detectedAny` も立たない）。この fixture の 5 パターンはどれも次項の⒞の限定で `isCookieSpecific()` 自体が偽になり条件 9. で先に落ちるので、**ハード条件 8. だけを単独で固定するテストは別項**に置いてある
- ハード条件 8. の単独固定（2026-09-09）: 祖先に notice の名乗りを持たせて⒞を通し（`isCookieSpecific()` は真になる）、自身の本文にはバナー語を持たせない容器を作り、それでも**採用しないこと**を検証する。レビューの実測で、ハード条件 8. の行をまるごと削除しても既存 824 件（`trap-ancestor-cookie` を含む）は 1 件も落ちないことが判明した（既存の罠は全部⒞の限定＝条件 9. で先に落ちるため、条件 8. だけが効くケースがそれまで無かった）ので、条件 8. だけが効くケースを切り出して固定した
- 祖先の本文を根拠にしてよい範囲（§5-5-d の 9. ⒞）: 祖先が `#root` のような**名乗りの無い入れ物**のときは、その本文に Cookie 語があっても `isCookieSpecific()` が偽になること／`class="cookie-banner"` `class="consent-box"` `class="notice"` `role="dialog"` の 4 パターンでは従来どおり真になること／`main` を内包する祖先は（バナーらしい名乗りがあっても）見ないこと／祖先の本文が `MAX_TEXT_LENGTH_COOKIE`（8000 文字）以上なら名乗りがあっても根拠にしないこと・短ければ従来どおり真になること／名乗りの無い `position: fixed` な祖先を⒞ の対象から外しても**多くの構造では祖先自身が容器になるので取りこぼさない**こと（例外は祖先が入力欄・サイト構造〔main/nav/article〕を内包する場合・本文が長い場合・`position` が static な場合。残存リスクは本書末尾を参照）
- 英語 fixtures の統合: `custom-en` `notice-en` `en-necessary-only` `en-continue` `en-div-buttons` `en-static-banner` は期待どおりのボタンが押され、`trap-newsletter-en` `trap-tos-en` は両モードで何も押されず消されないこと
- Cookie バナー以外を触らないこと: 固定チャットウィジェット・sticky ヘッダー・規約ダイアログを容器にしない／押さない／非表示にしない。fixtures（`trap-chat.html` `dialog-tos.html` `dialog-tos-fixed.html` `dialog-tos-consent-class.html`）でも両モードで何も起きないことを検証
- 容器の Cookie 固有語ゲート: `position` だけ・汎用属性ヒント（`class="consent-modal"` `class="privacy-modal"`）だけが理由の容器は Cookie 固有語が無ければ採用しない／強い属性ヒント（`class="cookie-banner"` `class="cookie-consent"`）があればバナー語だけで採用する。「同意する」は Cookie 固有語のある容器でだけ押し、「すべて許可」は容器の文脈なしでも押す
- hide の範囲: BEM のボタン行が最小容器でも外側の容器を消す／`position: sticky` なヘッダー（position 起点の候補）までは登らず容器だけを消す／ポータルルートに新しい子が追加されたら祖先の hide を解除し、容器は消したままにする（そのとき元の inline `display` に戻す）
- 退場判定（`defaultIsFaded` / `defaultIsOffscreen`）: 祖先の `opacity:0` で真、`body` 自身の指定は見ない、自前の cloak 由来の `opacity:0` は偽、祖先が `visibility:hidden` でも自身が `visible` なら偽
- COM の cloak: `hide { selector: 'html' }` で `html` に cloak が付かない／失敗したルールの cloak が解除される
- content script（jsdom + fake timers）: 実行中パスの最中に `startPicker` するとパスが打ち切られ fallback も走らない／picker 中止後の再開で cloak の `<style>` が張り直される／実行中の `rerun` は二重に走らずパス完了後に 1 回だけ再実行される／picker 中の `rerun` は無視される
- service worker: `watching` を保存してもバッジは空のまま／既存の `handled` を上書きしない／`handled`・`unhandled` で上書きされる
- `importConfig` の全置換: 新しい `cr:*` の書き込みに失敗しても旧データを消さない
- カスタムルール: セレクタが別ボタンに一意一致（文言不一致）／不可視／禁止語では押さない。文言経路は容器の中だけを探し、汎用文言は Cookie 固有語のある容器に限る
- クリックの成功判定: `transform` で画面外に出る／`opacity:0` になるバナーで成功を検出し、そのあと許可ボタンには触れないこと
- 容器の危険文脈語: Cookie 固有語の無い容器（「パスワードを削除しますか」等）は除外し、Cookie 固有語のある容器（"We use cookies in order to …"）は採用してボタン単位の禁止語で守る
- 禁止語の 2 段化: 「保存して閉じる」はヒューリスティックの候補にならないがカスタムルールでは押せる／「削除する」はカスタムルールでも押さず picker でも登録できない
- hide の条件と対象: 許可ボタンが無い／Cookie 固有語が無い容器は非表示にしない。hide しない経路（accept モード・`fallback=leave`）では cloak を外して抜ける。モーダルはバックドロップごと消す。サイト本来の `overflow:hidden` は戻さない。クラス由来の `overflow:hidden` は inline の override で解除し、その後 `class` が変わったら override を外す
- content script（jsdom + fake timers）: 監視窓の終了と進行中パスが競合しても `handled` が報告されること、`rerun`、picker 中止後に cloak が外れて監視が再開すること
- COM 解釈器: 小さなルール JSON（css / onoff matcher + click / list / consent(checkbox+toggle) / ifcss / waitcss / ifallowall / ifallownone）を jsdom 上で実行し、期待どおりクリック・トグルされることを検証。未知 type が例外を出さないこと、`negated` / `url` matcher / `iframeFilter` の意味、`waitcss` が制限時間と打ち切り要求で止まることも検証
- fallback の猶予: 猶予中に拒否ボタンが現れて成功するケースと、猶予後に hide されるケースの両方を検証（時間は注入した `EngineEnv` の仮想時計で進める）
- 設定パネル層（§5-5-e）: 行テキストからのカテゴリ推定（A/B/D/E/F と X）、必須系・`disabled` / `readonly` / `aria-disabled` の除外、行テキストの取り出し（他のトグルを含まない最小の祖先 → 取れなければ属性）、状態の読み書き（`checked` / `aria-checked`）、不可視 input を `label` 経由で押すこと、発動条件（accept モード・実行済み・断る候補あり・Cookie 固有語なし・監視窓の残り不足では試さない）、中止条件（パネルが出ない／入力欄／危険文脈語／保存にも閉じるにも使えるボタンなし／触れる部品が 0）でトグルに触らないこと
  - 許可 / 拒否のラジオ: 2 択だけをペアにすること（3 択・片側しか読めないグループは触らない）、「許可しない」が拒否側になること、グループの行テキストからカテゴリを引くこと、望む側が既に選ばれていれば触らないこと
  - 「すべてオフ」系が拒否ボタンとして扱われること、保存ボタンが無くても「閉じる」があれば望む状態にしてから閉じること（閉じるも無ければ・操作できないトグルが残るなら触らないこと）、元から可視の容器でも操作できるトグルが増えたらパネルとして扱えること
  - fixtures（`panel-ja` `panel-reject-all` `panel-no-save` `panel-close-only` `radio-panel` `accordion-panel` `trap-panel`）は両モードで統合検証する
- 画面遷移（§5-4）: `pushState` でパスが変わると監視をやり直すこと、クエリ・ハッシュだけの変化では再実行しないこと、連続した遷移は 1 回にまとまること、picker 中は無視すること、滞在中の再実行が 5 回で止まること
- `siteKey`: `www.tesla.com`→`tesla.com`、`a.b.example.co.jp`→`example.co.jp`、`localhost`→`localhost`
- picker のセレクタ生成: id あり／data-testid あり／ハッシュクラスのみ（selector 省略）の 3 ケース

## 13. 完了条件

- `pnpm install && pnpm rules:fetch && pnpm typecheck && pnpm test && pnpm build` がすべて成功し、`dist/` に読み込める拡張ができている
- README.md（日本語）にインストール・使い方・仕組み・限界・Consent-O-Matic との併用可否（同時に入れると二重に操作するので、本拡張を使うなら Consent-O-Matic は無効化を推奨）を記載
- commit はしない

## 14. プリセットと初期設定（UX 改修。§3 / §7 / §8 / §9 と矛盾する場合は本節が優先）

目的: Cookie をよく知らない人でも迷わず使えるようにする。専門用語（Consent-O-Matic、CMP、カテゴリ記号）は UI に出さない。「すべて許可」は UI のどこにも置かない（悪意のありそうな用途は常に拒否）。

### 14.1 用語とデータモデル

```ts
type Preset = 'strict' | 'minimal' | 'relaxed' | 'none'; // しっかり守る / ほどよく守る / ゆるく守る / すべて拒否
type CategoryKey = 'A' | 'B' | 'D' | 'E' | 'F' | 'X';    // 既存 ComCategory と同じ
interface Settings {
  preset: Preset | 'custom';                 // 既定 'minimal'。詳細設定でトグルを個別に変えると 'custom'
  allowCategories: Record<CategoryKey, boolean>; // 実効の許可カテゴリ（旧 rejectAllowCategories を改名。preset を選ぶとこの値も書き換える）
  pressCloseOnNotice: boolean;               // 選択肢のないお知らせで閉じるボタンを押すか。既定 true（'none' のときだけ false）
  onboarded: boolean;                        // 初期設定を完了したか。既定 false
  fallbackWhenNoReject: 'hide' | 'leave';    // 'accept' は UI から削除（型からも外す。既存値 'accept' は 'hide' に読み替え）
  showBadge: boolean; debug: boolean; observeSeconds: number;
  // defaultMode は削除。実効モードは siteOverride が 'off' なら 'off'、それ以外は常に 'reject'
}
type SiteOverride =                         // サイトごとの設定（確定版は §14.9）。未設定 = 全体の設定に従う
  | { kind: 'custom'; allow: Record<CategoryKey, boolean> }
  | { kind: 'off' };
type SiteOverrides = Record<string, SiteOverride>;
```

- プリセット → 許可カテゴリ（`shared/presets.ts` に定数として置く）:
  - `strict`（しっかり守る）: なし
  - `minimal`（ほどよく守る・既定）: A
  - `relaxed`（ゆるく守る）: A, B, E
  - `none`（すべて拒否）: なし（strict と同じ）
  - D / F / X はどのプリセットでも拒否。詳細設定のトグルでは個別に ON にできる（その場合 preset は 'custom'）
- **`none`（すべて拒否）の位置づけ**: 必須 Cookie は同意画面側でオフにできないので、カテゴリの許可という意味では `strict` より厳しくできない。そこで 4 つ目は「**同意を意味するボタンを一切押さない**」を差分にする:
  - 断るボタン・「必要なもののみ」系は従来どおり押す（＝断る意思表示）
  - **選択肢がひとつしかないお知らせ（「OK」「了解」「Got it」など閉じる語だけの画面）ではボタンを押さない**（`pressCloseOnNotice: false`。§5-5-d の閉じる語の条件）。代わりに「断れなかったとき」の設定（既定 `hide`）に落とすので、結果は `dismissed` ではなく `hidden`（`leave` なら `unhandled`）になる
  - デメリット（UI のコピーで伝える）: サイトに答えを返さないので同じ画面が何度も出ることがある／サイトによっては一部の機能が使えない
  - `PRESET_ORDER`（UI に 3 枚のカードとして並べるもの）は `strict` / `minimal` / `relaxed` のまま。`none` は別扱いの定数（`EXTRA_PRESET`）にし、UI では 3 枚の下にコンパクトなカードとして置く（§14.3）
  - `savePreset('none')` は `{ preset:'none', allowCategories: すべて false, pressCloseOnNotice: false }` の 3 つを揃えて書き、他のプリセットを選んだときは `pressCloseOnNotice` を true に戻す（`settingsForPreset(preset)` が 3 つの組を返し、onboarding の 1 回保存もこれを使う）
  - `saveAllowCategories()`（トグルの個別操作）は従来どおり `presetFromCategories()` で preset を引き直し（この関数は `'none'` を返さない。すべて false は `'strict'`）、`pressCloseOnNotice` も true に戻す。つまり `'none'` は**カードを明示的に選んだときだけ**の状態
  - `preset` は保存値ではなく「許可カテゴリ + `pressCloseOnNotice`」から引き直す（`mergeSettings`）。許可カテゴリがあるのに `pressCloseOnNotice` だけ false という UI から作れない保存値は、既定（true）に揃える
  - サイトごとの override（`{kind:'custom', allow}` / `{kind:'off'}`）は**このフラグを持たない＝全体設定にだけ効く**（§14.9）
- 実効カテゴリの決め方: サイトに `custom` の override があればその `allow`、無ければ `settings.allowCategories`（§14.9）
- 「必要なもの」（必須 Cookie）はカテゴリではなく常に許可。UI では一覧の先頭に「常に許可」と表示する
- ヒューリスティック／即決表の経路は従来どおり「拒否 or 必要最小のボタン」を押す（プリセットの差は、サイトが細かく選べる同意画面のときだけ現れる）。この事実を UI で一言添える: 「サイトが細かく選べるようになっている場合は、この設定どおりに選びます。選べないサイトでは、必要なもの以外を断ります。」
- `Mode` 型の `'accept'` と カスタムルールの `action: 'accept'` はエンジン内部・テスト（fixtures の `?mode=accept`）のために残すが、UI からは作れない。popup の「許可ボタンを教える」は削除
- 移行: 既存の保存値に新フィールドが無ければ既定値で埋める（`onboarded` は false、`pressCloseOnNotice` は true）。旧 `defaultMode` `rejectAllowCategories` は読み替えて捨てる。既存 override の変換は §14.9（プリセット名 → `custom`、`'reject'` → strict 相当、`'accept'` は削除）

### 14.2 カテゴリの表示名と説明（確定コピー。`shared/copy.ts` に置き、onboarding / popup / options で共用）

| key | 表示名 | 一言 | 説明（初心者向け） |
|---|---|---|---|
| 必須 | 必要なもの | 常に許可 | ログイン状態やカートの中身など、サイトが動くために欠かせないもの。これが無いとサイトが使えないので、常に許可します。 |
| A | 設定の記憶 | 実害はほぼなし | 言語・文字サイズ・地域などの設定を次回も覚えておくためのもの。渡るのは「あなたが選んだ設定」だけで、他社に渡ることはほとんどありません。 |
| B | アクセス解析 | 匿名の利用データ | どのページが何回見られたかをサイト運営者が知るためのもの（Google アナリティクスなど）。閲覧したページ・滞在時間・おおまかな地域・端末の種類が解析会社に渡ります。多くは個人が特定されない形に加工されます。 |
| D | 端末への保存 | 分析や広告の土台 | 端末に識別用の番号を保存し、あとから読み出す仕組み。それ自体に用途はなく、分析や広告の土台になります。用途が絞れないので、断っておくのが安心です。 |
| E | おすすめの表示 | 行動が記録される | あなたがサイト内で何を見たかから、おすすめの記事や動画を選び、その効果を測るためのもの。広告ではありませんが、サイト内での行動が記録されます。 |
| F | 追跡型の広告 | 最も避けたい | 一度見た商品の広告が別のサイトでも追いかけてくる仕組み。閲覧履歴や興味関心が広告会社（数十〜数百社）に共有され、長期間保持されます。 |
| X | その他 | 用途が不明 | 上のどれにも当てはまらない用途。中身が分からないので断っておくのが安全です。 |

プリセットの説明:
- **しっかり守る**: 必要なもの以外はすべて断ります。いちばん安心ですが、サイトによっては表示の設定が次回に引き継がれません。
- **ほどよく守る（おすすめ）**: サイトを快適に使うための「設定の記憶」だけ許可し、分析や広告は断ります。
- **ゆるく守る**: サイト運営者のアクセス解析とおすすめ表示も許可します。追跡型の広告と用途不明のものは断ります。
- **すべて拒否**（4 つ目。3 枚とは別枠で小さく置く。「おすすめ」は付けない）: 断るボタンがあれば断り、「OK」しかない画面では何も押さずに画面を消します。サイトに答えを返さないぶん、同じ画面が何度も出たり、一部の機能が使えないことがあります。

共通の注意書き: 「追跡型の広告と用途が不明なものは、どの設定でも断ります。」

### 14.3 初期設定ページ（onboarding）

- `public/onboarding.html` + `src/onboarding/onboarding.ts`（esbuild のエントリに追加）。SW の `onInstalled` で `reason === 'install'`、または `reason === 'update'` かつ `settings.onboarded === false` かつ `storage.local.onboardingShownAt` が未記録のときに `chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })` で開く（自動で開いたら時刻を記録し、更新のたびには開かない）。popup と options からも「設定する」「はじめの設定をもう一度見る」で開ける（popup / options は自分で `chrome.tabs.create` を呼び、開き終えてから popup を閉じる。SW の `openOnboarding` メッセージは tabs API が使えない環境向けのフォールバック。popup を先に閉じると SW への送信が届かないことがあるため）
- 構成（幅 560 中央、`docs/DESIGN.md` のトークン。白カード radius 16 + 影、見出し 22px 500、本文 14px、説明 13px muted）:
  1. 見出し「Cookie Autopilot へようこそ」／一文「サイトを開いたときに出る Cookie の同意画面に、あなたの代わりに答えます。」
  2. 「どこまで許可しますか？」— 3 枚の選択カード（radio）。非選択は白地＋1px 枠（`--border`）、選択は 2px 相当の黒枠（`--wb-900`。`box-shadow: inset` で表現しレイアウトは動かさない）。`minimal` を初期選択し「おすすめ」バッジ。各カードにプリセットの説明と、許可するカテゴリの表示名をチップで並べる（「必要なもの」は全カードに）。保存済みの `preset` が `'custom'`（詳細設定で個別に調整済み）のときは、カードの上に notice「現在は詳細設定で個別に調整されています。ここで選ぶと上書きされます。」を出す
     - その 3 枚の**下**に 4 つ目「すべて拒否」（`EXTRA_PRESET`）を**コンパクトなカード**（`.preset-card-compact`: padding `--space-3`、名前 13px 500、説明 12px `--fg-muted`、チップは出さない）で置く。同じ radiogroup の中に入れ、選択時の見え方（白地・黒枠）は 3 枚と同じ。部品は `ui/presetPicker.ts` の共通実装なので、初期設定ページと詳細設定の両方に同じものが出る
  3. 「それぞれの Cookie は何をするの？」— 7 カテゴリのアコーディオン（`<details>`）。表示名・一言・説明。各行に「しっかり守る / ほどよく守る / ゆるく守る」のどれで許可されるかを小さく示す
  4. 注意書き「追跡型の広告と用途が不明なものは、どの設定でも断ります。」と「サイトが細かく選べるようになっている場合は、この設定どおりに選びます。選べないサイトでは、必要なもの以外を断ります。」
  5. PushButton dark「この設定で始める」→ `preset` と `allowCategories` と `onboarded=true` を **1 回の `saveSettings` で**保存
     - **成功時**: HUD トースト「設定しました」を出す（options と同じ `.hud`。画面下部中央固定 `position: fixed`、`.hud-fixed-center`。1.2 秒で自動消滅）。カードの中身を完了表示に差し替える: 見出し 18px 500「設定しました」（`role="status"` を付け、通常の見出しではなくこれで 1 回だけ読み上げさせる）／本文 14px「Cookie の同意画面が出るサイトを開いてみてください。」／選んだ設定の要約を 13px `--fg-muted` で 1 行「いまの設定: <`PRESET_COPY[preset].name`>」／カウントダウン 13px `--fg-muted`「<N> 秒後にこのタブを閉じます」（1 秒ごとに更新。`aria-live` は付けない）／ボタン行 PushButton dark lg「今すぐ閉じる」・ghost「閉じない」・ghost「詳細設定を開く」
     - **自動クローズ**: 5 秒後に `chrome.tabs.getCurrent()` で自分のタブを取り `chrome.tabs.remove(tab.id)`。取れなければ `window.close()` にフォールバック。どちらも追加の権限を必要としないので `manifest.json` は変更しない。「閉じない」を押したらカウントダウンを止め、カウントダウンの行と「今すぐ閉じる」ボタンを消す（「詳細設定を開く」のみ残す）。「詳細設定を開く」を押したときもカウントダウンを止める（設定を見ている最中に自動で閉じないようにするだけで、表示はそのまま）。`chrome.tabs.getCurrent` / `remove` が無い環境（fixtures プレビュー）ではカウントダウンと「今すぐ閉じる」「閉じない」を出さず「詳細設定を開く」だけにする
     - タイマー（`setInterval`）は変数に持ち、「閉じない」と `pagehide` で確実に `clearInterval` する。`prefers-reduced-motion: reduce` では HUD のフェードを無効化する（theme.css の既存の仕組みにそのまま乗る）
     - **失敗時**: 完了表示にはせず、従来どおり danger 色の HUD で「保存できませんでした: <理由>」を表示
- `chrome` が無い環境（fixtures サーバ）でも既定値で描画し、保存は無効化して見た目を確認できる

### 14.4 popup（改修）

上から順に:
1. サイト名 + 状態バッジ。バッジはサイト名の**下**に置く（横並びにすると、長いホスト名がバッジに押されて 1〜3 文字ずつ折り返される）。文言は状態が分かる最短のものにし、説明は 2. の「このサイトでの結果」に任せる: handled「✓ 処理しました」/ none「同意画面なし」/ unhandled「見つかりませんでした」/ off「無効」/ watching「確認中」/ 取得前「確認しています…」/ 取得できない「同意画面なし」/ 非対応ページ「このページでは使えません」。初期設定が未完了なら最上部に notice「最初の設定がまだです」＋ small Button「設定する」（onboarding を開く）
2. **このサイトでの結果**（新設）。`TabStatus.decision` に応じて:
   - `granular`: 「サイトの選択画面で選びました」＋ チップ 2 列: 許可 = 必要なもの + `allowed` の表示名 / 拒否 = 残りのカテゴリ
   - `reject-all`: 「『<clickedLabel>』を押しました」＋ 許可 = 必要なもの / 拒否 = それ以外すべて
   - `custom`: 「教えたボタン『<clickedLabel>』を押しました」＋ 同上
   - `dismissed`: 「選択肢のないお知らせを閉じました。このサイトは Cookie を使います」（チップなし）
   - `hidden`: 「同意画面を非表示にしました。何も許可していません」
   - decision なしの `handled`: 「サイトの同意画面を閉じました。」（チップなし）
   - `unhandled`: `TabStatus.reason`（§5-8）で説明文を出し分ける — `no-reject` / 理由なし「断るボタンが見つかりませんでした。」/ `no-candidates`「同意画面は見つかりましたが、押せるボタンを判別できませんでした。」/ `panel-aborted`「設定画面を開きましたが、項目を判別できませんでした。」/ `click-failed`「ボタンを押しましたが、同意画面が閉じませんでした。」。いずれもヒント「下の『断るボタンを教える』で登録できます」は共通で付ける（バッジは従来どおり「見つかりませんでした」のまま）
   - `none`: 「このページでは Cookie の同意画面は出ていません。」/ `watching`: 「いまのところ Cookie の同意画面は出ていません。出てきたら自動で対応します。」/ `off`: 「このサイトでは動かさない設定です。」/ 取得できない: 「このページでは Cookie の同意画面は出ていません。」（いずれもバッジの繰り返しにはしない）
3. **このサイトの設定**: ControlRow を丸ごとボタンにした 1 行で、押すと詳細画面へドリルダウンする（構成は §14.9）。プリセットの選択と「全体の設定に従う」は popup から無くす（全体の設定は詳細設定ページのみ）
4. フッター: PushButton dark「断るボタンを教える」（旧「拒否ボタンを教える」。全 UI で「拒否」→「断る」に統一）、ghost「このページで再実行」、リンク「詳細設定 →」。「許可ボタンを教える」と「全体の既定」は削除

**以前の記録の表示**（新設。§14.8）: 1〜4 は現在のタブの状態が `handled` / `unhandled` / `off` のとき（＝現在の結果が確定しているとき）の説明で、この場合は常に現在の結果を優先する。それ以外（`none` / `watching` / タイムアウト / 読み込み中）で `getSiteHistoryEntry(siteKey)` に記録があれば、現在の結果の代わりに記録を表示する: バッジは「✓ 対応済み」（success）。2. の代わりに、`decision` が `granular` / `reject-all` / `custom` →「<日付>にこのサイトの同意画面に答えたので、今回は出ていません。」＋ チップ（描き方は 2. の `handled` と同じ。`granular` は `allowed` から、`reject-all` / `custom` は「必要なもの」／「それ以外すべて」）。`dismissed` →「<日付>に同意画面を閉じました。今回は出ていません。」。`decision` なし →「<日付>にこのサイトの同意画面に答えたので、今回は出ていません。」（チップ無し）。日付は `Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric' })`（年が違えば `year: 'numeric'` も付ける）。`watching` 中はこの記録を優先して表示し続け、今回の `handled` が届いたら現在の結果に切り替える。記録が無いときは 1〜4 のとおり従来の文言のまま

### 14.5 詳細設定（options。改修）

カード順:
1. **どこまで許可しますか？**（見出し文言は onboarding と共通）— 3 プリセットの選択カード + 4 つ目「すべて拒否」のコンパクトカード（onboarding と同じ部品。§14.3-2）＋ 小見出し「それぞれの Cookie は何をするの？」＋ onboarding と共通のカテゴリ表（`ui/categoryTable.ts`。表示名・一言・説明の `<details>` 開閉、「しっかり守る／ほどよく守る／ゆるく守る」の ✓／— マーク 3 列。**凡例は 3 列のまま**にする。「すべて拒否」の許可カテゴリは「しっかり守る」と同じ内容になり、列を足しても同じ印が並ぶだけでノイズになるため）。options では表の右にさらに「あなたの設定」列を足し、「必要なもの」行は固定の ✓（常に許可・操作不可）、A/B/D/E/F/X 行は ToggleSwitch でその場から ON/OFF できる。トグルを個別に変えると preset 表示が「カスタム」になる（プリセットカードは全非選択に）。注意書き 2 文を末尾に
2. **断れなかったとき** — ラジオ 2 つ「同意画面を非表示にする（おすすめ）」「そのまま表示しておく」
3. **サイトごとの設定** — host + Badge「個別に調整」（`custom`）／「動かさない」（`off`）+ ghost「削除」。`custom` のときは許可している項目名を 12px muted で添える（例「許可: 必要なもの・設定の記憶」。§14.9）
4. **教えたボタン** — host / Badge「断る」/ 文言（mono）/ ghost「削除」。action が accept の既存ルールがあれば「許可」Badge で表示だけする
5. **判定ルールの更新** — 「同意画面を見分けるルールを週に 1 回自動で更新します。」＋「最終更新: ○年○月○日」＋ Button outline「今すぐ更新」。失敗時は理由を小さく表示。**Consent-O-Matic の名前・件数・ライセンス表記はここに出さない**（出典と MIT 表記は README と `third_party/consent-o-matic/LICENSE` に残す）
6. **その他** — バッジ表示、監視秒数、デバッグログ、「はじめの設定をもう一度見る」（onboarding を開く）
7. **バックアップ** — 従来どおり（全置換の注記を含む）

### 14.6 ステータス報告の拡張（content → SW → popup）

```ts
type Decision = 'granular' | 'reject-all' | 'custom' | 'dismissed' | 'hidden';
interface TabStatus { …既存…; clickedText?: string; clickedLabel?: string; decision?: Decision; allowed?: CategoryKey[]; }
```
- `com:` 経路で consent を操作できたとき → `granular`、`allowed` = そのとき望んだ状態が true のカテゴリ（consent の判定は §4 のとおり）
- `quick:` / `heuristic` で拒否語・必要最小系を押したとき → `reject-all`
- `panel`（§5-5-e）でパネルの選択を保存できたとき → `granular`、`allowed` = オンのまま残したカテゴリ（パネル内の拒否ボタンを押した場合は `allowed: []`）。`clickedLabel` は「選択を保存」「全て拒否」のような保存ボタンの文言になる
- カスタムルール → `custom`
- 閉じる語（選択肢のない通知）→ `dismissed`
- `method: 'hide'` → `hidden`
- **`com:` 経路で consent を操作しなかったとき**は、押したボタンの文言（`clickedText`）を `shared/phrases` で分類する: 拒否語・必要最小系 → `reject-all` / 閉じる語 → `dismissed` / 許可語・分類できないもの → **`decision` を付けない**。同梱ルールには「許可を押すだけ」「閉じるだけ」のものがあり、一律 `reject-all` にすると popup が事実と逆の報告をしてしまうため
- **`clickedText` は照合用の正規化文言**（小文字化・空白と約物の除去）なので画面には出さない。表示には `clickedLabel`（`innerText` → `value` → `aria-label` → `title` を trim + 連続空白の畳み込みだけした文言。80 文字で省略）を使い、無ければ `clickedText` で代用する
- popup はこれだけで結果表示を組み立てる（カテゴリ記号は表示名に変換）

### 14.7 文言の統一
- 「拒否」→「断る」（ボタン・見出し）。「Cookie バナー」→「Cookie の同意画面」。「CMP」「Consent-O-Matic」「ルール名」「カテゴリ記号（A/B/…）」は UI に出さない
- 見出しは体言止め、説明はですます、ボタンは動詞（`docs/DESIGN.md` §4）

### 14.8 サイトごとの対応記録（新設）

目的: 一度 `handled` になったサイトは、次回以降 Cookie の同意画面自体が出ない（＝サイト側が「もう聞かない」と覚えているため）。そのため popup が「このページでは Cookie の同意画面は出ていません。」としか言えず、何もしていないように見える。以前どう答えたかを別途記録し、popup / options で振り返れるようにする。

```ts
interface SiteHistoryEntry {
  host: string;                 // siteKey。record（下記 SiteHistory）の key と同じ値を持つ
  decision?: Decision;          // §14.6
  allowed?: CategoryKey[];      // decision === 'granular' のときの許可カテゴリ
  clickedLabel?: string;
  method?: string;              // 'custom' | 'quick:<name>' | 'com:<ruleName>' | 'heuristic'
  at: number;
}
type SiteHistory = Record<string /* siteKey */, SiteHistoryEntry>;
// chrome.storage.local: siteHistory = SiteHistory
```

- `shared/storage.ts`: `getSiteHistory()` `getSiteHistoryEntry(host)` `recordSiteHistory(entry)`（同じ host は上書き。件数の上限は 500 件で、超えたら `at` が古いものから削除する）`removeSiteHistoryEntry(host)` `clearSiteHistory()` を持つ。書き込みは他の保存系と同じく失敗を reject して伝播する（H6）。`onStorageChanged` は変化したキー名をそのまま渡す既存の実装のままで、`'siteHistory'` の変化もそのまま購読できる
- SW（`handleStatus`）: `status === 'handled'` を受けたとき、`method === 'hide'` でない限り `recordSiteHistory({ host, decision, allowed, clickedLabel, method, at })` を呼ぶ。`hidden`（`method === 'hide'`）は同意していないので記録しない（バナーは再訪のたびに出て毎回隠すだけなので、現在の結果表示で足りる）。`dismissed`（選択肢のない通知を閉じただけ）を含め、それ以外の `handled` はすべて記録する。記録の保存に失敗しても `saveTabStatus` と同じく致命的ではないので無視する
- **エクスポート／インポート（§9 / §14.5-7）には含めない**（`ExportBundle` は設定のバックアップのためのもので、`siteHistory` は履歴なので対象外）
- popup の表示は §14.4「以前の記録の表示」のとおり
- options（§14.5）: 「その他」カードに「対応したサイトの記録: N 件」と ghost Button「記録を消す」（`clearSiteHistory()`）を追加。「サイトごとの設定」カードの一覧では、記録がある host に小さく「<日付>に対応」を添える（`formatHistoryDate` は popup と同じ書式）

### 14.9 サイトごとの設定（ドリルダウン + 項目ごとのトグル。§14.1 / §14.4-3 / §14.5-3 を上書き）

目的: 「このサイトだけ、この項目を許可したい」を popup からそのまま操作できるようにする。プリセットは全体の設定でだけ選ぶものにし、サイトごとの設定は「全体の設定に従う／項目ごとに調整する／動かさない」の 3 状態にする。

```ts
type SiteOverride =
  | { kind: 'custom'; allow: Record<CategoryKey, boolean> }   // このサイトだけ項目ごとに調整
  | { kind: 'off' };                                          // このサイトでは動かさない
type SiteOverrides = Record<string /* siteKey */, SiteOverride>;
```

- 旧形式は読み込み時に変換する: プリセット名（`'strict' | 'minimal' | 'relaxed'`）→ `{ kind: 'custom', allow: allowRecordForPreset(preset) }`、`'off'` → `{ kind: 'off' }`。さらに古い `'reject'` は strict 相当の `custom`、`'accept'` は削除（= 全体の設定に従う）
- `effectiveMode(host, overrides)`: `kind === 'off'` なら `'off'`、それ以外は `'reject'`
- `effectiveCategories(host, settings, overrides)`: `kind === 'custom'` なら `allow` の true 集合、無ければ `settings.allowCategories`（`off` は空）
- `shared/storage.ts` の API: `setSiteOverride(host, override | null)`（null で削除）に加えて
  - `setSiteAllow(host, patch: Partial<Record<CategoryKey, boolean>>)` — override が無ければ全体の `allowCategories` を土台に `custom` を作る。`off` のときも同じ土台で `custom` に戻してから適用する
  - `setSiteOff(host, off: boolean)` — `true` で `{ kind: 'off' }`。`false` は直前の `allow` を復元できないので **override ごと削除して全体の設定に戻す**
  - どちらも書き込み失敗は reject して伝播する（H6）
- エクスポートは新形式。インポートは新旧どちらの形式も変換して受け入れ、`kind` が不正なものは理由付きで reject する

**popup のメイン画面**（§14.4-3 の置き換え）: 「このサイトの設定」は ControlRow（h40 / radius 12 / `--bg-row` / 枠 `--border-row`）を丸ごと `<button>` にする。左にラベル「このサイトの設定」、右に要約（12px `--fg-muted`）＋ シェブロン「›」。要約は override 無し →「全体の設定と同じ」、`custom` →「このサイトだけ調整中」、`off` →「動かさない」。

**popup の詳細画面**（ドリルダウン）: 押すとメインの内容（結果・サイト設定行・フッターのボタン）を隠し、同じ popup 内（幅 320、高さは内容に合わせる）に表示する。

1. ヘッダー: ghost ボタン「← 戻る」（13px）＋ タイトル「このサイトの設定」（15px 500）＋ その下にホスト名（12px `--fg-muted`）
2. カテゴリ 7 行（`ESSENTIAL_COPY` + `CATEGORY_KEYS` の順。各行 h40、左に表示名 14px と一言 12px muted、右にトグル。「必要なもの」は ✓ 固定で title「常に許可」。行の区切りは 1px `--hairline`。`ui/categoryToggles.ts`）。表示名＋一言を押すと行の直下に説明文（`description`。onboarding のカテゴリ表と同じ文言）が開閉する（シェブロンが回転）。複数行を同時に開け、右のトグルとは独立して操作できる。初期状態は `effectiveCategories(host)`（override があればそれ、無ければ全体）。トグル操作で `setSiteAllow(host, { [key]: on })` を即保存し、override が無ければこの時点で作られる。失敗は HUD で理由を出す
3. 区切りの下に 1 行「このサイトでは動かさない」＋ トグル（`setSiteOff`）。ON のときカテゴリのトグルは disabled
4. フッター: outline Button「全体の設定に戻す」（override が無いときは disabled）→ `setSiteOverride(host, null)` → トグルを全体の値に同期し、要約も更新。12px muted の注記「変えた内容はこのサイトだけに効きます。」
- 「戻る」でメインに戻る。メインの要約は最新の override を反映する。`onStorageChanged` の `siteOverrides` で詳細画面のトグルも同期する
- HUD は詳細画面でも出す必要があるため、フッターの中ではなくフッターの直上（`.popup > .hud`）に置く
- `chrome` が無い環境（fixtures サーバ）では操作を無効化したうえで、行ボタンと「← 戻る」、カテゴリ説明の開閉ボタン（chrome.storage 不要の読み取り専用操作）だけ有効にして詳細画面の見た目を確認できるようにする

**詳細設定（options）の「サイトごとの設定」カード**: Badge は「個別に調整」（`custom`）／「動かさない」（`off`）。`custom` のときは許可している項目名を 12px muted で添える（例「許可: 必要なもの・設定の記憶」）。「削除」は従来どおり override を削除する。

**エンジン・content**: `run.ts` / `content/index.ts` は `effectiveMode` / `effectiveCategories` 経由なので変更不要。`restart()`（再実行）は override を読み直す（既存挙動）。

- 容器の `cookieSpecific` は「自身の本文の Cookie 固有語」「自身か 5 階層以内の祖先の強い属性ヒント」「祖先の本文の Cookie 固有語（`body`/`html` と `main`/`nav`/`article` を内包する祖先は除く）」のいずれかで真になる。ボタンだけが並ぶ行（「設定 / 全てに同意」）を Cookie バナーの一部として扱うため

### 取りこぼしを減らすための追補（2026-09-07）

- **強い拒否語は SOFT 禁止語より優先**する。「すべて解除」「全て解除」は `解除` が SOFT 禁止語に当たるが、断るボタンそのものなので候補に残す（`decisionCandidates`）。総量マーカーの無い「選択を解除」は非決定語のまま（チェックを外すだけで保存しない可能性があるため押さない）
- **SPA の遷移検出は `location.pathname` の定期確認**で行う（1.5 秒間隔・最大 10 分・`pagehide` で停止）。content script は isolated world なのでページ側の `history.pushState` を差し替えても捕まえられず、`popstate` だけでは push 遷移を取りこぼすため

### shadow DOM の中に現れる同意画面（2026-09-07）

- Stencil などの Web コンポーネントは、**同意画面を丸ごと shadow root の中に描く**（実サイト `mercedes-benz.co.jp` の `<cmm-cookie-banner>` は light DOM が空で、中身はすべて shadow root）。**shadow root の中の変化は `document` に張った MutationObserver には届かない**ので、変化を待つだけでは永久に見つけられない
- 対策: 監視窓のあいだ **1 秒間隔で見直す**（`POLL_INTERVAL_MS`。`src/content/index.ts`）。MutationObserver は従来どおり残し、取りこぼしの保険として定期チェックを併用する。パスが実行中・処理済みのときは走らせない

### 実サイト巡回・第2巡の反映（2026-09-07）

`docs/real-site-audit-2026-09-07-round2.md` の 3 件（adidas UK / IBM / LEGO）への対応。**IBM はブラウジングポリシーで実 DOM を取得できていない**ため、真因は実ログから推測できる範囲でしか特定できていない。実ログの理由コード `panel-aborted` は `src/engine/run.ts` の `fallbackReason(panelAborted, clicked)` が返すもので、**パネルを実際に開いたあとに中止した**ことしか意味しない（設定ボタンが見つからずパネルへ進めなかった場合の理由は `no-reject` になる。監査レポートの adidas のログがその形）。したがって「IBM で設定導線（`#truste-show-consent`）自体が見つかっていなかった」とは言えず、**最有力は⑤**（パネルの保存ボタン「設定を送信」が危険文脈語「送信」と誤判定されて中止していた可能性）である。②（即決容器の優先）と⑥（`オプション`）は IBM の確定した真因の修正ではなく、**同型の構造への備え**として位置づける。

- **① 操作要素は容器にしない**: `BUTTON` `A` `INPUT` `SELECT` `TEXTAREA` `OPTION` `LABEL` `SUMMARY` と、`role="button"` / `role="link"` を名乗る要素は、**どのヒント経路でも容器候補にしない**（当時は `containerHintKind` の先頭で落としていた。現在は `evaluateContainer` のハード条件 2.）。adidas UK の `BUTTON#glass-gdpr-default-consent-accept-button`（「Accept all cookies」）は id に `gdpr` / `consent` を含むため強い属性ヒントに当たり、**そのボタン自身が最小のバナー容器**として採用されていた。容器の中に拒否ボタンは無い（兄弟にある）ので候補 0 のまま猶予切れ → 非表示に落ちる。属性ヒントがどれだけ強くても、押す対象そのものはバナーの入れ物ではない。従来の `NON_CONTAINER_TAGS` は残す——あちらは `position` 判定（`getComputedStyle`）のコストを避けるための足切りで、属性・role・dialog の経路には効かない
- **② 即決 CMP 表の容器を中の断片より優先する（同型の構造への備え）**: ヒューリスティックが拾った最小容器を**内包する**即決表の容器（`RunState.quickContainers`。「その CMP だと言い切れる」セレクタに一致したもの）があれば、`evaluateContainer(el, env, { relaxSize: true })` で評価し直して**先頭に据える**（残りのリストは後ろに残す。hide の範囲を決める `outermostContainer` が使うため）。従来は「ヒューリスティックが容器を 1 つも拾えなかったときだけ」の控えだった。TrustArc のように、即決表が容器（`#truste-consent-track`）を見つけても reject セレクタ（`#truste-consent-required`）が存在しないと、ヒューリスティックは**中の最小テキスト容器**を採ってしまい、設定導線（`#truste-show-consent`）が容器の外に出て設定パネル層へ進めなくなる。**IBM の実ログがこの経路を辿ったとは確認できていない**（真因は上記のとおり⑤の可能性が高い）が、同型の構造を持つ他の CMP への備えとして入れてある
- **③ パネル層に限り「設定を送信」型の保存ボタンを許す**: `PANEL_SUBMIT_WORDS` = `/submit\s*(?:my\s*)?(?:preferences?|choices?|settings?|selections?)|(?:設定|選択)を送信/i`。`panelButtons()` は HARD 禁止語（`submit` / `送信`）に当たってもこれに一致するボタンを残し、`findSaveButton()` は保存語（`SAVE_WORDS`）に加えてこれも保存ボタンとして扱う。安全なのは ⒜ この経路は**自分で開いた Cookie 設定パネルの中**しか見ない ⒝ `abortReason()` が入力欄（password / email / text / tel / number / textarea）のあるパネルを先に弾く ⒞ 文言を「preferences / choices / settings / selection を submit する」型に限定している（裸の "Submit"「送信」は従来どおり押さない）の 3 つが重なっているため
- **④ 入口ゲート・年齢ゲートの属性を持つ要素は容器にしない**: id / class / aria-label が `AGE_GATE_ATTRIBUTE` = `/(?:^|[^a-z])(?:age[-_\s]?gate|age[-_\s]?verif|age[-_\s]?check|birth[-_\s]?date|date[-_\s]?of[-_\s]?birth|entry[-_\s]?gate)/i` に当たる要素は、**どのヒント経路でも容器にしない**。LEGO の入口選択ダイアログ（`DIALOG.AgeGate_age-gate__wrapper__ph949`。「LEGO.comに入ります［続ける］／プレイゾーン」＋ Cookie の説明文）を同意画面として採用すると、決定候補が「続ける」しか無いので `no-reject` の**未処理サイトとして報告**してしまう（クリック・非表示はしないので安全面は正しい）。可視テキストを見る `AGE_GATE_CONTEXT`（弱一致を止める既存の仕組み）とは別物。見るのは**その要素自身の属性だけで祖先は辿らない**——年齢ゲートのオーバーレイの中に別途 Cookie バナーが入っている構造まで捨ててしまわないため。先頭の `(?:^|[^a-z])` は `manage-gateway` `page-gateway` のような語への部分一致よけ。区切りは `[-_\s]?` で aria-label の空白区切り（`Age verification` 等）にも当たる
- **⑤ パネル層の危険文脈語判定は「設定を送信」型の文言を除いて見る**: `abortReason()` はパネルの可視テキストに危険文脈語（`hasDangerousContext`）があるとトグルに触らず中止するが、`送信` はこの危険文脈語に含まれるため、除かずに見ると**保存ボタンが「設定を送信」であるだけでパネルを中止してしまう**（TrustArc 日本語版の実文言はこちらなので、③を入れただけでは IBM を処理できていなかった可能性が高い。上記のとおり実 DOM は取れていないので確定はできない）。`abortReason()` は判定の前に `withoutSubmitPhrases()` で `PANEL_SUBMIT_WORDS` に一致する言い回しだけをテキストから取り除く（`g` 付き正規表現の `lastIndex` を持ち回らないよう、呼び出しごとに `RegExp` を生成する）。取り除くのはこのパターンに一致する言い回しだけなので、「お問い合わせを送信」「アカウントを削除」のような本物の危険文脈は残り、従来どおり中止の対象になる。`fixtures/trustarc-ibm.html` の保存ボタンは実文言どおり「設定を送信」に戻してある
- **⑥ `オプション` を `SETTINGS_BUTTON` に追加する（同型の構造への備え）**: `SETTINGS_BUTTON` に `オプション`（英語の `options` に対応する日本語）を追加した。TrustArc 日本語版の設定導線「オプションの続き」のように、設定ボタンがカタカナの「オプション」表記しか無い CMP を設定パネル層（§5-5-e）で認識するため。**`NON_DECISION` には入れていない**——「オプションのCookieを拒否」のような**総量マーカーの無い拒否ボタン**まで非決定語にして決定候補から落としてしまうため（`overridesNonDecision` は `すべて` / `全て` / `all` / `everything` を要求する）。設定導線を見つけるのに必要なのは `SETTINGS_BUTTON` 側だけで足りる

**残存リスク**: `INTERACTIVE_TAGS`（①）はタグ名と `role` だけで見るので、`<wb7-button>` のようなカスタム要素のボタンは依然として容器候補になり得る。`<div class="cc-btn">Got it!</div>`（role も `button` タグも持たない独自バナー。§5-5-d）を容器にできる余地を残す必要があるため、「クリック候補なら容器にしない」と単純化することはできない。

### 独自ボタンの取りこぼし（2026-09-08 / gakken.co.jp）

学研ホールディングス（gakken.co.jp）の Cookie バナーが検出できず、popup に「同意画面なし」と表示されていた。

- **症状**: `DIV.ux_popup_cookie_warning`（class に `cookie` を含むので強い属性ヒント）の中に、決定ボタンが `<div class="title4 highlight no-icon"><h4>同意</h4></div>` の `<h4>` だけがある。`button` タグでも `role="button"` でも `onclick` でもなく、class も `title4` でボタンらしい class トークンを持たない。拒否ボタンは無い（サイトの案内は「同意いただけない場合はブラウザを閉じてください」）
- **原因**: `<h4>` は緩い候補の経路（§5-5-d。`cursor: pointer` で `isLooseClickable` は通る）に来るが、`isLooseText()` が強い決定語・設定ボタンしか通さず「同意」（許可の弱一致）を弾いていたため、候補が 0 件 → 決定ボタンも 0 件 → 容器自体が不採用（`evaluateContainer` が `null`）→ 監視終了時の報告が `unhandled` ですらなく `none`（未検出）になっていた
- **対応**: `isLooseText()` に弱一致（許可の弱一致・拒否の弱一致・閉じる語。完全一致のみ）を追加した。安全な理由は5点——①この経路は `cookieSpecific` な容器の中でしか使わない ②弱一致は完全一致でしか当たらない ③ reject モードでは許可の弱一致（「同意」「OK」）は `scoreCandidates` が候補にしないので押されない（容器を成立させて `canHide` を満たすためだけに使う）④裸の許可語（`ACCEPT_STRONG_BARE` の「同意する」「accept」等）は引き続き対象外のまま ⑤ `isLooseText()` は `context.ageGate` を受け取り、年齢確認ゲートの容器では弱一致・閉じる語をそもそも候補にしない（`scoreCandidates` の `weakOk` と同じ判断基準）。⑤ はレビューで見つかった穴（弱一致を候補に含めるだけなら押しはしなくても、年齢確認ゲート＋Cookie 文言の入り混じった容器で決定ボタン候補が生まれ、同意画面ではない容器まで検出扱い＝cloak の対象になってしまっていた）を塞ぐために追加した
- **結果**: このサイトは拒否ボタンが無いので、reject では「同意」を押さずに容器を非表示にする（`method: 'hide'`, `decision: 'hidden'`）。fixture は `gakken-like.html`

### 容器検出を加点方式にする（2026-09-08）

`evaluateContainer()` の容器判定を「独立した必須条件の連鎖」から「**必須条件（ハード条件）＋ 加点 ＋ ネスト条件**」に作り替えた（§5-5-d を全面的に書き直してある）。

- **なぜ変えたか**: 実サイトで容器を拾えなかった例は、**すべて「条件は揃っているのに 1 つだけ欠けた」形**だった。従来の判定はどれか 1 つでも欠けると全部落ちるので、欠けた 1 つが致命傷になっていた
  - メルセデス（`mercedes-benz.co.jp`）= 最小容器になるボタン行の本文に Cookie 語が無い（`text-cookie` が欠ける）
  - IBM（TrustArc）= 選ばれた断片の中にボタンが無い（`decision-*` が欠ける）
  - adidas = 最小要素がボタン自身になった（そもそも容器にしてはいけない要素）
  - 学研（`gakken.co.jp`）= ボタンの文言が弱い語しか無い（`decision-strong` が欠ける）
  - これらは個別に条件を足して塞いできたが、同じ「1 つ欠け」は今後も別の形で出る。**手がかりが複数あるなら 1 つ欠けても採用できる**形にしておくのが構造的な対処になる
- **入口の足切り（①）は据え置き**。属性ヒント / `role="dialog"` / `aria-modal` / `position: fixed`・`sticky` のどれにも当たらない要素は、そもそも評価しない。理由は**性能**（全要素の `innerText` を読むと大きなページで重い）と**安全**（プライバシーポリシー本文の「Cookie の説明 ＋ 同意ボタン」のようなページ内セクションを容器にしない）の 2 つで、加点方式にしても変わらない。返り値が種別（`ContainerHintKind`）から真偽に変わっただけ
- **ハード条件（②）は安全側の要求そのもの**なので、1 つでも欠けたら容器にしない従来どおりの扱い。とくに **Cookie の名指し（`cookieSpecific`）と決定ボタンの存在は外していない**——ここを加点に落とすと「規約更新モーダルで『同意しない』を押す」「バナーでない固定 UI を消す」が起きうる
- **加点（③）に移したのはバナー語（`hasBannerWord`）だけ**。必須から 1 点の signal（`text-banner`）に降格した。閾値 4 は「今日採用されている容器を 1 つも落とさない」ように決めてある（§5-5-d の③）。実際、既存テスト 799 件は 1 件も落ちていない。**ただしこの「無条件に外す」形は安全側の後退で、下記のとおりレビューで差し戻している**
- **新しく通るようになるのは「本文にバナー語が無いバナー」**。説明文を画像・アイコンで済ませ、可視テキストがボタンの文言だけという実装がこれに当たる（fixture `en-icon-banner.html`）
- **診断（§5-8）に内訳を出す**: `DetectedContainer` の `hint` を `score` / `signals` に置き換え、進行ログの容器行に `score=8 [attr-cookie/text-cookie/overlay/decision-weak]` を、`unhandledSummary()` の JSON に `score` / `signals` を足した。**どの手がかりで容器と判断したか**が利用者の報告だけで分かるようにするため。`hide` の範囲を広げる先の判定（`outermostContainer`）も「`attribute` / `attribute-generic` の容器だけ」から「`attr-cookie` か `attr-consent` を持つ容器だけ」に読み替えてある（意味は同じ）
- **残る懸念**: ハード条件を通った要素は必ず 4 点以上になるので、**閾値は今のところ足切りとして働かない**（§5-5-d の③）。今回の変更で採否を決めているのは実質ハード条件で、加点は「バナー語を必須から外す」ことと診断の言語化が効果の中心である。閾値が意味を持つのはハード条件を緩めたときで、そのときは配点の見直しも要る
  - **下限まで書くと**: 修正後の「採用されうる構成の下限」は `attr-cookie` 3 ＋ `decision-weak` 1 = **4 点＝閾値と同値**なので、閾値は 1 件も足切りしていない。それ以外の容器（バナー語が要る側）は必ず 5 点以上になる

#### レビューで見つかった後退とその修正（2026-09-09）

上の「バナー語を**無条件に**必須から外す」が安全側の後退になっていた。`runOnce()` を実際に回して再現済み。

- **何が起きたか**: ハード条件で残る Cookie の名指し（`isCookieSpecific()`）には**最弱の経路**がある——「5 階層以内の祖先の本文に Cookie 固有語がある」（⒞）。`isBannerSizedAncestor()`（当時）が除くのは `main` / `nav` / `article` を内包する祖先だけなので、**セマンティックタグを使わない div soup の SPA では、フッターの「Cookie Policy」リンク 1 本で 5 階層ぶんの子孫がすべて `cookieSpecific` になる**。バナー語まで外すと、**自身は Cookie についても同意についても一言も書いていない要素**が容器になれてしまう。実測（`mode: 'reject'` / 既定設定）:
  - `<div class="modal" role="dialog">We have updated our Terms of Service…[I agree][Decline]</div>` → score=5 `[ancestor-cookie/decision-strong/overlay]` → **「Decline」をクリック**（accept では「I agree」）
  - `<div class="dlg" role="dialog">この記事を削除しますか？[はい][いいえ]</div>` → score=4 → 候補 0 → fallback で **`display:none`**
  - `<div class="promo" style="position:fixed">アプリで見るともっと便利[OK]</div>` → score=4 → **「OK」をクリック**
  - `<div class="newsletter" style="position:fixed">…[No thanks]</div>` → score=4 → 拒否候補として採用
  - 旧実装ではこれらはすべて「本文にバナー語が無い」で落ちていた。**規約を勝手に Decline する・無関係な固定 UI を消す／押すはこの拡張で最も重い事故**
- **修正①（ハード条件 8. の追加）**: バナー語を必須に戻すのではなく、**自身の属性が Cookie を名指ししている容器（`attr-cookie`）だけを免除する**形にした。今回広げたかった `en-icon-banner`（`class="cookie-consent"` ＋ アイコンだけ）と mercedes の `.cmm-cookie-banner__actions` は `attr-cookie` を持つので通り、上の 4 パターンは通らない。**置く位置は `isCookieSpecific()` の前**で、性能の意味もある——祖先の本文を読む経路に進む要素が減る。`main` を使わない div soup（カード 300 件・フッターに Cookie Policy リンク）で `getText` の読み取りを計測すると **1200 回 / 8,669,780 文字 → 300 回 / 1,500 文字**（採用される容器も 300 件 → 0 件）
- **修正②（死んでいた危険文脈語のガードを生き返らせる）**: `!cookieSpecific && hasDangerousContext(text)` は 9. と重なって永久に到達しなかった。条件を「**自身に Cookie の根拠が無い**（`attr-cookie` も `text-cookie` も無い＝根拠が祖先由来だけ）」に変え、「この記事を削除しますか？」型に対する二重の歯止めとして効かせた
- **修正③（入口と加点で同じ述語を使うことをコードで保証）**: `containerScore()` が `hintAttributes()` / `hasContainerHint()` / `isOverlay()`（`getComputedStyle`）を再計算していたのをやめ、`ContainerFacts` に `attributes` / `attrCookie` / `overlay` を載せて `evaluateContainer()` が 1 度だけ求める形にした（引数から `el` / `env` が消えた）。「入口の足切りを通った要素は必ず 1 点以上を得る」＝閾値が取りこぼしを生まないという不変条件が、片方だけ条件を変えたときに静かに壊れるのを防ぐため
- **回帰テスト**: 既存 813 件はこの後退を 1 件も検出できなかった。`trap*.html` はどれも「ページのどこにも Cookie 語が無い」ことに依存していて、**祖先の本文にだけ Cookie 語がある配置**が未カバーだったため。fixture `trap-ancestor-cookie.html` を足し、両モードで**1 つも押さず・1 つも消さず・`detectedAny` も立たない**ことを検証する（修正前は 4 パターンとも落ちることを確認済み）

### 祖先の本文を根拠にしてよい範囲を絞る（2026-09-09）

上の修正（ハード条件 8. のバナー語）で塞いだのは「**自身の本文にバナー語が無い**容器」までで、**自身の本文にバナー語だけがある容器**は残っていた。`isCookieSpecific()` の⒞（祖先の本文の Cookie 固有語）で本文を見てよい祖先を、**その祖先自身がバナーらしい名乗りを持つとき**に限定して塞いだ。

- **症状**: `main` / `nav` / `article` を使わない div 入れ子のページで、フッターに「Cookie Policy」のリンクが 1 本あるだけで、周辺の要素がまとめて Cookie バナー扱いになる。`#root` `.content` のような**ただの入れ物**の `innerText` には**別の枝**にあるフッターの文言まで含まれるためで、`isBannerSizedAncestor()`（当時）が止めるのはサイト構造タグを内包する祖先だけだった。実測（`mode: 'reject'` / 既定設定）:
  - `<div class="update" role="dialog">利用規約とプライバシーポリシーを改定しました。内容をご確認のうえ、同意しますか？[同意する][拒否]</div>` → `text-banner`（プライバシー・同意）＋ `ancestor-cookie`（フッターのリンク）＋ `overlay`（`role="dialog"`）＋ `decision-strong` = **score=6 で採用 → 「拒否」をクリック**（＝規約に同意しない、を代行してしまう）。英語版の "We have updated our Terms and Privacy Policy … [I agree][Decline]" も同じ
  - **これは加点方式（2026-09-08）で作った後退ではなく、それ以前からある穴**である。⒞ は mercedes-benz.co.jp 型（ボタン行だけが最小容器になる構造）のために足した経路で、当時から「どんな祖先の本文でも根拠にしてよい」形だった。加点方式の導入でハード条件のバナー語が外れたときに**同時に見つかったのが 8. の側だけ**で、バナー語を持つ規約更新モーダルは旧実装でも同じように採用されていた
- **原因**: ⒞ が見ていたのは祖先の**大きさ**（`body` / `html` でない・サイト構造タグを内包しない）だけで、**その祖先がバナーかどうか**を一切見ていなかった。ハード条件 8.（自身の本文のバナー語）は「Cookie についても同意についても一言も書いていない要素」しか落とせないので、**規約更新モーダルのように同意を求める文言を持つ UI は通ってしまう**——`プライバシー` も `同意` も `consent` もバナー語であり、それは Cookie バナー以外の同意画面でも同じだからである
- **対応**: ⒞ で本文を根拠にしてよい祖先を `canUseAncestorText()` に切り出し、**① その祖先自身がバナーらしい名乗りを持つ**（`hasBannerLikeName()`。id/class/aria-label が `CONTAINER_HINT` / `CONTAINER_HINT_GENERIC` / `CONTAINER_HINT_WEAK` のいずれか、または `role="dialog"` / `aria-modal="true"`）**② ページ全体・サイト構造の入れ物でない**（従来の条件。関数名は実態に合わせて改名した）の **AND** にした
  - **①は属性の読み取りだけで完結させる**（`position: fixed` は根拠に足さない）。`EngineEnv`（`getComputedStyle`）を `isCookieSpecific()` まで引き回さずに済ませるためで、取りこぼしにもならない——fixed な無名の祖先はそれ自身が容器の条件（`overlay` ＋ 本文の Cookie 固有語）を満たすので、**容器がボタン行から祖先に移るだけ**でクリックも hide も従来どおり効く
  - 強いヒント（cookie 系）を名乗る祖先は⒝ の属性判定で先に真になるので⒞ には来ない。**⒞ で実際に効くのは「`consent` / `privacy` / `banner` / `notice` を名乗る祖先」と「`dialog` を名乗る祖先」**だけになった。mercedes の `.cmm-cookie-banner__actions` は**自身の class に cookie がある**ので⒝ で真になり、この限定の影響を受けない
- **回帰テスト**: fixture `trap-ancestor-cookie.html` に**5 つ目のパターン**（上の日本語の規約更新モーダル）を足した。修正前は reject で「拒否」が実際に押される（fixture のログに 2 回記録され、そのあと fallback で `display:none` になる）ことを確認済み。単体では `isCookieSpecific()` を、名乗りの無い祖先（`#root`）で偽・`cookie-banner` / `consent-box` / `notice` / `role="dialog"` の 4 パターンで真・`main` を内包する祖先では（名乗りがあっても）偽、として検証する
- **既存テストへの影響（2 件。期待値は書き換えていない）**: どちらも「**名乗りの無い祖先**の本文を根拠に `isCookieSpecific()` が真になる」ことを直接アサートしていた箇所で、今回の限定が意図どおり効いたことの裏返しである
  - `detect.test.ts`「祖先の本文にだけ Cookie 語があっても、自身の本文にバナー語が無ければ採用しない」の**補助アサーション**（`.page` を祖先とする `#tos` が `cookieSpecific` になること）。テストの主旨である「容器にしない」（`evaluateContainer` が `null`・`findContainers` が 0 件）は今も通る
  - `detect.test.ts`「ボタンだけの行でも、親の見出しに Cookie 語があれば Cookie バナー扱いにする」（mercedes-benz.co.jp 型を `class="mbj-layer"` に単純化したもの）。実サイトの class は `cmm-cookie-banner__*` で⒝ に当たるため、`mercedes-like` / `mercedes-real` / `mercedes-real-shadow` の 3 fixture は通ったままである
- **祖先の本文の長さの上限を追加（2026-09-09 のレビューで判明した穴。⒞の限定だけでは塞げていなかった）**: ⒞ の限定（バナーらしい名乗り＋ページ構造を内包しない）だけでは、`banner` / `notice` のような弱い名乗りを持つ**ページ全体のラッパー**——`class="site-notice-area"` のような、実体はページ丸ごとの入れ物——の下に、無関係なモーダル（`role="dialog"` の規約更新「利用規約とプライバシーポリシーを改定しました…［同意する］［拒否］」）を置くと、フッターの Cookie Policy がその無関係なモーダルの根拠になり、reject の候補が `['拒否']` になることが実測された（`hero-banner` `promo-banner` `noticeboard` のような他の弱い名乗りでも同様）。祖先の本文を Cookie の根拠にしてよいのは、その祖先自身が「バナーそのものだと言い切れる大きさ」のときだけ、という条件を candidates.ts の `canUseAncestorText()` に足した（上限は `MAX_TEXT_LENGTH_COOKIE` と同値の 8000 文字。detect.ts からの import は循環依存になるため candidates.ts 側に値を複製している）。⒞ はもともと祖先の本文を読んでいる（`hasCookieWord(getText(current))`）ので、取得済みの文字列の `length` を見るだけで読み取り回数は増えない
- **残存リスク（本文長の上限を足しても塞ぎ切れていないもの）**:
  - 弱い名乗り（`banner` / `notice`）や `role="dialog"` を名乗る**入れ物**の下では、同じ誤クリック（規約更新モーダルの「拒否」を押す）が残りうる。本文長の上限で**実サイト規模のページ（本文が長い）は落ちる**が、ページ全体が短いサイトでは残る
  - §5-8 の診断で `ancestor-cookie` の signal が付いた容器は追えるので、実サイト巡回のときはそこを見れば拾える
  - 規約更新モーダル**自身の本文に Cookie 語がある**場合（例:「規約と Cookie ポリシーを改定しました…［同意する］［拒否］」）は経路⒜（自身の本文）で真になるため、⒞の限定では塞げない。別軸（語彙・危険文脈語）でしか詰められない既知の限界
  - `canUseAncestorText()` の入れ物判定（`main` / `nav` / `article` を内包するか）は `querySelector`（光の DOM のみ）で見ている。`detect.ts` の `wrapsPageStructure()` は `deepQueryFirst`（shadow DOM を横断）なので、shadow root 越しにサイト構造を内包する祖先は⒞ ではすり抜ける。既存の不揃いで、今回は直していない
