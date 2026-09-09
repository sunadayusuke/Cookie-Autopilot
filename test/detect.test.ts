import { beforeEach, describe, expect, it } from 'vitest';
import type { ButtonCandidate } from '../src/engine/candidates';
import {
  collectButtons,
  contextOf,
  decisionCandidates,
  isCookieSpecific,
  isEligibleAnchor,
  pickCandidates,
  scoreCandidates,
} from '../src/engine/candidates';
import { deepElements, deepQueryAll, deepQueryFirst } from '../src/engine/deepQuery';
import type { ContainerFacts } from '../src/engine/detect';
import {
  CONTAINER_SCORE_THRESHOLD,
  containerScore,
  detectBannerContainer,
  evaluateContainer,
  findContainers,
  hideTarget,
} from '../src/engine/detect';
import { setBody, testEnv } from './helpers';

const env = testEnv();

/** data-w / data-h があればその大きさを返す env */
const sizedEnv = testEnv({
  getRect: (el) => ({
    width: Number(el.getAttribute('data-w') ?? 600),
    height: Number(el.getAttribute('data-h') ?? 120),
  }),
});

beforeEach(() => {
  setBody('');
});

describe('容器検出', () => {
  it('日本語の独自実装バナー（fixed 下部）を検出する', () => {
    setBody(`
      <main><h1>記事</h1><p>本文です。</p></main>
      <div id="bar" class="fx-cookie-strip" style="position:fixed">
        <p>当サイトでは Cookie を使用して、利便性の向上とアクセス解析を行っています。</p>
        <button class="fx-allow">すべて許可</button>
        <button class="fx-deny">拒否</button>
        <button class="fx-config">Cookie の設定</button>
      </div>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('bar');
    expect(container?.decisions.map((d) => d.text)).toEqual(['すべて許可', '拒否']);
  });

  it('role="dialog" と aria-modal でも検出する', () => {
    setBody(`
      <div id="d1" role="dialog"><p>We use cookies.</p><button>Accept all</button><button>Reject all</button></div>
    `);
    expect(detectBannerContainer(document, env)?.el.id).toBe('d1');

    setBody(`
      <div id="d2" aria-modal="true"><p>クッキーの利用に同意してください</p><button>同意する</button></div>
    `);
    expect(detectBannerContainer(document, env)?.el.id).toBe('d2');
  });

  it('自身の本文にバナー語も Cookie の名指しも無い固定バーは採用しない', () => {
    setBody(`
      <div id="promo" style="position:fixed"><p>セール開催中です</p><button>今すぐ見る</button></div>
    `);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('祖先の本文にだけ Cookie 語があっても、自身の本文にバナー語が無ければ採用しない', () => {
    // main / nav / article を使わないページ（div soup）では、フッターの「Cookie Policy」
    // リンク 1 本で 5 階層ぶんの子孫が cookieSpecific になる。それだけを根拠に
    // 規約更新モーダルを容器にすると reject で「Decline」を押してしまう（§5-5-d のハード条件 8.）
    setBody(`
      <div class="page">
        <div class="site-footer"><a href="/cookie-policy">Cookie Policy</a></div>
        <div id="tos" role="dialog">
          <p>We have updated our Terms of Service.</p>
          <button>I agree</button><button>Decline</button>
        </div>
      </div>
    `);
    const tos = document.getElementById('tos') as Element;
    // 名乗りの無い祖先（`class="page"`）の本文は Cookie の根拠にしない（§5-5-d ⒞）。
    // フッターの「Cookie Policy」1 本で規約モーダルまで Cookie 扱いになるのを防ぐため
    expect(isCookieSpecific(tos, tos.textContent ?? '', (el) => el.textContent ?? '')).toBe(false);
    expect(evaluateContainer(tos, env)).toBeNull();
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('自身の属性が Cookie を名指ししていれば、本文にバナー語が無くても採用する', () => {
    setBody(`
      <div id="bar" class="cookie-consent" style="position:fixed">
        <button class="fx-deny">Reject</button>
        <button class="fx-allow">Accept</button>
      </div>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('bar');
    expect(container?.signals).toContain('attr-cookie');
    expect(container?.signals).not.toContain('text-banner');
  });

  it('決定ボタンが無い要素は採用しない（本文中の Cookie ポリシー）', () => {
    setBody(`
      <section class="fx-cookie-note">
        <h2>Cookie について</h2>
        <p>当サイトの Cookie の取り扱いについては <a href="/policy">Cookie ポリシー</a> をご覧ください。</p>
      </section>
    `);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('誤クリック防止ページ（trap）では容器が 1 つも見つからない', () => {
    setBody(`
      <form id="signup" class="card">
        <h2>会員登録</h2>
        <label><input type="checkbox" name="terms" /> 利用規約とプライバシーポリシーに同意する</label>
        <button type="submit">送信</button>
      </form>
      <section class="fx-cookie-note card">
        <h2>Cookie について</h2>
        <p>当サイトの Cookie の取り扱いについては <a href="/policy">Cookie ポリシー</a> をご覧ください。</p>
      </section>
    `);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('本文が長すぎる要素は採用しない', () => {
    setBody(`
      <div id="huge" style="position:fixed">
        <p>Cookie ${'あ'.repeat(8200)}</p>
        <button>拒否</button>
      </div>
    `);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('小さすぎる要素は採用しない', () => {
    setBody(`
      <div id="tiny" class="cookie-chip" data-w="180" data-h="20"><p>Cookie</p><button>拒否</button></div>
    `);
    expect(findContainers(document, sizedEnv)).toHaveLength(0);
  });

  it('複数見つかったら最も内側（最小）を優先する', () => {
    setBody(`
      <div id="outer" class="cookie-overlay" data-w="1000" data-h="800">
        <div id="inner" class="cookie-dialog" data-w="400" data-h="200">
          <p>Cookie を使用します</p>
          <button>拒否</button>
        </div>
      </div>
    `);
    const containers = findContainers(document, sizedEnv);
    expect(containers.map((c) => c.el.id)).toEqual(['inner', 'outer']);
    expect(detectBannerContainer(document, sizedEnv)?.el.id).toBe('inner');
  });

  it('shadow DOM の中のバナーも検出する', () => {
    setBody('<div id="host"></div>');
    const shadow = (document.getElementById('host') as HTMLElement).attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div class="fx-cookie-box">
        <p>We use cookies to improve your experience.</p>
        <button class="fx-accept">Accept all</button>
        <button class="fx-reject">Reject all</button>
      </div>
    `;
    const container = detectBannerContainer(document, env);
    expect(container?.el.className).toBe('fx-cookie-box');
    expect(pickCandidates(container?.el as Element, 'reject', env)[0]?.text).toBe('rejectall');
  });

  it('非表示の容器は検出しない', () => {
    setBody(`
      <div id="hidden-bar" class="cookie-bar" hidden><p>Cookie</p><button>拒否</button></div>
    `);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('position: static でも属性ヒント（id="cookie-banner"）で検出する', () => {
    setBody(`
      <div id="cookie-banner">
        <p>We use cookies to run this site and to understand how it is used.</p>
        <button class="fx-accept">Accept</button>
        <button class="fx-reject">Reject</button>
      </div>
      <main><h1>記事</h1><p>本文です。</p></main>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('cookie-banner');
    // fixed でも sticky でもないので、overlay の加点は付かず attr-cookie で拾われる
    expect(container?.signals).toContain('attr-cookie');
    expect(container?.signals).not.toContain('overlay');
    expect(env.getPosition(container?.el as Element)).toBe('static');
    expect(pickCandidates(container?.el as Element, 'reject', env)[0]?.text).toBe('reject');
    expect(pickCandidates(container?.el as Element, 'accept', env)[0]?.text).toBe('accept');
  });
});

describe('容器の加点（containerScore。§5-5-d）', () => {
  /** 加点されない値を既定にした facts（見たい signal だけを立てる） */
  const facts = (over: Partial<ContainerFacts> = {}): ContainerFacts => ({
    text: '',
    attributes: '',
    attrCookie: false,
    overlay: false,
    cookieSpecific: false,
    decisions: [],
    ...over,
  });

  const bar = (): Element => document.getElementById('bar') as Element;

  /** 容器の中の決定ボタン候補（実際の収集経路をそのまま使う） */
  const decisionsIn = (el: Element): ButtonCandidate[] => decisionCandidates(collectButtons(el, env));

  it('attr-cookie: 自身の class が cookie 系なら 3 点', () => {
    expect(containerScore(facts({ attributes: 'cookie-bar', attrCookie: true }))).toEqual({
      score: 3,
      signals: ['attr-cookie'],
    });
  });

  it('text-cookie: 本文の Cookie 固有語で 3 点（バナー語の 1 点も必ず付く）', () => {
    // COOKIE_WORDS ⊂ BANNER_WORDS なので、text-cookie は text-banner を必ず伴う
    expect(containerScore(facts({ text: 'We use cookies.' }))).toEqual({
      score: 4,
      signals: ['text-cookie', 'text-banner'],
    });
  });

  it('ancestor-cookie: 名指しの根拠が祖先だけなら 2 点', () => {
    expect(containerScore(facts({ cookieSpecific: true }))).toEqual({
      score: 2,
      signals: ['ancestor-cookie'],
    });
  });

  it('ancestor-cookie: attr-cookie / text-cookie があるときは加算しない', () => {
    expect(
      containerScore(facts({ attributes: 'cookie-bar', attrCookie: true, cookieSpecific: true })).signals,
    ).toEqual(['attr-cookie']);

    expect(containerScore(facts({ cookieSpecific: true, text: 'cookie' })).signals).toEqual([
      'text-cookie',
      'text-banner',
    ]);
  });

  it('attr-consent: 汎用の属性ヒント（consent / privacy）で 2 点', () => {
    expect(containerScore(facts({ attributes: 'consent-modal' }))).toEqual({
      score: 2,
      signals: ['attr-consent'],
    });
  });

  it('decision-strong: 子孫の決定候補に強い決定語があれば 2 点', () => {
    setBody('<div id="bar"><button>Reject all</button></div>');
    expect(containerScore(facts({ decisions: decisionsIn(bar()) }))).toEqual({
      score: 2,
      signals: ['decision-strong'],
    });
  });

  it('attr-banner: 弱い属性ヒント（banner / notice）で 1 点', () => {
    expect(containerScore(facts({ attributes: 'site-banner' }))).toEqual({ score: 1, signals: ['attr-banner'] });
  });

  it('overlay: 入口の足切りが見た値をそのまま 1 点にする', () => {
    expect(containerScore(facts({ overlay: true }))).toEqual({ score: 1, signals: ['overlay'] });
  });

  it('overlay: dialog / aria-modal / fixed / sticky が overlay として数えられる', () => {
    // 加点の overlay は evaluateContainer が入口の足切りで求めた isOverlay の結果そのもの
    for (const attributes of ['role="dialog"', 'aria-modal="true"', 'style="position:fixed"', 'style="position:sticky"']) {
      setBody(`<div id="bar" ${attributes}><p>We use cookies.</p><button>Reject all</button></div>`);
      expect(evaluateContainer(bar(), env)?.signals, attributes).toContain('overlay');
    }
  });

  it('text-banner: 本文のバナー語だけなら 1 点', () => {
    expect(containerScore(facts({ text: '個人情報の取り扱いに同意してください。' }))).toEqual({
      score: 1,
      signals: ['text-banner'],
    });
  });

  it('decision-weak: 強い決定語でない決定候補だけなら 1 点', () => {
    setBody('<div id="bar"><button>OK</button></div>');
    expect(containerScore(facts({ decisions: decisionsIn(bar()) }))).toEqual({
      score: 1,
      signals: ['decision-weak'],
    });
  });

  it('decision-strong / decision-weak は子孫のボタンから決まる（自身がボタンなら容器にしない）', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies.</p>
        <button id="deny">Reject all</button>
      </div>
    `);
    // 容器自身の文言ではなく、子孫の決定候補を見る
    expect(containerScore(facts({ decisions: decisionsIn(bar()) })).signals).toContain('decision-strong');
    // ボタン自身は加点まで進まない（ハード条件 2. の「自身が操作要素でない」で落ちる）
    expect(evaluateContainer(document.getElementById('deny') as Element, env)).toBeNull();
  });

  it('閾値ちょうど（4 点）なら採用し、3 点なら届かない', () => {
    // 採用されうる構成の下限 = attr-cookie 3 + decision-weak 1 = 4（＝閾値と同値）。
    // 本文にバナー語は無いが、自身の属性が cookie を名指ししているのでハード条件 8. は免除される
    setBody('<div id="bar" class="cookie-bar"><button>OK</button></div>');
    const container = evaluateContainer(bar(), env);
    expect(container?.score).toBe(CONTAINER_SCORE_THRESHOLD);
    expect(container?.signals).toEqual(['attr-cookie', 'decision-weak']);

    // 名指しの根拠が祖先だけ（ancestor-cookie 2 + decision-weak 1）なら 3 点で閾値に届かない
    setBody('<div class="cookie-root"><div id="bar"><button>OK</button></div></div>');
    const scored = containerScore(facts({ cookieSpecific: true, decisions: decisionsIn(bar()) }));
    expect(scored).toEqual({ score: 3, signals: ['ancestor-cookie', 'decision-weak'] });
    expect(scored.score < CONTAINER_SCORE_THRESHOLD).toBe(true);
    // 実際にも採用しない（この形は入口の足切りとハード条件 8. でも落ちるので、点数だけが理由ではない）
    expect(evaluateContainer(bar(), env)).toBeNull();
  });
});

describe('候補の採点', () => {
  const bannerHtml = `
    <div id="bar" class="fx-cookie-strip" style="position:fixed">
      <p>当サイトでは Cookie を使用しています。</p>
      <button class="fx-allow">すべて許可</button>
      <button class="fx-deny">拒否</button>
      <button class="fx-config">Cookie の設定</button>
    </div>
  `;

  it('reject モードでは拒否ボタンを選ぶ', () => {
    setBody(bannerHtml);
    const candidates = pickCandidates(document.getElementById('bar') as Element, 'reject', env);
    expect(candidates[0]?.text).toBe('拒否');
    expect(candidates[0]?.kind).toBe('reject-strong');
    expect(candidates).toHaveLength(1);
  });

  it('accept モードでは許可ボタンを選ぶ', () => {
    setBody(bannerHtml);
    const candidates = pickCandidates(document.getElementById('bar') as Element, 'accept', env);
    expect(candidates[0]?.text).toBe('すべて許可');
    expect(candidates[0]?.kind).toBe('accept-strong');
  });

  it('強一致が必要最小系より優先される', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>Cookie</p>
        <button>必要なもののみ</button>
        <button>すべて拒否</button>
      </div>
    `);
    const candidates = pickCandidates(document.getElementById('bar') as Element, 'reject', env);
    expect(candidates.map((c) => c.text)).toEqual(['すべて拒否', '必要なもののみ']);
  });

  it('reject モードは 強一致 > 必要最小 > 弱一致 の順', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies on this site.</p>
        <button>No thanks</button>
        <button>Necessary cookies only</button>
        <button>Reject all</button>
      </div>
    `);
    const candidates = pickCandidates(document.getElementById('bar') as Element, 'reject', env);
    expect(candidates.map((c) => c.kind)).toEqual(['reject-strong', 'reject-minimal', 'reject-weak']);
    expect(candidates.map((c) => c.text)).toEqual(['rejectall', 'necessarycookiesonly', 'nothanks']);
  });

  it('同点なら容器内で先に出現したもの', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>Cookie</p>
        <button id="first">拒否</button>
        <button id="second">同意しない</button>
      </div>
    `);
    const candidates = pickCandidates(document.getElementById('bar') as Element, 'reject', env);
    expect((candidates[0]?.el as Element).id).toBe('first');
  });

  it('拒否ボタンが無ければ reject モードの候補はゼロ', () => {
    setBody(`
      <div id="bar" class="fx-cookie-bar" style="position:fixed">
        <p>Cookie の利用に同意いただくと、より便利にご利用いただけます。</p>
        <button class="fx-agree">同意する</button>
        <button class="fx-config">設定</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(pickCandidates(bar, 'reject', env)).toHaveLength(0);
    expect(pickCandidates(bar, 'accept', env)[0]?.text).toBe('同意する');
  });

  it('決定ボタンが 1 つだけで閉じる語ならどちらのモードでも押せる', () => {
    setBody(`
      <div id="bar" class="fx-cookie-toast" style="position:fixed">
        <p>このサイトは Cookie を使用しています。</p>
        <button>OK</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(pickCandidates(bar, 'reject', env)[0]?.kind).toBe('close');
    expect(pickCandidates(bar, 'accept', env)[0]?.text).toBe('ok');
  });

  it('閉じる語でも他に決定ボタンがあれば選ばない', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>Cookie</p>
        <button>同意する</button>
        <button aria-label="閉じる"></button>
      </div>
    `);
    expect(pickCandidates(document.getElementById('bar') as Element, 'reject', env)).toHaveLength(0);
  });

  it('禁止語・非決定語のボタンは候補にしない', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>Cookie</p>
        <button>同意して登録</button>
        <button>設定を保存</button>
        <button>送信</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    const cookieBanner = { cookieSpecific: true, ageGate: false };
    expect(scoreCandidates(collectButtons(bar, env), 'accept', cookieBanner)).toHaveLength(0);
    expect(scoreCandidates(collectButtons(bar, env), 'reject', cookieBanner)).toHaveLength(0);
  });

  it('SOFT 禁止語（保存・Apply）はヒューリスティックでは候補にしない', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>Cookie の利用設定</p>
        <button>保存して閉じる</button>
        <button>Save and exit</button>
        <button>Apply</button>
      </div>
    `);
    const buttons = collectButtons(document.getElementById('bar') as Element, env);
    expect(buttons).toHaveLength(3);
    expect(decisionCandidates(buttons)).toHaveLength(0);
    // 決定ボタンが 1 つも無いので容器としても採用されない
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('非表示のボタンは候補にしない', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>Cookie</p>
        <button style="display:none">拒否</button>
        <button disabled>すべて拒否</button>
      </div>
    `);
    expect(collectButtons(document.getElementById('bar') as Element, env)).toHaveLength(0);
  });

  it('accept モードでは「Consent」だけが候補になり、「Do not consent」は押さない（Google Funding Choices 型）', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies to personalise content. Please choose your consent status.</p>
        <button id="yes">Consent</button>
        <button id="no">Do not consent</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(pickCandidates(bar, 'accept', env).map((c) => c.text)).toEqual(['consent']);
    // 同じ容器の reject モードでは逆に「Do not consent」だけが候補になる
    expect(pickCandidates(bar, 'reject', env).map((c) => c.text)).toEqual(['donotconsent']);
  });

  it('総量指定の決定語（"purposes" "vendors" を含む）は非決定語より優先される', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies to personalise ads and content, and to analyse our traffic.</p>
        <button id="accept">Accept all purposes</button>
        <button id="reject">Reject all vendors</button>
        <button id="manage">Manage consent preferences</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(pickCandidates(bar, 'accept', env)[0]?.text).toBe('acceptallpurposes');
    expect(pickCandidates(bar, 'reject', env)[0]?.text).toBe('rejectallvendors');
    // 「Manage consent preferences」は非決定語のままなので、どちらのモードでも候補にならない
    expect(decisionCandidates(collectButtons(bar, env)).map((b) => b.text)).toEqual([
      'acceptallpurposes',
      'rejectallvendors',
    ]);
  });
});

describe('a 要素の扱い', () => {
  it('実ページへのリンクは候補にしない', () => {
    setBody(`
      <a id="a1" href="/policy">Cookie ポリシー</a>
      <a id="a2" href="#">拒否</a>
      <a id="a3" href="">拒否</a>
      <a id="a4" href="javascript:void(0)">拒否</a>
      <a id="a5" role="button" href="/foo">拒否</a>
      <a id="a6">拒否</a>
    `);
    const eligible = (id: string): boolean => isEligibleAnchor(document.getElementById(id) as Element);
    expect(eligible('a1')).toBe(false);
    expect(eligible('a2')).toBe(true);
    expect(eligible('a3')).toBe(true);
    expect(eligible('a4')).toBe(true);
    expect(eligible('a5')).toBe(true);
    expect(eligible('a6')).toBe(true);
  });
});

describe('リンクで作られた決定ボタン（§5-5-d の緩和）', () => {
  /** 決定ボタンがすべて実リンクの同意画面（mercedes-benz.co.jp 型） */
  const linkBannerHtml = `
    <div id="bar" role="dialog" aria-modal="true" style="position:fixed">
      <p>当サイトでは Cookie を使用します。</p>
      <a href="/settings">設定</a>
      <a id="agree" href="/consent/all">全てに同意</a>
      <a href="/privacy">プライバシーポリシー</a>
      <a href="/imprint">インプリント</a>
    </div>
  `;

  it('Cookie の容器なら実リンクでも強い決定語は候補にする', () => {
    setBody(linkBannerHtml);
    const bar = document.getElementById('bar') as Element;
    // 「設定」（非決定語）「プライバシーポリシー」「インプリント」は情報リンクなので入らない
    expect(collectButtons(bar, env, { cookieSpecific: true, ageGate: false }).map((b) => b.text)).toEqual([
      '全てに同意',
    ]);
    // 断るボタンは無いので reject の候補はゼロ。accept 側に残るので hide の条件は満たす
    expect(pickCandidates(bar, 'reject', env)).toHaveLength(0);
    expect(pickCandidates(bar, 'accept', env).map((c) => (c.el as Element).id)).toEqual(['agree']);
  });

  it('拒否がリンクなら reject で押せる（第 1 候補になる）', () => {
    setBody(`
      <div id="bar" role="dialog" aria-modal="true" style="position:fixed">
        <p>当サイトでは Cookie を使用します。</p>
        <a href="/settings">設定</a>
        <a id="agree" href="/consent/all">全てに同意</a>
        <a id="deny" href="/consent/reject">全て拒否</a>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    const candidates = pickCandidates(bar, 'reject', env);
    expect(candidates.map((c) => (c.el as Element).id)).toEqual(['deny']);
    expect(candidates[0]?.kind).toBe('reject-strong');
  });

  it('Cookie バナーと言い切れない容器では実リンクの「全て拒否」も候補にしない', () => {
    setBody(`
      <div id="bar" class="consent-banner" style="position:fixed">
        <p>個人情報の取り扱いについて同意をお願いします。</p>
        <a href="/consent/reject">全て拒否</a>
        <button id="agree">同意する</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    // 汎用ヒント（consent）だけでテキストにも Cookie 固有語が無いので、容器にもならず
    // 実リンクの緩和も効かない
    expect(findContainers(document, env)).toHaveLength(0);
    expect(collectButtons(bar, env, { cookieSpecific: false, ageGate: false }).map((b) => b.text)).toEqual([
      '同意する',
    ]);
    expect(pickCandidates(bar, 'reject', env)).toHaveLength(0);
  });

  it('強い属性ヒントの容器ならテキストに Cookie 固有語が無くても実リンクを緩和する（F1）', () => {
    setBody(`
      <div id="bar" class="cookie-banner" style="position:fixed">
        <p>個人情報の取り扱いについて同意をお願いします。</p>
        <a id="deny" href="/consent/reject">全て拒否</a>
        <button id="agree">同意する</button>
      </div>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('bar');
    expect(container?.cookieSpecific).toBe(true);
    expect(pickCandidates(container?.el as Element, 'reject', env).map((c) => (c.el as Element).id)).toEqual([
      'deny',
    ]);
  });

  it('弱一致・閉じる語のリンクは緩和の対象外（Cookie の容器でも押さない）', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>当サイトでは Cookie を使用します。</p>
        <a href="/close">OK</a>
        <a href="/no">No thanks</a>
        <a href="/detail">詳細</a>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(collectButtons(bar, env, { cookieSpecific: true, ageGate: false })).toHaveLength(0);
    expect(detectBannerContainer(document, env)).toBeNull();
  });

  it('HARD 禁止語のリンクは強い決定語でも候補にしない', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>当サイトでは Cookie を使用します。</p>
        <a href="/register">登録して全てに同意</a>
        <button id="agree">全てに同意</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(
      collectButtons(bar, env, { cookieSpecific: true, ageGate: false }).map((b) => (b.el as Element).id),
    ).toEqual(['agree']);
  });
});

describe('容器内限定のクリック候補（role も button タグも無いボタン）', () => {
  const html = `
    <button class="btn" id="outside">Reject all</button>
    <div id="bar" class="cookie-bar" style="position:fixed">
      <p>We use cookies to personalise content and analyse our traffic.</p>
      <div class="cc-btn cc-allow">Allow cookies</div>
      <div class="cc-btn cc-deny">Decline</div>
      <span onclick="void 0">Got it!</span>
    </div>
  `;

  it('容器内なら class / onclick だけの要素も候補になる', () => {
    setBody(html);
    const buttons = collectButtons(document.getElementById('bar') as Element, env);
    expect(buttons.map((b) => b.text)).toEqual(['allowcookies', 'decline', 'gotit']);
    expect(pickCandidates(document.getElementById('bar') as Element, 'reject', env)[0]?.text).toBe('decline');
    expect(pickCandidates(document.getElementById('bar') as Element, 'accept', env)[0]?.text).toBe('allowcookies');
  });

  it('容器の外の .btn は候補にならない', () => {
    setBody(html);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('bar');
    const ids = collectButtons(container?.el as Element, env).map((b) => (b.el as Element).id);
    expect(ids).not.toContain('outside');
    // 容器の外は走査しないので、document 直下の .btn は拒否語でも拾わない
    expect(collectButtons(document.body, env).map((b) => (b.el as Element).id)).toContain('outside');
  });
});

describe('root 自身の shadow root（C）', () => {
  /** host 直下の shadow にバナーを入れて host を返す */
  function mountShadowBanner(): Element {
    setBody('<div id="host" style="position:fixed"></div>');
    const host = document.getElementById('host') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = `
      <div class="box">
        <p>We use cookies to improve your experience.</p>
        <button class="deny">Reject all</button>
        <button class="allow">Accept all</button>
      </div>
    `;
    return host;
  }

  it('host 要素を root に渡しても中のボタンが取れる', () => {
    const host = mountShadowBanner();
    expect(deepQueryAll(host, 'button').map((el) => el.className)).toEqual(['deny', 'allow']);
    expect(deepQueryFirst(host, 'button')?.className).toBe('deny');
    expect(deepElements(host).map((el) => el.tagName)).toEqual(['DIV', 'P', 'BUTTON', 'BUTTON']);
  });

  it('host が容器になっても候補を拾える（#usercentrics-root 型）', () => {
    const host = mountShadowBanner();
    const buttons = collectButtons(host, env, { cookieSpecific: true, ageGate: false });
    expect(buttons.map((b) => b.text)).toEqual(['rejectall', 'acceptall']);
    expect(scoreCandidates(buttons, 'reject', { cookieSpecific: true, ageGate: false })[0]?.text).toBe('rejectall');
  });

  it('ownShadow: false なら root 自身の shadow root は見ない（子孫の shadow には入る）', () => {
    const host = mountShadowBanner();
    expect(deepQueryAll(host, 'button', { ownShadow: false })).toHaveLength(0);
    // 子孫が持つ shadow root には従来どおり入る
    expect(deepQueryAll(document.body, 'button', { ownShadow: false })).toHaveLength(2);
  });
});

describe('高さ 0 の shadow ホストを容器にする（REAL-001）', () => {
  /**
   * deepl.com の Usercentrics。ホスト（`ASIDE#usercentrics-cmp-ui`）自身の高さは 0 で、
   * open shadow root の中の説明文・「さらに詳しく」・「すべて許可」が兄弟として並ぶ。
   */
  function mountUsercentrics(): Element {
    setBody(`
      <main><h1>記事</h1><p>本文です。</p></main>
      <aside id="usercentrics-cmp-ui" data-w="1280" data-h="0"></aside>
    `);
    const host = document.getElementById('usercentrics-cmp-ui') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = `
      <div id="uc-main-dialog" role="dialog">
        <p>当社は Cookie を使用して、サービスの提供と広告の表示を行います。</p>
      </div>
      <a id="uc-more-link" role="button" href="#">さらに詳しく</a>
      <button id="accept">すべて許可</button>
    `;
    return host;
  }

  it('ホスト自身の高さが 0 でも、shadow の中の可視な子で大きさを測る', () => {
    const host = mountUsercentrics();
    const container = detectBannerContainer(document, sizedEnv);
    expect(container?.el).toBe(host);
    expect(container?.cookieSpecific).toBe(true);
    // 説明文のダイアログには決定ボタンが無いので、容器はホストの方になる
    expect(container?.decisions.map((button) => button.text)).toEqual(['すべて許可']);
  });

  it('ホスト自身のテキストが空でも shadow の中の本文で判定する', () => {
    // env.getText は光の DOM しか見ない（実ブラウザの innerText と同じ）ので、
    // ホストのテキストは空。それでもバナー語・Cookie 固有語を拾えること
    setBody('<main><h1>記事</h1><p>本文です。</p></main><div id="fx-cmp-root" style="position:fixed"></div>');
    const host = document.getElementById('fx-cmp-root') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = `
      <div class="box">
        <p>当サイトは Cookie を使用します。</p>
        <button>すべて許可</button>
      </div>
    `;
    expect(env.getText(host)).toBe('');
    const container = detectBannerContainer(document, env);
    expect(container?.el).toBe(host);
    expect(container?.cookieSpecific).toBe(true);
  });

  it('shadow root を持たない要素の大きさの下限は変わらない', () => {
    setBody(`
      <main><h1>記事</h1><p>本文です。</p></main>
      <div id="bar" class="cookie-bar" style="position:fixed" data-w="1280" data-h="0">
        <p>当サイトでは Cookie を使用しています。</p>
        <button>すべて許可</button>
      </div>
    `);
    expect(detectBannerContainer(document, sizedEnv)).toBeNull();
  });

  it('shadow の中の子も小さければ容器にしない（ヒューリスティックでは緩めない）', () => {
    setBody('<main><h1>記事</h1><p>本文です。</p></main><aside id="usercentrics-cmp-ui" data-w="0" data-h="0"></aside>');
    const host = document.getElementById('usercentrics-cmp-ui') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = `
      <div id="uc-wrap" data-w="0" data-h="0">
        <p>当社は Cookie を使用します。</p>
        <button id="accept">すべて許可</button>
      </div>
    `;
    expect(detectBannerContainer(document, sizedEnv)).toBeNull();
    // 大きさの下限だけ緩めれば（即決 CMP 表が見つけた容器）採用できる
    expect(evaluateContainer(host, sizedEnv, { relaxSize: true })?.el).toBe(host);
  });
});

describe('拒否済みの案内は容器にしない（REAL-003）', () => {
  /** theguardian.com の「もう拒否してあります」の案内 */
  const SETTLED = `
    <main><h1>記事</h1><p>本文です。</p></main>
    <aside id="notice" class="dcr-17eqobb" style="position:fixed">
      <p>You’ve chosen to reject third-party cookies while browsing our site.</p>
      <button>Collapse banner</button>
    </aside>
  `;

  it('完了状態の文言 + 折りたたみボタンだけなら容器にしない', () => {
    setBody(SETTLED);
    expect(detectBannerContainer(document, env)).toBeNull();
  });

  it('同じ文言でも選ぶ余地があるボタンがあれば容器にする', () => {
    setBody(SETTLED.replace('<button>Collapse banner</button>', '<button>Reject all</button><button>Accept all</button>'));
    expect(detectBannerContainer(document, env)?.el.id).toBe('notice');
  });

  it('完了状態の文言が無ければ、閉じる語だけの通知は従来どおり容器になる', () => {
    setBody(SETTLED.replace('You’ve chosen to reject third-party cookies while browsing our site.', 'We use cookies on this site.').replace('<button>Collapse banner</button>', '<button>OK</button>'));
    expect(detectBannerContainer(document, env)?.el.id).toBe('notice');
  });
});

describe('緩いクリック候補（カスタム要素・data 属性ボタン。A）', () => {
  /** Cookie 固有語のある fixed な容器。inner にボタンらしきものを差し込む */
  const banner = (inner: string): string => `
    <div id="bar" style="position:fixed">
      <p>当サイトは Cookie を使用しています。</p>
      ${inner}
    </div>
  `;

  const bar = (): Element => document.getElementById('bar') as Element;
  const texts = (): string[] => collectButtons(bar(), env, contextOf(bar(), env)).map((b) => b.text);

  it('cursor:pointer のカスタム要素が候補になる', () => {
    setBody(
      banner(`
        <my-button style="cursor:pointer">すべて拒否</my-button>
        <my-button style="cursor:pointer">すべて許可</my-button>
      `),
    );
    expect(texts()).toEqual(['すべて拒否', 'すべて許可']);
    expect(pickCandidates(bar(), 'reject', env)[0]?.text).toBe('すべて拒否');
    expect(pickCandidates(bar(), 'accept', env)[0]?.text).toBe('すべて許可');
  });

  it('同じカスタム要素も Cookie 固有語の無い容器では候補にならない', () => {
    setBody(`
      <div id="bar" style="position:fixed">
        <p>新しい利用規約に同意してください。</p>
        <my-button style="cursor:pointer">すべて拒否</my-button>
        <my-button style="cursor:pointer">すべて許可</my-button>
      </div>
    `);
    expect(contextOf(bar(), env).cookieSpecific).toBe(false);
    expect(collectButtons(bar(), env, contextOf(bar(), env))).toHaveLength(0);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('決定語でない文言は候補にならない（cursor:pointer の「削除する」）', () => {
    setBody(
      banner(`
        <div style="cursor:pointer">削除する</div>
        <div style="cursor:pointer">もっと見る</div>
        <my-button style="cursor:pointer">すべて拒否</my-button>
      `),
    );
    expect(texts()).toEqual(['すべて拒否']);
  });

  it('tabindex="0" と data-* ヒントでも拾う（cursor が無くても）', () => {
    setBody(
      banner(`
        <span id="a" tabindex="0">すべて拒否</span>
        <span id="b" data-testid="accept-all-cookies">すべて許可</span>
        <span id="c">必要なもののみ</span>
      `),
    );
    expect(texts()).toEqual(['すべて拒否', 'すべて許可']);
  });

  it('緩い候補どうしが入れ子なら内側だけを候補にする', () => {
    setBody(
      banner(`
        <div id="outer" data-testid="reject-all"><span id="inner" style="cursor:pointer">すべて拒否</span></div>
      `),
    );
    const els = collectButtons(bar(), env, contextOf(bar(), env)).map((b) => (b.el as Element).id);
    expect(els).toEqual(['inner']);
  });

  it('ふつうのボタンの中の要素は候補にしない（同じボタンを二重に数えない）', () => {
    setBody(
      banner(`
        <button id="deny"><span id="label" style="cursor:pointer">すべて拒否</span></button>
      `),
    );
    const els = collectButtons(bar(), env, contextOf(bar(), env)).map((b) => (b.el as Element).id);
    expect(els).toEqual(['deny']);
  });

  it('disabled / aria-hidden / 不可視のものは拾わない', () => {
    setBody(
      banner(`
        <my-button style="cursor:pointer" disabled>すべて拒否</my-button>
        <my-button style="cursor:pointer" aria-hidden="true">拒否する</my-button>
        <my-button style="cursor:pointer;display:none">オプトアウト</my-button>
        <my-button style="cursor:pointer">同意しない</my-button>
      `),
    );
    expect(texts()).toEqual(['同意しない']);
  });

  it('設定ボタンは候補にはなるが決定ボタンにはならない（パネル層が使う）', () => {
    setBody(
      banner(`
        <my-button style="cursor:pointer">Cookie の設定</my-button>
        <my-button style="cursor:pointer">全てに同意</my-button>
      `),
    );
    const buttons = collectButtons(bar(), env, contextOf(bar(), env));
    expect(buttons.map((b) => b.text)).toEqual(['cookieの設定', '全てに同意']);
    expect(decisionCandidates(buttons).map((b) => b.text)).toEqual(['全てに同意']);
    expect(pickCandidates(bar(), 'reject', env)).toHaveLength(0);
  });

  it('実ページへのリンクの中の緩い候補は従来どおり除く', () => {
    setBody(
      banner(`
        <a href="/settings"><span style="cursor:pointer">Cookie の設定</span></a>
        <my-button style="cursor:pointer">すべて拒否</my-button>
      `),
    );
    expect(texts()).toEqual(['すべて拒否']);
  });

  it('cursor:pointer の「同意」（gakken.co.jp 型の独自ボタン）が緩い候補として拾われる', () => {
    setBody(
      banner(`
        <div style="cursor:pointer">同意</div>
      `),
    );
    expect(texts()).toEqual(['同意']);
  });

  it('Cookie 固有語も属性ヒントも無い容器では「同意」は拾われない', () => {
    setBody(`
      <div id="bar" style="position:fixed">
        <p>新しい利用規約に同意してください。</p>
        <div style="cursor:pointer">同意</div>
      </div>
    `);
    expect(contextOf(bar(), env).cookieSpecific).toBe(false);
    expect(collectButtons(bar(), env, contextOf(bar(), env))).toHaveLength(0);
  });

  it('reject モードでは「同意」が候補にならない（押されない）', () => {
    setBody(
      banner(`
        <div style="cursor:pointer">同意</div>
      `),
    );
    const context = contextOf(bar(), env);
    expect(scoreCandidates(collectButtons(bar(), env, context), 'reject', context)).toHaveLength(0);
  });
});

describe('ボタンの親ラッパーを候補にしない（H-3）', () => {
  it('BEM のラッパー 2 段は候補にならず、中の Reject all が第 1 候補になる', () => {
    setBody(`
      <div id="bar" class="cookie-banner" style="position:fixed">
        <p>We use cookies to personalise content and analyse our traffic.</p>
        <div class="cookie-banner__buttons">
          <div class="btn-group">
            <button class="cookie-banner__btn">Accept all</button>
            <button class="cookie-banner__btn">Reject all</button>
            <button class="cookie-banner__btn">Cookie settings</button>
          </div>
        </div>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    // ラッパーが候補に混ざると連結テキスト（acceptallrejectallcookiesettings）で
    // 拒否の強一致に化け、押しても効かないまま候補枠（最大 3）を食う
    expect(collectButtons(bar, env).map((b) => b.text)).toEqual(['acceptall', 'rejectall', 'cookiesettings']);
    expect(pickCandidates(bar, 'reject', env).map((c) => c.text)).toEqual(['rejectall']);
    expect(pickCandidates(bar, 'accept', env)[0]?.text).toBe('acceptall');
  });

  it('onclick を持つ内側ラッパーも候補にしない（reject モードで同意が走らない）', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies on this site.</p>
        <div class="btn" onclick="acceptAll()">
          <button id="accept">Accept all</button>
          <button id="reject">Reject all</button>
        </div>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(collectButtons(bar, env).map((b) => (b.el as Element).id)).toEqual(['accept', 'reject']);
    expect(pickCandidates(bar, 'reject', env).map((c) => c.text)).toEqual(['rejectall']);
  });

  it('shadow root の中に実装の button を持つ web components 製ボタンはラッパーにしない（H-3-b）', () => {
    setBody(`
      <div id="bar" class="cookie-banner" style="position:fixed">
        <p>We use cookies to personalise content and analyse our traffic.</p>
        <x-button class="button">Reject all</x-button>
        <x-button class="button">Accept all</x-button>
      </div>
    `);
    // Stencil の shadow: true と同じ形。文言はスロット越しなので、実装側の `<button>` から
    // 取れる文言は空になる。ホストをラッパー扱いで落とすと候補が 1 つも残らない
    for (const host of Array.from(document.querySelectorAll('x-button'))) {
      host.attachShadow({ mode: 'open' }).innerHTML = '<button><slot></slot></button>';
    }
    const bar = document.getElementById('bar') as Element;
    expect(collectButtons(bar, env).map((b) => b.text)).toEqual(['rejectall', 'acceptall', '', '']);
    expect(pickCandidates(bar, 'reject', env).map((c) => c.text)).toEqual(['rejectall']);
    expect(pickCandidates(bar, 'accept', env)[0]?.text).toBe('acceptall');
  });

  it('class は部分一致ではなくトークンで見る（buttons / btn-group は候補にしない）', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>This website uses cookies.</p>
        <div class="cc-btn">Decline</div>
        <div class="btn">Accept all</div>
        <span class="cmp__button">Got it</span>
        <div class="buttons">Our buttons</div>
        <div class="btn-group">Button group</div>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(collectButtons(bar, env).map((b) => b.text)).toEqual(['decline', 'acceptall', 'gotit']);
  });

  it('通知のみバナーのボタン行ラッパーは決定ボタンを増やさない（閉じる語が押せる）', () => {
    setBody(`
      <div id="bar" class="fx-cookie-toast" style="position:fixed">
        <p>This website uses cookies to ensure you get the best experience.</p>
        <div class="buttons"><button>Got it</button></div>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(decisionCandidates(collectButtons(bar, env))).toHaveLength(1);
    expect(pickCandidates(bar, 'reject', env)[0]?.kind).toBe('close');
    expect(pickCandidates(bar, 'accept', env)[0]?.text).toBe('gotit');
  });

  it('リンクの中のボタンらしい要素は、文脈が無ければ候補にしない（M-1）', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies to personalise content.</p>
        <a href="/leave"><div class="btn">Decline</div></a>
        <button id="ok">Accept all</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    // 文脈（CandidateContext）を渡さない経路では従来どおり実リンクを一切拾わない
    expect(collectButtons(bar, env).map((b) => b.text)).toEqual(['acceptall']);
  });

  it('Cookie の容器では、リンクの中の強い決定語は a の側を候補にする', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies to personalise content.</p>
        <a id="leave" href="/leave"><div class="btn">Decline</div></a>
        <button id="ok">Accept all</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    // 押す先はどのみち a なので、中の div を重ねて候補にはしない（候補枠を二重に使わない）
    const candidates = pickCandidates(bar, 'reject', env);
    expect(candidates.map((c) => (c.el as Element).id)).toEqual(['leave']);
    expect(candidates[0]?.text).toBe('decline');
  });

  it('href="#" のリンクの中のボタンらしい要素は従来どおり候補', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies to personalise content.</p>
        <a href="#"><div class="btn">Decline</div></a>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(pickCandidates(bar, 'reject', env)[0]?.text).toBe('decline');
  });
});

describe('拒否側の曖昧な文言（M-2）', () => {
  it('サブキャプション付きの許可ボタンは拒否候補にしない', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies to personalise content.</p>
        <button id="accept">Accept all<small>You can opt out at any time</small></button>
        <button id="deny">Do not accept all</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    // 連結テキストの optout で拒否の強一致に化けていた
    expect(pickCandidates(bar, 'reject', env).map((c) => (c.el as Element).id)).toEqual(['deny']);
  });

  it('サブキャプションだけの許可ボタンなら拒否候補ゼロ（fallback に落とす）', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies to personalise content.</p>
        <button id="accept">Accept all<small>Withdraw consent at any time</small></button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(pickCandidates(bar, 'reject', env)).toHaveLength(0);
  });
});

