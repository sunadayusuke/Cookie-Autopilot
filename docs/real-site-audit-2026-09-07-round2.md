# 実サイト Cookie 同意 UI 監査・第2巡（2026-09-07）

## 概要

第1巡と重複しない大規模サイト 30 件を、Chrome に読み込まれた Cookie Autopilot で巡回した。
各サイトを約 9〜10 秒観察し、同意 UI が残った疑いのあるサイトは監視終了を超える時間まで再確認した。

### 集計

- 拒否・必要最小・閉じる操作に成功: **17 件**
- 拒否を送信できず、安全側の非表示フォールバックで処理: **2 件**（IBM、adidas UK）
- Cookie 同意 UI が最初から表示されず未評価: **10 件**
- Cookie 同意ではない入口選択画面を誤検出: **1 件**（LEGO）
- 監視終了後も残った本物の Cookie 同意 UI: **0 件**

同意 UI が実際に出た 19 件は最終的にすべて画面から消えた。ただし IBM と adidas UK は拒否状態をサイトへ保存できておらず、再訪時に再表示される可能性がある。

## 条件と判定

- 実施日: 2026-09-07（Asia/Tokyo）
- ブラウザ: ユーザーの Chrome（既存プロファイル）
- 拡張のデバッグログ: ON
- サイトデータは消していない。UI が出なかったサイトは成功に数えない
- `成功`: `→ 成功` と `処理完了` をログで確認し、同意 UI が残っていない
- `非表示`: `fallback: 非表示にした` を確認し、画面から同意 UI が消えている
- `未評価`: 初回表示時点で同意 UI が存在しない

## 30 サイトの結果

| # | サイト | 検出経路 | 結果 | 主なログ・注記 |
|---:|---|---|---|---|
| 1 | Airbnb | 未検出 | 未評価 | 日本サイトへ遷移。同意 UI なし |
| 2 | Booking.com | 未検出 | 未評価 | 日本語ページへ遷移。同意 UI なし |
| 3 | Tripadvisor | 未検出 | 未評価 | `Cookie consent` 設定ボタンのみ。初回同意 UI なし |
| 4 | Expedia | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 5 | Skyscanner | ヒューリスティック | **成功** | 「必須Cookieのみ受け入れる」を押下 |
| 6 | Lufthansa | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 7 | British Airways | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 8 | KLM | ヒューリスティック | **成功** | `Reject` を押下 |
| 9 | Spotify | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 10 | Dropbox | ヒューリスティック | **成功** | 「拒否」を押下 |
| 11 | Zoom | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 12 | Atlassian | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 13 | Salesforce | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 14 | Oracle | 未検出 | 未評価 | 同意 UI なし |
| 15 | IBM | TrustArc → ヒューリスティック → fallback | **非表示** | 設定処理を完了できず `panel-aborted`。後述 |
| 16 | Intel | 未検出 | 未評価 | 日本サイトへ遷移。同意 UI なし |
| 17 | Dell | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 18 | HP | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 19 | Lenovo | 未検出 | 未評価 | 同意 UI なし |
| 20 | Samsung | 未検出 | 未評価 | 日本サイトへ遷移。同意 UI なし |
| 21 | Sony UK | ヒューリスティック | **成功** | `Reject All` を押下 |
| 22 | Nintendo UK | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 23 | LEGO | ヒューリスティック | **誤検出** | サイト入口選択画面を `no-reject` と報告。後述 |
| 24 | adidas UK | ヒューリスティック → fallback | **非表示** | `Reject all` があるのに押せず、監視終了付近で非表示。後述 |
| 25 | PUMA UK | COM / OneTrust | **成功** | `COM: onetrust を試行 → 成功` |
| 26 | H&M UK | ヒューリスティック | **成功** | `ONLY REQUIRED COOKIES` を押下 |
| 27 | ZARA UK | OneTrust失敗 → ヒューリスティック | **成功（閉じる）** | OneTrust の直接ボタンは見つからず `Close` を押下 |
| 28 | BBC | 未検出 | 未評価 | 同意 UI なし |
| 29 | CNN | 未検出 | 未評価 | 同意 UI なし |
| 30 | TechCrunch | 未検出 | 未評価 | 同意 UI なし |

## 経路別の結果

### Consent-O-Matic / OneTrust で成功（11 件）

Expedia、Lufthansa、British Airways、Spotify、Zoom、Atlassian、Salesforce、Dell、HP、Nintendo UK、PUMA UK。

代表ログ:

```text
[cookie-autopilot] com: ルールを検出 onetrust
[cookie-autopilot] COM: onetrust を試行 → 成功
[cookie-autopilot] 処理完了 Object
```

### ヒューリスティックで成功（6 件）

```text
Skyscanner  「必須Cookieのみ受け入れる」を押した → 成功
KLM         「Reject」を押した → 成功
Dropbox     「拒否」を押した → 成功
Sony UK     「Reject All」を押した → 成功
H&M UK      「ONLY REQUIRED COOKIES」を押した → 成功
ZARA UK     「Close」を押した → 成功
```

ZARA UK は明示的な拒否ではなく閉じる操作である。Cookie UI は消えたが、サイト側へ `reject-all` を保存したことまでは保証できない。

## 修正候補

### ROUND2-001: adidas UK で Reject all を押せず、遅れて非表示になる（優先度: 高）

