# Cookie Autopilot — UI デザイン仕様（popup / options）

基準は既存プロダクトの実装（`app/globals.css` や `components/ui/*` に相当するもの）。デザインシステムのドキュメントは実装と食い違っている場合があるため参照しない。
同じトークンは社内の別アプリ（Swift 版の DesignSystem）にも移植されているため自動的に揃う。成功／警告／危険の色と `prefers-reduced-motion` の扱いは、別の社内プロダクトの実装を参考にした。
**ライトモード固定**（3 プロジェクトとも light only。`prefers-color-scheme: dark` の分岐は置かない）。

## 1. トークン（`public/theme.css` の `:root`）

### 色（zinc ランプ）
```
--wb-0: #ffffff;  --wb-50: #f3f4f4;  --wb-100: #e7e7e9;  --wb-200: #dcdce0;  --wb-300: #ceced3;
--wb-400: #9f9fa9; --wb-500: #71717b; --wb-600: #52525c; --wb-700: #3f3f46; --wb-800: #27272a;
--wb-900: #18181b; --wb-950: #0c0c10; --wb-green: #0dca7a;
/* インクアルファ（rgba(12,12,16,x)） */
--ink-a5: rgba(12,12,16,.05); --ink-a12: rgba(12,12,16,.12); --ink-a26: rgba(12,12,16,.26);
--ink-a46: rgba(12,12,16,.46); --ink-a64: rgba(12,12,16,.64);
/* セマンティック */
--bg-page: var(--wb-50);  --bg-surface: var(--wb-0);  --bg-row: var(--wb-50);
--fg: var(--wb-900);  --fg-secondary: var(--wb-700);  --fg-muted: var(--wb-500);  --fg-label: var(--ink-a46);
--border: var(--wb-200);  --hairline: var(--wb-100);  --border-row: var(--ink-a5);
--accent: var(--wb-900);  --accent-hover: var(--wb-800);  --accent-active: var(--wb-950);  --on-accent: var(--wb-0);
--focus-ring: var(--wb-900);
/* 状態色（別プロダクトから借用。淡背景 + 濃文字のペア） */
--success-fg: #1d8b56; --success-bg: #e6f5ec;
--warning-fg: #c74700; --warning-bg: #ffeee2;
--danger-fg:  #ce0000; --danger-bg:  #fdeeee;
--info-fg:    #0066be; --info-bg:    #f0f9ff;
--neutral-fg: #4d4d4d; --neutral-bg: #f2f2f2;
```

### フォント
- family: `"Gen Interface JP", -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Helvetica Neue", Arial, sans-serif`
- 読み込み: 既存プロダクトで使っている jsDelivr CDN の URL（weight 400 / 500 / 600 / 700）を `popup.html` と `options.html` の `<link>` でそのまま使う。オフライン時は上記フォールバック
- mono: `ui-monospace, "SF Mono", "Fira Code", "Roboto Mono", monospace`（selector 表示のみ）
- サイズは px 直値: 18（パネルタイトル）/ 15（セクション見出し）/ 14（ボタン既定・行ラベル）/ 13（入力・小ボタン・補足）/ 12（セグメント・ヒント）/ 11（キャプション）
- ウェイト: 500 が主役（ボタン・見出し）、600 はピル／セグメント。700 は使わない。letter-spacing は使わない
- 行間: ボタンは `line-height: 1`、本文は `1.6`

### 形状・影・余白
- radius: ボタン・入力 **10px** / 行・Select **12px** / カード・ダイアログ **16px** / セグメント・PushButton **9999px**。小要素（× ボタン）6px
- 枠線は 1px。カードは**罫線なし＋影**、行（ControlRow）は `--border-row` の極薄枠
- 影: 行・小要素 `0 2px 2px 0 rgba(0,0,0,.02)` / カード `0 4px 20px -8px rgba(0,0,0,.08)` / 浮遊ピル `0 2px 36px -8px rgba(0,0,0,.16)` / セグメント選択チップ `drop-shadow(0 4px 6px rgba(0,0,0,.06))` / ポップオーバー `0 8px 28px rgba(12,12,16,.14), 0 2px 8px rgba(12,12,16,.08)`
- 余白: 4px グリッド、主役は **8 / 12 / 16 / 20 / 24**。14（3.5）と 10（2.5）も許容

