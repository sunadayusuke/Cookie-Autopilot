# 実サイト Cookie 同意 UI 監査（2026-09-07）

## 目的

Chrome に読み込まれた Cookie Autopilot を使い、CMP と実装方式が異なる大規模サイトを巡回した。
同意 UI が実際に消えたケースだけを成功とし、表示されなかったサイトは成功に数えない。

## 条件と判定ルール

- 実施日: 2026-09-07（Asia/Tokyo）
- ブラウザ: ユーザーの Chrome（既存プロファイル）
- 拡張のデバッグログ: ON
- サイトデータは消していない。既訪問サイトでは同意済み Cookie の影響があり得る
- `成功`: `[cookie-autopilot] ... → 成功` と `処理完了` があり、同意 UI が残っていない
- `非表示`: 拒否を送信できなかったが、設定どおり `fallback: 非表示にした` で UI が消えた
- `失敗`: 20 秒の監視後も同意 UI が画面に残った
- `未評価`: 同意 UI が最初から表示されず、拡張による処理か既存 Cookie かを分けられない

## 結果一覧

| # | サイト | 想定・検出 CMP | 結果 | 証拠・注記 |
|---:|---|---|---|---|
| 1 | Mercedes-Benz Japan | Usercentrics / 独自 Web Components | 対象外 | ユーザーが直前に確認済みで同意 UI は出なかった |
| 2 | Reuters | 未検出 | 未評価 | 同意 UI なし。フッターの `Manage Cookies` のみ |
| 3 | Nike Japan | 未検出 | 未評価 | 同意 UI なし。フッターの「プライバシー設定」のみ |
| 4 | IKEA Japan | OneTrust | 未評価 | `#onetrust-banner-sdk` は DOM に残るが `display:none; visibility:hidden`。既存状態か今回処理かを分離できず |
| 5 | Amazon UK | 独自 `FORM#cos-banner` | **成功** | ヒューリスティックが `Decline` を押し、約 818 ms で成功 |
| 6 | eBay UK | eBay | **成功** | 即決 CMP 表の eBay ルールで成功 |
| 7 | Yahoo | 未検出 | 未評価 | `?guccounter=1` へ遷移したが同意 UI なし |
| 8 | LinkedIn | 未検出 | 未評価 | ログインページに同意 UI なし |
| 9 | The Guardian | 独自案内バナー | **誤検出** | 同意拒否後の案内を Cookie 同意 UI とみなし `no-reject`。後述 |
| 10 | Stack Overflow | OneTrust | **成功** | Consent-O-Matic の `onetrust` ルールで成功 |
| 11 | Dailymotion | 独自 React UI | **失敗** | 「内容を理解した」だけの Cookie ダイアログを検出できず、20 秒後も表示。後述 |
| 12 | DeepL | Usercentrics | **失敗** | CMP は検出するが拒否ボタンなしとして空振りし、20 秒後も表示。後述 |
| 13 | Microsoft | 未検出 | 未評価 | 同意 UI なし。フッターの `Your Privacy Choices` のみ |
| 14 | Adobe | 未検出 | 未評価 | 同意 UI なし |
| 15 | Wix | 未検出 | 未評価 | 同意 UI なし |
| 16 | HubSpot | HubSpot | **成功** | 即決 CMP 表の HubSpot ルールで成功 |
| 17 | Le Monde | 独自 UI | **非表示** | 拒否ボタンなし。ヒューリスティック検出後、`fallback hide no-reject` で非表示 |
| 18 | GOV.UK | Consent-O-Matic `gov.ukopen` / `gov.uk` | 未評価 | ルール検出は確認したが同意 UI は画面に残っていない。既存 Cookie の可能性あり |
| 19 | The New York Times | - | 検証不可 | ブラウザのサイト安全制約により自動操作不可。迂回していない |
| 20 | The Washington Post | 未検出 | 未評価 | 同意 UI なし。フッターの `Cookie Settings` のみ |

## 成功ログの代表例

### Amazon UK

