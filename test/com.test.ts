import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import comRulesRaw from '../public/rules/consent-o-matic.json?raw';
import { matchMatcher, executeAction } from '../src/engine/com/actions';
import { createComContext, detectRule, isRulePresent, parseComRules, runRule } from '../src/engine/com/engine';
import type { EngineEnv } from '../src/engine/env';
import type { CategoryKey, ComAction, ComMatcher, ComRule } from '../src/shared/types';
import { setBody, testEnv } from './helpers';

const env = testEnv();

/**
 * 許可カテゴリは既定で空（= すべて拒否）にしておく。
 * 実際の既定は 'minimal'（A を許可）だが、ここは解釈器の単体テストなので
 * 「望む状態」をテストごとに明示できるほうが読みやすい。
 */
function context(
  ruleName = 'test',
  mode: 'reject' | 'accept' = 'reject',
  allowCategories: readonly CategoryKey[] = [],
  extra: { isSubFrame?: boolean; isCancelled?: () => boolean; env?: EngineEnv } = {},
) {
  const cloaked: Element[] = [];
  const ctx = createComContext({
    doc: document,
    env: extra.env ?? env,
    mode,
    allowCategories,
    ruleName,
    isSubFrame: extra.isSubFrame === true,
    cloak: (el) => cloaked.push(el),
    ...(extra.isCancelled ? { isCancelled: extra.isCancelled } : {}),
  });
  return { ctx, cloaked };
}

/** click リスナーはテストごとに外す（document に残ると次のテストに漏れる） */
const clickListeners: EventListener[] = [];
function onClick(listener: EventListener): void {
  clickListeners.push(listener);
  document.addEventListener('click', listener, true);
}

beforeEach(() => {
  setBody('');
});

afterEach(() => {
  for (const listener of clickListeners.splice(0)) document.removeEventListener('click', listener, true);
});

describe('parseComRules', () => {
  it('detectors を持つルールだけを取り込む', () => {
    const rules = parseComRules({
      good: { detectors: [{ presentMatcher: [{ type: 'css', target: { selector: '#a' } }] }], methods: [] },
      noDetectors: { methods: [] },
      notObject: 'x',
    });
    expect(Object.keys(rules)).toEqual(['good']);
  });

  it('壊れた入力でも例外を出さない', () => {
    expect(parseComRules(null)).toEqual({});
    expect(parseComRules('nope')).toEqual({});
    expect(parseComRules([1, 2, 3])).toEqual({});
  });
});

