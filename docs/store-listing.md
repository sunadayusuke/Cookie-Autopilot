# Chrome ウェブストア掲載情報（下書き）

審査フォームにそのまま貼り付けられる形でまとめています。見出しごとに文字数の上限も併記しています（上限が明示されていない項目は、提出時にフォーム側の上限を確認してください）。

参考: プライバシーポリシー URL は `https://github.com/sunadayusuke/Cookie-Autopilot/blob/main/PRIVACY.md` を指定します。

## 拡張機能名（45 文字以内）

```
Cookie Autopilot
```

※ manifest は `_locales`（default_locale: en）により、拡張機能名・説明をブラウザの UI 言語に応じて出し分けます。ストア掲載の「説明」欄（詳細な説明・短い説明など、本ドキュメントの各セクション）は、これとは別に言語ごとの個別登録が必要です。

## 概要 / 短い説明（132 文字以内）

日本語:

```
Cookieの同意バナーを、決めた方針で自動処理。断るボタンを自動でクリックし、見つからない場合は非表示にします。閲覧内容を開発者に送信しません。
```

English:

```
Handles cookie banners per your policy: rejects when possible, otherwise hides them. No developer telemetry.
```

## 詳細な説明

### 日本語

```
Cookie Autopilot は、Webサイトに表示されるCookieの同意画面を、あらかじめ選んだ方針にしたがって自動処理する拡張機能です。

できること
・「拒否」「必要なものだけ許可」に相当するボタンを自動でクリックします。対応する同意画面では、カテゴリ別の許可設定を反映します。
・断るボタンが見つからない場合は、同意画面を非表示にします。設定で、そのまま表示しておくこともできます。
・「しっかり守る」「ほどよく守る」「ゆるく守る」「すべて拒否」から方針を選べます。詳細設定ではカテゴリ別に調整できます。
・サイト別の設定変更や、特定サイトだけの無効化ができます。
・自動処理がうまくいかないサイトでは、押してほしいボタンを自分で教えることができます。
・ツールバーのアイコンから、処理結果やサイト別の設定を確認できます。
・表示言語は日本語と英語に対応し、設定から切り替えられます。既定はブラウザの言語に合わせます。

知っておいていただきたいこと
・画面の非表示は、同意の拒否やCookieの削除を意味しません。サイトによるCookieの保存や追跡を防ぐことを保証する機能ではありません。
・すべてのサイトや言語に対応しているわけではありません。独自の同意画面などでは、手動操作が必要になる場合があります。
・「すべて許可」を自動で選ぶ機能はありません。既定のプリセットでは、追跡型広告や用途不明のカテゴリを許可しません。

プライバシーと通信
・開発者による閲覧データの収集、広告、アクセス解析はありません。
・設定、サイト別の例外、教えたボタンのルールはChromeの同期機能により、利用者自身のGoogleアカウントで同期される場合があります。処理履歴は端末内に保存します。
・同意画面の判定ルールを更新するため、GitHubからConsent-O-MaticのJSONデータを取得します。

使い方
インストール後の初期設定で方針を選ぶと、自動処理が始まります。設定はいつでも変更できます。既に同意が保存されたサイトでは、同意画面が表示されない場合があります。
```

### English

```
Cookie Autopilot automatically handles the cookie consent banners you run into on the web, following a policy you choose in advance.

What it does
- Automatically clicks the button for "Reject" or "Allow necessary only." On banners that support it, your category-level choices are applied too.
- Hides the banner when no reject button can be found. You can turn this off in settings and leave banners visible instead.
- Lets you pick a policy — Strict, Balanced, Relaxed, or Reject all — with per-category fine-tuning in advanced settings.
- Supports per-site overrides, or disabling the extension entirely on specific sites.
- Lets you teach it which button to press on sites where automatic handling doesn't work.
- Shows processing results and per-site settings from the toolbar icon.
- Comes in Japanese and English, switchable from settings. Defaults to your browser's language.

Good to know
- Hiding a banner doesn't mean consent was rejected or cookies were deleted, and it doesn't guarantee the site stops storing cookies or tracking you.
- Not every site or language is supported. Custom-built consent banners may need manual handling.
- There's no automatic "accept all." Default presets never allow targeted ads or categories of unclear purpose.

Privacy and network
- No browsing-data collection, ads, or analytics from the developer.
- Settings, per-site exceptions, and taught button rules may sync to your own Google account via Chrome Sync. Processing history stays on your device.
- Fetches Consent-O-Matic's JSON rule data from GitHub to keep consent-detection rules up to date.

How to use
Pick a policy during onboarding right after install, and automatic handling starts immediately. You can change settings anytime. Sites where consent was already saved may not show the banner again.
```

