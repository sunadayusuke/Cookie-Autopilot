import { describe, expect, it } from 'vitest';
import { decisionCandidates } from '../src/engine/candidates';
import { normalize } from '../src/engine/normalize';
import {
  hasAgeGateAttribute,
  hasAgeGateContext,
  hasBannerWord,
  hasContainerHint,
  hasCookieWord,
  hasDangerousContext,
  hasGenericContainerHint,
  hasSettledNotice,
  hasWeakContainerHint,
  isAcceptStrong,
  isAcceptStrongSpecific,
  isAcceptWeak,
  isAmbiguousReject,
  isCloseWord,
  isCollapseWord,
  isForbidden,
  isForbiddenHard,
  isGenericPhrase,
  isNonDecision,
  isRejectMinimal,
  isRejectStrong,
  isRejectWeak,
  isSettingsButton,
  overridesNonDecision,
} from '../src/shared/phrases';

const n = normalize;

describe('禁止語', () => {
  it('日本語の危険な操作を弾く', () => {
    for (const text of ['購入する', 'カートに入れて支払う', '送信', '削除する', 'ログイン', '新規登録', '購読する', '退会']) {
      expect(isForbidden(n(text)), text).toBe(true);
    }
  });

  it('英語の危険な操作を弾く', () => {
    for (const text of ['Buy now', 'Checkout', 'Submit', 'Delete', 'Log in', 'Sign in', 'Sign up', 'Register', 'Subscribe', 'Unsubscribe']) {
      expect(isForbidden(n(text)), text).toBe(true);
    }
  });

  it('取り返しのつかない操作を弾く', () => {
    for (const text of ['注文する', '決済する', '解約', '振込', '寄付する', 'Place order', 'Remove', 'Transfer', 'Donate']) {
      expect(isForbidden(n(text)), text).toBe(true);
    }
  });

  it('同意系の文言は禁止語ではない', () => {
    for (const text of ['すべて許可', '拒否', 'Accept all', 'Reject all', '必要なもののみ']) {
      expect(isForbidden(n(text)), text).toBe(false);
    }
  });
});

describe('禁止語の 2 段化（HARD / SOFT）', () => {
  /** どの経路でも押さない語 */
  const HARD = ['購入する', 'Checkout', '支払う', 'ご注文を確定', 'Place order', '削除する', 'Delete', 'Remove', 'ログイン', 'Sign up', '登録', 'Subscribe', '退会', '解約', '振込', 'Transfer', '寄付する', '送信', 'Submit'];
  /** ヒューリスティックでだけ避ける語（Cookie 設定画面の正当なボタンにも当たる） */
  const SOFT = ['保存', '保存して閉じる', 'Save', 'Save and exit', 'Apply', '申し込む', '予約する', 'Book now', 'Reserve', '投稿する', 'Publish', '公開する', '解除'];

  it('HARD はヒューリスティックでもカスタムルールでも禁止', () => {
    for (const text of HARD) {
      expect(isForbidden(n(text)), text).toBe(true);
      expect(isForbidden(n(text), { strict: false }), text).toBe(true);
      expect(isForbiddenHard(n(text)), text).toBe(true);
    }
  });

  it('SOFT はヒューリスティックだけ禁止（教えたボタンには適用しない）', () => {
    for (const text of SOFT) {
      expect(isForbidden(n(text)), text).toBe(true);
      expect(isForbidden(n(text), { strict: false }), text).toBe(false);
      expect(isForbiddenHard(n(text)), text).toBe(false);
    }
  });

  it('空文字はどちらでも禁止語ではない', () => {
    expect(isForbidden('')).toBe(false);
    expect(isForbiddenHard('')).toBe(false);
  });
});

describe('非決定語', () => {
  it('設定・詳細系を弾く', () => {
    for (const text of ['Cookie の設定', '設定', '詳細', '詳しく見る', 'カスタマイズ', 'Cookie ポリシー', 'Settings', 'Manage cookies', 'Preferences', 'Customize', 'Learn more', 'More options', 'Privacy policy']) {
      expect(isNonDecision(n(text)), text).toBe(true);
    }
  });

  it('Cookie バナーで使われる confirm / cancel / 確定 は禁止語ではなく非決定語', () => {
    for (const text of ['Confirm my choices', 'Cancel', 'キャンセル', '選択を確定', '確定する']) {
      expect(isForbidden(n(text)), text).toBe(false);
      expect(isNonDecision(n(text)), text).toBe(true);
    }
  });

  it('「注文を確定」は注文が HARD 禁止語なので押さない', () => {
    expect(isForbiddenHard(n('注文を確定する'))).toBe(true);
  });

  it('決定ボタンは非決定語ではない', () => {
    for (const text of ['拒否', 'すべて許可', '同意する', 'Accept all', 'Reject all', 'OK']) {
      expect(isNonDecision(n(text)), text).toBe(false);
    }
  });
});