### モーション
- 色変化 `100–150ms`（既定 easing）。移動・変形は `cubic-bezier(0.22,0.61,0.36,1)` で 240–300ms
- 押下 `transform: scale(.98)`。hover は背景を 1 段濃く（`wb-0 → 50 → 100 → 200`）
- `@media (prefers-reduced-motion: reduce)` で animation / transition を `0.01ms` に潰す（別プロダクトの実装と同じ）
- フォーカス: `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px }`（黒リング）

## 2. コンポーネント

- **Button（既定）**: h 40 / px 16 / 14px 500 / radius 10 / `transition-colors`。variant: `primary`（bg `--accent` → hover `--accent-hover` → active `--accent-active`、文字白）/ `outline`（枠 `--border`、bg 白 → hover `wb-50` → active `wb-100`）/ `secondary`（bg `wb-50` → `wb-100` → `wb-200`）/ `ghost`（透明 → `wb-50` → `wb-100`）/ `destructive`（bg `--danger-fg` 文字白 → hover 90%）。disabled は `opacity: .4`。size sm = h 32 / px 12 / 13px、xs = h 28 / px 10 / 12px
- **PushButton（主要 CTA、ピル）**: h 36 / px 16 / 13px **600** / `radius 9999` / `backdrop-filter: blur(20px)` / active `scale(.98)` / `transition: background-color, opacity, transform 100ms`。variant `dark`（bg `wb-900`、枠 `--ink-a12`、文字白）/ `light`（bg 白、枠 `--ink-a12`、文字 `wb-900`）
- **ControlRow（設定 1 行）**: h 40 / `radius 12` / bg `--bg-row` / 枠 1px `--border-row` / 影 `0 2px 2px rgba(0,0,0,.02)` / padding-left 16 padding-right 14 / 左にラベル（14px、色 `--fg-label`）、右にコントロール
- **ButtonSelect（セグメント）**: 外枠 `radius 9999` / bg `rgba(255,255,255,.7)` / 枠 1px 白 / padding 3。項目 h 22 / px 6 / 12px 600 / `radius 9999`。非選択 `opacity: .4` → hover `.7`、選択は bg 白 + `drop-shadow(0 4px 6px rgba(0,0,0,.06))` + opacity 1。ラジオはアクセシブルに隠す（`position:absolute; opacity:0`）し、`:focus-visible` で外枠にリング
- **ToggleSwitch**: トラック 36×20、つまみ 16×16（inset 2）。OFF トラック `wb-300`、ON トラック `--wb-green`。つまみ影 `0 1px 2px rgba(12,12,16,.22), 0 1px 3px rgba(12,12,16,.10)`。トラック 220ms ease、つまみ 240ms `cubic-bezier(0.22,0.61,0.36,1)`
- **Input / Select**: h 40 / radius 10 / px 14 / 13px / **bg `wb-50` 枠なし** / hover bg `wb-100` / focus `box-shadow: 0 0 0 2px var(--focus-ring)` / placeholder `wb-400`
- **Card（options）**: bg 白 / radius 16 / 影 `0 4px 20px -8px rgba(0,0,0,.08)` / 罫線なし / padding 20。カード内見出し 15px 500、行区切りは 1px `--hairline`
- **Badge（状態表示）**: `radius 9999` / px 10 py 4 / 12px 600 / 状態色ペア（success / warning / danger / info / neutral）
- **区切り**: セクション間は 1px `--border`、カード内は 1px `--hairline`
- **通知（保存しました／エラー）**: 既存プロダクトの HUD 風通知を踏襲。radius 18 / padding 14 18 / 13px / bg `rgba(255,255,255,.85)` + `backdrop-filter: blur(20px)` / 枠 1px `rgba(12,12,16,.08)` / 影 `0 2px 36px -8px rgba(0,0,0,.16)` / fade in 120ms・out 180ms / 1.2 秒で自動消滅。options では右下固定、popup ではフッター上に inline 表示