```text
[cookie-autopilot] ヒューリスティックで容器を検出 FORM cos-banner
[cookie-autopilot] ヒューリスティック: 候補 1 件 [Decline]
[cookie-autopilot] ヒューリスティック: 「Decline」を押した → 成功
[cookie-autopilot] パス: custom 0ms / com 5ms / quick 4ms / heuristic 809ms 合計 818ms → heuristic
[cookie-autopilot] 処理完了 Object
```

現行 Amazon は即決表の `#sp-cc` ではなく `FORM#cos-banner` だったが、ヒューリスティックで処理できた。

### eBay UK

```text
[cookie-autopilot] 即決 CMP 表で検出 eBay
[cookie-autopilot] 即決表: eBay を試行 → 成功
[cookie-autopilot] 処理完了 Object
```

### Stack Overflow

```text
[cookie-autopilot] com: ルールを検出 onetrust
[cookie-autopilot] COM: onetrust を試行 → 成功
[cookie-autopilot] 処理完了 Object
```

### HubSpot

```text
[cookie-autopilot] 即決 CMP 表で検出 HubSpot
[cookie-autopilot] 即決表: HubSpot を試行 → 成功
[cookie-autopilot] 処理完了 Object
```

### Le Monde

```text
[cookie-autopilot] ヒューリスティックで容器を検出 DIV
[cookie-autopilot] 設定パネル: 試さない（容器に設定ボタンが無い）
[cookie-autopilot] 拒否ボタンが見つからないので fallback hide no-reject
[cookie-autopilot] fallback: 非表示にした（理由: no-reject）
[cookie-autopilot] 処理完了 Object
```

## 修正候補

### REAL-001: DeepL の Usercentrics が残る（優先度: 高）

再現 URL: `https://www.deepl.com/translator`

実際の構造:

```text
ASIDE#usercentrics-cmp-ui
  #shadow-root (open)
    DIV#uc-main-dialog[role="dialog"]
    A#uc-more-link[role="button"]     "さらに詳しく"
    BUTTON#accept                       "すべて許可"
```

ホスト要素は横幅を持つが高さが `0`。Shadow DOM 内のダイアログは画面中央に表示される。
拒否ボタンはなく、「すべて許可」だけがある。

主要ログ:

```text
[cookie-autopilot] 即決 CMP 表で検出 Usercentrics
[cookie-autopilot] 即決表: Usercentrics を試行 → 失敗（容器の中にボタンが無い）
...（監視中に繰り返し）...
[cookie-autopilot] 監視終了 Object
[cookie-autopilot] 同意画面を処理できませんでした: {"reason":"no-candidates","container":null,"buttons":0,"decisions":0,"labels":[]}
```

期待動作:

- reject モードなので `#accept` は押さない
- 拒否手段がないため、`fallbackWhenNoReject === 'hide'` なら Usercentrics の同意 UI を非表示にする
- 失敗要約には検出済みの CMP 名、容器、見つかった `#accept` を残す

修正観点:

1. 即決 CMP 表で容器まで検出したが reject セレクタが無かったケースを、検出情報ごと fallback へ渡す。
2. 高さ 0 の Shadow DOM ホストでも、見えている Shadow DOM 子を持つ CMP 容器なら hide 対象にできるようにする。
3. `no-candidates / container:null` ではなく、`Usercentrics / #usercentrics-cmp-ui / accept-only` が分かる診断を残す。
4. 「高さ 0 のホスト + open Shadow DOM + accept-only」の fixture を追加し、reject モードで `hide` になることをテストする。

### REAL-002: Dailymotion の「内容を理解した」を検出できない（優先度: 高）

再現 URL: `https://www.dailymotion.com/`

実際の構造:

```text
DIV.CookiePopup__desktopContainer___ZCIMO[role="dialog"]
  Cookie 使用の説明
  A.CookiePopup__link___bJ2ng          "当社のクッキーに関する方針。"
  BUTTON                               "内容を理解した"
```

画面右上にダイアログが表示されたままになる。監視中は以下を繰り返し、失敗要約すら出ない。

