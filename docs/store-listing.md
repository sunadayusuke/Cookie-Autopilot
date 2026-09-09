# Chrome ウェブストア掲載情報（下書き）

審査フォームにそのまま貼り付けられる形でまとめています。見出しごとに文字数の上限も併記しています（上限が明示されていない項目は、提出時にフォーム側の上限を確認してください）。

参考: プライバシーポリシー URL は `https://github.com/sunadayusuke/Cookie-Autopilot/blob/main/PRIVACY.md` を指定します。

## 拡張機能名（45 文字以内）

```
Cookie Autopilot
```

## 概要 / 短い説明（132 文字以内）

日本語:

```
Cookieの同意バナーを、決めた方針で自動処理。断るボタンを自動でクリックし、見つからない場合は非表示にします。外部へのデータ送信はありません。
```

English:

```
Auto-handles cookie consent banners per your chosen policy: rejects when possible, else hides them. No data leaves your device.
```

## 詳細な説明

### 日本語

```
Cookie Autopilot は、Web サイトで表示される Cookie の同意画面(同意バナー)を、あなたがあらかじめ決めた方針にしたがって自動で処理する拡張機能です。

できること
- 同意画面を見つけると、「拒否」「必要なものだけ許可」に相当するボタンを自動でクリックします
- 断るボタンが見つからない場合は、画面を自動で隠します(設定で「そのまま表示」に変更することもできます)
- Cookie の種類(必要なもの・設定の記憶・アクセス解析・おすすめ表示・追跡型の広告など)ごとに許可するかどうかを、4 段階のプリセット(しっかり守る・ほどよく守る・ゆるく守る・すべて拒否)から選べます
- サイトごとに個別の設定に切り替えたり、特定のサイトだけ拡張を無効にすることもできます
- 自動処理がうまくいかないサイトでは、押してほしいボタンを自分で教えることができます

しないこと
- 「すべて許可」を勝手に押すことはありません。既定の設定でも、追跡型の広告や用途不明の Cookie は常に拒否します
- 個人情報・閲覧履歴・ページの内容を、開発者や第三者に送信することはありません
- すべてのサイト・すべての言語の同意画面に完全対応しているわけではありません。日本語・英語以外の言語だけで書かれたバナーや、独自実装の同意画面では処理できないことがあります

動作の仕組み
拡張機能を初めて使うときに、初期設定ページで許可の方針を選びます。以降は Cookie の同意画面が出るたびに、その方針にしたがって自動で処理し、ツールバーのアイコンから処理結果を確認できます。設定はいつでも変更できます。
```

### English

```
Cookie Autopilot automatically handles cookie consent banners on websites, following a policy you choose in advance.

What it does
- When it finds a consent banner, it automatically clicks the button that corresponds to "reject" or "necessary only"
- If no reject button can be found, it hides the banner (you can change this to "leave it visible" in settings)
- You choose how to handle each cookie category (necessary, preferences, analytics, personalization, targeted advertising, etc.) from four preset levels (Strict / Balanced (recommended) / Relaxed / Reject all)
- You can override the setting for individual sites, or disable the extension entirely on specific sites
- For sites where automatic handling does not work well, you can manually teach it which button to press

What it does not do
- It never clicks "accept all" on its own. Even with the default settings, targeted advertising and unrecognized cookie categories are always rejected
- It never sends personal information, browsing history, or page content to the developer or any third party
- It does not fully support every website or every language. Banners written only in languages other than Japanese and English, or with highly custom implementations, may not be handled

How it works
The first time you use the extension, you choose a policy on the onboarding page. From then on, whenever a cookie consent banner appears, it is handled automatically according to that policy, and you can check the result from the toolbar icon at any time. Settings can be changed at any time.
```

## カテゴリ

```
プライバシーとセキュリティ
```

## 言語

```
日本語(UI はすべて日本語のみ)
```

## 単一用途の説明（審査で必須）

```
Cookie の同意画面を、利用者があらかじめ決めた方針どおりに自動処理すること。本拡張の機能はこの目的のみに限られ、それ以外の用途は持ちません。
```

## 権限の正当化

各項目 1 段落、審査フォームにそのまま貼る想定です。

### storage

```
拡張の設定(選んだプリセット)とサイトごとの例外設定を保存するために使用します。それ以外の用途では使用しません。
```

### activeTab

```
ポップアップを開いたときに、現在のタブでの処理結果を表示し、「このページで再実行」を行うために使用します。
```

### alarms

```
同意画面の判定に使うルール(Consent-O-Matic のルール)を定期的に更新するために使用します。
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
収集する情報カテゴリ: なし(個人情報・閲覧履歴・ページの内容・認証情報などのいずれも収集しません)
第三者への販売: しない
承認された用途・単一用途と無関係な用途への利用: しない
信用力の判断(与信・融資審査等)を目的とした利用: しない
```