describe('matcher', () => {
  it('css matcher は要素が見つかれば真', () => {
    setBody('<div id="banner">Cookie</div>');
    const { ctx } = context();
    expect(matchMatcher({ type: 'css', target: { selector: '#banner' } }, ctx)).toBe(true);
    expect(matchMatcher({ type: 'css', target: { selector: '#nope' } }, ctx)).toBe(false);
  });

  it('checkbox matcher は checked を返す', () => {
    setBody('<input id="on" type="checkbox" checked /><input id="off" type="checkbox" />');
    const { ctx } = context();
    expect(matchMatcher({ type: 'checkbox', target: { selector: '#on' } }, ctx)).toBe(true);
    expect(matchMatcher({ type: 'checkbox', target: { selector: '#off' } }, ctx)).toBe(false);
  });

  it('onoff matcher は on 側が見つかれば真、off 側が見つかれば偽', () => {
    // 実ルール（arteradio）と同じ形
    setBody('<div id="swichana" data-value="on"></div>');
    const { ctx } = context();
    const matcher = {
      type: 'onoff',
      onMatcher: { target: { selector: "#swichana[data-value='on']" } },
      offMatcher: { target: { selector: "#swichana[data-value='off']" } },
    };
    expect(matchMatcher(matcher, ctx)).toBe(true);
    document.getElementById('swichana')?.setAttribute('data-value', 'off');
    expect(matchMatcher(matcher, ctx)).toBe(false);
  });

  it('onoff matcher の parent は探索範囲を絞る', () => {
    // 実ルール（Autodesk）と同じ形。容器の外にある on の目印は数えない
    setBody(`
      <div class="outside"><span class="on"></span></div>
      <div class="control"><span class="off"></span></div>
    `);
    const { ctx } = context();
    const matcher = {
      type: 'onoff',
      onMatcher: { parent: { selector: '.control' }, target: { selector: '.on' } },
      offMatcher: { parent: { selector: '.control' }, target: { selector: '.off' } },
    };
    expect(matchMatcher(matcher, ctx)).toBe(false);
    document.querySelector('.control .off')?.classList.replace('off', 'on');
    expect(matchMatcher(matcher, ctx)).toBe(true);
  });

  it('onoff matcher は両方一致なら真・どちらも無ければ偽（いずれも debug ログ）', () => {
    const debug = vi.fn();
    const ctx = createComContext({
      doc: document,
      env: testEnv({ debug }),
      mode: 'reject',
      allowCategories: [],
      isSubFrame: false,
    ruleName: 'test',
      cloak: () => undefined,
    });
    const matcher = {
      type: 'onoff',
      onMatcher: { target: { selector: '.on' } },
      offMatcher: { target: { selector: '.off' } },
    };
    setBody('<span class="on"></span><span class="off"></span>');
    expect(matchMatcher(matcher, ctx)).toBe(true);
    setBody('');
    expect(matchMatcher(matcher, ctx)).toBe(false);
    expect(debug).toHaveBeenCalledTimes(2);
  });

  it('未知の matcher type は偽になり例外を出さない', () => {
    const debug = vi.fn();
    const ctx = createComContext({
      doc: document,
      env: testEnv({ debug }),
      mode: 'reject',
      allowCategories: [],
      isSubFrame: false,
    ruleName: 'test',
      cloak: () => undefined,
    });
    expect(matchMatcher({ type: 'nonexistent-matcher', target: { selector: '#x' } }, ctx)).toBe(false);
    expect(debug).toHaveBeenCalled();
  });

  it('negated の matcher は結果を反転する（onetrust_pcpanel）', () => {
    setBody('<div id="banner">Cookie</div><input id="cb" type="checkbox" checked />');
    const { ctx } = context();
    const negated = (matcher: ComMatcher): ComMatcher => ({ ...matcher, negated: true }) as ComMatcher;

    expect(matchMatcher(negated({ type: 'css', target: { selector: '#banner' } }), ctx)).toBe(false);
    expect(matchMatcher(negated({ type: 'css', target: { selector: '#nope' } }), ctx)).toBe(true);
    // 実ルール onetrust_pcpanel と同じ形（チェックが入っていたら「拒否されていない」）
    expect(matchMatcher(negated({ type: 'checkbox', target: { selector: '#cb' } }), ctx)).toBe(false);
    document.querySelector<HTMLInputElement>('#cb')?.removeAttribute('checked');
    (document.querySelector('#cb') as HTMLInputElement).checked = false;
    expect(matchMatcher(negated({ type: 'checkbox', target: { selector: '#cb' } }), ctx)).toBe(true);
  });

  it('未知の type は negated でも真にしない', () => {
    const { ctx } = context();
    expect(matchMatcher({ ...{ type: 'nonexistent', target: { selector: '#x' } }, negated: true } as ComMatcher, ctx)).toBe(
      false,
    );
  });

  it('url matcher は location.href の部分一致（文字列・配列とも）', () => {
    const { ctx } = context();
    const host = document.location.hostname;
    expect(matchMatcher({ type: 'url', url: [host] }, ctx)).toBe(true);
    expect(matchMatcher({ type: 'url', url: host }, ctx)).toBe(true);
    expect(matchMatcher({ type: 'url', url: ['nope.example.invalid', host] }, ctx)).toBe(true);
    expect(matchMatcher({ type: 'url', url: ['nope.example.invalid'] }, ctx)).toBe(false);
    expect(matchMatcher({ type: 'url', url: [] }, ctx)).toBe(false);
    expect(matchMatcher({ type: 'url', url: [''] }, ctx)).toBe(false);
  });

  it('iframeFilter は「今のフレームが iframe か」を見る', () => {
    setBody('<div id="banner">Cookie</div>');
    const top = context('test', 'reject', [], { isSubFrame: false });
    const sub = context('test', 'reject', [], { isSubFrame: true });
    const inFrame: ComMatcher = { type: 'css', target: { selector: '#banner', iframeFilter: true } };
    const inTop: ComMatcher = { type: 'css', target: { selector: '#banner', iframeFilter: false } };

    expect(matchMatcher(inFrame, top.ctx)).toBe(false);
    expect(matchMatcher(inFrame, sub.ctx)).toBe(true);
    expect(matchMatcher(inTop, top.ctx)).toBe(true);
    expect(matchMatcher(inTop, sub.ctx)).toBe(false);
  });

  it('textFilter / displayFilter / parent が効く', () => {
    setBody(`
      <div id="wrap">
        <button class="btn">Manage cookies</button>
        <button class="btn">Accept all</button>
        <button class="btn" style="display:none">Reject all</button>
      </div>
      <button class="btn">Accept all</button>
    `);
    const { ctx } = context();
    expect(
      matchMatcher({ type: 'css', target: { selector: '.btn', textFilter: 'manage cookies' } }, ctx),
    ).toBe(true);
    expect(matchMatcher({ type: 'css', target: { selector: '.btn', textFilter: ['nope'] } }, ctx)).toBe(false);
    // displayFilter: true は可視のみ
    expect(
      matchMatcher({ type: 'css', target: { selector: '.btn', textFilter: 'reject', displayFilter: true } }, ctx),
    ).toBe(false);
    expect(
      matchMatcher({ type: 'css', target: { selector: '.btn', textFilter: 'reject', displayFilter: false } }, ctx),
    ).toBe(true);
    // parent の中だけを探す
    expect(
      matchMatcher(
        { type: 'css', parent: { selector: '#wrap' }, target: { selector: '.btn', textFilter: 'manage' } },
        ctx,
      ),
    ).toBe(true);
  });

  it('childFilter と childFilterNegate が効く', () => {
    setBody(`
      <ul>
        <li id="withInput"><input type="checkbox" /><span>統計</span></li>
        <li id="withoutInput"><span>必須</span></li>
      </ul>
    `);
    const { ctx } = context();
    const withChild = { type: 'css', target: { selector: 'li', childFilter: { target: { selector: ':scope > input' } } } };
    const withoutChild = {
      type: 'css',
      target: { selector: 'li', childFilter: { target: { selector: ':scope > input' } }, childFilterNegate: true },
    };
    expect(matchMatcher(withChild, ctx)).toBe(true);
    expect(matchMatcher(withoutChild, ctx)).toBe(true);
    // 実際に選ばれる要素が違うことを click で確認する
    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).id));
    void executeAction({ ...withChild, type: 'click' }, ctx);
    void executeAction({ ...withoutChild, type: 'click' }, ctx);
    expect(clicked).toEqual(['withInput', 'withoutInput']);
  });
});