## 3. 画面構成

### popup（幅 320、bg 白）

> 現行の画面構成は `docs/SPEC.md` §14.4 が確定版（プリセット導入後）。以下は改修前の記述で、矛盾する場合は §14.4 が優先。ヘッダーの状態 Badge は、長いホスト名を潰さないよう**サイト名の下**に置き、Badge の文言は短くする（補足行は廃止し、説明は「このサイトでの結果」に出す）。

既存プロダクトの `ControlPanel` 相当のコンポーネント構造をそのまま:
1. **ヘッダー** `padding: 24px 20px 12px`。サイト名（siteKey）を 18px 500 で。右側に状態 Badge（✓ 処理しました = success / バナー未検出 = neutral / 見つかりませんでした = warning / 無効 = neutral）。Badge 下に 12px `--fg-muted` で補足（例「拒否 · Consent-O-Matic ルール」）
2. **セクション「このサイト」** `padding: 16px 20px; gap 8; border-bottom 1px --border`。見出し 15px 500。ControlRow 1 行にラベル「動作」+ ButtonSelect（従う / 拒否 / 許可 / 無効）。※ 幅が足りない場合は行の下段に ButtonSelect を落として 2 段にする
3. **セクション「全体の既定」** 同構造。ButtonSelect（拒否 / 許可 / 無効）
4. **フッター** 下部固定 `padding 16; gap 8` + `backdrop-filter: blur(6px)` + 白へのグラデーション。PushButton `dark`「拒否ボタンを教える」、`light`「許可ボタンを教える」、ghost 小ボタン「このページで再実行」。最下段に 12px の「詳細設定 →」リンク（`--fg-muted` → hover `--fg`）
- 非対応ページ: ヘッダーに「このページでは使えません」（neutral Badge）、セクション 2 とフッターの 3 ボタンを非表示。全体の既定と詳細設定リンクは残す
- 状態取得不能（1.5 秒待っても無い）: neutral Badge「同意画面なし」+ 結果欄「このページでは Cookie の同意画面は出ていません。」（失敗に見せない方針）

### options（幅 720 中央、bg `--bg-page`）
既存プロダクトの `SettingsView` 相当の構成:
- ページ余白 28、タイトル「Cookie Autopilot の設定」22px 500（参照元は bold だが Web 側に合わせ 500〜600）。セクション（カード）間 20
- カード: 「動作」（既定モード = ラジオ縦積み 3 行、拒否できなかったときの挙動 = ラジオ 3 行、「必要なもののみ」でも許可するカテゴリ = ToggleSwitch 6 行 + 注記）/「表示」（バッジ ToggleSwitch、監視秒数 Input、デバッグ ToggleSwitch）/「Consent-O-Matic ルール」（件数・更新日時・失敗件数、Button outline「今すぐ更新」、出典と MIT 表記 12px muted）/「サイト別設定」（ホスト + Badge + ghost「削除」の行リスト、空状態は 13px muted）/「教えたボタン」（ホスト / 拒否・許可 Badge / mono 12px の selector or text / ghost「削除」）/「バックアップ」（Button outline「エクスポート」「インポート」+ 12px の注記「インポートすると現在のサイト別設定と教えたボタンは置き換えられます」）
- 各ラジオ行・トグル行は h 40、ラベル 14px `--fg`、説明 12px `--fg-muted`、行区切り 1px `--hairline`
- 保存は即時。成功は HUD 通知「保存しました」、失敗は danger 色で「保存できませんでした: <理由>」

## 4. 文言のトーン
- 見出し・ラベルは体言止め（「動作」「表示」「サイト別設定」）。説明は丁寧語（ですます）。ボタンは動詞（「教える」「再実行」「更新」「削除」）
- 進行中は三点リーダ `…`（`...` は使わない）。遷移は `→`。補足は全角括弧（）
- 見出しに `#` 的な装飾や絵文字は使わない。✓ は成功状態のみ
