// fallback（hide / leave）の猶予（docs/SPEC.md §5-1 / §5-5-d）。
// 容器を検出しても押せる候補が無いとき、すぐ hide せず FALLBACK_GRACE_MS まで再試行する。
// 時間は注入した env の仮想時計（sleep で now が進む）で進めるので実時間は待たない。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineEnv } from '../src/engine/env';
import type { RunDeps } from '../src/engine/run';
import { CLOAK_ATTR, HIDDEN_ATTR, SCROLL_ATTR } from '../src/engine/cloak';
import { cloakSelectors } from '../src/engine/cmpQuick';
import {
  CLICK_WAIT_MS,
  FALLBACK_GRACE_MS,
  FALLBACK_RETRY_MS,
  createRunState,
  resolveCustomTargets,
  runOnce,
  unhandledSummary,
} from '../src/engine/run';
import { activeCategories } from '../src/shared/presets';
import { DEFAULT_SETTINGS } from '../src/shared/storage';
import type { CategoryKey, ComRule, CustomRule, Settings } from '../src/shared/types';
import { setBody, testEnv } from './helpers';

/** 拒否・許可の両方があるふつうのバナー */
const BANNER_HTML = `
  <main><h1>記事</h1><p>本文です。</p></main>
  <div id="bar" class="cookie-bar" style="position:fixed">
    <p>当サイトでは Cookie を使用しています。</p>
    <button id="deny">拒否</button>
    <button id="agree">同意する</button>
  </div>
`;

/** 「OK」しか無い通知バナー（fixtures/notice-only.html 相当） */
const NOTICE_ONLY_HTML = `
  <main><h1>記事</h1><p>本文です。</p></main>
  <div id="bar" class="cookie-toast" style="position:fixed">
    <p>当サイトでは Cookie を使用しています。</p>
    <button id="ok">OK</button>
  </div>
`;

/** 「同意する」と「設定」しかないバナー（fixtures/no-reject.html 相当） */
const NO_REJECT_HTML = `
  <main><h1>記事</h1><p>本文です。</p></main>
  <div id="bar" class="cookie-bar" style="position:fixed">
    <p>当サイトでは Cookie を使用して、利便性の向上とアクセス解析を行っています。</p>
    <button id="agree">同意する</button>
    <button id="config">設定</button>
  </div>
`;

/**
 * reject モードの deps を組む。
 * onTick は sleep のたびに（仮想時計の現在値付きで）呼ばれるので、
 * 「1 秒後に拒否ボタンが描画される」といったサイトの挙動を模せる。
 */
interface HarnessExtra {
  mode?: 'reject' | 'accept';
  /** 実効の許可カテゴリ。既定は DEFAULT_SETTINGS（= プリセット minimal）と同じ */
  allowCategories?: readonly CategoryKey[];
  customRules?: CustomRule[];
  comRules?: Record<string, ComRule>;
  /** env の差し替え（isOffscreen / isFaded / getRect など） */
  env?: Partial<EngineEnv>;
}

function harness(
  patch: Partial<Settings> = {},
  onTick?: (now: number) => void,
  extra: HarnessExtra = {},
): { deps: RunDeps; env: EngineEnv } {
  let clock = 0;
  const env = testEnv({
    sleep: async (ms) => {
      clock += ms;
      onTick?.(clock);
    },
    now: () => clock,
    ...extra.env,
  });
  const deps: RunDeps = {
    doc: document,
    env,
    settings: { ...DEFAULT_SETTINGS, ...patch },
    mode: extra.mode ?? 'reject',
    allowCategories: extra.allowCategories ?? activeCategories(DEFAULT_SETTINGS.allowCategories),
    customRules: extra.customRules ?? [],
    comRules: extra.comRules ?? {},
    isSubFrame: false,
    state: createRunState(env.now()),
  };
  return { deps, env };
}

/** data-w / data-h で大きさを与える getRect */
function sizedRect(el: Element): { width: number; height: number } {
  return {
    width: Number(el.getAttribute('data-w') ?? 600),
    height: Number(el.getAttribute('data-h') ?? 120),
  };
}

/** 押されたボタンの文言を順に記録する */
function recordClicks(): string[] {
  const clicked: string[] = [];
  onClick((event) => {
    const el = (event.target as Element).closest?.('button, a, [role="button"], input');
    if (el && event.type === 'click') clicked.push((el.textContent ?? '').trim());
  });
  return clicked;
}

/** click リスナーはテストごとに外す（document に残ると次のテストに漏れる） */
const clickListeners: EventListener[] = [];
function onClick(listener: EventListener): void {
  clickListeners.push(listener);
  document.addEventListener('click', listener, true);
}

/** id のボタンが押されたらバナーを消す（実サイトの挙動を模す） */
function closeOnClick(id: string, banner: Element): void {
  onClick((event) => {
    if ((event.target as Element).id === id) banner.remove();
  });
}

/**
 * id のボタンが押されたらバナーを「画面外へ退場」させる。
 * DOM には残り display / visibility も変わらないので、gone 経由で env に伝える。
 */
function closeOnClickMoveOut(id: string, banner: Element, gone: Set<Element>): void {
  onClick((event) => {
    if ((event.target as Element).id === id) gone.add(banner);
  });
}

beforeEach(() => {
  setBody('');
  document.body.className = '';
  document.body.removeAttribute(SCROLL_ATTR);
  document.body.style.removeProperty('overflow');
  document.documentElement.style.removeProperty('overflow');
});

afterEach(() => {
  for (const listener of clickListeners.splice(0)) document.removeEventListener('click', listener, true);
});