describe('非決定語の override（M-3）', () => {
  it('総量マーカーの無い "Manage or reject cookies" は決定ボタンにしない', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies to personalise ads and content.</p>
        <button id="manage">Manage or reject cookies</button>
        <button id="reject">Reject all vendors</button>
        <button id="accept">Accept all purposes</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(decisionCandidates(collectButtons(bar, env)).map((b) => b.text)).toEqual([
      'rejectallvendors',
      'acceptallpurposes',
    ]);
    expect(pickCandidates(bar, 'reject', env)[0]?.text).toBe('rejectallvendors');
    expect(pickCandidates(bar, 'accept', env)[0]?.text).toBe('acceptallpurposes');
  });
});

describe('reject モードの閉じる語（M-6）', () => {
  const withSettings = `
    <div id="bar" class="cookie-bar" style="position:fixed">
      <p>By continuing to browse, you accept our use of cookies.</p>
      <button id="continue">Continue</button>
      <button id="manage">Manage settings</button>
    </div>
  `;

  it('設定ボタンが残っている容器では Continue を押さない', () => {
    setBody(withSettings);
    expect(pickCandidates(document.getElementById('bar') as Element, 'reject', env)).toHaveLength(0);
  });

  it('accept モードでは従来どおり Continue を押す', () => {
    setBody(withSettings);
    expect(pickCandidates(document.getElementById('bar') as Element, 'accept', env)[0]?.text).toBe('continue');
  });

  it('情報リンクだけの通知バナーは従来どおり閉じる語を押す', () => {
    setBody(`
      <div id="bar" class="fx-cookie-toast" style="position:fixed">
        <p>This website uses cookies to ensure you get the best experience.</p>
        <button id="ok">Got it!</button>
        <a href="#">Learn more</a>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(pickCandidates(bar, 'reject', env)[0]?.kind).toBe('close');
    expect(pickCandidates(bar, 'reject', env)[0]?.text).toBe('gotit');
  });
});

describe('年齢確認ゲート（H-2）', () => {
  // 手がかりは**可視テキスト**のゲート語だけ（class="age-gate" のような属性を持つ要素は
  // そもそも容器にしない。ROUND2-003 の「入口ゲート・年齢ゲートの属性」を参照）
  it('「Are you over 18?」の Yes / No は両モードとも押さない', () => {
    setBody(`
      <div id="gate" style="position:fixed">
        <p>Are you over 18? This site uses cookies to remember your choice.</p>
        <button id="yes">Yes</button>
        <button id="no">No</button>
      </div>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('gate');
    expect(container?.ageGate).toBe(true);
    expect(pickCandidates(container?.el as Element, 'reject', env)).toHaveLength(0);
    expect(pickCandidates(container?.el as Element, 'accept', env)).toHaveLength(0);
  });

  it('ゲート語のある容器では閉じる語・弱一致も使わない', () => {
    setBody(`
      <div id="gate" style="position:fixed">
        <p>You must be 21 or older to enter. We use cookies on this site.</p>
        <button id="ok">Continue</button>
      </div>
    `);
    const gate = document.getElementById('gate') as Element;
    expect(pickCandidates(gate, 'reject', env)).toHaveLength(0);
    expect(pickCandidates(gate, 'accept', env)).toHaveLength(0);
  });

  it('医療従事者ゲートも同じ（"I am a healthcare professional" を押さない）', () => {
    setBody(`
      <div id="gate" style="position:fixed">
        <p>This site is intended for healthcare professionals. We use cookies.</p>
        <button id="ok">Yes</button>
        <button id="no">No</button>
      </div>
    `);
    const gate = document.getElementById('gate') as Element;
    expect(pickCandidates(gate, 'reject', env)).toHaveLength(0);
    expect(pickCandidates(gate, 'accept', env)).toHaveLength(0);
  });

  it('ゲート語が無ければ従来どおり弱一致を使う', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>We use cookies to personalise content. Manage your storage settings later.</p>
        <button id="ok">Got it</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(detectBannerContainer(document, env)?.ageGate).toBe(false);
    expect(pickCandidates(bar, 'accept', env)[0]?.text).toBe('gotit');
  });

  it('緩い候補（cursor:pointer の独自要素）にもゲート語が効く: 弱一致だけでは容器にならない', () => {
    // 「はい」はネイティブの button ではなく cursor:pointer の div（緩い候補の経路）。
    // isLooseText がゲート語を見ずに弱一致を通すと、決定ボタン候補が生まれてしまい、
    // 同意画面ではない年齢ゲートまで容器として検出扱い（cloak）になってしまう
    setBody(`
      <div id="gate" class="cookie-bar" style="position:fixed">
        <p>18歳以上の方のみご利用いただけます。当サイトは Cookie を使用しています。</p>
        <div style="cursor:pointer">はい</div>
      </div>
    `);
    const gate = document.getElementById('gate') as Element;
    expect(collectButtons(gate, env, contextOf(gate, env))).toHaveLength(0);
    expect(detectBannerContainer(document, env)).toBeNull();
  });
});