describe('「オプション」は SETTINGS_BUTTON のみに入れる（修正2）', () => {
  it('オプションの続き は設定ボタン', () => {
    expect(isSettingsButton(n('オプションの続き'))).toBe(true);
  });

  it('オプションの続き は非決定語にしない（総量マーカーの無い拒否ボタンを落とさないため）', () => {
    expect(isNonDecision(n('オプションの続き'))).toBe(false);
  });

  it('「オプションのCookieを拒否」は総量マーカーが無くても決定候補に残る', () => {
    const buttons = ['オプションのCookieを拒否'].map((text, index) => ({
      el: document.createElement('button'),
      text: n(text),
      label: text,
      index,
    }));
    expect(decisionCandidates(buttons).map((b) => b.label)).toEqual(['オプションのCookieを拒否']);
  });
});

describe('拒否語', () => {
  it('強一致（日本語）', () => {
    for (const text of ['拒否', 'すべて拒否', '同意しない', '許可しない', '承諾しない', '受け入れない', 'オプトアウト', '辞退する']) {
      expect(isRejectStrong(n(text)), text).toBe(true);
    }
  });

  it('強一致（英語）', () => {
    for (const text of ['Reject all', 'Decline', 'Deny', 'Refuse', 'Disagree', 'Opt out', 'Do not accept', "Don't accept", 'Continue without accepting']) {
      expect(isRejectStrong(n(text)), text).toBe(true);
    }
  });

  it('強一致（英語の否定形。アポストロフィは normalize で落ちる）', () => {
    for (const text of ['I do not agree', "Don't agree", 'Do not allow', "Don’t allow", 'Disable all', 'Opt-out of all']) {
      expect(isRejectStrong(n(text)), text).toBe(true);
    }
  });

  it('必要最小系', () => {
    for (const text of ['必要なもののみ', '必要なもののみ許可', '必要な Cookie のみ', '必須のみ', '必要不可欠なもののみ', 'Necessary only', 'Only necessary', 'Essential only', 'Only essential', 'Required only', 'Strictly necessary cookies', 'Use necessary cookies only']) {
      expect(isRejectMinimal(n(text)), text).toBe(true);
    }
  });

  it('必要最小系は only が無くても拾う（Accept necessary cookies 型）', () => {
    for (const text of ['Accept necessary cookies', 'Allow essential cookies', 'Use required cookies', 'Enable strictly necessary cookies', 'Allow the necessary cookies']) {
      expect(isRejectMinimal(n(text)), text).toBe(true);
      expect(isAcceptStrong(n(text)), text).toBe(false);
    }
    // 「すべて」が挟まるものは必要最小系ではない（accept 直後が all）
    for (const text of ['Accept all necessary and optional', 'Accept all cookies']) {
      expect(isRejectMinimal(n(text)), text).toBe(false);
      expect(isAcceptStrongSpecific(n(text)), text).toBe(true);
    }
  });

  it('必要最小系は語順を問わない', () => {
    for (const text of ['Necessary cookies only', 'Accept only necessary', 'Allow essential cookies only', 'Only allow essential cookies', 'Only the required cookies', 'Allow functional cookies only', 'Technical cookies only', 'Mandatory cookies only']) {
      expect(isRejectMinimal(n(text)), text).toBe(true);
      // 許可語を含んでいても許可扱いにしない（これが accept モードの最後の砦）
      expect(isAcceptStrong(n(text)), text).toBe(false);
    }
  });

  it('弱一致は完全一致のみ（Cookie 固有語のある容器でだけ使う）', () => {
    for (const text of ['No thanks', 'No, thanks', 'No thank you', 'Not now']) {
      expect(isRejectWeak(n(text)), text).toBe(true);
      expect(isGenericPhrase(n(text)), text).toBe(true);
    }
    for (const text of ['No problem', 'Not interested', 'Now']) {
      expect(isRejectWeak(n(text)), text).toBe(false);
    }
  });

  // 酒類・製薬サイトの年齢確認ゲート「Are you over 18? [Yes] [No]」で "No" を押すと
  // サイトから追い出される。ACCEPT_WEAK_EXACT の 'yes' を外したことと対称
  it('裸の No は弱一致にしない（年齢確認ゲートよけ）', () => {
    expect(isRejectWeak(n('No'))).toBe(false);
    expect(isGenericPhrase(n('No'))).toBe(false);
  });

  it('disable は過去形に当たらない', () => {
    for (const text of ['Disable', 'Disable all', 'Disable non-essential cookies']) {
      expect(isRejectStrong(n(text)), text).toBe(true);
    }
    for (const text of ['Disabled', "I've disabled my ad blocker", 'Cookies are disabled']) {
      expect(isRejectStrong(n(text)), text).toBe(false);
    }
  });

  it('許可系は拒否語ではない', () => {
    for (const text of ['すべて許可', '同意する', 'Accept all']) {
      expect(isRejectStrong(n(text)), text).toBe(false);
      expect(isRejectMinimal(n(text)), text).toBe(false);
    }
  });
});

