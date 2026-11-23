// 実在する英語バナーのボタン文言を採点器（scoreCandidates）に 1 つずつ通して分類を固定する表（§5-5-d）。
// phrases.test.ts の分類表は判定関数の組み合わせを見るが、こちらは採点の結果（どの kind で
// 選ばれるか・選ばれないか）を見る。どちらも「語彙を広げたときに安全策が崩れていないか」の確認用。
//
// 文脈はすべて Cookie 固有語のある容器（cookieSpecific: true）・年齢確認ゲートなし。
// 容器にはそのボタン 1 つだけがある前提で採点する。

import { describe, expect, it } from 'vitest';
import type { CandidateContext } from '../src/engine/candidates';
import { scoreCandidates } from '../src/engine/candidates';
import { normalize } from '../src/engine/normalize';
import { SAVE_WORDS } from '../src/engine/panel';
import { hasSettledNotice, isCollapseWord, isSettingsButton } from '../src/shared/phrases';

const COOKIE_CONTEXT: CandidateContext = { cookieSpecific: true, ageGate: false };
const AGE_GATE_CONTEXT: CandidateContext = { cookieSpecific: true, ageGate: true };
const NON_COOKIE_CONTEXT: CandidateContext = { cookieSpecific: false, ageGate: false };

function button(label: string, index = 0) {
  return { el: document.createElement('button'), text: normalize(label), label, index };
}

/** 1 ボタンだけの容器として採点し、選ばれた kind を返す（何も選ばれなければ空配列） */
function kinds(label: string, mode: 'reject' | 'accept', context = COOKIE_CONTEXT): string[] {
  return scoreCandidates([button(label)], mode, context).map((s) => s.kind);
}

/** reject モードで `reject-*` として選ばれる */
const REJECT = [
  'Reject all',
  'Reject All Cookies',
  'Reject',
  'Decline',
  'Decline all',
  'Deny',
  'Deny all',
  'Refuse all',
  'I refuse',
  'I decline',
  'Disagree',
  'I do not agree',
  'Disagree and close',
  'Continue without agreeing',
  'Continue without accepting',
  'Do not consent',
  'Reject additional cookies',
  'Reject non-essential cookies',
  'Reject optional cookies',
  'Decline optional cookies',
  'Only necessary',
  'Necessary only',
  'Necessary cookies only',
  'Use necessary cookies only',
  'Allow essential cookies only',
  'Only essential cookies',
  'Essential cookies only',
  'Accept only essential cookies',
  'Only accept essential cookies',
  'Required only',
  'Accept required only',
  'Strictly necessary only',
  'Use essential cookies',
  'Allow necessary cookies',
  'Accept necessary cookies',
  'Continue with necessary cookies',
  'Continue with essential cookies',
  'Continue with required cookies',
  'Continue with essential cookies only',
  'Proceed with necessary cookies',
  'Proceed with essential cookies only',
  'Essential only',
  'Keep essential only',
  'Only required cookies',
  'Opt out',
  'Opt-out of all',
  "Don't allow",
  "I don't accept",
  'No, thanks',
  'Not now',
  'Reject & close',
  'Close and reject',
  'Refuse non-essential',
  'Block all',
  'Block all cookies',
  'Block cookies',
  'Block non-essential cookies',
  'Block all non-essential',
  'Block tracking',
  'Reject tracking',
  'Decline cookies',
  'Refuse cookies',
  'Withdraw consent',
  'Object to all',
  'Turn off all',
  'Disable all',
  'Accept essentials',
  'Essentials only',
  'Allow required',
  'Use required cookies only',
  'Accept minimal cookies',
  'Minimal cookies only',
  'Continue with minimal cookies',
  // 許可語（allow / accept）に部分一致するが拒否
  'Disallow',
  'Disallow all',
  'Disallow cookies',
  'Disagree to all',
  'Accept none',
  'Allow none',
  'Not accept',
  // 否定形 ＋ 動詞
  'I will not consent',
  'Do not enable',
  "Don't enable",
  'Do not use analytics cookies',
  "Don't use cookies",
  'Do not track',
  "Don't track me",
  'No tracking',
  'Stop tracking',
  // without ＋ 目的語
  'Proceed without cookies',
  'Browse without cookies',
  'Use without tracking',
  'Continue without consent',
  'Opt me out',
  'Switch off',
  'Switch all off',
  'Turn cookies off',
  'Deactivate all',
  'Do not use non-essential cookies',
  'Do not use third-party cookies',
  'Proceed without optional cookies',
  'No, I do not accept',
  // 否定された「すべて許可」
  'Refuse to accept all',
  'Decline to accept all',
  'Continue without accepting all',
  'Just necessary',
  'Just the essential cookies',
  // 弱一致の追加分
  'No, thank you!',
  'No cookies',
  'No cookies, please',
  'Nope',
  "I'd rather not",
];

