# Cookie Autopilot プライバシーポリシー

最終更新日: 2026-09-09

Cookie Autopilot（以下「本拡張」）のプライバシーポリシーです。

## 収集しない情報

本拡張は、個人情報・閲覧履歴・ページの内容を、開発者や第三者へ送信することは一切ありません。

## 保存する情報

本拡張の設定（選んだプリセット、サイトごとの例外設定、教えたボタン、直近の処理結果の履歴）を `chrome.storage` に保存します。`chrome.storage.sync` に保存した項目は、利用者自身の Google アカウントで同期されますが、開発者がその内容にアクセスすることはできません。

## ページの読み取りについて

同意画面を見つけるために、本拡張は開いているページの内容を読み取ります。ただし、読み取った内容が端末の外に送信されることはありません。

## 外部通信

本拡張が行う外部通信は、同意画面の判定に使うルール（[Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) が公開している JSON データ）を GitHub から定期的に取得する 1 本のみです。これは通常の HTTP リクエストであり、利用者を識別する情報は含まれません。

## 第三者提供・販売・広告・トラッキング

本拡張は、利用者の情報を第三者に提供・販売することはありません。広告表示や、利用者を追跡する仕組みも一切ありません。

## お問い合わせ

ご質問・不具合報告は [GitHub Issues](https://github.com/sunadayusuke/Cookie-Autopilot/issues) までお願いします。

---

# Cookie Autopilot Privacy Policy

Last updated: 2026-09-09

This is the privacy policy for Cookie Autopilot (the "Extension").

## Information We Do Not Collect

The Extension never sends personal information, browsing history, or page content to the developer or any third party.

## Information We Store

The Extension stores its settings (the chosen preset, per-site exceptions, taught buttons, and recent processing history) in `chrome.storage`. Items stored in `chrome.storage.sync` are synced through the user's own Google account; the developer has no access to this data.

## Reading Page Content

The Extension reads the content of the page you are viewing in order to find consent banners. Nothing it reads ever leaves your device.

## External Communication

The Extension makes exactly one kind of external request: it periodically fetches consent-detection rules (JSON data published by [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic)) from GitHub. This is a plain HTTP request and does not include any information that identifies the user.

## No Third-Party Sharing, Sales, Ads, or Tracking

The Extension does not share or sell user information to third parties, does not show ads, and does not track users.

## Contact

For questions or bug reports, please use [GitHub Issues](https://github.com/sunadayusuke/Cookie-Autopilot/issues).