describe('許可語', () => {
  it('強一致（日本語）', () => {
    for (const text of ['すべて同意', '全て同意する', 'すべて許可', '全て許可', 'すべて受け入れる', '同意する', '同意します', '承諾する', '許可する', '受け入れる']) {
      expect(isAcceptStrong(n(text)), text).toBe(true);
    }
  });

  it('強一致（英語）', () => {
    for (const text of ['Accept all', 'Allow all', 'I agree', 'Agree', 'Accept', 'Allow', 'Enable all']) {
      expect(isAcceptStrong(n(text)), text).toBe(true);
    }
  });

  it('拒否語に一致するものは許可語として扱わない', () => {
    for (const text of ['承諾しない', '同意しない', '許可しない', 'Do not accept', '必要なもののみ許可']) {
      expect(isAcceptStrong(n(text)), text).toBe(false);
    }
  });

  // accept モードで拒否ボタンを押さないための最後の砦。REJECT_MINIMAL に当たる文言は
  // ACCEPT_STRONG_BARE の `accept` / `allow` を含んでいても許可語にしない
  it('"Accept only essential cookies" は必要最小系なので許可語にしない', () => {
    for (const text of ['Accept only essential cookies', 'Allow only necessary cookies', 'Accept necessary cookies only']) {
      expect(isRejectMinimal(n(text)), text).toBe(true);
      expect(isAcceptStrong(n(text)), text).toBe(false);
      expect(isAcceptStrongSpecific(n(text)), text).toBe(false);
    }
  });

  it('弱一致は完全一致のみ', () => {
    for (const text of ['同意', '許可', 'OK', 'okay', 'はい', 'Got it', 'Understood', 'I understand']) {
      expect(isAcceptWeak(n(text)), text).toBe(true);
    }
    expect(isAcceptWeak(n('同意して続ける'))).toBe(false);
    expect(isAcceptWeak(n('Continue without accepting'))).toBe(false);
  });

  // Continue は「次へ」の意味でフォームにも頻出するので一度は外していたが、
  // 容器の Cookie 固有語ゲートとテキスト入力を含む容器の除外で守られているので戻した
  it('Continue は Cookie 固有語ゲートの内側でだけ使う弱一致', () => {
    for (const text of ['Continue', 'Sure', 'Alright', "That's fine"]) {
      expect(isAcceptWeak(n(text)), text).toBe(true);
      // 汎用文言なので、教えたボタンでも Cookie 固有語のある容器に限られる
      expect(isGenericPhrase(n(text)), text).toBe(true);
    }
    // 部分一致では拾わない
    for (const text of ['Continue to checkout', 'Yes, send me offers']) {
      expect(isAcceptWeak(n(text)), text).toBe(false);
    }
  });

  // 年齢確認ゲート「Are you over 18? [Yes] [No]」の "Yes" を押すと法的な自己申告の代行になる
  it('裸の Yes は弱一致にしない（年齢確認ゲートよけ）', () => {
    expect(isAcceptWeak(n('Yes'))).toBe(false);
    expect(isGenericPhrase(n('Yes'))).toBe(false);
    // 「すべて〜」を明示する Yes to all は従来どおり許可語
    expect(isAcceptStrongSpecific(n('Yes to all'))).toBe(true);
  });

  // isAcceptStrong が先に当たるので採点では弱一致まで来ない（到達不能なので語彙から外した）
  it('Agree and continue は強一致（弱一致には入れない）', () => {
    expect(isAcceptStrong(n('Agree and continue'))).toBe(true);
    expect(isAcceptWeak(n('Agree and continue'))).toBe(false);
  });

  it('容器の文脈なしで押してよいのは「すべて〜」系と cookie を含む文言だけ', () => {
    for (const text of ['すべて同意', 'すべて許可', '全て許可', 'すべて受け入れる', '全て受け入れる', 'Accept all', 'Allow all', 'Enable all', 'Accept cookies']) {
      expect(isAcceptStrongSpecific(n(text)), text).toBe(true);
    }
  });

  it('「同意する」「Accept」は Cookie 固有語ゲートの側（規約更新モーダルにも使われる）', () => {
    for (const text of ['同意する', '同意します', '承諾する', '承諾', '許可する', '受け入れる', 'Accept', 'Agree', 'I agree', 'Allow', 'Consent']) {
      expect(isAcceptStrong(n(text)), text).toBe(true);
      expect(isAcceptStrongSpecific(n(text)), text).toBe(false);
    }
  });
});

describe('閉じる語', () => {
  it('完全一致で判定する', () => {
    for (const text of ['OK', 'okay', '閉じる', '了解', 'わかりました', 'Got it', 'Understood', 'I understand', 'Close', 'Dismiss', '×', '✕', 'x']) {
      expect(isCloseWord(n(text)), text).toBe(true);
    }
  });

  it('部分一致は閉じる語ではない', () => {
    for (const text of ['OK して閉じる', '閉じるボタン', 'Close window']) {
      expect(isCloseWord(n(text)), text).toBe(false);
    }
  });

  it('読んだことを伝えるだけの日本語も閉じる語に含む（REAL-002）', () => {
    for (const text of ['内容を理解した', '理解した', '了承しました', '確認しました']) {
      expect(isCloseWord(n(text)), text).toBe(true);
      // 汎用文言なので Cookie 固有語のある容器でしか使わない
      expect(isGenericPhrase(n(text)), text).toBe(true);
    }
  });

  it('決定を伴う言い回しは閉じる語にしない', () => {
    for (const text of ['内容を理解して同意する', '理解したうえで許可する', '確認しましたか']) {
      expect(isCloseWord(n(text)), text).toBe(false);
    }
  });
});