再現 URL: `https://www.adidas.co.uk/`

表示される構造:

```text
DIV.cookie-consent-modal
  DIV#gl-modal__[role="dialog"]
  BUTTON#glass-gdpr-default-consent-accept-button
    "Accept all cookies"
  BUTTON#glass-gdpr-default-consent-reject-button-central
    "Reject all"
```

約 9 秒時点では同意 UI が画面に残った。監視終了まで待つと以下の経路で非表示になった。

```text
[cookie-autopilot] ヒューリスティックで容器を検出 BUTTON glass-gdpr-default-consent-accept-button
[cookie-autopilot] ヒューリスティック: 候補 0
[cookie-autopilot] 設定パネル: 試さない（容器に設定ボタンが無い）
[cookie-autopilot] 拒否ボタンが見つからないので fallback hide no-reject
[cookie-autopilot] fallback: 非表示にした（理由: no-reject）
[cookie-autopilot] 処理完了 Object
```

問題点:

- `Reject all` が存在するのに押せていない。
- `id` に `cookie` / `consent` を含む accept ボタン自体を、最小のバナー容器として採用している。
- fallback まで画面が残るため処理が遅い。
- 拒否状態を保存しないので再訪時に再表示され得る。

修正観点:

1. 強い属性ヒントがあっても `BUTTON`、`A`、`INPUT` のような操作要素を容器として採用しない。
2. `.cookie-consent-modal` または `#gl-modal__` を容器として採用し、兄弟の `#glass-gdpr-default-consent-reject-button-central` を収集する。
3. adidas の安定 ID を即決 CMP 表へ追加することも検討する。
4. 「accept ボタンの ID に cookie/consent を含み、reject ボタンが兄弟にある」fixture を追加する。

### ROUND2-002: IBM TrustArc を拒否できず panel-aborted で隠す（優先度: 高）

再現 URL: `https://www.ibm.com/`

実際の TrustArc 構造:

```text
DIV#truste-consent-track
  A                         "Cookie設定"
  BUTTON#truste-consent-button
                            "すべて承諾"
  BUTTON#truste-show-consent
                            "オプションの続き"
```

現行即決表の reject セレクタ `#truste-consent-required` は存在しなかった。

```text
[cookie-autopilot] 即決 CMP 表で検出 TrustArc
[cookie-autopilot] 即決表: TrustArc を試行 → 失敗（容器の中にボタンが無い）
[cookie-autopilot] ヒューリスティックで容器を検出 DIV truste-consent-text
[cookie-autopilot] 拒否ボタンが見つからないので fallback hide panel-aborted
[cookie-autopilot] fallback: 非表示にした（理由: panel-aborted）
[cookie-autopilot] 処理完了 Object
```

修正観点:

1. TrustArc の設定導線として `#truste-show-consent` を認識し、設定パネルを開く。
2. 最小のテキスト容器ではなく、操作ボタンを含む `#truste-consent-track` を設定処理へ渡す。
3. 設定パネルで必要 Cookie 以外を無効化し、保存できる実構造を fixture 化する。
4. `#truste-consent-button` は「すべて承諾」なので reject モードでは絶対に押さない。

### ROUND2-003: LEGO の入口選択画面を Cookie 同意 UI と誤検出（優先度: 中）

再現 URL: `https://www.lego.com/`

画面は Cookie 同意ではなく、通常サイトとプレイゾーンを選ぶ入口画面。

```text
DIALOG.AgeGate_age-gate__wrapper__ph949
  "LEGO.comに入ります"
  BUTTON "続ける"
  "プレイゾーン"
  LINK "プレイを楽しむ"
  Cookie 使用についての説明文
```

拡張はクリック・非表示を行わなかったため、安全面では正しい。ただし popup とログでは Cookie 同意 UI の処理失敗として扱われる。

```text
[cookie-autopilot] ヒューリスティックで容器を検出 DIALOG
[cookie-autopilot] ヒューリスティック: 候補 0
[cookie-autopilot] 拒否ボタンが見つからないので fallback hide no-reject
[cookie-autopilot] fallback: そのまま（Cookie バナーと言い切れないので非表示にしない。理由: no-reject）
[cookie-autopilot] 同意画面を処理できませんでした: {"reason":"no-reject","cmp":null,"container":"DIALOG.AgeGate_age-gate__wrapper__ph949","buttons":1,"decisions":1,"labels":["続ける"]}
```

修正観点:

1. `AgeGate` の id/class を年齢・入口ゲートの強い除外シグナルとして扱う。
2. 「通常サイト／プレイゾーン」のような目的地選択と Cookie 同意を分離する。
3. Cookie 説明が同じダイアログ内にあっても、入口選択ボタンを同意決定ボタンとして扱わない負例を追加する。

## 継続確認ポイント

- adidas UK: `Reject all` を直接押して即座に消えること。
- IBM: 設定画面から必要 Cookie のみにして保存できること。
- LEGO: 入口選択画面を Cookie 未処理として報告しないこと。
- ZARA UK: `Close` が実際にどの consent 状態を保存するかを確認し、必要なら明示的拒否へ切り替えること。
- UI 未表示の 10 件は、新しいブラウザプロファイルまたはサイトデータ削除を明示的に行う回で再検証すること。