describe('アクション', () => {
  it('click / list を順に実行する', async () => {
    setBody('<button id="a">A</button><button id="b">B</button>');
    const { ctx } = context();
    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).id));
    await executeAction(
      {
        type: 'list',
        actions: [
          { type: 'click', target: { selector: '#a' } },
          { type: 'click', target: { selector: '#b' } },
        ],
      },
      ctx,
    );
    expect(clicked).toEqual(['a', 'b']);
  });

  it('multiclick は見つかったものすべてを押す', async () => {
    setBody('<button class="c">1</button><button class="c">2</button><button class="c">3</button>');
    const { ctx } = context();
    let count = 0;
    onClick(() => count++);
    await executeAction({ type: 'multiclick', target: { selector: '.c' } }, ctx);
    expect(count).toBe(3);
  });

  it('consent（checkbox + toggleAction）: 望む状態と違うときだけトグルする', async () => {
    setBody(`
      <input id="stats" type="checkbox" checked />
      <input id="prefs" type="checkbox" />
    `);
    const { ctx } = context();
    const stats = document.getElementById('stats') as HTMLInputElement;
    const prefs = document.getElementById('prefs') as HTMLInputElement;
    await executeAction(
      {
        type: 'consent',
        consents: [
          {
            type: 'B',
            matcher: { type: 'checkbox', target: { selector: '#stats' } },
            toggleAction: { type: 'click', target: { selector: '#stats' } },
          },
          {
            type: 'A',
            matcher: { type: 'checkbox', target: { selector: '#prefs' } },
            toggleAction: { type: 'click', target: { selector: '#prefs' } },
          },
        ],
      },
      ctx,
    );
    // reject モードなので両方 false にしたい。checked だった stats だけトグルされる
    expect(stats.checked).toBe(false);
    expect(prefs.checked).toBe(false);
  });

  it('consent: 許可カテゴリは true にする', async () => {
    setBody('<input id="stats" type="checkbox" />');
    const { ctx } = context('test', 'reject', ['B']);
    await executeAction(
      {
        type: 'consent',
        consents: [
          {
            type: 'B',
            matcher: { type: 'checkbox', target: { selector: '#stats' } },
            toggleAction: { type: 'click', target: { selector: '#stats' } },
          },
        ],
      },
      ctx,
    );
    expect((document.getElementById('stats') as HTMLInputElement).checked).toBe(true);
  });

  it('consent（trueAction / falseAction）: matcher が既に一致していればスキップする', async () => {
    setBody('<div id="marker"></div><button id="off">off</button><button id="on">on</button>');
    const { ctx } = context();
    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).id));
    await executeAction(
      {
        type: 'consent',
        consents: [
          {
            type: 'F',
            matcher: { type: 'css', target: { selector: '#marker' } },
            trueAction: { type: 'click', target: { selector: '#on' } },
            falseAction: { type: 'click', target: { selector: '#off' } },
          },
        ],
      },
      ctx,
    );
    // reject（望む状態 false）で matcher が真 → falseAction が動く
    expect(clicked).toEqual(['off']);
  });

  it('ifcss は trueAction / falseAction を切り替える', async () => {
    setBody('<div id="exists"></div><button id="yes">yes</button><button id="no">no</button>');
    const { ctx } = context();
    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).id));
    await executeAction(
      {
        type: 'ifcss',
        target: { selector: '#exists' },
        trueAction: { type: 'click', target: { selector: '#yes' } },
        falseAction: { type: 'click', target: { selector: '#no' } },
      },
      ctx,
    );
    await executeAction(
      {
        type: 'ifcss',
        target: { selector: '#missing' },
        trueAction: { type: 'click', target: { selector: '#yes' } },
        falseAction: { type: 'click', target: { selector: '#no' } },
      },
      ctx,
    );
    expect(clicked).toEqual(['yes', 'no']);
  });

  it('waitcss は要素が現れるまで待ち、negated では消えるまで待つ', async () => {
    setBody('<div id="later-host"></div>');
    const { ctx } = context();
    let waits = 0;
    const slowEnv = testEnv({
      sleep: async () => {
        waits++;
        if (waits === 2) {
          const el = document.createElement('div');
          el.id = 'later';
          document.body.appendChild(el);
        }
      },
    });
    const slowCtx = { ...ctx, env: slowEnv };
    await executeAction({ type: 'waitcss', target: { selector: '#later' }, retries: 5, waitTime: 1 }, slowCtx);
    expect(document.getElementById('later')).not.toBeNull();
    expect(waits).toBe(2);

    // negated: 既に無いものはすぐ返る
    await executeAction({ type: 'waitcss', target: { selector: '#gone' }, negated: true, retries: 5 }, slowCtx);
    expect(waits).toBe(2);
  });

  it('waitcss はルールの制限時間を超えたら打ち切る（cdiscountopen の retries 100）', async () => {
    const clock = testEnv();
    const { ctx } = context('cdiscountopen', 'reject', [], { env: clock });
    // retries 100 × 250ms = 25 秒。ルールの制限時間（15 秒）で止まる
    await executeAction({ type: 'waitcss', target: { selector: '#never' }, retries: 100, waitTime: 250 }, ctx);
    expect(clock.now()).toBeGreaterThanOrEqual(10000);
    expect(clock.now()).toBeLessThan(25000);
    expect(clock.now()).toBeLessThanOrEqual(ctx.deadline);
  });

  it('打ち切り要求が立つと waitcss もアクションも動かない', async () => {
    setBody('<button id="btn">Accept</button>');
    let cancelled = false;
    const clock = testEnv();
    const { ctx } = context('test', 'reject', [], { env: clock, isCancelled: () => cancelled });

    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).id));

    cancelled = true;
    await executeAction({ type: 'waitcss', target: { selector: '#never' }, retries: 100, waitTime: 250 }, ctx);
    await executeAction({ type: 'click', target: { selector: '#btn' } }, ctx);
    expect(clock.now()).toBe(0);
    expect(clicked).toEqual([]);

    cancelled = false;
    await executeAction({ type: 'click', target: { selector: '#btn' } }, ctx);
    expect(clicked).toEqual(['btn']);
  });

  it('foreach は base を差し替えて子要素ごとに実行する', async () => {
    setBody(`
      <div class="row"><input type="checkbox" checked /></div>
      <div class="row"><input type="checkbox" checked /></div>
    `);
    const { ctx } = context();
    await executeAction(
      {
        type: 'foreach',
        target: { selector: '.row' },
        action: {
          type: 'consent',
          consents: [
            {
              type: 'X',
              matcher: { type: 'checkbox', target: { selector: 'input' } },
              toggleAction: { type: 'click', target: { selector: 'input' } },
            },
          ],
        },
      },
      ctx,
    );
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
    expect(boxes.map((box) => box.checked)).toEqual([false, false]);
  });

  it('hide は cloak を呼ぶ（display:none にはしない）', async () => {
    setBody('<div id="banner">Cookie</div>');
    const { ctx, cloaked } = context();
    await executeAction({ type: 'hide', target: { selector: '#banner' } }, ctx);
    expect(cloaked.map((el) => el.id)).toEqual(['banner']);
    expect((document.getElementById('banner') as HTMLElement).style.display).toBe('');
  });

  it('ifallowall は全カテゴリ許可のときだけ trueAction', async () => {
    setBody('<button id="all">all</button><button id="some">some</button>');
    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).id));
    const action = {
      type: 'ifallowall',
      trueAction: { type: 'click', target: { selector: '#all' } },
      falseAction: { type: 'click', target: { selector: '#some' } },
    };
    await executeAction(action, context('test', 'reject').ctx);
    await executeAction(action, context('test', 'accept').ctx);
    expect(clicked).toEqual(['some', 'all']);
  });

  it('ifallownone は全カテゴリ不許可のときだけ trueAction', async () => {
    setBody('<button id="none">none</button><button id="some">some</button>');
    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).id));
    const action = {
      type: 'ifallownone',
      trueAction: { type: 'click', target: { selector: '#none' } },
      falseAction: { type: 'click', target: { selector: '#some' } },
    };
    // reject モードで許可カテゴリが空 = 何も許可しない
    await executeAction(action, context('test', 'reject').ctx);
    // 1 つでも許可していれば falseAction
    await executeAction(action, context('test', 'reject', ['B']).ctx);
    // accept モードは全許可なので falseAction
    await executeAction(action, context('test', 'accept').ctx);
    expect(clicked).toEqual(['none', 'some', 'some']);
  });

  it('consent の matcher が onoff でも toggleAction が発火する', async () => {
    setBody(`
      <div id="stats" class="on"></div>
      <div id="prefs" class="off"></div>
      <button id="stats-toggle">stats</button>
      <button id="prefs-toggle">prefs</button>
    `);
    const { ctx } = context();
    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).id));
    const consentOf = (name: string) => ({
      type: 'B',
      matcher: {
        type: 'onoff',
        onMatcher: { target: { selector: `#${name}.on` } },
        offMatcher: { target: { selector: `#${name}.off` } },
      },
      toggleAction: { type: 'click', target: { selector: `#${name}-toggle` } },
    });
    await executeAction({ type: 'consent', consents: [consentOf('stats'), consentOf('prefs')] }, ctx);
    // reject モードなので両方 off にしたい。on だった stats だけトグルされる
    expect(clicked).toEqual(['stats-toggle']);
  });

  it('consent の matcher が onoff のとき trueAction / falseAction が正しく選ばれる', async () => {
    // 実ルール（arteradio）と同じ形
    setBody(`
      <div id="swichana" data-value="on"></div>
      <button id="swichana_railon">on</button>
      <button id="swichana_railoff">off</button>
    `);
    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).id));
    const consent = {
      type: 'B',
      matcher: {
        type: 'onoff',
        onMatcher: { target: { selector: "#swichana[data-value='on']" } },
        offMatcher: { target: { selector: "#swichana[data-value='off']" } },
      },
      trueAction: { type: 'click', target: { selector: '#swichana_railon' } },
      falseAction: { type: 'click', target: { selector: '#swichana_railoff' } },
    };
    const run = (mode: 'reject' | 'accept') =>
      executeAction({ type: 'consent', consents: [consent] }, context('arteradio-like', mode).ctx);

    // reject（望む状態 false）で現在 on → falseAction
    await run('reject');
    expect(clicked).toEqual(['swichana_railoff']);
    // accept（望む状態 true）で現在 on → 既に一致しているのでスキップ
    await run('accept');
    expect(clicked).toEqual(['swichana_railoff']);
    // off にすると accept で trueAction
    document.getElementById('swichana')?.setAttribute('data-value', 'off');
    await run('accept');
    expect(clicked).toEqual(['swichana_railoff', 'swichana_railon']);
  });

  it('runrooted は探索ルートを差し替える', async () => {
    setBody(`
      <div id="outside"><button class="btn">outside</button></div>
      <div id="root"><button class="btn">inside</button></div>
    `);
    const { ctx } = context();
    const clicked: string[] = [];
    onClick((event) => clicked.push((event.target as Element).textContent ?? ''));
    await executeAction(
      {
        type: 'runrooted',
        target: { selector: '#root' },
        action: { type: 'click', target: { selector: '.btn' } },
      },
      ctx,
    );
    expect(clicked).toEqual(['inside']);
  });

  it('wait は指定時間待つ', async () => {
    let slept = 0;
    const ctx = createComContext({
      doc: document,
      env: testEnv({ sleep: async (ms) => void (slept += ms) }),
      mode: 'reject',
      allowCategories: [],
      isSubFrame: false,
    ruleName: 'test',
      cloak: () => undefined,
    });
    await executeAction({ type: 'wait', waitTime: 500 }, ctx);
    expect(slept).toBe(500);
  });

  it('未知 / no-op のアクションは例外を出さない', async () => {
    const debug = vi.fn();
    const ctx = createComContext({
      doc: document,
      env: testEnv({ debug }),
      mode: 'reject',
      allowCategories: [],
      isSubFrame: false,
    ruleName: 'test',
      cloak: () => undefined,
    });
    await expect(executeAction({ type: 'slide', target: { selector: '#a' } }, ctx)).resolves.toBeUndefined();
    await expect(executeAction({ type: 'close' }, ctx)).resolves.toBeUndefined();
    await expect(executeAction({ type: 'nonexistent-action' }, ctx)).resolves.toBeUndefined();
    await expect(executeAction(undefined, ctx)).resolves.toBeUndefined();
    expect(debug).toHaveBeenCalledTimes(3);
  });

  it('不正なセレクタでも例外を出さない', async () => {
    const { ctx } = context();
    await expect(executeAction({ type: 'click', target: { selector: '>>>bad' } }, ctx)).resolves.toBeUndefined();
  });
});