describe('折りたたみ語（完了状態の案内の判定にだけ使う。REAL-003）', () => {
  it('完全一致で判定する', () => {
    for (const text of ['Collapse', 'Collapse banner', 'Hide banner', '折りたたむ']) {
      expect(isCollapseWord(n(text)), text).toBe(true);
    }
  });

  it('自動で押す語には入れない（閉じる語・汎用文言ではない）', () => {
    for (const text of ['Collapse banner', '折りたたむ']) {
      expect(isCloseWord(n(text)), text).toBe(false);
      expect(isGenericPhrase(n(text)), text).toBe(false);
    }
  });
});

describe('完了状態の文言（REAL-003）', () => {
  it('もう選び終わったことを伝える案内に当たる', () => {
    for (const text of [
      'You’ve chosen to reject third-party cookies while browsing our site.',
      "You've chosen to reject third-party cookies",
      'You have rejected all cookies.',
      'You have already accepted our cookies.',
      'Your consent choice saved.',
      'Cookie の設定を保存しました。',
      'Cookie の利用を拒否しました。',
      'Cookie の利用に同意しました。',
      'ご希望を受け付けました。',
    ]) {
      expect(hasSettledNotice(text), text).toBe(true);
    }
  });

  it('これから同意を求める文言には当たらない', () => {
    for (const text of [
      '当サイトでは Cookie を使用しています。同意しますか？',
      'We use cookies to improve your experience. Do you accept?',
      'Cookie の利用を拒否できます。',
    ]) {
      expect(hasSettledNotice(text), text).toBe(false);
    }
  });
});

describe('汎用文言', () => {
  it('弱一致と閉じる語をまとめて汎用文言とみなす', () => {
    for (const text of ['OK', 'はい', '閉じる', '了解', '同意']) {
      expect(isGenericPhrase(n(text)), text).toBe(true);
    }
    for (const text of ['拒否', 'すべて許可', 'Reject all']) {
      expect(isGenericPhrase(n(text)), text).toBe(false);
    }
  });
});

describe('拒否候補として曖昧な文言（M-2）', () => {
  it('「すべて許可」の言い回しを含み否定形が無いものは曖昧', () => {
    for (const text of ['Accept all', 'Accept all. You can opt out at any time', 'Allow all cookies. You can withdraw consent later', 'すべて許可（あとで拒否できます）']) {
      expect(isAmbiguousReject(n(text)), text).toBe(true);
    }
  });

  it('否定形があるもの・「すべて許可」を含まないものは曖昧ではない', () => {
    for (const text of ['Do not accept all', "Don't accept all cookies", 'Continue without accepting all', 'Reject all', 'Necessary cookies only', 'Decline']) {
      expect(isAmbiguousReject(n(text)), text).toBe(false);
    }
    expect(isAmbiguousReject('')).toBe(false);
  });
});

describe('設定ボタン（M-6）', () => {
  it('設定画面を開くボタンを見分ける', () => {
    for (const text of ['Manage settings', 'Cookie settings', 'Preferences', 'Customise', 'Manage options', 'My choices', 'Configure', 'Adjust', '設定', 'カスタマイズ']) {
      expect(isSettingsButton(n(text)), text).toBe(true);
    }
  });

  it('情報リンク・決定ボタンは設定ボタンではない', () => {
    for (const text of ['Learn more', 'Privacy policy', 'Read more', 'About cookies', 'Why?', 'Continue', 'Got it!', 'Reject all', 'Accept all'] ) {
      expect(isSettingsButton(n(text)), text).toBe(false);
    }
    expect(isSettingsButton('')).toBe(false);
  });
});

describe('非決定語の override（M-3）', () => {
  it('必要最小系と「すべて〜」を伴う決定語だけが非決定語より優先される', () => {
    for (const text of ['Reject all vendors', 'Accept all purposes', 'Reject all', 'Accept only necessary', 'Necessary cookies only']) {
      expect(overridesNonDecision(n(text)), text).toBe(true);
    }
  });

  it('総量マーカーの無い決定語は非決定語のまま（設定パネルが開くだけのボタン）', () => {
    for (const text of ['Manage or reject cookies', 'Reject cookie settings', 'Change my preferences', 'Manage consent preferences', 'Allow selection']) {
      expect(overridesNonDecision(n(text)), text).toBe(false);
    }
  });
});

describe('年齢確認ゲート語（H-2）', () => {
  it('年齢確認・医療従事者確認のゲートを見分ける', () => {
    for (const text of ['Are you over 18?', 'You must be 21 or older to enter.', 'Please verify your age', 'age verification', 'Are you of legal drinking age?', 'This site is intended for healthcare professionals only.', '年齢確認', '20歳以上ですか', '未成年の飲酒は法律で禁止されています']) {
      expect(hasAgeGateContext(text), text).toBe(true);
    }
  });

  it('ふつうの Cookie バナーの文言はゲートにしない（manage / message / storage は語境界で除く）', () => {
    for (const text of [
      'We use cookies to personalise content. Manage settings',
      'This site uses cookies for storage and analytics.',
      'Hide this message',
      'We and our partners store and/or access information on a device.',
      '当サイトでは Cookie を使用しています',
    ]) {
      expect(hasAgeGateContext(text), text).toBe(false);
    }
  });
});