/** reject モードでは何も選ばれず、accept モードで `accept-*` として選ばれる */
const ACCEPT = [
  'Accept all',
  'Accept All Cookies',
  'Allow all',
  'Allow all cookies',
  'Accept',
  'I accept',
  'Agree',
  'I agree',
  'Yes, I agree',
  'Accept & continue',
  'Agree and proceed',
  'Accept and close',
  'Allow cookies',
  'Accept cookies',
  'Enable all',
  'Accept analytics cookies',
  'Agree & close',
  // 同意寄りの相づち。許可ボタンとしてだけ認識し、閉じる語にはしない
  'Sounds good',
  "That's OK",
  "That's okay",
  "I'm OK with that",
  "I'm okay with that",
  "Yes, I'm happy",
  'Yes, I’m happy',
  "I'm happy with that",
  'Allow',
  'Consent',
  // 同意ボタンなので reject モードでは押さない（閉じる語ではない）
  'Accept and hide',
  "I'm fine with this",
  'Fine with me',
  'Fine by me',
  'Happy with that',
  "I'm OK with cookies",
  'I am happy with all cookies',
  "I'm happy",
  'Sure thing',
  'All cookies',
  'Turn on all',
  'Turn on cookies',
  'Switch on all',
  'Continue with all cookies',
  'Yes to cookies',
  'Turn all on',
  // `acceptnone-ssential` を拒否（Accept none）と読まない
  'Accept non-essential cookies',
  'Allow non-essential cookies',
  'I accept non-essential cookies',
];

/** reject モードで `close` として選ばれる */
const CLOSE = [
  'Got it',
  'Got it!',
  'OK',
  'Okay',
  'Close',
  'Dismiss',
  'I understand',
  'Understood',
  'OK, got it',
  'Okay, thanks',
  'Ok, thanks',
  'Thanks',
  'Thank you',
  'Noted',
  'Continue',
  'Continue browsing',
  'Close banner',
  'Close message',
  'Close notice',
  'Close cookie banner',
  'Close cookie notice',
  'Hide cookie message',
  'Hide this message',
  'Ok, I understand',
  'I got it',
  'No problem',
  'Hide',
  '×',
  '✖',
  // 相づちの組み合わせ
  'Got it, thanks!',
  'Thanks, got it',
  'OK, understood',
  'Okay, I understand',
  'Okay, thank you',
  'Noted, thanks',
  'All right',
  'Gotcha',
  'Acknowledge',
  'I acknowledge',
  // 閉じる動詞 ＋ 対象
  'Close this message',
  'Close this banner',
  'Close notification',
  'Close dialog',
  'Close popup',
  'Close modal',
  'Close cookie bar',
  'Close cookies banner',
  'Close cookie consent',
  'Dismiss notice',
  'Dismiss this message',
  'Dismiss cookie notice',
  'Hide this notice',
  'Hide message',
  'Keep browsing',
  'Continue to site',
  'Proceed',
  'Close and continue',
];

/** どちらのモードでも何も選ばれない（設定導線・情報リンク・保存系） */
const SETTINGS = [
  'Manage preferences',
  'Cookie settings',
  'Customize',
  'Customise',
  'Manage options',
  'More options',
  'Learn more',
  'Show purposes',
  'Vendors',
  'Confirm my choices',
  'Do Not Sell or Share My Personal Information',
  'Privacy policy',
  'Change settings',
  'Manage cookies',
  'Set preferences',
  'Adjust preferences',
  'Cookie policy',
  'Let me choose',
  'Allow selection',
  'Save preferences',
  'Save and close',
  'Your privacy choices',
  // `adjust` は設定導線（拒否ボタンではない）
  'No, adjust... ',
  // 「おすすめの設定」を許可ボタンとは言い切れないので、設定導線として押さない側に倒す
  'Accept recommended settings',
  'Choose language',
  'Accept selected',
  'Update preferences',
  'Close preferences',
];