describe('検出とルール実行', () => {
  const rule: ComRule = {
    detectors: [
      {
        presentMatcher: [{ type: 'css', target: { selector: '#dialog' } }],
        showingMatcher: [{ type: 'css', target: { selector: '#dialog', displayFilter: true } }],
      },
    ],
    methods: [
      { name: 'OPEN_OPTIONS', action: { type: 'click', target: { selector: '#customize' } } },
      {
        name: 'DO_CONSENT',
        action: {
          type: 'consent',
          consents: [
            {
              type: 'B',
              matcher: { type: 'checkbox', target: { selector: '#stats' } },
              toggleAction: { type: 'click', target: { selector: '#stats' } },
            },
          ],
        },
      },
      { name: 'SAVE_CONSENT', action: { type: 'click', target: { selector: '#save' } } },
    ],
  };

  const html = `
    <div id="dialog">
      <p>Cookie を使用します</p>
      <button id="customize">詳細</button>
      <input id="stats" type="checkbox" checked />
      <button id="save">保存</button>
    </div>
  `;

  it('present と showing の両方が真なら検出する', () => {
    setBody(html);
    const { ctx } = context('cookiebot-like');
    expect(isRulePresent(rule, ctx)).toBe(true);
    expect(detectRule(rule, ctx)).toBe(true);

    setBody('<div id="dialog" style="display:none"></div>');
    expect(isRulePresent(rule, context().ctx)).toBe(true);
    expect(detectRule(rule, context().ctx)).toBe(false);
  });

  it('showingMatcher 省略時は present と同義', () => {
    setBody('<div id="dialog" style="display:none"></div>');
    const onlyPresent: ComRule = { detectors: [{ presentMatcher: [{ type: 'css', target: { selector: '#dialog' } }] }] };
    expect(detectRule(onlyPresent, context().ctx)).toBe(true);
  });

  it('OPEN_OPTIONS → DO_CONSENT → SAVE_CONSENT の順に実行して成功を判定する', async () => {
    setBody(html);
    const order: string[] = [];
    onClick((event) => {
      const el = event.target as HTMLElement;
      order.push(el.id);
      if (el.id === 'save') document.getElementById('dialog')?.remove();
    });

    const cloaked: Element[] = [];
    const result = await runRule(rule, {
      doc: document,
      env,
      mode: 'reject',
      allowCategories: [],
      isSubFrame: false,
    ruleName: 'cookiebot-like',
      cloak: (el) => cloaked.push(el),
    });

    expect(order).toEqual(['customize', 'stats', 'save']);
    expect(result.ok).toBe(true);
    // consent を通ったので granular。allowed は空（すべて拒否）
    expect(result).toMatchObject({ decision: 'granular', allowed: [] });
    // HIDE_CMP が無いので present 要素が cloak される
    expect(cloaked.map((el) => el.id)).toContain('dialog');
  });

  it('許可カテゴリがあれば granular の allowed に載る（§14.6）', async () => {
    setBody(html);
    const order: string[] = [];
    onClick((event) => {
      const el = event.target as HTMLElement;
      order.push(el.id);
      if (el.id === 'save') document.getElementById('dialog')?.remove();
    });

    const result = await runRule(rule, {
      doc: document,
      env,
      mode: 'reject',
      allowCategories: ['A', 'B', 'E'],
      isSubFrame: false,
      ruleName: 'cookiebot-like',
      cloak: () => undefined,
    });

    expect(result).toMatchObject({ ok: true, decision: 'granular', allowed: ['A', 'B', 'E'] });
    // B は許可なので、既に checked のチェックボックスはトグルしない
    expect(order).toEqual(['customize', 'save']);
  });

  describe('consent を通らないルールの decision（H2: 押したボタンの文言で分類する）', () => {
    /** 決定ボタンが 1 つだけのバナー（押すと閉じる） */
    const clickOnlyHtml = `
      <div id="dialog">
        <p>Cookie を使用します</p>
        <button id="target"></button>
      </div>
    `;

    /** #target を押すだけのルール */
    const clickOnly: ComRule = {
      detectors: rule.detectors,
      methods: [{ name: 'SAVE_CONSENT', action: { type: 'click', target: { selector: '#target' } } }],
    };

    async function runWithButton(label: string) {
      setBody(clickOnlyHtml);
      (document.getElementById('target') as HTMLElement).textContent = label;
      onClick((event) => {
        if ((event.target as HTMLElement).id === 'target') document.getElementById('dialog')?.remove();
      });
      return runRule(clickOnly, {
        doc: document,
        env,
        mode: 'reject',
        allowCategories: ['A'],
        isSubFrame: false,
        ruleName: 'click-only',
        cloak: () => undefined,
      });
    }

    it('拒否ボタンを押しただけなら reject-all', async () => {
      const result = await runWithButton('すべて拒否');
      expect(result).toMatchObject({
        ok: true,
        decision: 'reject-all',
        clickedText: 'すべて拒否',
        clickedLabel: 'すべて拒否',
      });
      expect(result.allowed).toBeUndefined();
    });

    it('必要最小系のボタンでも reject-all', async () => {
      expect(await runWithButton('Necessary cookies only')).toMatchObject({
        ok: true,
        decision: 'reject-all',
        clickedLabel: 'Necessary cookies only',
      });
    });

    it('許可ボタンを押した場合は decision を付けない', async () => {
      const result = await runWithButton('Accept all cookies');
      expect(result).toMatchObject({ ok: true, clickedLabel: 'Accept all cookies' });
      expect(result.decision).toBeUndefined();
    });

    it('閉じる語なら dismissed', async () => {
      expect(await runWithButton('Got it!')).toMatchObject({
        ok: true,
        decision: 'dismissed',
        clickedLabel: 'Got it!',
      });
    });

    it('分類できない文言では decision を付けない', async () => {
      const result = await runWithButton('保存');
      expect(result).toMatchObject({ ok: true, clickedText: '保存', clickedLabel: '保存' });
      expect(result.decision).toBeUndefined();
      expect(result.allowed).toBeUndefined();
    });
  });

  it('consent の matcher が何にも当たらなければ granular にしない（M1）', async () => {
    // #stats が無いので consent エントリを通っても「カテゴリごとに選んだ」ことにはならない
    setBody(`
      <div id="dialog">
        <p>Cookie を使用します</p>
        <button id="customize">詳細</button>
        <button id="save">すべて拒否</button>
      </div>
    `);
    onClick((event) => {
      if ((event.target as HTMLElement).id === 'save') document.getElementById('dialog')?.remove();
    });

    const result = await runRule(rule, {
      doc: document,
      env,
      mode: 'reject',
      allowCategories: [],
      isSubFrame: false,
      ruleName: 'cookiebot-like',
      cloak: () => undefined,
    });

    expect(result).toMatchObject({ ok: true, decision: 'reject-all' });
    expect(result.allowed).toBeUndefined();
  });

  it('showing が消えなければ失敗を返す', async () => {
    setBody(html);
    const result = await runRule(rule, {
      doc: document,
      env: testEnv({ now: (() => { let t = 0; return () => (t += 1000); })() }),
      mode: 'reject',
      allowCategories: [],
      isSubFrame: false,
    ruleName: 'cookiebot-like',
      cloak: () => undefined,
    });
    expect(result.ok).toBe(false);
  });

  it('存在しないメソッドはスキップする', async () => {
    setBody('<div id="dialog">Cookie</div>');
    const bare: ComRule = { detectors: rule.detectors, methods: [] };
    await expect(
      runRule(bare, {
        doc: document,
        env: testEnv({ now: (() => { let t = 0; return () => (t += 1000); })() }),
        mode: 'reject',
        allowCategories: [],
        isSubFrame: false,
    ruleName: 'bare',
        cloak: () => undefined,
      }),
    ).resolves.toEqual({ ok: false });
  });
});