describe('入口ゲート・年齢ゲートの属性（ROUND2-003）', () => {
  it('id / class / aria-label の入口ゲートの印を見分ける', () => {
    for (const value of [
      'AgeGate_age-gate__wrapper__ph949',
      'age-gate',
      'agegate-overlay',
      'age-verification',
      'age_check',
      'entry_gate',
      'modal birth-date-form',
      'date-of-birth',
      // aria-label の空白区切り（修正3）
      'Age verification',
      'Age gate',
      'Date of birth',
    ]) {
      expect(hasAgeGateAttribute(value), value).toBe(true);
    }
  });

  it('語の途中の一致は取らない（manage-gateway を入口ゲートにしない）', () => {
    for (const value of [
      'manage-gateway',
      'page-gateway',
      'message-banner',
      'storage-consent',
      'cookie-banner',
      'usercentrics-root',
      // 大文字ケースでも [^a-z] は i フラグ下で A-Z を含めて除外するので誤爆しない（修正3。
      // 将来 \b に「簡素化」されると静かに壊れる箇所なので固定しておく）
      'MANAGE-GATEWAY',
      'STORAGE-GATEWAY',
    ]) {
      expect(hasAgeGateAttribute(value), value).toBe(false);
    }
  });
});

describe('Cookie 固有語・危険文脈語', () => {
  it('Cookie 固有語は cookie / クッキー / gdpr だけ', () => {
    for (const text of ['We use cookies', 'クッキーの使用について', 'GDPR に基づく']) {
      expect(hasCookieWord(text), text).toBe(true);
    }
    // 規約ダイアログ・フォーム・ヘッダーに頻出する語は Cookie 固有語にしない
    for (const text of ['利用規約に同意しますか', 'プライバシーポリシー', '個人情報の取り扱い', 'Privacy']) {
      expect(hasCookieWord(text), text).toBe(false);
    }
  });

  it('危険文脈語', () => {
    for (const text of ['アカウントを削除しますか', 'お支払い方法', 'ご注文の確認', 'パスワードを入力', 'Delete this item', 'Payment method', 'Password']) {
      expect(hasDangerousContext(text), text).toBe(true);
    }
    expect(hasDangerousContext('当サイトでは Cookie を使用しています')).toBe(false);
  });

  it('order / remove は危険文脈語にしない（"in order to" が Cookie バナー定番のため）', () => {
    for (const text of ['We use cookies in order to improve your experience.', 'Remove this filter']) {
      expect(hasDangerousContext(text), text).toBe(false);
    }
  });
});