## カテゴリ

```
プライバシーとセキュリティ
```

## 言語

```
日本語 / English
```

ストアの「言語」欄には日本語と English の 2 つを登録します。拡張の UI 表示言語は詳細設定・初期設定ページの JA/EN トグルで切り替えられ、保存値が無い場合はブラウザの言語で自動判定します(日本語以外はすべて英語表示)。

## 単一用途の説明（審査で必須）

```
Cookie の同意画面を、利用者があらかじめ決めた方針どおりに自動処理すること。本拡張の機能はこの目的のみに限られ、それ以外の用途は持ちません。
```

## 権限の正当化

各項目 1 段落、審査フォームにそのまま貼る想定です。

### storage

```
選んだプリセット、サイトごとの例外、利用者が教えたボタンのルールをchrome.storage.syncに保存します。判定ルールのキャッシュ・更新状態・初期設定の表示状態・サイトごとの処理履歴はchrome.storage.local、タブごとの処理状態はchrome.storage.sessionに保存します。いずれもCookie同意画面の自動処理と結果表示のために使用します。
```

### activeTab

```
ポップアップを開いたときに、現在のタブでの処理結果を表示し、「このページで再実行」を行うために使用します。
```

### alarms

```
同意画面の判定に使うルール(Consent-O-Matic のルール)を週1回更新するために使用します。
```

### ホストへのアクセス（`<all_urls>` の content script）

```
Cookie の同意画面はあらゆる Web サイトに表示される可能性があり、対象サイトをあらかじめ列挙することができません。そのため content script はすべてのサイトで動作しますが、読み取るのは同意画面の検出・分類に必要な範囲(ページ内のテキストや要素の構造)に限られ、読み取った内容が外部に送信されることはありません。
```

### リモートコードについて

```
本拡張が外部から定期的に取得するのは、Consent-O-Matic が公開している同意画面判定用のルール(JSON データ)のみです。取得したデータはあらかじめ決められた形式のとおりに解釈して使うだけで、コードとして実行することはありません。本拡張のソースコード全体で eval および new Function は使用していません。
```

## データ利用の申告（フォームのチェック項目への回答）

```
申告する情報カテゴリ: ウェブ履歴、ウェブサイトのコンテンツ
理由: 同意画面の要素やテキストを読み取り、サイト別の処理履歴を端末内に保存するため。開発者への閲覧データ送信はありません。Googleの申告方針ではローカル処理・保存も開示対象です。
第三者への販売: しない
承認された用途・単一用途と無関係な用途への利用: しない
信用力の判断(与信・融資審査等)を目的とした利用: しない
```

## 審査担当者向け操作手順

ログインや有料契約は不要です。インストール後の初期設定でプリセットを選び、Cookie同意バナーが表示されるサイトを開いてください。ツールバーから処理結果とサイト別設定を確認できます。既に同意を保存したサイトではバナーが出ない場合があります。非表示という結果は拒否成功を意味しません。詳細設定から、拒否ボタンがない場合に画面を残す設定にも変更できます。

## リンク

- ホームページ: https://github.com/sunadayusuke/Cookie-Autopilot
- サポート: https://github.com/sunadayusuke/Cookie-Autopilot/issues
- プライバシーポリシー: https://github.com/sunadayusuke/Cookie-Autopilot/blob/main/PRIVACY.md

## 提出画面への反映（2026-09-10）

