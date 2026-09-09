import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSelector, cancelPicker, startPicker } from '../src/content/picker';
import { setBody } from './helpers';

const byId = (id: string): Element => document.getElementById(id) as Element;

beforeEach(() => {
  setBody('');
});

describe('buildSelector', () => {
  it('安定した id があれば #id を使う', () => {
    setBody('<button id="onetrust-reject-all-handler">すべて拒否</button>');
    expect(buildSelector(byId('onetrust-reject-all-handler'))).toBe('#onetrust-reject-all-handler');
  });

  it('数字が 3 桁以上続く id や数字始まりの id は使わない', () => {
    setBody('<div><button id="btn-12345" class="deny-btn">拒否</button></div>');
    expect(buildSelector(byId('btn-12345'))).toBe('button.deny-btn');
  });

  it('長すぎる id は使わない', () => {
    const id = `a${'b'.repeat(45)}`;
    setBody(`<button id="${id}" class="deny">拒否</button>`);
    expect(buildSelector(document.querySelector('button') as Element)).toBe('button.deny');
  });

  it('data-testid があれば tag[data-testid="…"] を使う', () => {
    setBody('<div><button data-testid="uc-deny-all-button" class="css-1x2y3z">Deny</button></div>');
    expect(buildSelector(document.querySelector('button') as Element)).toBe(
      'button[data-testid="uc-deny-all-button"]',
    );
  });

  it('data-hook / aria-label などにも対応する', () => {
    setBody('<button data-hook="consent-banner-decline-button">Decline</button>');
    expect(buildSelector(document.querySelector('button') as Element)).toBe(
      'button[data-hook="consent-banner-decline-button"]',
    );

    setBody('<div><button aria-label="閉じる"></button><button>他</button></div>');
    expect(buildSelector(document.querySelector('button') as Element)).toBe('button[aria-label="閉じる"]');
  });

  it('ハッシュ風クラスしか無く一意にできなければ undefined', () => {
    setBody(`
      <div class="css-9f8e7d">
        <button class="css-1a2b3c">Accept all</button>
        <button class="css-4d5e6f">Reject all</button>
      </div>
    `);
    const buttons = document.querySelectorAll('button');
    expect(buildSelector(buttons[1] as Element)).toBeUndefined();
  });

  it('数字を多く含むクラスや長いクラスは安定クラスとして使わない', () => {
    setBody('<div><button class="btn-12345">拒否</button><button>他</button></div>');
    expect(buildSelector(document.querySelector('button') as Element)).toBeUndefined();
  });

  it('tag + 安定クラスで一意になればそれを使う', () => {
    setBody('<div><button class="cky-btn cky-btn-reject">拒否</button><button class="cky-btn">設定</button></div>');
    expect(buildSelector(document.querySelector('button') as Element)).toBe('button.cky-btn.cky-btn-reject');
  });

  it('一意でなければ祖先を前置する', () => {
    setBody(`
      <div id="banner-a"><button class="deny">拒否</button></div>
      <div id="banner-b"><button class="deny">拒否</button></div>
    `);
    const target = document.querySelectorAll('#banner-b .deny')[0] as Element;
    expect(buildSelector(target)).toBe('#banner-b button.deny');
  });

  it('祖先を 3 階層前置しても一意にならなければ undefined', () => {
    setBody(`
      <div><div><div><div><button>拒否</button></div></div></div></div>
      <div><div><div><div><button>拒否</button></div></div></div></div>
    `);
    const target = document.querySelectorAll('button')[1] as Element;
    expect(buildSelector(target)).toBeUndefined();
  });
});

describe('汎用クラス（C3）', () => {
  it('btn / primary のような汎用・状態クラスだけなら祖先を前置する', () => {
    setBody('<div id="cookie-bar"><button class="btn primary">拒否</button></div>');
    expect(buildSelector(document.querySelector('button') as Element)).toBe('#cookie-bar button.btn.primary');
  });

  it('汎用クラスしか無く祖先も特定できなければ undefined', () => {
    setBody('<div><button class="btn primary active">拒否</button></div>');
    expect(buildSelector(document.querySelector('button') as Element)).toBeUndefined();
  });

  it('クラスが無い要素も祖先の前置を必須にする', () => {
    setBody('<div><button>拒否</button></div>');
    expect(buildSelector(document.querySelector('button') as Element)).toBeUndefined();

    setBody('<div id="cookie-bar"><button>拒否</button></div>');
    expect(buildSelector(document.querySelector('button') as Element)).toBe('#cookie-bar button');
  });

  it('固有のクラスが混ざっていればそのまま使う', () => {
    setBody('<div><button class="btn cky-btn-reject">拒否</button><button class="btn">設定</button></div>');
    expect(buildSelector(document.querySelector('button') as Element)).toBe('button.btn.cky-btn-reject');
  });
});