describe('英語ボタン文言の採点（1 ボタンだけの容器）', () => {
  describe('拒否', () => {
    it.each(REJECT)('%s', (label) => {
      const selected = kinds(label, 'reject');
      expect(selected).toHaveLength(1);
      expect(selected[0]).toMatch(/^reject-/);
    });
  });

  describe('許可', () => {
    it.each(ACCEPT)('%s', (label) => {
      expect(kinds(label, 'reject')).toEqual([]);
      const selected = kinds(label, 'accept');
      expect(selected).toHaveLength(1);
      expect(selected[0]).toMatch(/^accept-/);
    });
  });

  describe('閉じる', () => {
    it.each(CLOSE)('%s', (label) => {
      expect(kinds(label, 'reject')).toEqual(['close']);
    });
  });

  describe('設定・情報（押さない）', () => {
    it.each(SETTINGS)('%s', (label) => {
      expect(kinds(label, 'reject')).toEqual([]);
      expect(kinds(label, 'accept')).toEqual([]);
    });
  });
});

describe('英語の語彙追加の安全側', () => {
  // Cookie 設定のせいで止めている埋め込み（動画など）のプレースホルダ。押すと同意になる
  it.each(['Unblock', 'Unblock video', 'Unblock content', 'Unblock all', 'Blocked content', 'Block ads'])(
    '%s は拒否として選ばない',
    (label) => {
      expect(kinds(label, 'reject').filter((kind) => kind.startsWith('reject-'))).toEqual([]);
    },
  );

  it.each(['Continue with all cookies', 'Continue with necessary and marketing cookies', 'Continue'])(
    '%s は拒否として選ばない',
    (label) => {
      expect(kinds(label, 'reject').filter((kind) => kind.startsWith('reject-'))).toEqual([]);
    },
  );

  // 拒否の強一致・必要最小系は Cookie 固有語ゲートの外でも有効なので、Cookie 語の無い容器でも見る
  const rejectKinds = (label: string) =>
    [...kinds(label, 'reject'), ...kinds(label, 'reject', NON_COOKIE_CONTEXT)].filter((kind) =>
      kind.startsWith('reject-'),
    );

  // 別カテゴリも含む必要最小系もどき（押すと全許可に近い）
  it.each([
    'Accept minimal cookies and all analytics',
    'Continue with minimal cookies and marketing',
    'Allow minimal cookies plus advertising',
    'Accept strictly necessary and marketing',
    'Continue with necessary cookies and marketing',
    'Proceed with essential cookies and analytics',
  ])('%s は必要最小系にしない', (label) => {
    expect(rejectKinds(label)).toEqual([]);
  });

  // continue / proceed は目的語（cookies / only）が無ければ必要最小系にしない（プラン選択・フォームよけ）
  it.each([
    'Continue with Essential',
    'Continue with Essential plan',
    'Continue with required fields',
    'Continue with necessary updates',
    'Continue with required booking',
    'Use minimal mode',
    'Enable minimal UI',
    'Allow minimal',
    'Continue with Google',
    'Continue with Apple',
    'Continue with email',
  ])('%s は拒否として選ばない', (label) => {
    expect(rejectKinds(label)).toEqual([]);
  });

  // block は否定形・広告ブロッカー・通知系の後続語には当てない
  it.each([
    "Don't block cookies",
    'Do not block cookies',
    'Block all notifications',
    'Block all messages from this user',
    'Adblock all',
  ])('%s は拒否として選ばない', (label) => {
    expect(rejectKinds(label)).toEqual([]);
  });

  // 同意を意味する相づちは、選択肢のない通知の閉じる語として押さない
  it.each(['Sounds good', "That's OK", "I'm OK with that", "Yes, I'm happy", "I'm happy with that"])(
    '%s は reject モードの閉じる語として押さない',
    (label) => {
      expect(kinds(label, 'reject')).toEqual([]);
    },
  );

  it('theguardian.com 型の [Yes, I’m happy] [Manage or reject cookies] は reject モードで何も押さない', () => {
    const buttons = [button("Yes, I'm happy", 0), button('Manage or reject cookies', 1)];
    expect(scoreCandidates(buttons, 'reject', COOKIE_CONTEXT)).toEqual([]);
    // 非表示フォールバックの判定材料として、accept モードでは許可ボタンが見える
    expect(scoreCandidates(buttons, 'accept', COOKIE_CONTEXT).map((s) => s.label)).toEqual(["Yes, I'm happy"]);
  });

  // 年齢確認ゲートの容器では弱一致・閉じる語を一切使わない（H-2）
  it.each([
    'Sounds good',
    "That's OK",
    "That's okay",
    "I'm OK with that",
    "I'm okay with that",
    "Yes, I'm happy",
    "I'm happy with that",
    'Ok, thanks',
    'Okay, thanks',
    'Thanks',
    'Thank you',
    'Noted',
    'Ok, I understand',
    'I got it',
    'Continue browsing',
    'Close banner',
    'Close message',
    'Close notice',
    'Close cookie banner',
    'Close cookie notice',
    'Hide cookie message',
  ])('ageGate の容器では %s を使わない', (label) => {
    expect(kinds(label, 'reject', AGE_GATE_CONTEXT)).toEqual([]);
    expect(kinds(label, 'accept', AGE_GATE_CONTEXT)).toEqual([]);
    // ゲートが無ければ使える（この表が空振りしていないことの確認）
    expect([...kinds(label, 'reject'), ...kinds(label, 'accept')]).not.toEqual([]);
  });
});