掲載文に非表示と拒否の違い、Chrome同期、GitHubルール更新を明記。カテゴリは「プライバシー&セキュリティ」、言語は日本語。ホームページ・サポートURLを入力し保存済み。単一用途とstorage/activeTab/alarms/ホスト権限の理由を入力。リモートコードは「使用していません」、データ利用は「ウェブ履歴」「ウェブサイトのコンテンツ」を選択し、用途限定の3項目とプライバシーポリシーURLを保存済み。

申告根拠: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq （端末内のみの処理・保存も開示対象）。審査への送信は未完了。

> この時点の記録。その後 v1.0.0 を提出し、公開済み。現状は「更新（2026-09-19）」を参照。

## 更新（2026-09-16）

- 「詳細な説明」の日本語・英語を全面差し替え。UI の日英切り替え(既定はブラウザの言語判定)に触れる 1 行を追加
- 拡張の UI が日本語/英語の 2 言語対応になったことに合わせ、manifest を `_locales`（default_locale: en）化。拡張機能名・説明はブラウザの UI 言語に追従するが、ストア掲載の「説明」欄は言語ごとの個別登録が引き続き必要
- 「言語」欄をストアへの登録言語(日本語 / English)が分かる内容に更新
- 「概要 / 短い説明」を日本語・英語とも差し替え。日本語は末尾を「外部へのデータ送信はありません。」から「閲覧内容を開発者に送信しません。」に、英語は全文を `Handles cookie banners per your policy: rejects when possible, otherwise hides them. No developer telemetry.` に変更(端末内での処理・保存は行うため、送信しないのは開発者宛てであることを明確にした)。日本語 73 文字・英語 108 文字で、いずれも 132 文字以内であることを確認済み

## 更新（2026-09-19）

v1.0.0 は公開済み。UI の日英 2 言語対応を含む **v1.1.0** をこの日に提出する。

- `public/manifest.json` / `package.json` の version を `1.0.0` → `1.1.0` に更新（公開中のバージョンと同じ番号は再アップロードできないため）
- `pnpm build && pnpm package` で `release/cookie-autopilot-v1.1.0.zip` を作成。`manifest.json` が zip 直下にあること、`_locales/en/messages.json` と `_locales/ja/messages.json` が同梱されていることを確認済み
- 権限（storage / activeTab / alarms / ホストへのアクセス）に変更はない。リモートコードの扱い・データ利用の申告も v1.0.0 から変更なし

### 提出時の残作業

1. ダッシュボードの「パッケージ」に `release/cookie-autopilot-v1.1.0.zip` をアップロードする
2. 「ストアの掲載情報」で言語に English を追加し、本ファイルの英語ブロック（概要 / 短い説明・詳細な説明）を貼る。掲載文は言語ごとの個別入力で、ZIP の `_locales` では代替できない
3. スクリーンショットは `store-assets/` の日本語 UI のものを流用している。英語の掲載に英語 UI のスクリーンショットを出す場合は撮り直しが必要
4. 審査に送信する

### 既知の懸念

プライバシーポリシー（`PRIVACY.md`）が日本語のみのため、英語の掲載文から日本語のポリシーを参照する形になる。審査で指摘される可能性がある。

## 更新（2026-09-24）

不具合修正の **v1.1.1** のパッケージを作成する。

- `public/manifest.json` / `package.json` の version を `1.1.0` → `1.1.1` に更新（提出済みのバージョンと同じ番号は再アップロードできないため）
- 変更内容: 英語バナーの語彙の拡充（"Continue with necessary cookies" "Block all cookies" など）、Cookie を名乗る埋め込みのプレースホルダ（動画の「Unblock」）が本物のバナーより先に処理されて拒否ボタンまで届かなかった不具合の修正、ソフトハイフン等の不可視文字や "Accept required service and unblock content" のような文言で「Unblock」（押すと同意になる）を拒否ボタンと誤認しうる経路の修正
- `pnpm build && pnpm package` で `release/cookie-autopilot-v1.1.1.zip` を作成
- 権限（storage / activeTab / alarms / ホストへのアクセス）・リモートコードの扱い・データ利用の申告は v1.1.0 から変更なし。掲載文の変更も不要