describe('バナー語・容器ヒント', () => {
  it('バナー語（可視テキスト。正規化前でも判定できる）', () => {
    for (const text of ['We use cookies', 'クッキーの使用について', '同意をお願いします', 'プライバシー設定', 'GDPR', 'トラッキング技術', '個人情報の取り扱い']) {
      expect(hasBannerWord(text), text).toBe(true);
    }
    expect(hasBannerWord('会員登録フォーム')).toBe(false);
  });

  // E: 容器の入口を広げた分。押す・隠すの条件は cookieSpecific のままなので安全側は変わらない
  it('バナー語の追加分（E）', () => {
    for (const text of [
      '同意管理プラットフォーム',
      'プライバシー設定を変更',
      'データの利用について',
      'データ利用に関するお知らせ',
      '情報の利用目的',
      'お客様のプライバシーを尊重します',
      'お客様のデータの取り扱い',
      'Cookie Policy',
      'Privacy Preference Center',
      'Data Protection',
    ]) {
      expect(hasBannerWord(text), text).toBe(true);
    }
  });

  it('強い容器ヒント（id / class / aria-label）', () => {
    for (const value of ['cookie-bar', 'クッキー通知', 'gdpr-modal', 'qc-cmp2-container', 'cmpbox', '__cmp-wrap']) {
      expect(hasContainerHint(value), value).toBe(true);
    }
    expect(hasContainerHint('signup card')).toBe(false);
  });

  it('consent / privacy は汎用ヒント（単独では容器にしない。H-1）', () => {
    for (const value of ['ConsentBanner', 'privacy-notice', 'consent-modal', 'privacy-modal']) {
      expect(hasContainerHint(value), value).toBe(false);
      expect(hasGenericContainerHint(value), value).toBe(true);
    }
    expect(hasGenericContainerHint('cookie-bar')).toBe(false);
  });

  it('banner / notice は弱いヒント（単独では容器にしない）', () => {
    for (const value of ['hero-banner', 'notice-bar', 'promo banner']) {
      expect(hasContainerHint(value), value).toBe(false);
      expect(hasWeakContainerHint(value), value).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 英語ボタン文言の分類表
// ---------------------------------------------------------------------------

/**
 * 実サイトでよく見る英語のボタン文言を 1 件ずつ固定する表。
 * 語彙を広げたときに「どのゲートで守られているか」が崩れていないことを見るのが目的なので、
 * 期待値は候補の並び順ではなく判定関数の組み合わせそのもの。
 */
type Label =
  | 'forbidden-hard'
  | 'forbidden-soft'
  | 'non-decision'
  | 'reject-strong'
  | 'reject-minimal'
  | 'reject-weak'
  | 'accept-specific'
  | 'accept-bare'
  | 'accept-weak'
  | 'close';

/**
 * パイプラインと同じ順に判定する。
 * 禁止語・非決定語は decisionCandidates がそこで落とすので、それ以上は分類しない。
 * ただし総量を明示する決定語（必要最小系／「すべて〜」を伴う許可の specific 一致・拒否の
 * 強一致）は、decisionCandidates と同じく非決定語より優先する（"Accept all purposes"
 * "Reject all vendors" のような、設定系の語を含む決定ボタンを非決定語として落とさないため）。
 * 拒否／許可／閉じるは同じ文言が複数に当たりうる（"Continue" は許可の弱一致でも閉じる語でもある）
 * ので、当たったものをすべて返して表で固定する。
 */
function labelsOf(text: string): Label[] {
  const t = n(text);
  if (isForbiddenHard(t)) return ['forbidden-hard'];
  if (isForbidden(t)) return ['forbidden-soft'];
  if (isNonDecision(t) && !overridesNonDecision(t)) return ['non-decision'];

  const labels: Label[] = [];
  if (isRejectStrong(t)) labels.push('reject-strong');
  if (isRejectMinimal(t)) labels.push('reject-minimal');
  if (isRejectWeak(t)) labels.push('reject-weak');
  if (isAcceptStrongSpecific(t)) labels.push('accept-specific');
  else if (isAcceptStrong(t)) labels.push('accept-bare');
  if (isAcceptWeak(t)) labels.push('accept-weak');
  if (isCloseWord(t)) labels.push('close');
  return labels;
}

/** 文言 → 期待する分類。1 件ずつ検証する */
const ENGLISH_BUTTONS: readonly (readonly [string, Label[]])[] = [
  // --- 拒否（強一致）---
  ['Reject All', ['reject-strong']],
  ['Reject all cookies', ['reject-strong']],
  ['Reject non-essential cookies', ['reject-strong']],
  ['Reject additional cookies', ['reject-strong']],
  ['Reject analytics cookies', ['reject-strong']],
  ['Reject optional', ['reject-strong']],
  ['Decline', ['reject-strong']],
  ['Decline optional cookies', ['reject-strong']],
  ['Decline all', ['reject-strong']],
  ['Deny', ['reject-strong']],
  ['Refuse', ['reject-strong']],
  ['Disagree', ['reject-strong']],
  ['I do not agree', ['reject-strong']],
  ['Don’t allow', ['reject-strong']],
  ['Do not allow', ['reject-strong']],
  ['Do not accept', ['reject-strong']],
  ["Don't accept", ['reject-strong']],
  // Google Funding Choices の拒否ボタン文言そのもの。ACCEPT_STRONG_BARE の `consent` に
  // 部分一致して許可語に化けない（accept-bare にならない）ことを確認する
  ['Do not consent', ['reject-strong']],
  ["Don't consent", ['reject-strong']],
  ['Withdraw consent', ['reject-strong']],
  // IAB TCF の「正当な利益に異議を唱える」操作
  ['Object to legitimate interests', ['reject-strong']],
  ['Opt out', ['reject-strong']],
  ['Opt-out of all', ['reject-strong']],
  ['Continue without accepting', ['reject-strong']],
  ['Disable all', ['reject-strong']],
  ['Disable non-essential cookies', ['reject-strong']],
  ['Turn off all', ['reject-strong']],
  // 裸の Disable も拒否語（裸の Enable を外したことと対称）
  ['Disable', ['reject-strong']],
  // ただし過去形には当たらない（"I've disabled my ad blocker" よけ。M-5）
  ['Disabled', []],
  // --- 拒否（必要最小系）---
  ['Necessary cookies only', ['reject-minimal']],
  ['Only necessary', ['reject-minimal']],
  ['Only allow essential cookies', ['reject-minimal']],
  ['Use necessary cookies only', ['reject-minimal']],
  ['Accept only necessary', ['reject-minimal']],
  ['Strictly necessary cookies', ['reject-minimal']],
  ['Essential only', ['reject-minimal']],
  ['Allow functional cookies only', ['reject-minimal']],
  ['Required cookies only', ['reject-minimal']],
  ['Accept only essential cookies', ['reject-minimal']],
  // 必要最小系に見えるが別カテゴリも含む文言は許可（reject モードで押して全許可にならないよう必要最小系から外す）
  ['Allow necessary and optional cookies', ['accept-specific']],
  ['Accept necessary and marketing cookies', ['accept-specific']],
  // only が付かない必要最小系（M-4）
  ['Accept necessary cookies', ['reject-minimal']],
  ['Allow essential cookies', ['reject-minimal']],
  // --- 拒否（弱一致。Cookie 固有語のある容器でだけ使う）---
  ['No, thanks', ['reject-weak']],
  ['No thanks', ['reject-weak']],
  ['No thank you', ['reject-weak']],
  ['Not now', ['reject-weak']],
  // 裸の No / Yes は年齢確認ゲート（"Are you over 18?"）を押すのでどの語彙にも入れない（H-2）
  ['No', []],
  ['Later', ['reject-weak']],
  ['Maybe later', ['reject-weak']],
  ['Skip', ['reject-weak']],
  // --- 許可（容器の文脈なしで押してよい具体的な言い回し）---
  ['Accept All Cookies', ['accept-specific']],
  ['Allow all', ['accept-specific']],
  // 助詞つきの日本語（実サイトの「全てに同意」など）
  ['全てに同意', ['accept-specific']],
  ['すべてを許可', ['accept-specific']],
  ['全てのCookieに同意する', ['accept-specific']],
  ['Accept all', ['accept-specific']],
  ['Agree to all', ['accept-specific']],
  ['Accept everything', ['accept-specific']],
  ['Allow everything', ['accept-specific']],
  ['Yes to all', ['accept-specific']],
  ['Enable all cookies', ['accept-specific']],
  ['Accept cookies', ['accept-specific']],
  ['Enable cookies', ['accept-specific']],
  // 裸の enable は外したので、cookie を含まない Enable 系はどの許可語にも当たらない
  ['Enable notifications', []],
  // --- 許可（Cookie 固有語ゲートの側）---
  ['Agree & proceed', ['accept-bare']],
  ['I accept', ['accept-bare']],
  ['I agree', ['accept-bare']],
  ['Accept', ['accept-bare']],
  ['Allow', ['accept-bare']],
  ['Yes, I agree', ['accept-bare']],
  // isAcceptStrong が先に当たるので弱一致には入れていない
  ['Agree and continue', ['accept-bare']],
  // --- 許可（弱一致）／閉じる語 ---
  ['Continue', ['accept-weak', 'close']],
  ['Yes', []],
  ['OK', ['accept-weak', 'close']],
  ['Got it!', ['accept-weak', 'close']],
  ['Understood', ['accept-weak', 'close']],
  ["That's fine", ['accept-weak']],
  ['Sure', ['accept-weak', 'close']],
  ['Alright', ['accept-weak', 'close']],
  ['OK, got it', ['close']],
  ['Hide this message', ['close']],
  ['Hide notice', ['close']],
  ['Close this notice', ['close']],
  ['No problem', ['close']],
  ['Close', ['close']],
  ['Dismiss', ['close']],
  // --- 総量を明示する決定語は非決定語より優先される（purposes / vendors を含んでいても決定ボタン扱い）---
  ['Accept all purposes', ['accept-specific']],
  ['Reject all vendors', ['reject-strong']],
  // --- 非決定（設定・詳細系。決定ボタンにしない）---
  ['Manage preferences', ['non-decision']],
  // 総量マーカーが無いので拒否語を含んでいても非決定語のまま（押しても設定パネルが開くだけ。M-3）
  ['Manage or reject cookies', ['non-decision']],
  ['Reject cookie settings', ['non-decision']],
  // "consent" は許可の bare 一致だが specific ではないので、非決定語のまま
  // （decisionCandidates の優先ルールは specific / 拒否強一致・必要最小系だけが対象）
  ['Manage consent preferences', ['non-decision']],
  ['Cookie settings', ['non-decision']],
  ['Manage choices', ['non-decision']],
  ['Show purposes', ['non-decision']],
  ['Vendors', ['non-decision']],
  ['Our partners', ['non-decision']],
  ['Do Not Sell or Share My Personal Information', ['non-decision']],
  ['Learn more', ['non-decision']],
  ['Privacy policy', ['non-decision']],
  ['Cookie Policy', ['non-decision']],
  ['More information', ['non-decision']],
  ['Change my preferences', ['non-decision']],
  ['Confirm my choices', ['non-decision']],
  ['Customise', ['non-decision']],
  ['Privacy Centre', ['non-decision']],
  ['Why?', ['non-decision']],
  ['About cookies', ['non-decision']],
  // Cookiebot の「選んだものだけ許可」。決定ボタンにはしない
  ['Allow selection', ['non-decision']],
  // --- 禁止語 ---
  ['Subscribe', ['forbidden-hard']],
  ['Sign in', ['forbidden-hard']],
  ['Sign up', ['forbidden-hard']],
  ['Buy now', ['forbidden-hard']],
  ['Checkout', ['forbidden-hard']],
  ['Delete my data', ['forbidden-hard']],
  ['Submit', ['forbidden-hard']],
  ['Save & exit', ['forbidden-soft']],
  ['Save my choices', ['forbidden-soft']],
  ['Apply', ['forbidden-soft']],
];

describe('英語ボタン文言の分類表', () => {
  it('表が 60 件以上ある', () => {
    expect(ENGLISH_BUTTONS.length).toBeGreaterThanOrEqual(60);
  });

  for (const [text, expected] of ENGLISH_BUTTONS) {
    it(`${text} -> ${expected.join(' + ')}`, () => {
      expect(labelsOf(text)).toEqual(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// 語彙の追加分（D）の分類表
// ---------------------------------------------------------------------------

/**
 * 取りこぼしを減らすために足した文言を 1 件ずつ固定する表。
 * プランに挙がっていた語のうち、すでに裸の `reject` `decline` `必要な.*のみ` などに
 * 当たるものは正規表現を増やさず、この表だけで担保している。
 */
const ADDED_VOCABULARY: readonly (readonly [string, Label[]])[] = [
  // --- 拒否（強一致。日本語）---
  ['拒絶する', ['reject-strong']],
  ['お断りします', ['reject-strong']],
  ['Cookie を利用しない', ['reject-strong']],
  ['Cookie を使用しない', ['reject-strong']],
  ['すべてオフにする', ['reject-strong']],
  ['広告 Cookie を無効にする', ['reject-strong']],
  ['同意せずに続ける', ['reject-strong']],
  ['同意せずに進む', ['reject-strong']],
  ['承認しない', ['reject-strong']],
  // --- 拒否（強一致。英語）---
  ['Turn all off', ['reject-strong']],
  ['Browse without accepting', ['reject-strong']],
  ['Deny all', ['reject-strong']],
  ['Refuse all', ['reject-strong']],
  ['Reject optional cookies', ['reject-strong']],
  ['Reject marketing cookies', ['reject-strong']],
  ['Decline optional', ['reject-strong']],
  ['Decline cookies', ['reject-strong']],
  ['Opt out of all', ['reject-strong']],
  // 「解除」は SOFT 禁止語なので、拒否語に当たってもヒューリスティックでは押さない
  // （decisionCandidates が落とす）。ユーザーが教えたボタンとしてだけ使える
  ['全て解除', ['forbidden-soft']],
  ['すべて解除', ['forbidden-soft']],
  ['選択を解除', ['forbidden-soft']],
  // --- 拒否（必要最小系）---
  ['必要最小限', ['reject-minimal']],
  ['最低限のみ許可', ['reject-minimal']],
  ['最低限のクッキーだけ', ['reject-minimal']],
  ['必要な項目のみ', ['reject-minimal']],
  ['必須のみ', ['reject-minimal']],
  ['必須のみ許可', ['reject-minimal']],
  ['基本的なもののみ', ['reject-minimal']],
  ['Only the strictly necessary', ['reject-minimal']],
  ['Only essential', ['reject-minimal']],
  ['Only required', ['reject-minimal']],
  ['Essential cookies only', ['reject-minimal']],
  ['Required cookies only', ['reject-minimal']],
  ['Minimum only', ['reject-minimal']],
  ['Minimum cookies', ['reject-minimal']],
  // --- 許可（specific。総量か cookie を明示するもの）---
  ['全部に同意', ['accept-specific']],
  ['全部同意', ['accept-specific']],
  ['全部許可', ['accept-specific']],
  ['すべてを受け入れる', ['accept-specific']],
  ['全てを受け入れる', ['accept-specific']],
  ['Accept cookies', ['accept-specific']],
  ['Accept all cookies', ['accept-specific']],
  ['Agree all', ['accept-specific']],
  ['Agree to everything', ['accept-specific']],
  ['Allow cookies', ['accept-specific']],
  ['Allow all cookies', ['accept-specific']],
  ['I accept all', ['accept-specific']],
  // --- 非決定語（開くだけのボタン）---
  ['一覧', ['non-decision']],
  ['パートナー一覧', ['non-decision']],
  ['Vendor list', ['non-decision']],
  ['詳細設定', ['non-decision']],
  ['Advanced', ['non-decision']],
  ['各社', ['non-decision']],
  ['ベンダー', ['non-decision']],
];

describe('語彙の追加分の分類表（D）', () => {
  for (const [text, expected] of ADDED_VOCABULARY) {
    it(`${text} -> ${expected.join(' + ')}`, () => {
      expect(labelsOf(text)).toEqual(expected);
    });
  }

  // 「解除」系は SOFT 禁止語で落ちるが、拒否語としては認識できている
  // （カスタムルール・picker のように HARD だけで見る経路のため）
  it('解除系は拒否語には当たる（SOFT 禁止語で落ちるだけ）', () => {
    for (const text of ['全て解除', 'すべて解除', '選択を解除']) {
      expect(isRejectStrong(n(text)), text).toBe(true);
      expect(isForbiddenHard(n(text)), text).toBe(false);
    }
  });

  // 拒否語を足したことで許可側に化けていないこと（accept モードの最後の砦）
  it('追加した拒否語は許可語として扱わない', () => {
    for (const text of ['拒絶する', 'Cookie を使用しない', 'すべてオフにする', '同意せずに続ける', '必要最小限', 'Minimum only']) {
      expect(isAcceptStrong(n(text)), text).toBe(false);
    }
  });

  // 追加した許可語は reject モードの候補から外れる（連結テキストで拒否語に化けたときの保険）
  it('追加した許可語は拒否候補として曖昧', () => {
    for (const text of ['全部に同意', 'Accept cookies', 'Allow cookies', 'Agree to everything']) {
      expect(isAmbiguousReject(n(text)), text).toBe(true);
    }
    // 否定形があるものは従来どおり拒否ボタン
    expect(isAmbiguousReject(n('Do not accept cookies'))).toBe(false);
  });
});

describe('強い拒否語は SOFT 禁止語より優先する', () => {
  // 「選択を解除」は総量マーカー（すべて / 全て）が無く NON_DECISION の `選択` に当たるので落とす
  // （チェックを外すだけで保存しない可能性があるため、押さない側に倒す）
  it('「すべて解除」「全て解除」は決定ボタンとして残る', () => {
    const buttons = ['すべて解除', '全て解除'].map((text, index) => ({
      el: document.createElement('button'),
      text: n(text),
      label: text,
      index,
    }));
    expect(decisionCandidates(buttons).map((b) => b.label)).toEqual(['すべて解除', '全て解除']);
  });

  it('拒否語でない SOFT 禁止語（保存・投稿）は従来どおり落とす', () => {
    const buttons = ['保存する', '投稿する'].map((text, index) => ({
      el: document.createElement('button'),
      text: n(text),
      label: text,
      index,
    }));
    expect(decisionCandidates(buttons)).toEqual([]);
  });
});