```text
[cookie-autopilot] COM: 一致なし
[cookie-autopilot] 即決表: 一致なし
[cookie-autopilot] ヒューリスティック: 容器なし
...
[cookie-autopilot] 監視終了 Object
```

原因候補:

- 容器自体は `role="dialog"` かつ Cookie 固有語を持つが、`内容を理解した` が決定候補・閉じる語に無いため、`decisionCandidates` が 0 件になり容器ごと捨てられる。

修正観点:

1. `内容を理解した` を Cookie 固有容器内だけで有効な完全一致の閉じる語候補として検討する。
2. 汎用文言を増やす場合も、Cookie 固有語ゲート・入力フォーム除外・年齢確認除外を維持する。
3. 実構造に近い fixture を追加し、通常プリセットでは dismissed、`すべて拒否` プリセットでは設定どおりの挙動になることをテストする。
4. `detectedAny === false` で監視終了した場合も、画面に強い Cookie 容器候補があったなら診断情報を残せるようにする。

### REAL-003: Guardian の拒否後案内を同意 UI と誤検出（優先度: 中）

再現 URL: `https://www.theguardian.com/international`

画面には Cookie 同意 UI ではなく、既に第三者 Cookie を拒否したことを伝える案内が出た。

```text
ASIDE.dcr-17eqobb
  "You’ve chosen to reject third-party cookies while browsing our site."
  BUTTON "Collapse banner"
```

主要ログ:

```text
[cookie-autopilot] ヒューリスティックで容器を検出 ASIDE
[cookie-autopilot] 設定パネル: 試さない（容器に設定ボタンが無い）
[cookie-autopilot] 拒否ボタンが見つからないので fallback hide no-reject
[cookie-autopilot] fallback: そのまま（Cookie バナーと言い切れないので非表示にしない。理由: no-reject）
[cookie-autopilot] 同意画面を処理できませんでした: {"reason":"no-reject","container":"ASIDE.dcr-17eqobb","buttons":1,"decisions":1,"labels":["Collapse banner"]}
```

サイト表示は壊していないが、popup とログでは未処理サイトに見える。

修正観点:

- `already rejected / you've chosen to reject / consent choice saved` のような完了状態文言を、同意要求ではなく「既処理案内」と判別する。
- `Collapse banner` しかない案内を `unhandled` にしない負例テストを追加する。

### OBS-001: `data-cookie-autopilot` 診断属性が付かない（優先度: 中）

デバッグログが流れているにもかかわらず、巡回したページで以下は `null` だった。

```js
document.documentElement.getAttribute('data-cookie-autopilot')
```

`mark('loading')` は `document_start` の `<html>` 作成前に失敗し得る。`mark('watching')` も storage 待ちが短いと DOM 準備前に実行され、その後再試行されない。

修正観点:

- `domReady()` 後または `document.documentElement` の出現時に現在状態を再度 mark する。
- `watching+debug`、`handled`、`unhandled`、`none` まで更新すると実サイト QA がしやすい。

### OBS-002: デバッグログが大量に重複する（優先度: 低）

監視中、実行不能な Consent-O-Matic ルールの `スキップ` と各層の `一致なし` が毎秒大量に出る。
実サイト失敗ログの抽出を難しくするため、同じ内容は 1 ページ 1 回に抑えるか、層の要約ログと詳細ログを分ける余地がある。

## 次回の再検証

修正後は少なくとも次を行う。

1. DeepL: UI が画面から消え、`method: hide` または安全な granular 処理になり、`#accept` を押していないこと。
2. Dailymotion: 「内容を理解した」が設定どおり処理され、UI が消えること。
3. Guardian: 拒否後案内を Cookie 同意 UI の失敗として報告しないこと。
4. Amazon UK / eBay UK / Stack Overflow / HubSpot: 既存の成功経路が回帰していないこと。
5. 新しいプロファイルまたはサイトデータを明示的に消した状態で、今回 `未評価` だったサイトを再試験すること。