describe('Cookie バナー以外の固定 UI を採用しない', () => {
  it('テキスト入力を持つ固定チャットウィジェットは容器にしない', () => {
    setBody(`
      <div id="chat" style="position:fixed">
        <p>We are committed to protecting your privacy.</p>
        <textarea placeholder="メッセージ"></textarea>
        <button>Send us a message</button>
      </div>
    `);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('main / nav を内包する sticky ヘッダーは容器にしない', () => {
    setBody(`
      <header id="head" style="position:sticky">
        <nav><a href="/privacy">Privacy</a><a href="#">Menu</a></nav>
      </header>
      <div id="wrap" style="position:fixed">
        <main><p>Cookie について</p><button>拒否</button></main>
      </div>
    `);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('role="dialog" 起点の容器は Cookie 固有語が無ければ採用しない', () => {
    setBody(`
      <div id="tos" role="dialog" style="position:fixed">
        <p>利用規約と個人情報の取り扱いを更新しました。新しい規約に同意しますか？</p>
        <button id="yes">はい</button>
        <button id="no">いいえ</button>
      </div>
    `);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('fixed なだけの規約更新モーダルは容器にしない（H-A。role も Cookie 語も無い）', () => {
    setBody(`
      <div id="tos" style="position:fixed">
        <p>利用規約と個人情報の取り扱いを更新しました。新しい規約に同意しますか？</p>
        <button id="agree">同意する</button>
        <button id="disagree">同意しない</button>
      </div>
    `);
    // 容器にならないので、accept で「同意する」も reject で「同意しない」も押されない
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('class="consent-modal" だけの規約更新モーダルは容器にしない（H-1）', () => {
    const modal = (text: string): string => `
      <div id="tos" class="consent-modal">
        <p>${text}</p>
        <button id="agree">同意する</button>
        <button id="disagree">同意しない</button>
      </div>
    `;
    setBody(modal('利用規約と個人情報の取り扱いを更新しました。新しい規約に同意しますか？'));
    expect(findContainers(document, env)).toHaveLength(0);

    // 同じ class でもテキストに Cookie 固有語があればバナーとして採用する
    setBody(modal('Cookie の利用に同意しますか？'));
    expect(detectBannerContainer(document, env)?.el.id).toBe('tos');
  });

  it('class="privacy-modal" だけの英語の規約モーダルも容器にしない（H-1）', () => {
    setBody(`
      <div id="tos" class="privacy-modal">
        <p>We have updated our terms of service and privacy policy. Do you agree to the new terms?</p>
        <button id="agree">I agree</button>
        <button id="decline">Decline</button>
      </div>
    `);
    expect(findContainers(document, env)).toHaveLength(0);
  });

  it('強い属性ヒント（cookie-consent）なら本文に Cookie 固有語が無くても拒否を押せる（H-1）', () => {
    setBody(`
      <div id="bar" class="cookie-consent" style="position:fixed">
        <p>プライバシーの取り扱いに同意してください。</p>
        <button id="agree">同意する</button>
        <button id="disagree">同意しない</button>
      </div>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('bar');
    expect(pickCandidates(container?.el as Element, 'reject', env)[0]?.text).toBe('同意しない');
  });

  it('属性ヒントがあれば Cookie 固有語が無くても容器にする（class="cookie-banner" + 拒否）', () => {
    setBody(`
      <div id="bar" class="cookie-banner" style="position:fixed">
        <p>プライバシーの取り扱いに同意してください。</p>
        <button id="agree">同意する</button>
        <button id="deny">拒否</button>
      </div>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('bar');
    expect(pickCandidates(container?.el as Element, 'reject', env)[0]?.text).toBe('拒否');
  });

  it('role="dialog" でも Cookie 固有語があれば採用する', () => {
    setBody(`
      <div id="cd" role="dialog" style="position:fixed">
        <p>Cookie の利用に同意しますか？</p>
        <button>同意する</button>
        <button>拒否</button>
      </div>
    `);
    expect(detectBannerContainer(document, env)?.el.id).toBe('cd');
  });

  it('banner / notice のクラスだけの要素は Cookie 固有語があるときだけ採用する', () => {
    setBody(`
      <div id="promo" class="site-banner"><p>プライバシーを大切にしています</p><button>同意する</button></div>
    `);
    expect(findContainers(document, env)).toHaveLength(0);

    setBody(`
      <div id="cb" class="site-banner"><p>Cookie を使用しています</p><button>同意する</button></div>
    `);
    expect(detectBannerContainer(document, env)?.el.id).toBe('cb');
  });

  it('Cookie 固有語の無い容器は危険文脈語（削除・支払い・パスワード）で採用しない', () => {
    for (const body of [
      '<div id="d" style="position:fixed"><p>パスワードを削除しますか？個人情報も消えます</p><button>拒否</button></div>',
      '<div id="d" style="position:fixed"><p>お支払い情報の取り扱いに同意しますか</p><button>拒否</button></div>',
      '<div id="d" style="position:fixed"><p>プライバシー設定を削除しますか</p><button>拒否</button></div>',
    ]) {
      setBody(body);
      expect(findContainers(document, env), body).toHaveLength(0);
    }
  });

  it('Cookie 固有語のある容器は危険文脈語があっても採用する（ボタン単位の禁止語で守る）', () => {
    setBody(`
      <div id="bar" style="position:fixed">
        <p>Cookie の送信に同意してください。設定はいつでも削除できます。</p>
        <button id="deny">拒否</button>
        <button id="del">削除する</button>
      </div>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('bar');
    // 危険なボタンは禁止語で落ち、拒否ボタンだけが候補になる
    expect(container?.decisions.map((d) => d.text)).toEqual(['拒否']);
    expect(pickCandidates(container?.el as Element, 'reject', env)[0]?.text).toBe('拒否');
  });

  it('"in order to" を含む英語 Cookie バナーでも拒否ボタンを選ぶ', () => {
    setBody(`
      <div id="bar" class="cookie-banner" style="position:fixed">
        <p>We use cookies in order to improve your experience and analyse traffic.</p>
        <button id="accept">Accept all</button>
        <button id="reject">Reject all</button>
      </div>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('bar');
    expect(pickCandidates(container?.el as Element, 'reject', env)[0]?.text).toBe('rejectall');
  });
});

describe('操作要素を容器にしない（ROUND2-001）', () => {
  /**
   * ボタンの id に cookie / gdpr が入っていて、中の `<span>` が緩い候補になる形。
   * ボタン自身が容器として採用されると、その中には拒否ボタンが無いので候補 0 になる
   * （adidas.co.uk の `BUTTON#glass-gdpr-default-consent-accept-button`）。
   */
  const bannerHtml = `
    <div id="bar" class="cookie-banner" style="position:fixed" data-w="600" data-h="200">
      <p>We use cookies to improve your experience.</p>
      <button id="gdpr-consent-accept-button" data-w="320" data-h="48">
        <span style="cursor:pointer">Accept all cookies</span>
      </button>
      <div id="gdpr-consent-reject-button" role="button" data-w="320" data-h="48">
        <span style="cursor:pointer">Reject all</span>
      </div>
    </div>
  `;

  it('id に cookie / gdpr を含む button と role="button" の div は容器にしない', () => {
    setBody(bannerHtml);
    for (const id of ['gdpr-consent-accept-button', 'gdpr-consent-reject-button']) {
      expect(evaluateContainer(document.getElementById(id) as Element, sizedEnv), id).toBeNull();
    }
  });

  it('容器になるのは親の .cookie-banner で、兄弟の拒否ボタンを候補にできる', () => {
    setBody(bannerHtml);
    const container = detectBannerContainer(document, sizedEnv);
    expect(container?.el.id).toBe('bar');
    expect(pickCandidates(container?.el as Element, 'reject', sizedEnv)[0]?.label).toBe('Reject all');
  });
});

describe('入口ゲート・年齢ゲートの属性（ROUND2-003）', () => {
  it('age-gate の属性を持つ要素はどのヒント経路でも容器にしない', () => {
    // 入口選択ダイアログ（lego.com）。position でも強い属性ヒント（cookie）でも容器にしない
    for (const attributes of [
      'class="AgeGate_age-gate__wrapper__ph949" style="position:fixed"',
      'class="cookie-agegate-overlay" style="position:fixed"',
      'role="dialog" class="age-verification"',
    ]) {
      setBody(`
        <div id="gate" ${attributes}>
          <p>LEGO.comに入ります。当サイトでは Cookie を使用しています。</p>
          <button id="enter">続ける</button>
        </div>
      `);
      expect(evaluateContainer(document.getElementById('gate') as Element, env), attributes).toBeNull();
      expect(findContainers(document, env), attributes).toHaveLength(0);
    }
  });

  it('ゲートの中にある Cookie バナーは従来どおり容器にする（自身の属性だけを見る）', () => {
    setBody(`
      <div id="gate" class="age-gate" style="position:fixed" data-w="1000" data-h="800">
        <p>Are you over 18?</p>
        <div id="bar" class="cookie-banner" data-w="600" data-h="200">
          <p>We use cookies.</p>
          <button id="accept">Accept all</button>
          <button id="reject">Reject all</button>
        </div>
      </div>
    `);
    expect(evaluateContainer(document.getElementById('gate') as Element, sizedEnv)).toBeNull();
    expect(detectBannerContainer(document, sizedEnv)?.el.id).toBe('bar');
  });
});

describe('採点の Cookie 固有語ゲート', () => {
  /** 「同意」だけで Cookie 固有語も強い属性ヒントも持たない容器 */
  const genericHtml = `
    <div id="bar" class="consent-bar" style="position:fixed">
      <p>プライバシーの取り扱いに同意してください。</p>
      <button id="a">Accept</button>
      <button id="b">はい</button>
    </div>
  `;

  it('裸の許可語は Cookie バナーと言い切れる容器でだけ押す', () => {
    setBody(genericHtml);
    expect(pickCandidates(document.getElementById('bar') as Element, 'accept', env)).toHaveLength(0);
  });

  it('「同意する」も Cookie バナーと言い切れる容器でだけ押す（H-A）', () => {
    setBody(`
      <div id="bar" class="consent-bar" style="position:fixed">
        <p>利用規約と個人情報の取り扱いを更新しました。新しい規約に同意しますか？</p>
        <button>同意する</button>
      </div>
    `);
    expect(pickCandidates(document.getElementById('bar') as Element, 'accept', env)).toHaveLength(0);

    setBody(`
      <div id="bar" class="consent-bar" style="position:fixed">
        <p>Cookie の利用に同意してください。</p>
        <button>同意する</button>
      </div>
    `);
    expect(pickCandidates(document.getElementById('bar') as Element, 'accept', env)[0]?.text).toBe('同意する');

    // 強い属性ヒント（class="cookie-bar"）があれば、テキストに Cookie 固有語が無くても押す（F1）
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>利用規約と個人情報の取り扱いを更新しました。新しい規約に同意しますか？</p>
        <button>同意する</button>
      </div>
    `);
    expect(pickCandidates(document.getElementById('bar') as Element, 'accept', env)[0]?.text).toBe('同意する');
  });

  it('「すべて許可」系は容器に Cookie 固有語が無くても押す', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>プライバシーの取り扱いについて。</p>
        <button>すべて許可</button>
      </div>
    `);
    expect(pickCandidates(document.getElementById('bar') as Element, 'accept', env)[0]?.text).toBe('すべて許可');
  });

  it('文言自体が cookie を含めば容器に Cookie 固有語が無くても押す', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>プライバシーの取り扱いに同意してください。</p>
        <button>Accept cookies</button>
      </div>
    `);
    expect(pickCandidates(document.getElementById('bar') as Element, 'accept', env)[0]?.text).toBe('acceptcookies');
  });

  it('弱一致（はい・OK）は Cookie 固有語のある容器でだけ押す', () => {
    setBody(`
      <div id="bar" class="consent-box" style="position:fixed">
        <p>個人情報の取り扱いに同意しますか。</p>
        <button>はい</button>
      </div>
    `);
    const bar = document.getElementById('bar') as Element;
    expect(pickCandidates(bar, 'accept', env)).toHaveLength(0);
    expect(pickCandidates(bar, 'reject', env)).toHaveLength(0);
  });

  it('拒否の弱一致（No thanks）も Cookie 固有語のある容器でだけ押す', () => {
    const modal = (text: string): string => `
      <div id="bar" class="privacy-notice" style="position:fixed">
        <p>${text}</p>
        <button id="yes">Yes, I agree</button>
        <button id="no">No thanks</button>
      </div>
    `;
    // ニュースレター・通知の許可ダイアログ（Cookie 語なし）では押さない
    setBody(modal('Get 10% off. Join our newsletter and we will keep your data private.'));
    expect(pickCandidates(document.getElementById('bar') as Element, 'reject', env)).toHaveLength(0);

    // 同じ文言でも Cookie バナーなら拒否の弱一致として押す
    setBody(modal('We use cookies to personalise content.'));
    const candidates = pickCandidates(document.getElementById('bar') as Element, 'reject', env);
    expect(candidates[0]?.text).toBe('nothanks');
    expect(candidates[0]?.kind).toBe('reject-weak');
  });

  it('閉じる語も Cookie 固有語のある容器でだけ押す', () => {
    setBody(`
      <div id="bar" class="consent-box" style="position:fixed">
        <p>個人情報の取り扱いについて更新しました。</p>
        <button>OK</button>
      </div>
    `);
    expect(pickCandidates(document.getElementById('bar') as Element, 'reject', env)).toHaveLength(0);
  });

  it('拒否語は容器の文脈に関係なく押せる', () => {
    setBody(genericHtml.replace('<button id="a">Accept</button>', '<button id="a">拒否</button>'));
    expect(pickCandidates(document.getElementById('bar') as Element, 'reject', env)[0]?.text).toBe('拒否');
  });
});

describe('Cookie 固有語ゲートの手がかりを祖先まで見る（F1）', () => {
  it('ボタン行のテキストに Cookie 語が無くても、祖先の class が cookie なら cookieSpecific', () => {
    setBody(`
      <div class="cmm-cookie-banner">
        <div id="actions" class="actions">
          <button>設定</button>
          <button>全てに同意</button>
        </div>
      </div>
    `);
    const actions = document.getElementById('actions') as Element;
    expect(contextOf(actions, env).cookieSpecific).toBe(true);
  });

  it('自身の class が cookie 系ならテキストを問わず cookieSpecific（mercedes-benz 型のボタン行）', () => {
    setBody(`
      <div id="bar" class="cmm-cookie-banner__actions" style="position:fixed">
        <button class="button">設定</button>
        <button class="button">全てに同意</button>
        <a href="/privacy">プライバシーポリシー</a>
      </div>
    `);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('bar');
    expect(container?.cookieSpecific).toBe(true);
  });

  it('汎用ヒント（consent / privacy）・弱ヒント（banner / notice）では cookieSpecific にしない', () => {
    setBody(`
      <div class="consent-modal">
        <div id="a1"><button>同意する</button></div>
      </div>
      <div class="site-banner">
        <div id="a2"><button>同意する</button></div>
      </div>
    `);
    expect(isCookieSpecific(document.getElementById('a1') as Element, '同意する')).toBe(false);
    expect(isCookieSpecific(document.getElementById('a2') as Element, '同意する')).toBe(false);
  });

  it('5 階層より上の祖先までは見ない', () => {
    setBody(`
      <div class="cookie-banner">
        <div><div><div><div><div>
          <div id="deep"><button>同意する</button></div>
        </div></div></div></div></div>
      </div>
    `);
    expect(isCookieSpecific(document.getElementById('deep') as Element, '同意する')).toBe(false);
  });
});

describe('容器のテキスト長（F2）', () => {
  const longBanner = (attributes: string, length: number): string => `
    <div id="bar" ${attributes}>
      <p>Cookie ${'あ'.repeat(length)}</p>
      <button>拒否</button>
    </div>
  `;

  it('強い属性ヒントのある容器は長文でも採用する（設定パネルを開いた後の容器）', () => {
    setBody(longBanner('class="cookie-settings-content"', 3200));
    expect(detectBannerContainer(document, env)?.el.id).toBe('bar');
  });

  it('強い属性ヒントでも 20000 文字を超えたら採用しない', () => {
    setBody(longBanner('class="cookie-settings-content"', 20200));
    expect(findContainers(document, env)).toHaveLength(0);
  });

  // 本文に Cookie 固有語があれば 8000 文字まで許す（B）。
  // 属性ヒント（20000）と従来の上限（3000）の中間
  it('Cookie 語のある fixed な長文ダイアログは 5000 文字でも採用する', () => {
    setBody(longBanner('style="position:fixed"', 5000));
    expect(detectBannerContainer(document, env)?.el.id).toBe('bar');
  });

  it('Cookie 語が無ければ従来どおり 3000 文字で切る', () => {
    // 祖先の強い属性ヒントで cookieSpecific にはなるが、本文には Cookie 固有語が無い容器。
    // 祖先自身は小さすぎて容器にならないので、長さの判定だけを見られる
    const nested = (length: number): string => `
      <div class="cookie-root" data-w="100" data-h="20">
        <div id="bar" style="position:fixed">
          <p>同意 ${'あ'.repeat(length)}</p>
          <button>拒否</button>
        </div>
      </div>
    `;
    setBody(nested(2800));
    expect(detectBannerContainer(document, sizedEnv)?.el.id).toBe('bar');
    setBody(nested(5000));
    expect(findContainers(document, sizedEnv)).toHaveLength(0);
  });

  it('position だけの長文容器も 8000 文字を超えたら採用しない', () => {
    setBody(longBanner('style="position:fixed"', 8200));
    expect(findContainers(document, env)).toHaveLength(0);
  });
});

describe('非表示にする対象（hideTarget）', () => {
  it('テキストが同じ fixed / absolute な祖先（バックドロップ）まで遡る', () => {
    setBody(`
      <div id="backdrop" style="position:fixed">
        <div id="dialog" style="position:absolute">
          <p>Cookie を使用します</p>
          <button>同意する</button>
        </div>
      </div>
    `);
    const dialog = document.getElementById('dialog') as Element;
    expect(hideTarget(dialog, env).id).toBe('backdrop');
  });

  it('祖先に他の中身があれば遡らない', () => {
    setBody(`
      <div id="wrap" style="position:fixed">
        <p>ほかの中身</p>
        <div id="dialog" style="position:absolute"><p>Cookie を使用します</p><button>同意する</button></div>
      </div>
    `);
    expect(hideTarget(document.getElementById('dialog') as Element, env).id).toBe('dialog');
  });

  it('static な祖先では止まる', () => {
    setBody(`
      <div id="wrap">
        <div id="dialog" style="position:fixed"><p>Cookie を使用します</p><button>同意する</button></div>
      </div>
    `);
    expect(hideTarget(document.getElementById('dialog') as Element, env).id).toBe('dialog');
  });

  it('body / html には決して達しない', () => {
    setBody('<div id="bar" style="position:fixed"><p>Cookie</p><button>同意する</button></div>');
    document.body.style.position = 'fixed';
    try {
      const bar = document.getElementById('bar') as Element;
      expect(hideTarget(bar, env)).toBe(bar);
    } finally {
      document.body.style.removeProperty('position');
    }
  });
});

describe('容器検出のコスト', () => {
  it('インライン・葉要素には getComputedStyle（getPosition）を掛けない', () => {
    setBody(`
      <div id="box">
        <span>span</span><a href="#">a</a><button>button</button>
        <img alt="img" /><label>label</label><ul><li>li</li></ul>
        <input type="text" />
      </div>
    `);
    const asked: string[] = [];
    const counting = testEnv({
      getPosition: (el) => {
        asked.push(el.tagName);
        return 'static';
      },
    });
    findContainers(document, counting);
    expect(asked).not.toContain('SPAN');
    expect(asked).not.toContain('A');
    expect(asked).not.toContain('BUTTON');
    expect(asked).not.toContain('IMG');
    expect(asked).not.toContain('LABEL');
    expect(asked).not.toContain('LI');
    expect(asked).not.toContain('INPUT');
    expect(asked).toContain('DIV');
  });
});

describe('祖先の本文で Cookie バナーだと判断する', () => {
  it('ボタンだけの行でも、親の見出しに Cookie 語があれば Cookie バナー扱いにする', () => {
    // mercedes-benz.co.jp 型。行自体のテキストは「設定 全てに同意 …」で Cookie 語が無い。
    // 実サイト（`cmm-cookie-banner__actions`）は自身の class が cookie を名乗るので経路⒝で
    // 拾える。ここは**⒞ の経路そのものを残すための合成ケース**なので、あえて弱い名乗り
    // （banner）にしてある。
    // 名乗りが無い場合の扱いは別テストを参照（多くの構造では祖先自身が容器になる。例外は
    // docs/SPEC.md 末尾の残存リスク参照）
    setBody(`
      <div class="mbj-banner" style="position:fixed">
        <div class="mbj-head">
          <div class="mbj-title">メルセデス・ベンツ日本合同会社は多様な目的でCookieを使用します</div>
        </div>
        <div class="mbj-actions" id="actions">
          <button>設定</button>
          <button>全てに同意</button>
        </div>
      </div>
    `);
    const actions = document.getElementById('actions') as HTMLElement;
    expect(isCookieSpecific(actions, 'せってい全てに同意', (el) => (el as HTMLElement).textContent ?? '')).toBe(
      true,
    );
  });

  it('サイト構造（main）を内包する祖先の本文は見ない', () => {
    setBody(`
      <div id="page">
        <main><p>Cookie ポリシーについて</p></main>
        <div id="row"><button>次へ</button></div>
      </div>
    `);
    const row = document.getElementById('row') as HTMLElement;
    expect(isCookieSpecific(row, '次へ', (el) => (el as HTMLElement).textContent ?? '')).toBe(false);
  });

  it('getText を渡さなければ祖先の本文は見ない（従来どおり）', () => {
    setBody(`
      <div class="plain"><div class="head">Cookie を使用します</div><div id="row2"><button>OK</button></div></div>
    `);
    const row = document.getElementById('row2') as HTMLElement;
    expect(isCookieSpecific(row, 'ok')).toBe(false);
  });
});

describe('祖先の本文を根拠にしてよい範囲（2026-09-09）', () => {
  /**
   * 祖先の本文（⒞）を根拠にしてよいのは、**その祖先自身がバナーらしい名乗りを持つ**ときだけ。
   * 名乗りの無い入れ物（`#root` `.content`）の `innerText` には**別の枝**にあるフッターの
   * 「Cookie Policy」まで含まれるので、`main` / `nav` / `article` を使わない div 入れ子の
   * サイトではリンク 1 本で周辺の要素がまとめて Cookie バナー扱いになっていた。
   */
  const soup = (ancestor: string): string => `
    <div ${ancestor}>
      <div class="head">当サイトは Cookie を使用します</div>
      <div class="site-footer"><a href="/cookie-policy">Cookie Policy</a></div>
      <div class="row" id="row"><button>設定</button><button>全てに同意</button></div>
    </div>
  `;

  const rowIsCookieSpecific = (): boolean => {
    const row = document.getElementById('row') as HTMLElement;
    return isCookieSpecific(row, 'せってい全てに同意', (el) => (el as HTMLElement).textContent ?? '');
  };

  it('名乗りの無い入れ物の本文は根拠にしない（Cookie 語があっても偽）', () => {
    setBody(soup('id="root"'));
    expect(rowIsCookieSpecific()).toBe(false);
  });

  it('強いヒント（cookie）を名乗る祖先は従来どおり真', () => {
    // 強いヒントは属性の判定（⒝）で先に真になるので、そもそも⒞に来ない
    setBody(soup('class="cookie-banner"'));
    expect(rowIsCookieSpecific()).toBe(true);
  });

  it('汎用ヒント（consent）を名乗る祖先は従来どおり真', () => {
    setBody(soup('class="consent-box"'));
    expect(rowIsCookieSpecific()).toBe(true);
  });

  it('弱いヒント（notice）を名乗る祖先は従来どおり真', () => {
    setBody(soup('class="notice"'));
    expect(rowIsCookieSpecific()).toBe(true);
  });

  it('dialog を名乗る祖先は従来どおり真', () => {
    setBody(soup('role="dialog"'));
    expect(rowIsCookieSpecific()).toBe(true);
  });

  it('サイト構造（main）を内包する祖先は、バナーらしい名乗りがあっても見ない', () => {
    // 名乗り（①）と入れ物でないこと（②）は AND。既存の性質の回帰。
    // 名乗りは汎用ヒントで置く（強いヒントだと⒝で真になり⒞まで来ない）
    setBody(`
      <div class="consent-box">
        <main><p>Cookie ポリシーについて</p></main>
        <div class="row" id="row"><button>設定</button><button>全てに同意</button></div>
      </div>
    `);
    expect(rowIsCookieSpecific()).toBe(false);
  });

  it('名乗りの無い fixed な祖先は、この形では祖先自身が容器になるので取りこぼさない（例外は docs/SPEC.md 参照）', () => {
    // 名乗りの無い祖先を⒞の対象から外しても、その祖先は本文の Cookie 固有語（text-cookie）と
    // position: fixed（overlay）で容器の条件を満たす。容器がボタン行から祖先に移るだけ。
    // ただしこれは一例であって一般則ではない——祖先が入力欄・サイト構造を内包する場合や
    // 本文が長い場合・static な場合は祖先自身も容器になれず取りこぼす（残存リスクは
    // docs/SPEC.md 末尾）
    setBody(`
      <div class="mbj-layer" id="layer" style="position:fixed">
        <div class="mbj-title">メルセデス・ベンツ日本合同会社は多様な目的でCookieを使用します</div>
        <div class="mbj-actions" id="row"><button>設定</button><button>全てに同意</button></div>
      </div>
    `);
    expect(rowIsCookieSpecific()).toBe(false);
    const container = detectBannerContainer(document, env);
    expect(container?.el.id).toBe('layer');
    expect(container?.cookieSpecific).toBe(true);
    expect(container?.decisions.map((button) => button.text)).toContain('全てに同意');
  });
});

describe('ハード条件 8. を単独で固定する（2026-09-09）', () => {
  /**
   * ハード条件 8.（`!attrCookie && !hasBannerWord(text)` なら容器にしない）は、レビューでの
   * 実測により**この行を丸ごと削除しても既存 824 件が 1 件も落ちない**ことが判明した。
   * ⒞ の限定（祖先の本文を根拠にしてよい範囲を絞った修正）によって、既存の罠（trap-*.html）は
   * すべて条件 9.（`cookieSpecific` が偽）で先に落ちるようになったため——条件 8. だけが効く
   * ケースがテストに無かった。将来⒞を緩めたときに条件 8. が壊れていても検出できるよう、
   * 条件 8. だけが効くケースを単独で固定する。
   */
  it('祖先の名乗りで cookieSpecific が真でも、自身の本文にバナー語が無ければ採用しない', () => {
    // 祖先 `.site-notice-area` は notice を名乗るので⒞ を通り cookieSpecific は真になる
    // （id/class に cookie は無いので⒝ ではなく⒞ で真になる）。`#promo` 自身の本文には
    // バナー語（BANNER_WORDS）を一切持たせていないので、落とすのはハード条件 8. だけになる
    setBody(`
      <div class="site-notice-area">
        <div class="site-footer"><a href="/cookie-policy">Cookie Policy</a></div>
        <div id="promo" style="position:fixed"><p>アプリで見るともっと便利</p><button>OK</button></div>
      </div>
    `);
    const promo = document.getElementById('promo') as HTMLElement;
    // ⒞ を通っていること（cookieSpecific が真であること）の明示
    expect(
      isCookieSpecific(promo, promo.textContent ?? '', (el) => (el as HTMLElement).textContent ?? ''),
    ).toBe(true);
    // それでも採用しないのはハード条件 8. のおかげ（cookieSpecific が真なので条件 9. では落ちない）
    expect(evaluateContainer(promo, env)).toBeNull();
  });
});

describe('祖先の本文を根拠にしてよい上限（本文の長さ。2026-09-09）', () => {
  /**
   * ⒞（祖先の本文）を Cookie の根拠にしてよいのは、その祖先自身が「バナーそのものだと
   * 言い切れる大きさ」のときだけに絞った（§5-5-d ⒞・candidates.ts の MAX_TEXT_LENGTH_COOKIE）。
   * 弱い名乗り（banner / notice）だけを持つ**ページ全体のラッパー**が対象のままだと、
   * フッターの Cookie Policy が無関係なモーダルの根拠になってしまうため。
   */
  const rowIsCookieSpecificWithAncestorBody = (ancestorBody: string): boolean => {
    setBody(`
      <div class="notice">
        <p>${ancestorBody}</p>
        <div class="row" id="row"><button>設定</button><button>全てに同意</button></div>
      </div>
    `);
    const row = document.getElementById('row') as HTMLElement;
    return isCookieSpecific(row, 'せってい全てに同意', (el) => (el as HTMLElement).textContent ?? '');
  };

  it('名乗りのある祖先でも、本文が 8000 文字以上なら根拠にしない', () => {
    const long = 'Cookie を使用します。' + 'あ'.repeat(8000);
    expect(rowIsCookieSpecificWithAncestorBody(long)).toBe(false);
  });

  it('名乗りのある祖先の本文が短ければ、従来どおり根拠にする', () => {
    const short = 'Cookie を使用します。';
    expect(rowIsCookieSpecificWithAncestorBody(short)).toBe(true);
  });
});