describe('拒否語・閉じる語を広げたぶんの安全側', () => {
  const rejectKinds = (label: string) =>
    [...kinds(label, 'reject'), ...kinds(label, 'reject', NON_COOKIE_CONTEXT)].filter((kind) =>
      kind.startsWith('reject-'),
    );

  // 補足文つきの許可ボタン。連結した文言に拒否語が含まれても拒否にしない
  it.each([
    'Accept all You can disagree at any time',
    'Accept all You can disallow cookies later',
    'Allow all cookies or switch them off in settings',
    'Accept all Browse without limits',
    "Accept all — we don't track you",
    'Accept all — we never track you',
    'Accept cookies — we do not use marketing cookies',
    'Accept all — no data shared without consent',
    'Accept all — browse without tracking',
    'Accept all Some features will not work without cookies',
    'Accept all - works without tracking',
    // 総量を言わない許可ボタンの補足文（先頭に限った拒否語には当たらない）
    "Accept — we don't track you",
    'Accept Some features will not work without cookies',
    'OK — no tracking, promise',
  ])('%s は拒否として選ばない', (label) => {
    expect(rejectKinds(label)).toEqual([]);
  });

  // 空白を落とした文言での部分一致よけ
  it.each([
    'Not useful',
    'Cookies not used',
    'Adjust necessary cookies',
    'Without limits',
    'Enable non-essential cookies',
    'Allow non-essential',
    'Turn off ad blocker',
    "Don't turn off cookies",
    'Return offer',
    'No thanks, continue with ads',
    'No thanks, keep personalized ads',
    'I object',
  ])('%s は拒否として選ばない', (label) => {
    expect(rejectKinds(label)).toEqual([]);
  });

  // 状態の表示（押すボタンではない）
  it.each(['Not allowed', 'Not accepted', 'Cookies not enabled', 'Disallowed', 'Deactivated'])(
    '%s は拒否として選ばない',
    (label) => {
      expect(rejectKinds(label)).toEqual([]);
    },
  );

  it.each(['Opting out', 'Disapprove', 'Do not turn on cookies'])(
    '%s は許可として選ばない',
    (label) => {
      expect(kinds(label, 'accept').filter((kind) => kind.startsWith('accept-'))).toEqual([]);
    },
  );

  // `dis-all-ow` を総量マーカーと読んで、設定導線を決定ボタンに戻さない
  it.each(['Manage or disallow cookies', 'Disallow cookie settings', 'Manage or do not allow cookies'])(
    '%s は決定ボタンにしない',
    (label) => {
      expect(kinds(label, 'reject')).toEqual([]);
      expect(kinds(label, 'accept')).toEqual([]);
    },
  );

  it('Continue with all essential cookies only は必要最小系のまま（曖昧な拒否にしない）', () => {
    expect(kinds('Continue with all essential cookies only', 'reject')).toEqual(['reject-minimal']);
  });

  // `consent` に部分一致しても、閉じる操作は許可ボタンではない
  it.each(['Close cookie consent', 'Close consent banner', 'Dismiss consent notice'])(
    '%s は accept モードでも閉じる語',
    (label) => {
      expect(kinds(label, 'accept')).toEqual(['close']);
    },
  );

  // 同意寄りの相づちは閉じる語にしない
  it.each(["I'm fine with this", 'Fine with me', 'Happy with that', "I'm OK with cookies"])(
    '%s は reject モードの閉じる語として押さない',
    (label) => {
      expect(kinds(label, 'reject')).toEqual([]);
    },
  );

  it.each([
    'Hide this banner',
    'Close window',
    'Close account',
    'Dismiss all',
    'Got it, yes',
    'OK, accept',
    'Close the',
    'Hide cookie',
    'Great',
    'Cool, thanks',
  ])(
    '%s は閉じる語として押さない',
    (label) => {
      expect(kinds(label, 'reject')).toEqual([]);
    },
  );

  it.each([
    'Got it, thanks!',
    'OK, understood',
    'Close this message',
    'Dismiss notice',
    "I'm fine with this",
    'Fine with me',
    'No cookies',
    "I'd rather not",
    'Proceed',
    'Continue to site',
  ])('ageGate の容器では %s を使わない', (label) => {
    expect(kinds(label, 'reject', AGE_GATE_CONTEXT)).toEqual([]);
    expect(kinds(label, 'accept', AGE_GATE_CONTEXT)).toEqual([]);
    expect([...kinds(label, 'reject'), ...kinds(label, 'accept')]).not.toEqual([]);
  });

  it('[Continue] [Let me choose] は reject モードで Continue を押さない', () => {
    const buttons = [button('Continue', 0), button('Let me choose', 1)];
    expect(scoreCandidates(buttons, 'reject', COOKIE_CONTEXT)).toEqual([]);
  });
});