describe('同梱の実ルール', () => {
  const realRules = parseComRules((JSON.parse(comRulesRaw) as { rules: unknown }).rules);

  /** ルールツリーから type が一致するノードを集める */
  function collect(node: unknown, type: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (Array.isArray(node)) {
      for (const child of node) collect(child, type, out);
      return out;
    }
    if (!node || typeof node !== 'object') return out;
    const record = node as Record<string, unknown>;
    if (record['type'] === type) out.push(record);
    for (const value of Object.values(record)) collect(value, type, out);
    return out;
  }

  it('onoff matcher は実ルールのすべての箇所を例外なく判定できる', () => {
    // 取得時点では 66 箇所 / 12 ルール。いずれも { type, onMatcher, offMatcher } の形
    const matchers = collect(realRules, 'onoff') as ComMatcher[];
    expect(matchers.length).toBeGreaterThan(0);
    for (const matcher of matchers) {
      expect(matcher.onMatcher?.target?.selector).toBeTypeOf('string');
      expect(matcher.offMatcher?.target?.selector).toBeTypeOf('string');
    }

    const debug = vi.fn();
    const ctx = createComContext({
      doc: document,
      env: testEnv({ debug }),
      mode: 'reject',
      allowCategories: [],
      isSubFrame: false,
    ruleName: 'real',
      cloak: () => undefined,
    });
    // 空の DOM では on も off も見つからないので、すべて偽 + debug ログ
    for (const matcher of matchers) expect(matchMatcher(matcher, ctx)).toBe(false);
    expect(debug).toHaveBeenCalledTimes(matchers.length);
  });

  it('ifallownone は実ルールに含まれ、実行しても例外を出さない', async () => {
    // 取得時点では 10 箇所 / 7 ルール
    const actions = collect(realRules, 'ifallownone') as ComAction[];
    expect(actions.length).toBeGreaterThan(0);
    const { ctx } = context('real');
    for (const action of actions) {
      await expect(executeAction(action, ctx)).resolves.toBeUndefined();
    }
  });
});