describe('picker のイベント抑止（L10）', () => {
  afterEach(() => {
    cancelPicker();
  });

  it('mousedown / pointerup もサイトに届かせない', () => {
    setBody('<div id="bar"><button id="deny">拒否</button></div>');
    const button = document.getElementById('deny') as HTMLElement;
    const siteEvents: string[] = [];
    for (const type of ['mousedown', 'pointerdown', 'mouseup', 'pointerup', 'click']) {
      button.addEventListener(type, (event) => siteEvents.push(event.type));
    }

    const picked: string[] = [];
    startPicker({ doc: document, action: 'reject', onPicked: ({ text }) => void picked.push(text) });

    for (const type of ['mousedown', 'pointerdown', 'mouseup', 'pointerup']) {
      button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
    expect(siteEvents).toEqual([]);

    button.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    expect(siteEvents).toEqual([]);
    expect(picked).toEqual(['拒否']);
  });

  it('中止したら抑止も解除する', () => {
    setBody('<div id="bar"><button id="deny">拒否</button></div>');
    const button = document.getElementById('deny') as HTMLElement;
    const siteEvents: string[] = [];
    button.addEventListener('mousedown', (event) => siteEvents.push(event.type));

    const cancelled: string[] = [];
    startPicker({
      doc: document,
      action: 'reject',
      onPicked: () => undefined,
      onCancel: () => void cancelled.push('cancel'),
    });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toEqual(['cancel']);

    button.dispatchEvent(new Event('mousedown', { bubbles: true, cancelable: true }));
    expect(siteEvents).toEqual(['mousedown']);
  });

  it('cancelPicker でも onCancel を呼ぶ', () => {
    setBody('<div id="bar"><button id="deny">拒否</button></div>');
    const cancelled: string[] = [];
    startPicker({
      doc: document,
      action: 'reject',
      onPicked: () => undefined,
      onCancel: () => void cancelled.push('cancel'),
    });
    cancelPicker();
    expect(cancelled).toEqual(['cancel']);
    expect(document.querySelector('[data-cookie-autopilot-picker]')).toBeNull();
  });

  it('危険な操作に見えるボタンは登録できない（トーストで断り picker は続く）', () => {
    setBody('<div id="bar"><button id="buy">購入する</button><button id="deny">拒否</button></div>');
    const picked: string[] = [];
    startPicker({ doc: document, action: 'reject', onPicked: ({ text }) => void picked.push(text) });

    const click = (id: string): void => {
      byId(id).dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    };

    click('buy');
    expect(picked).toEqual([]);
    const toast = document.querySelector('[data-cookie-autopilot-picker]')?.firstElementChild;
    expect(toast?.textContent).toContain('このボタンは登録できません');

    // picker は続いているので、別のボタンなら教えられる
    click('deny');
    expect(picked).toEqual(['拒否']);
    expect(document.querySelector('[data-cookie-autopilot-picker]')).toBeNull();
  });

  it('文言のないアイコンボタンは登録できない（M-f。picker は続く）', () => {
    setBody('<div id="bar"><button id="icon"><svg viewBox="0 0 8 8"></svg></button><button id="deny">拒否</button></div>');
    const picked: string[] = [];
    startPicker({ doc: document, action: 'reject', onPicked: ({ text }) => void picked.push(text) });

    const click = (id: string): void => {
      byId(id).dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    };

    click('icon');
    expect(picked).toEqual([]);
    const toast = document.querySelector('[data-cookie-autopilot-picker]')?.firstElementChild;
    expect(toast?.textContent).toContain('文言のないボタンは登録できません');

    // 文字の入ったボタンなら続けて教えられる
    click('deny');
    expect(picked).toEqual(['拒否']);
  });

  it('aria-label があるアイコンボタンは登録できる', () => {
    setBody('<div id="bar"><button id="close" aria-label="閉じる"></button></div>');
    const picked: string[] = [];
    startPicker({ doc: document, action: 'reject', onPicked: ({ text }) => void picked.push(text) });
    byId('close').dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    expect(picked).toEqual(['閉じる']);
  });

  it('SOFT 禁止語（保存して閉じる）は教えられる', () => {
    setBody('<div id="bar"><button id="save">保存して閉じる</button></div>');
    const picked: string[] = [];
    startPicker({ doc: document, action: 'accept', onPicked: ({ text }) => void picked.push(text) });
    byId('save').dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    expect(picked).toEqual(['保存して閉じる']);
  });

  it('作り直しでは前の onCancel を呼ばない', () => {
    setBody('<div id="bar"><button id="deny">拒否</button></div>');
    const cancelled: string[] = [];
    startPicker({ doc: document, action: 'reject', onPicked: () => undefined, onCancel: () => void cancelled.push('a') });
    startPicker({ doc: document, action: 'accept', onPicked: () => undefined, onCancel: () => void cancelled.push('b') });
    expect(cancelled).toEqual([]);
  });
});