describe('設定導線と保存ボタンの英語', () => {
  it.each(['Let me choose', 'I want to choose', 'Choose cookies', 'Select cookies', 'Choose which cookies'])('%s は設定ボタン', (label) => {
    expect(isSettingsButton(normalize(label))).toBe(true);
  });

  // 設定パネル層は最初に当たった設定ボタンを押す。言語の切り替え・課金導線・同意ボタンを先に押さない
  it.each([
    'Choose language',
    'Choose your country',
    'Choose another language',
    'Choose currency',
    'Choose a plan',
    'Choose ad-free subscription',
    'Choose free with ads',
    'I choose to accept all',
    'Choose all cookies',
    'Accept selected cookies',
  ])('%s は設定ボタンではない', (label) => {
    expect(isSettingsButton(normalize(label))).toBe(false);
  });

  it.each([
    'Accept selected',
    'Accept selected cookies',
    'Accept selection',
    'Allow selected',
    'Accept my choices',
    'Continue with selection',
    'Proceed with my choices',
  ])('%s は保存語', (label) => {
    expect(SAVE_WORDS.test(normalize(label))).toBe(true);
  });
});

describe('バナーを隠す語は折りたたみ語（自動では押さない）', () => {
  // `hide banner` と同じ扱い。`hide cookie message` のようにメッセージを隠す語だけが閉じる語
  it.each(['Hide banner', 'Hide cookie banner'])('%s は閉じる語として押さず、折りたたみ語として扱う', (label) => {
    expect(kinds(label, 'reject')).toEqual([]);
    expect(kinds(label, 'accept')).toEqual([]);
    expect(isCollapseWord(normalize(label))).toBe(true);
  });
});

describe('完了状態の文言（英語の追加分）', () => {
  // GOV.UK Frontend の Cookie バナーが選択後に出すメッセージ
  it.each(["You've rejected additional cookies.", 'You’ve rejected additional cookies.'])('%s に当たる', (text) => {
    expect(hasSettledNotice(text)).toBe(true);
  });

  // 許可側の短縮形は足していない（閉じる語で閉じる通知まで完了状態にしてしまうため）
  it.each(["By using this site you've accepted our cookies.", 'By using this site you’ve accepted our cookies.'])(
    '%s には当たらない',
    (text) => {
      expect(hasSettledNotice(text)).toBe(false);
    },
  );
});