describe('fallback の猶予', () => {
  it('猶予中に拒否ボタンが現れたら押す（fallback しない）', async () => {
    setBody(NO_REJECT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;
    closeOnClick('deny', bar);

    // 1 秒遅れて拒否ボタンが描画されるサイトを模す
    let added = false;
    const { deps, env } = harness({}, (now) => {
      // 猶予（FALLBACK_GRACE_MS）の途中で現れることを、猶予の長さに依らず表す
      if (added || now < FALLBACK_RETRY_MS * 2) return;
      added = true;
      const button = document.createElement('button');
      button.id = 'deny';
      button.textContent = '拒否';
      bar.appendChild(button);
    });

    const outcome = await runOnce(deps);
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedText: '拒否',
    });
    // 猶予が切れる前にクリックを始めている（クリック後の確認待ちは猶予の外）
    expect(env.now()).toBeLessThan(FALLBACK_GRACE_MS + CLICK_WAIT_MS);
    expect(bar.isConnected).toBe(false);
    expect(bar.hasAttribute('data-cookie-autopilot-hidden')).toBe(false);
  });

  it('猶予が切れるまでは cloak のまま待ち、そのあと hide する', async () => {
    setBody(NO_REJECT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;

    const midway: { cloak: string | null; display: string }[] = [];
    const { deps, env } = harness({}, (now) => {
      if (now !== FALLBACK_RETRY_MS * 2) return;
      midway.push({ cloak: bar.getAttribute('data-cookie-autopilot-cloak'), display: bar.style.display });
    });

    const outcome = await runOnce(deps);
    // 猶予中は cloak（opacity:0）のままで、display:none にはしていない
    expect(midway).toEqual([{ cloak: '', display: '' }]);
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide' });
    expect(env.now()).toBeGreaterThanOrEqual(FALLBACK_GRACE_MS);
    expect(bar.style.display).toBe('none');
    expect(bar.getAttribute('data-cookie-autopilot-hidden')).toBe('');
    expect(bar.hasAttribute('data-cookie-autopilot-cloak')).toBe(false);
  });

  it('監視窓が先に切れるときは猶予を打ち切って fallback する', async () => {
    setBody(NO_REJECT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;
    const { deps, env } = harness({ observeSeconds: 1 });

    const outcome = await runOnce(deps);
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide' });
    // 3 秒の猶予ではなく、監視窓（1 秒）の手前で適用される
    expect(env.now()).toBeLessThan(1000);
    expect(bar.style.display).toBe('none');
  });

  it('猶予中にサイト側がバナーを消したら何もしない', async () => {
    setBody(NO_REJECT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;
    const { deps } = harness({}, (now) => {
      if (now >= 500) bar.remove();
    });

    const outcome = await runOnce(deps);
    expect(outcome).toBeNull();
    expect(deps.state.detectedAny).toBe(true);
    expect(bar.style.display).toBe('');
    expect(bar.hasAttribute('data-cookie-autopilot-hidden')).toBe(false);
  });
});

describe('fallback=hide の条件（C1）', () => {
  it('押さずに残す許可ボタンが無い容器は非表示にしない', async () => {
    setBody(`
      <div id="widget" style="position:fixed">
        <p>We are committed to protecting your privacy. Cookie についてはこちら。</p>
        <button>Send us a message</button>
      </div>
    `);
    const widget = document.getElementById('widget') as HTMLElement;
    const { deps } = harness();

    const outcome = await runOnce(deps);
    expect(outcome).toMatchObject({ status: 'unhandled' });
    expect(widget.style.display).toBe('');
    expect(widget.hasAttribute('data-cookie-autopilot-hidden')).toBe(false);
    expect(widget.hasAttribute('data-cookie-autopilot-cloak')).toBe(false);
  });

  // 強い属性ヒント（class="cookie-box"）は、可視テキストに Cookie 固有語が無くても
  // 「Cookie バナーだと言い切れる容器」として扱う（F1。isCookieSpecific）
  it('強い属性ヒントの容器はテキストに Cookie 固有語が無くても非表示にする', async () => {
    setBody(`
      <div id="widget" class="cookie-box" style="position:fixed">
        <p>プライバシーの取り扱いに同意してください。</p>
        <button>同意する</button>
      </div>
    `);
    const widget = document.getElementById('widget') as HTMLElement;
    const { deps } = harness();

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide' });
    expect(widget.style.display).toBe('none');
  });

  it('汎用ヒントだけの容器は Cookie 固有語が無ければ採用も非表示もしない', async () => {
    setBody(`
      <div id="widget" class="consent-box" style="position:fixed">
        <p>プライバシーの取り扱いに同意してください。</p>
        <button>同意する</button>
      </div>
    `);
    const widget = document.getElementById('widget') as HTMLElement;
    const { deps } = harness();

    expect(await runOnce(deps)).toBeNull();
    expect(widget.style.display).toBe('');
    expect(widget.hasAttribute('data-cookie-autopilot-cloak')).toBe(false);
  });

  it('Cookie バナーで許可ボタンがあれば従来どおり非表示にする', async () => {
    setBody(NO_REJECT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;
    const { deps } = harness();

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide' });
    expect(bar.style.display).toBe('none');
  });
});

describe('モーダル型バナーの非表示（H2）', () => {
  it('テキストが同じ fixed な祖先（バックドロップ）ごと消す', async () => {
    setBody(`
      <div id="backdrop" style="position:fixed" data-w="1000" data-h="800">
        <div id="dialog" style="position:absolute" data-w="400" data-h="200">
          <p>Cookie の利用に同意してください。</p>
          <button>同意する</button>
          <button>設定</button>
        </div>
      </div>
    `);
    const backdrop = document.getElementById('backdrop') as HTMLElement;
    const dialog = document.getElementById('dialog') as HTMLElement;
    const { deps } = harness({}, undefined, { env: { getRect: sizedRect } });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide' });
    expect(backdrop.style.display).toBe('none');
    expect(backdrop.getAttribute('data-cookie-autopilot-hidden')).toBe('');
    expect(dialog.style.display).toBe('');
  });
});

describe('スクロールロックの復帰（H3）', () => {
  it('サイト本来の overflow:hidden は戻さない', async () => {
    setBody(NO_REJECT_HTML);
    document.body.style.overflow = 'hidden';
    const { deps } = harness();

    expect(await runOnce(deps)).toMatchObject({ method: 'hide' });
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('バナーが後から掛けた overflow:hidden は元の inline 値に戻す', async () => {
    setBody(NO_REJECT_HTML);
    let locked = false;
    const { deps } = harness({}, (now) => {
      if (locked || now < 500) return;
      locked = true;
      document.body.style.overflow = 'hidden';
    });

    expect(await runOnce(deps)).toMatchObject({ method: 'hide' });
    expect(locked).toBe(true);
    expect(document.body.style.overflow).toBe('');
  });

  /** バナー表示中に `body.modal-open` を付けてスクロールを止めるサイトを模す */
  async function lockByClass(): Promise<void> {
    setBody(`<style>body.modal-open { overflow: hidden; }</style>${NO_REJECT_HTML}`);
    let locked = false;
    const { deps } = harness({}, (now) => {
      if (locked || now < 500) return;
      locked = true;
      document.body.classList.add('modal-open');
    });

    expect(await runOnce(deps)).toMatchObject({ method: 'hide' });
    expect(locked).toBe(true);
  }

  it('クラス由来の overflow:hidden は inline の override で解除する', async () => {
    await lockByClass();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
    expect(document.body.hasAttribute(SCROLL_ATTR)).toBe(true);
  });

  it('その後サイトが class を変えたら override を外して身を引く', async () => {
    await lockByClass();
    document.body.classList.add('site-own-modal');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.style.overflow).toBe('');
    expect(document.body.hasAttribute(SCROLL_ATTR)).toBe(false);
  });

  it('記録時から hidden だったクラス由来のロックには触らない', async () => {
    setBody(`<style>body.modal-open { overflow: hidden; }</style>${NO_REJECT_HTML}`);
    document.body.classList.add('modal-open');
    const { deps } = harness();

    expect(await runOnce(deps)).toMatchObject({ method: 'hide' });
    expect(document.body.style.overflow).toBe('');
    expect(document.body.hasAttribute(SCROLL_ATTR)).toBe(false);
  });
});

describe('クリックの成功判定（H1）', () => {
  /** 拒否を押すと画面外へ退場する（transform）バナー */
  const SLIDE_OUT_HTML = `
    <div id="bar" class="cookie-bar" style="position:fixed">
      <p>当サイトでは Cookie を使用しています。</p>
      <button id="deny">拒否</button>
      <button id="agree">同意する</button>
    </div>
  `;

  it('transform で viewport の外に出たら成功とみなす', async () => {
    setBody(SLIDE_OUT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;
    const gone = new Set<Element>();
    closeOnClickMoveOut('deny', bar, gone);
    const clicked = recordClicks();

    const { deps, env } = harness({}, undefined, {
      env: { isOffscreen: (el) => gone.has(el) },
    });
    const outcome = await runOnce(deps);

    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', action: 'reject', clickedText: '拒否' });
    // 拒否が効いたので許可ボタンには触れていない
    expect(clicked).toEqual(['拒否']);
    expect(env.now()).toBeLessThan(FALLBACK_GRACE_MS);
  });

  it('opacity:0 になったら成功とみなす（自前の cloak とは区別する）', async () => {
    setBody(SLIDE_OUT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;
    const gone = new Set<Element>();
    closeOnClickMoveOut('deny', bar, gone);
    const clicked = recordClicks();

    const { deps } = harness({}, undefined, {
      env: { isFaded: (el) => gone.has(el) },
    });
    expect(await runOnce(deps)).toMatchObject({ status: 'handled', clickedText: '拒否' });
    expect(clicked).toEqual(['拒否']);
  });

  it('押した要素自体が消えたら成功とみなす', async () => {
    setBody(SLIDE_OUT_HTML);
    const deny = document.getElementById('deny') as HTMLElement;
    onClick((event) => {
      if ((event.target as Element).id === 'deny') deny.remove();
    });
    const clicked = recordClicks();

    const { deps } = harness({});
    expect(await runOnce(deps)).toMatchObject({ status: 'handled', clickedText: '拒否' });
    expect(clicked).toEqual(['拒否']);
  });
});

describe('position: static のバナー（fixtures/en-static-banner.html 相当）', () => {
  /** fixed でも sticky でもない、id だけがバナーを名指ししている英語バナー */
  const STATIC_HTML = `
    <div id="cookie-banner">
      <p>We use cookies to run this site and to understand how it is used.</p>
      <button id="accept">Accept</button>
      <button id="reject">Reject</button>
    </div>
    <main><h1>Article</h1><p>Body text.</p></main>
  `;

  it('reject では Reject が押される（position を見ずに属性ヒントで検出する）', async () => {
    setBody(STATIC_HTML);
    const bar = document.getElementById('cookie-banner') as HTMLElement;
    closeOnClick('reject', bar);
    const clicked = recordClicks();

    const { deps } = harness();
    expect(await runOnce(deps)).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedText: 'reject',
    });
    expect(clicked).toEqual(['Reject']);
    expect(bar.isConnected).toBe(false);
  });

  it('accept では Accept が押される', async () => {
    setBody(STATIC_HTML);
    const bar = document.getElementById('cookie-banner') as HTMLElement;
    closeOnClick('accept', bar);
    const clicked = recordClicks();

    const { deps } = harness({}, undefined, { mode: 'accept' });
    expect(await runOnce(deps)).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'accept',
      clickedText: 'accept',
    });
    expect(clicked).toEqual(['Accept']);
  });
});

describe('reject モードの閉じる語（M-6）', () => {
  it('設定ボタンが残っている容器の Continue は押さず、fallback の hide に落ちる', async () => {
    setBody(`
      <main><h1>Article</h1><p>Body text.</p></main>
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>By continuing to browse, you accept our use of cookies.</p>
        <button id="continue">Continue</button>
        <button id="manage">Manage settings</button>
      </div>
    `);
    const bar = document.getElementById('bar') as HTMLElement;
    const clicked = recordClicks();
    const { deps } = harness();

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide' });
    // 設定パネル層（§5-5-e）が "Manage settings" を開こうとするが、パネルが出ないので
    // 何も触らず hide に落ちる。同意ボタンの Continue は押さない
    expect(clicked).toEqual(['Manage settings']);
    expect(bar.style.display).toBe('none');
  });

  it('accept モードでは Continue を押す', async () => {
    setBody(`
      <main><h1>Article</h1><p>Body text.</p></main>
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>By continuing to browse, you accept our use of cookies.</p>
        <button id="continue">Continue</button>
        <button id="manage">Manage settings</button>
      </div>
    `);
    const bar = document.getElementById('bar') as HTMLElement;
    closeOnClick('continue', bar);
    const clicked = recordClicks();
    const { deps } = harness({}, undefined, { mode: 'accept' });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', action: 'accept', clickedText: 'continue' });
    expect(clicked).toEqual(['Continue']);
  });
});

describe('即決 CMP 表の容器セレクタ（H-1 / Civic）', () => {
  it('Yahoo の容器は #consent-page の中の .consent-form だけ（cloak も同じ）', () => {
    setBody('<form class="consent-form"><p>同意して送信</p></form>');
    const form = document.querySelector('.consent-form') as Element;
    // 単独の .consent-form は document_start の cloak でも不可視にしない
    expect(cloakSelectors(false).some((selector) => form.matches(selector))).toBe(false);

    setBody('<div id="consent-page"><form class="consent-form"><p>Cookie</p></form></div>');
    const yahoo = document.querySelector('.consent-form') as Element;
    expect(cloakSelectors(false).some((selector) => yahoo.matches(selector))).toBe(true);
  });

  it('Civic の容器は開いているときだけ（#ccc[open]）', () => {
    setBody('<div id="ccc"><p>Cookie</p></div>');
    const closed = document.getElementById('ccc') as Element;
    expect(cloakSelectors(false).some((selector) => closed.matches(selector))).toBe(false);

    closed.setAttribute('open', '');
    expect(cloakSelectors(false).some((selector) => closed.matches(selector))).toBe(true);
  });

  it('無関係な .consent-form の「同意して送信」は押さない', async () => {
    setBody(`
      <main><h1>お問い合わせ</h1></main>
      <form class="consent-form">
        <p>個人情報の取り扱いに同意のうえ送信してください。</p>
        <button name="agree">同意して送信</button>
      </form>
    `);
    const clicked = recordClicks();
    const { deps } = harness({}, undefined, { mode: 'accept' });

    expect(await runOnce(deps)).toBeNull();
    expect(clicked).toEqual([]);
  });
});

describe('即決 CMP 表のボタン探索（M7）', () => {
  it('容器の中に無ければ document 全体へは広げない', async () => {
    setBody(`
      <main><button id="deny">記事を取り下げる</button></main>
      <div id="usercentrics-root">
        <p>当サイトは Cookie を使用しています。</p>
        <button class="uc-other">なにか</button>
      </div>
    `);
    const clicked = recordClicks();
    const { deps } = harness();

    // 容器の中に拒否ボタンが無いので即決層は失敗。document 全体の #deny には触らない
    expect(await runOnce(deps)).toBeNull();
    expect(clicked).toEqual([]);
  });

  it('容器の外にある同じ id のボタンは押さない', async () => {
    setBody(`
      <main><button id="deny">記事を取り下げる</button></main>
      <div id="usercentrics-root">
        <p>当サイトは Cookie を使用しています。</p>
        <button id="deny">すべて拒否</button>
      </div>
    `);
    const root = document.getElementById('usercentrics-root') as HTMLElement;
    onClick((event) => {
      const el = (event.target as Element).closest('button');
      if (el && el.parentElement === root) root.remove();
    });
    const clicked = recordClicks();
    const { deps } = harness();

    const outcome = await runOnce(deps);
    expect(outcome).toMatchObject({ status: 'handled', method: 'quick:Usercentrics', action: 'reject' });
    expect(clicked).toEqual(['すべて拒否']);
  });
});

describe('猶予の起点（L9）', () => {
  it('容器が別要素に差し替わったら猶予をやり直す', async () => {
    setBody(NO_REJECT_HTML);
    let swapped = false;
    const { deps, env } = harness({}, (now) => {
      if (swapped || now < 1000) return;
      swapped = true;
      const old = document.getElementById('bar') as HTMLElement;
      const next = old.cloneNode(true) as HTMLElement;
      next.id = 'bar2';
      old.replaceWith(next);
    });

    const outcome = await runOnce(deps);
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide' });
    expect(swapped).toBe(true);
    // 差し替え（1 秒）を起点に猶予をやり直すので、3 秒では終わらない
    expect(env.now()).toBeGreaterThanOrEqual(1000 + FALLBACK_GRACE_MS);
    expect((document.getElementById('bar2') as HTMLElement).style.display).toBe('none');
  });
});

describe('進行中パスの打ち切り（H5）', () => {
  it('cancelled が立ったら猶予を打ち切り、fallback も適用しない', async () => {
    setBody(NO_REJECT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;
    const { deps, env } = harness({}, (now) => {
      if (now >= 500) deps.state.cancelled = true;
    });

    const outcome = await runOnce(deps);
    expect(outcome).toBeNull();
    expect(env.now()).toBeLessThan(FALLBACK_GRACE_MS);
    expect(bar.style.display).toBe('');
    expect(deps.state.detectedAny).toBe(true);
  });
});

describe('カスタムルール（C3）', () => {
  const BANNER = `
    <div id="bar" class="cookie-bar" style="position:fixed">
      <p>当サイトでは Cookie を使用しています。</p>
      <button class="btn deny">拒否</button>
      <button class="btn agree">同意する</button>
    </div>
  `;

  function rule(patch: Partial<CustomRule> = {}): CustomRule {
    return { id: 'r1', host: 'example.com', action: 'reject', text: '拒否', createdAt: 0, ...patch };
  }

  it('セレクタが一意でも文言が違えばその要素は押さない（文言経路にだけ任せる）', () => {
    setBody(BANNER);
    const { deps } = harness();
    const targets = resolveCustomTargets(rule({ selector: '.agree' }), deps);
    const agree = document.querySelector('.agree') as Element;
    expect(targets.some((t) => t.el === agree)).toBe(false);
    expect(targets.map((t) => t.text)).toEqual(['拒否']);
  });

  it('セレクタが別ボタンに当たり、文言に一致する要素も無ければ 0 件', () => {
    setBody(BANNER.replace('>拒否<', '>すべて拒否<'));
    const { deps } = harness();
    expect(resolveCustomTargets(rule({ selector: '.agree' }), deps)).toHaveLength(0);
  });

  it('セレクタが一意で文言も一致すれば押す', () => {
    setBody(BANNER);
    const { deps } = harness();
    const targets = resolveCustomTargets(rule({ selector: '.deny' }), deps);
    expect(targets.map((t) => t.text)).toEqual(['拒否']);
  });

  it('不可視の要素は押さない', () => {
    setBody(BANNER.replace('class="btn deny"', 'class="btn deny" style="display:none"'));
    const { deps } = harness();
    expect(resolveCustomTargets(rule({ selector: '.deny' }), deps)).toHaveLength(0);
  });

  it('HARD 禁止語の要素は教えたボタンでも押さない', () => {
    for (const text of ['退会する', '削除する']) {
      setBody(`
        <div id="bar" class="cookie-bar" style="position:fixed">
          <p>Cookie を使用します</p>
          <button class="deny">${text}</button>
          <button class="agree">同意する</button>
        </div>
      `);
      const { deps } = harness();
      expect(resolveCustomTargets(rule({ selector: '.deny', text }), deps), text).toHaveLength(0);
    }
  });

  it('SOFT 禁止語（保存して閉じる）は教えたボタンなら押せる', () => {
    const html = `
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>Cookie の利用設定</p>
        <button class="save">保存して閉じる</button>
        <button class="agree">すべて許可</button>
      </div>
    `;
    setBody(html);
    const { deps } = harness();
    const saved = rule({ selector: '.save', text: '保存して閉じる' });
    expect(resolveCustomTargets(saved, deps).map((t) => t.text)).toEqual(['保存して閉じる']);

    // セレクタが外れても、容器の中の文言経路で見つかる
    setBody(html);
    expect(resolveCustomTargets(rule({ text: '保存して閉じる' }), deps).map((t) => t.text)).toEqual([
      '保存して閉じる',
    ]);
  });

  it('文言だけの経路はバナー容器の中だけを探す', () => {
    setBody(`
      <main><button id="outside">拒否</button></main>
      ${BANNER}
    `);
    const { deps } = harness();
    const targets = resolveCustomTargets(rule(), deps);
    expect(targets).toHaveLength(1);
    expect((targets[0]?.el as Element).className).toBe('btn deny');
  });

  it('容器が無ければ文言だけでは押さない', () => {
    setBody('<main><button id="outside">拒否</button></main>');
    const { deps } = harness();
    expect(resolveCustomTargets(rule(), deps)).toHaveLength(0);
  });

  it('OK のような汎用文言は Cookie 固有語のある容器でだけ押す', () => {
    setBody(`
      <div id="bar" class="consent-box" style="position:fixed">
        <p>個人情報の取り扱いについて更新しました。</p>
        <button>OK</button>
        <button>あとで</button>
      </div>
    `);
    const { deps } = harness();
    expect(resolveCustomTargets(rule({ text: 'ok' }), deps)).toHaveLength(0);

    setBody(`
      <div id="bar" class="consent-box" style="position:fixed">
        <p>当サイトは Cookie を使用しています。</p>
        <button>OK</button>
        <button>あとで</button>
      </div>
    `);
    expect(resolveCustomTargets(rule({ text: 'ok' }), deps)).toHaveLength(1);
  });

  it('文言が保存されていないルールは使わない', () => {
    setBody(BANNER);
    const { deps } = harness();
    const legacy: CustomRule = { id: 'r0', host: 'example.com', action: 'reject', selector: '.deny', createdAt: 0 };
    expect(resolveCustomTargets(legacy, deps)).toHaveLength(0);
  });

  it('層としてはセレクタが別ボタンに当たっても何も押さない', async () => {
    setBody(`
      <main><p>本文</p><button id="submit-post">送信</button></main>
      <div id="notice" class="notice-bar"><p>お知らせ</p><button id="ok">OK</button></div>
    `);
    const clicked = recordClicks();
    const { deps } = harness({}, undefined, {
      customRules: [rule({ selector: '#submit-post', text: '拒否' })],
    });

    expect(await runOnce(deps)).toBeNull();
    expect(clicked).toEqual([]);
  });
});

describe('hide の範囲（H-B）', () => {
  /** ボタン行だけが最小容器になる BEM 構造 */
  const BEM_HTML = `
    <main><h1>記事</h1><p>本文です。</p></main>
    <div id="outer" class="cookie-consent" style="position:fixed" data-w="1200" data-h="160">
      <p>当サイトでは Cookie を使用しています。</p>
      <div id="actions" class="cookie-consent__actions" data-w="400" data-h="48">
        <button id="accept">Accept all cookies</button>
        <button id="settings">Cookie settings</button>
      </div>
    </div>
  `;

  it('クリック候補は最小容器で探すが、hide は最外側の容器に掛ける', async () => {
    setBody(BEM_HTML);
    const outer = document.getElementById('outer') as HTMLElement;
    const actions = document.getElementById('actions') as HTMLElement;
    const { deps } = harness({}, undefined, { env: { getRect: sizedRect } });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide' });
    // ボタン行だけを消して本文が残る、という状態にしない
    expect(outer.style.display).toBe('none');
    expect(outer.getAttribute(HIDDEN_ATTR)).toBe('');
    expect(actions.style.display).toBe('');
  });

  it('position 起点の外側容器（sticky ヘッダー）までは登らない（M-1）', async () => {
    setBody(`
      <header id="head" style="position:sticky" data-w="1200" data-h="600">
        <p>サイト名</p>
        <div id="notice" class="cookie-notice" data-w="600" data-h="120">
          <p>当サイトでは Cookie を使用しています。</p>
          <button id="agree">同意する</button>
          <button id="config">設定</button>
        </div>
      </header>
    `);
    const head = document.getElementById('head') as HTMLElement;
    const notice = document.getElementById('notice') as HTMLElement;
    const { deps } = harness({}, undefined, { env: { getRect: sizedRect } });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide' });
    // ヘッダーごと消さず、バナーだけを消す
    expect(notice.style.display).toBe('none');
    expect(head.style.display).toBe('');
    expect(head.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });

  it('ポータルルートに新しい子が追加されたら祖先の hide を解除する（バナーは隠れたまま）', async () => {
    setBody(`
      <main><h1>記事</h1><p>本文です。</p></main>
      <div id="modal-root" style="position:fixed" data-w="0" data-h="0">
        <div id="bar" class="cookie-bar" style="position:fixed" data-w="600" data-h="120">
          <p>当サイトでは Cookie を使用しています。</p>
          <button id="agree">同意する</button>
          <button id="config">設定</button>
        </div>
      </div>
    `);
    const root = document.getElementById('modal-root') as HTMLElement;
    const bar = document.getElementById('bar') as HTMLElement;
    const { deps } = harness({}, undefined, { env: { getRect: sizedRect } });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide' });
    // バックドロップとして祖先ごと消すが、容器自身も消してある
    expect(root.style.display).toBe('none');
    expect(bar.style.display).toBe('none');

    // サイトが同じポータルルートに自前のモーダルを描いた
    root.appendChild(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.style.display).toBe('');
    expect(root.hasAttribute(HIDDEN_ATTR)).toBe(false);
    // バナーは隠れたまま
    expect(bar.style.display).toBe('none');
  });

  it('hide を解除するとき、元の inline display に戻す（M-5）', async () => {
    setBody(`
      <main><h1>記事</h1><p>本文です。</p></main>
      <div id="modal-root" style="position:fixed;display:flex" data-w="0" data-h="0">
        <div id="bar" class="cookie-bar" style="position:fixed" data-w="600" data-h="120">
          <p>当サイトでは Cookie を使用しています。</p>
          <button id="agree">同意する</button>
          <button id="config">設定</button>
        </div>
      </div>
    `);
    const root = document.getElementById('modal-root') as HTMLElement;
    const { deps } = harness({}, undefined, { env: { getRect: sizedRect } });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide' });
    expect(root.style.display).toBe('none');

    // サイトが同じポータルルートに自前のモーダルを描いたら hide を解除する
    root.appendChild(document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.style.display).toBe('flex');
    expect(root.hasAttribute(HIDDEN_ATTR)).toBe(false);
  });
});

describe('候補ゼロで抜けるときの cloak（M-a）', () => {
  it('hide の見込みも無ければ cloak を外して見せる', async () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>当サイトでは Cookie を使用しています。</p>
        <button id="deny">拒否</button>
      </div>
    `);
    const bar = document.getElementById('bar') as HTMLElement;
    // accept モードには押せる候補が無く、許可ボタンも無いので hide もできない
    const { deps } = harness({}, undefined, { mode: 'accept' });

    expect(await runOnce(deps)).toBeNull();
    expect(bar.hasAttribute(CLOAK_ATTR)).toBe(false);
    expect(bar.style.display).toBe('');
  });

  it('hide できる容器なら cloak したまま抜ける（次のパスで消せる）', async () => {
    setBody(NO_REJECT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;
    const { deps } = harness({}, (now) => {
      if (now >= 500) deps.state.cancelled = true;
    });

    expect(await runOnce(deps)).toBeNull();
    expect(bar.getAttribute(CLOAK_ATTR)).toBe('');
  });

  it('accept モードでクリックが効かない容器は cloak を外して抜ける（M-2）', async () => {
    setBody(NO_REJECT_HTML);
    const bar = document.getElementById('bar') as HTMLElement;
    // 「同意する」を押しても消えないサイト。accept モードに fallback は無い
    const { deps } = harness({}, undefined, { mode: 'accept' });

    expect(await runOnce(deps)).toBeNull();
    expect(bar.hasAttribute(CLOAK_ATTR)).toBe(false);
    expect(bar.style.display).toBe('');
  });
});

describe('decision の判定（§14.6）', () => {
  it('拒否ボタンを押したら reject-all', async () => {
    setBody(BANNER_HTML);
    closeOnClick('deny', document.getElementById('bar') as HTMLElement);
    const { deps } = harness();

    expect(await runOnce(deps)).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      decision: 'reject-all',
      clickedText: '拒否',
    });
  });

  it('選択肢のないお知らせを閉じたら dismissed', async () => {
    setBody(NOTICE_ONLY_HTML);
    closeOnClick('ok', document.getElementById('bar') as HTMLElement);
    const { deps } = harness();

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', decision: 'dismissed', clickedText: 'ok' });
  });

  it('非表示にしたら hidden', async () => {
    setBody(NO_REJECT_HTML);
    const { deps } = harness();

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
  });

  it('すべて拒否（pressCloseOnNotice: false）ではお知らせを押さず hidden にする（§14.1）', async () => {
    setBody(NOTICE_ONLY_HTML);
    closeOnClick('ok', document.getElementById('bar') as HTMLElement);
    const clicked = recordClicks();
    const { deps } = harness({ pressCloseOnNotice: false });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
    expect(clicked).toEqual([]);
    expect((document.getElementById('bar') as HTMLElement).style.display).toBe('none');
  });

  it('すべて拒否 + fallback=leave では何も押さず unhandled', async () => {
    setBody(NOTICE_ONLY_HTML);
    closeOnClick('ok', document.getElementById('bar') as HTMLElement);
    const clicked = recordClicks();
    const { deps } = harness({ pressCloseOnNotice: false, fallbackWhenNoReject: 'leave' });

    expect(await runOnce(deps)).toMatchObject({ status: 'unhandled' });
    expect(clicked).toEqual([]);
    expect((document.getElementById('bar') as HTMLElement).style.display).toBe('');
  });

  it('教えたボタンを押したら custom', async () => {
    setBody(BANNER_HTML);
    closeOnClick('deny', document.getElementById('bar') as HTMLElement);
    const { deps } = harness({}, undefined, {
      customRules: [{ id: 'r1', host: 'example.com', action: 'reject', selector: '#deny', text: '拒否', createdAt: 0 }],
    });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'custom', decision: 'custom' });
  });

  it('即決 CMP 表で押したら reject-all', async () => {
    setBody(`
      <main><h1>記事</h1><p>本文です。</p></main>
      <div id="onetrust-banner-sdk">
        <p>当サイトは Cookie を使用しています。</p>
        <button id="onetrust-reject-all-handler">すべて拒否</button>
      </div>
    `);
    const banner = document.getElementById('onetrust-banner-sdk') as HTMLElement;
    closeOnClick('onetrust-reject-all-handler', banner);
    const { deps } = harness();

    expect(await runOnce(deps)).toMatchObject({
      status: 'handled',
      method: 'quick:OneTrust',
      decision: 'reject-all',
    });
  });

  it('accept モード（fixtures 用）では拒否側の decision を付けない', async () => {
    setBody(BANNER_HTML);
    closeOnClick('agree', document.getElementById('bar') as HTMLElement);
    const { deps } = harness({}, undefined, { mode: 'accept' });

    const outcome = await runOnce(deps);
    expect(outcome).toMatchObject({ status: 'handled', action: 'accept', clickedText: '同意する' });
    expect(outcome?.decision).toBeUndefined();
  });
});

describe('SSR で最初からロックされたスクロール（M-b）', () => {
  /** jsdom は scrollHeight が常に 0 なので、documentElement に直接生やす */
  function setScrollHeight(value: number): () => void {
    Object.defineProperty(document.documentElement, 'scrollHeight', { value, configurable: true });
    return () => {
      delete (document.documentElement as unknown as Record<string, unknown>)['scrollHeight'];
    };
  }

  it('スクロールすべき中身があれば、記録時から hidden でも override で解除する', async () => {
    setBody(`<style>body.no-scroll { overflow: hidden; }</style>${NO_REJECT_HTML}`);
    document.body.classList.add('no-scroll');
    const restore = setScrollHeight(5000);
    try {
      const { deps } = harness();
      expect(await runOnce(deps)).toMatchObject({ method: 'hide' });
      expect(document.body.style.overflow).toBe('auto');
      expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
      expect(document.body.hasAttribute(SCROLL_ATTR)).toBe(true);
    } finally {
      restore();
    }
  });

  it('内部スクロール設計（scrollHeight <= innerHeight）には触らない', async () => {
    setBody(`<style>body.no-scroll { overflow: hidden; }</style>${NO_REJECT_HTML}`);
    document.body.classList.add('no-scroll');
    const restore = setScrollHeight(100);
    try {
      const { deps } = harness();
      expect(await runOnce(deps)).toMatchObject({ method: 'hide' });
      expect(document.body.style.overflow).toBe('');
      expect(document.body.hasAttribute(SCROLL_ATTR)).toBe(false);
    } finally {
      restore();
    }
  });
});

describe('COM ルールの cloak（H-E）', () => {
  /** HIDE_CMP で html ごと隠そうとする実ルール（fastcmp）と同じ形 */
  function ruleHiding(selector: string): Record<string, ComRule> {
    return {
      bad: {
        detectors: [{ presentMatcher: [{ type: 'css', target: { selector: '#cmp' } }] }],
        methods: [
          { name: 'HIDE_CMP', action: { type: 'hide', target: { selector } } },
          { name: 'SAVE_CONSENT', action: { type: 'click', target: { selector: '#cmp-save' } } },
        ],
      },
    };
  }

  const CMP_HTML = `
    <main><h1>記事</h1><p>本文です。</p></main>
    <div id="cmp"><p>お知らせ</p><button id="cmp-save">保存</button></div>
  `;

  it('html は cloak しない（ルールが成功してもページを白紙にしない）', async () => {
    setBody(CMP_HTML);
    const cmp = document.getElementById('cmp') as HTMLElement;
    onClick((event) => {
      if ((event.target as Element).id === 'cmp-save') cmp.remove();
    });
    const { deps } = harness({}, undefined, { comRules: ruleHiding('html') });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'com:bad' });
    expect(document.documentElement.hasAttribute(CLOAK_ATTR)).toBe(false);
    expect(document.body.hasAttribute(CLOAK_ATTR)).toBe(false);
  });

  it('失敗したルールが cloak した要素は元に戻す', async () => {
    setBody(CMP_HTML);
    // #cmp-save を押しても何も起きない = ルールは失敗する
    const { deps } = harness({}, undefined, { comRules: ruleHiding('#cmp') });

    expect(await runOnce(deps)).toBeNull();
    expect((document.getElementById('cmp') as HTMLElement).hasAttribute(CLOAK_ATTR)).toBe(false);
  });

  it('実行できるメソッドが無いルール（UTILITY のみ）はスキップする（M3）', async () => {
    setBody(CMP_HTML);
    // onetrust_banner のように UTILITY しか持たないルール。実行しても必ず失敗して
    // 成功待ちの時間を捨てるだけなので、検出も cloak もせずに次の層へ渡す
    const comRules: Record<string, ComRule> = {
      utilityOnly: {
        detectors: [{ presentMatcher: [{ type: 'css', target: { selector: '#cmp' } }] }],
        methods: [{ name: 'UTILITY', action: { type: 'click', target: { selector: '#cmp-save' } } }],
      },
    };
    const { deps, env } = harness({}, undefined, { comRules });

    expect(await runOnce(deps)).toBeNull();
    expect(deps.state.triedComRules.size).toBe(0);
    expect((document.getElementById('cmp') as HTMLElement).hasAttribute(CLOAK_ATTR)).toBe(false);
    // 成功待ち（SUCCESS_TIMEOUT_MS）に入っていない
    expect(env.now()).toBe(0);
  });
});

describe('unhandled の理由（§5-8）', () => {
  it('断るボタンが無いだけなら no-reject', async () => {
    setBody(NO_REJECT_HTML);
    const { deps } = harness({ fallbackWhenNoReject: 'leave' });
    expect(await runOnce(deps)).toMatchObject({ status: 'unhandled', reason: 'no-reject' });
    expect(deps.state.reason).toBe('no-reject');
  });

  it('押したのに消えなかったら click-failed', async () => {
    setBody(BANNER_HTML);
    const { deps } = harness({ fallbackWhenNoReject: 'leave' });
    const clicked = recordClicks();
    expect(await runOnce(deps)).toMatchObject({ status: 'unhandled', reason: 'click-failed' });
    expect(clicked).toContain('拒否');
  });

  it('容器は見つかったが候補が集まらなければ no-candidates', async () => {
    // 即決 CMP 表が容器を見つけるがボタンは無く、ヒューリスティックも容器を採用しない
    setBody(`
      <main><h1>記事</h1><p>本文です。</p></main>
      <div id="onetrust-banner-sdk" style="position:fixed">
        <p>当サイトでは Cookie を使用しています。</p>
      </div>
    `);
    const { deps } = harness();
    expect(await runOnce(deps)).toBeNull();
    expect(deps.state.detectedAny).toBe(true);
    expect(deps.state.reason).toBe('no-candidates');
  });

  it('何も検出しなければ理由も付けない', async () => {
    setBody('<main><h1>記事</h1><p>本文です。</p></main>');
    const { deps } = harness();
    expect(await runOnce(deps)).toBeNull();
    expect(deps.state.reason).toBeNull();
  });

  it('即決 CMP 表が容器だけ見つけたときは、CMP 名と容器を要約に残す（REAL-001）', async () => {
    setBody(`
      <main><h1>記事</h1><p>本文です。</p></main>
      <div id="onetrust-banner-sdk" style="position:fixed">
        <p>当サイトでは Cookie を使用しています。</p>
      </div>
    `);
    const { deps } = harness();
    expect(await runOnce(deps)).toBeNull();
    // container:null / buttons:0 だけの要約にはしない
    expect(JSON.parse(unhandledSummary(deps.state))).toMatchObject({
      reason: 'no-candidates',
      cmp: 'OneTrust',
      container: 'DIV#onetrust-banner-sdk',
    });
  });

  it('診断には容器と候補の文言が残る（デバッグログ用）', async () => {
    setBody(NO_REJECT_HTML);
    const { deps } = harness({ fallbackWhenNoReject: 'leave' });
    await runOnce(deps);
    expect(deps.state.diagnosis).toMatchObject({
      container: 'DIV#bar.cookie-bar',
      buttons: 2,
      decisions: 1,
      labels: ['同意する', '設定'],
    });
    expect(JSON.parse(unhandledSummary(deps.state))).toMatchObject({
      reason: 'no-reject',
      container: 'DIV#bar.cookie-bar',
      labels: ['同意する', '設定'],
    });
  });
});

describe('即決 CMP 表が見つけた容器を fallback に渡す（REAL-001）', () => {
  /**
   * deepl.com の Usercentrics 型。ホストも shadow の中の入れ物も大きさが 0 なので
   * ヒューリスティックの容器条件（幅・高さの下限）には掛からないが、
   * 即決 CMP 表が「その CMP だと言い切れる」セレクタで見つけている。
   */
  function mountZeroSizeCmp(): HTMLElement {
    setBody('<main><h1>記事</h1><p>本文です。</p></main><aside id="usercentrics-cmp-ui" data-w="0" data-h="0"></aside>');
    const host = document.getElementById('usercentrics-cmp-ui') as HTMLElement;
    host.attachShadow({ mode: 'open' }).innerHTML = `
      <div id="uc-wrap" data-w="0" data-h="0">
        <p>当社は Cookie を使用して、サービスの提供と広告の表示を行います。</p>
        <button id="accept">すべて許可</button>
      </div>
    `;
    return host;
  }

  it('拒否ボタンが無くても、許可ボタンを押さずに非表示にする', async () => {
    const host = mountZeroSizeCmp();
    const clicked = recordClicks();
    const { deps } = harness({}, undefined, { env: { getRect: sizedRect } });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
    expect(clicked).toEqual([]);
    expect(host.style.display).toBe('none');
    expect(host.hasAttribute(HIDDEN_ATTR)).toBe(true);
  });

  it('fallback=leave なら何も押さず、要約に CMP 名と許可ボタンが残る', async () => {
    const host = mountZeroSizeCmp();
    const clicked = recordClicks();
    const { deps } = harness({ fallbackWhenNoReject: 'leave' }, undefined, { env: { getRect: sizedRect } });

    expect(await runOnce(deps)).toMatchObject({ status: 'unhandled', reason: 'no-reject' });
    expect(clicked).toEqual([]);
    expect(host.style.display).toBe('');
    expect(host.hasAttribute(CLOAK_ATTR)).toBe(false);
    expect(JSON.parse(unhandledSummary(deps.state))).toMatchObject({
      reason: 'no-reject',
      cmp: 'Usercentrics',
      container: 'ASIDE#usercentrics-cmp-ui',
      labels: ['すべて許可'],
    });
  });

  it('accept モードでは即決 CMP 表がそのまま許可ボタンを押す', async () => {
    const host = mountZeroSizeCmp();
    const clicked = recordClicks();
    (host.shadowRoot?.getElementById('accept') as HTMLElement).addEventListener('click', () => host.remove());
    const { deps } = harness({}, undefined, { mode: 'accept', env: { getRect: sizedRect } });

    expect(await runOnce(deps)).toMatchObject({ status: 'handled', method: 'quick:Usercentrics' });
    expect(clicked).toEqual([]); // shadow の中のクリックは document では target が付け替わる
    expect(host.isConnected).toBe(false);
  });
});

describe('操作要素は容器にしない・run レベルの固定（ROUND2-001）', () => {
  /**
   * adidas-like.html と同型（accept ボタンの id に gdpr / consent を含む）だが、
   * 即決 CMP 表の adidas エントリ（`.cookie-consent-modal`）には**一致しない**ラッパー class
   * （`.gl-cookie-consent`）にしてある。fixtures.test.ts の adidas-like 統合テストは即決表が
   * 先に効くので `method: 'quick:adidas (Glass)'` になり、`detect.ts` の `INTERACTIVE_TAGS`
   * を外しても検出できない（即決表がヒューリスティックより先に容器を cloak・クリックするため）。
   * ここでは即決表に一切当たらない状態で `runOnce` を流し、「操作要素（accept ボタン）を
   * 容器にしない」だけで兄弟の `Reject all` を押せることを run レベルで固定する。
   * accept ボタンの中の span に `cursor:pointer` を明示しているのは、実ブラウザの cursor
   * 継承（＝ span が緩い候補になり、accept ボタン自身が「決定候補を含む容器」の条件まで
   * 満たしてしまう状態）を jsdom で再現するため（detect.test.ts の ROUND2-001 と同じ手当て。
   * これが無いと INTERACTIVE_TAGS を外しても accept ボタンの中に決定候補が 1 つも無く
   * `evaluateContainer` が弾くので、そもそもバグを再現できない）。
   */
  const HTML = `
    <main><h1>記事</h1><p>本文です。</p></main>
    <div class="gl-cookie-consent" style="position:fixed">
      We use cookies and similar technologies to give you a better experience. You can accept all
      cookies or reject them.
      <button id="glass-gdpr-default-consent-accept-button" type="button">
        <span style="cursor:pointer">Accept all cookies</span>
      </button>
      <button id="glass-gdpr-default-consent-reject-button-central" type="button">
        <span>Reject all</span>
      </button>
    </div>
  `;

  /**
   * 全要素に同じ大きさ（test/helpers.ts の makeEnv の既定 600x120）を返すと面積が並んで
   * 文書順（＝外側の容器が先）で決まってしまい、「accept ボタン自身が最小の容器になる」
   * という実サイトの状況を再現できない（fixtures.test.ts の smallButtons と同じ理由）。
   */
  const smallButtons: Partial<EngineEnv> = {
    getRect: (el) => (el.tagName === 'BUTTON' ? { width: 320, height: 48 } : { width: 600, height: 300 }),
  };

  it('即決表に一致しなくても、accept ボタンを容器にせず兄弟の Reject all を押す', async () => {
    setBody(HTML);
    const wrapper = document.querySelector('.gl-cookie-consent') as Element;
    const clicked = recordClicks();
    closeOnClick('glass-gdpr-default-consent-reject-button-central', wrapper);
    const { deps } = harness({}, undefined, { env: smallButtons });

    expect(await runOnce(deps)).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedLabel: 'Reject all',
      decision: 'reject-all',
    });
    expect(clicked).toEqual(['Reject all']);
    expect(wrapper.isConnected).toBe(false);
  });
});

describe('進行ログの重複を抑える（OBS-002）', () => {
  it('同じ内容の行は監視窓につき 1 回だけ出す', async () => {
    setBody('<main><h1>記事</h1><p>本文です。</p></main>');
    const lines: string[] = [];
    const { deps } = harness({}, undefined, {
      env: { trace: (...args: unknown[]) => void lines.push(String(args[0])) },
    });

    // 監視中は 1 秒ごとに同じパスが走る
    await runOnce(deps);
    await runOnce(deps);

    expect(lines.filter((line) => line === '即決表: 一致なし')).toHaveLength(1);
    expect(lines.filter((line) => line === 'COM: 一致なし')).toHaveLength(1);
    expect(lines.filter((line) => line === 'ヒューリスティック: 容器なし')).toHaveLength(1);
    // パスの締めくくりは毎回出す（層ごとの所要時間が入る行）
    expect(lines.filter((line) => line.startsWith('パス:'))).toHaveLength(2);
  });

  it('状態が変われば文言も変わるので、その行は出る', async () => {
    setBody('<main><h1>記事</h1><p>本文です。</p></main>');
    const lines: string[] = [];
    const { deps } = harness({}, undefined, {
      env: { trace: (...args: unknown[]) => void lines.push(String(args[0])) },
    });

    await runOnce(deps);
    expect(lines).toContain('ヒューリスティック: 容器なし');

    // 遅れてバナーが現れたら、容器の行は新しく出る
    document.body.insertAdjacentHTML('beforeend', NO_REJECT_HTML);
    await runOnce(deps);
    expect(lines.some((line) => line.startsWith('容器: DIV#bar.cookie-bar'))).toBe(true);
    expect(lines).toContain('ヒューリスティック: 候補 0');
  });
});
