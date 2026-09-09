// 退場判定（docs/SPEC.md §5-6）の単体テスト。
//
// jsdom はレイアウトしないので getBoundingClientRect を差し替える。
// また `<style disabled>` を getComputedStyle に反映しないため、cloak を除いて読む挙動
// （withoutCloak）は、実ブラウザの cascade を模した getComputedStyle で確かめる。

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOAK_ATTR, findStyleElement, injectCloakStyle, removeCloakStyle } from '../src/engine/cloak';
import { defaultIsFaded, defaultIsOffscreen } from '../src/engine/env';

const restores: (() => void)[] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.removeProperty('opacity');
  document.body.style.removeProperty('visibility');
});

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  removeCloakStyle(document);
});

/**
 * 実ブラウザのように、cloak の style が有効な間だけ cloak 属性を opacity:0 に見せる。
 * jsdom は `style.disabled` を無視して常にルールを適用してしまうので、
 * cloak 属性を持つ要素の opacity だけはこちらで組み立てる。
 */
function emulateCloakCascade(): void {
  const original = window.getComputedStyle.bind(window);
  const style = findStyleElement(document);
  window.getComputedStyle = ((el: Element) => {
    const real = original(el);
    if (!el.hasAttribute(CLOAK_ATTR)) return real;
    const cloakActive = style !== null && !style.disabled;
    const inline = (el as HTMLElement).style;
    return {
      opacity: cloakActive ? '0' : inline.opacity || '1',
      visibility: real.visibility,
    } as CSSStyleDeclaration;
  }) as typeof window.getComputedStyle;
  restores.push(() => {
    window.getComputedStyle = original as typeof window.getComputedStyle;
  });
}

function setRect(el: Element, rect: Partial<DOMRect>): void {
  const value = {
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
  (el as HTMLElement).getBoundingClientRect = () => value;
}

describe('defaultIsFaded', () => {
  it('自分が opacity:0 / visibility:hidden なら真', () => {
    document.body.innerHTML = `
      <div id="fade" style="opacity:0"></div>
      <div id="hide" style="visibility:hidden"></div>
      <div id="plain"></div>
    `;
    expect(defaultIsFaded(document.getElementById('fade') as Element)).toBe(true);
    expect(defaultIsFaded(document.getElementById('hide') as Element)).toBe(true);
    expect(defaultIsFaded(document.getElementById('plain') as Element)).toBe(false);
  });

  it('祖先が opacity:0 でも真（親をフェードさせて退場するバナー。H-C）', () => {
    document.body.innerHTML = `
      <div id="wrap" style="opacity:0">
        <div id="dialog"><button id="deny">拒否</button></div>
      </div>
    `;
    expect(defaultIsFaded(document.getElementById('dialog') as Element)).toBe(true);
    expect(defaultIsFaded(document.getElementById('deny') as Element)).toBe(true);
  });

  it('祖先が visibility:hidden なら真（継承された computed で判定する）', () => {
    document.body.innerHTML = '<div id="wrap" style="visibility:hidden"><div id="dialog"></div></div>';
    expect(defaultIsFaded(document.getElementById('dialog') as Element)).toBe(true);
  });

  it('祖先が visibility:hidden でも自分が visible なら偽（M-4）', () => {
    document.body.innerHTML = `
      <div id="wrap" style="visibility:hidden">
        <div id="banner" style="visibility:visible"><button id="deny">拒否</button></div>
      </div>
    `;
    expect(defaultIsFaded(document.getElementById('banner') as Element)).toBe(false);
    expect(defaultIsFaded(document.getElementById('deny') as Element)).toBe(false);
  });

  it('body 自身の指定は見ない（サイト全体のフェードを退場と誤認しない）', () => {
    document.body.innerHTML = '<div id="bar"></div>';
    document.body.style.opacity = '0';
    expect(defaultIsFaded(document.getElementById('bar') as Element)).toBe(false);
  });

  it('自前の cloak による opacity:0 は退場とみなさない', () => {
    document.body.innerHTML = '<div id="bar"></div>';
    injectCloakStyle(document, []);
    const bar = document.getElementById('bar') as Element;
    bar.setAttribute(CLOAK_ATTR, '');
    emulateCloakCascade();

    expect(defaultIsFaded(bar)).toBe(false);
    // 読み取りの間だけ無効化して同期のうちに戻すので、判定後も cloak は効いたまま
    expect(findStyleElement(document)?.disabled).toBe(false);
    expect(window.getComputedStyle(bar).opacity).toBe('0');
  });

  it('cloak 中でもサイト側の opacity:0 は退場とみなす', () => {
    document.body.innerHTML = '<div id="bar" style="opacity:0"></div>';
    injectCloakStyle(document, []);
    const bar = document.getElementById('bar') as Element;
    bar.setAttribute(CLOAK_ATTR, '');
    emulateCloakCascade();

    expect(defaultIsFaded(bar)).toBe(true);
  });
});

describe('defaultIsOffscreen', () => {
  it('viewport の中なら偽', () => {
    document.body.innerHTML = '<div id="bar"></div>';
    const bar = document.getElementById('bar') as Element;
    setRect(bar, { top: 600, bottom: 720, left: 0, right: 1024, width: 1024, height: 120 });
    expect(defaultIsOffscreen(bar)).toBe(false);
  });

  it('上下左右いずれかに出ていれば真（transform で退場するバナー）', () => {
    document.body.innerHTML = '<div id="bar"></div>';
    const bar = document.getElementById('bar') as Element;
    const height = window.innerHeight;
    const width = window.innerWidth;
    const cases: Partial<DOMRect>[] = [
      { top: -200, bottom: -80, left: 0, right: width, width, height: 120 },
      { top: height, bottom: height + 120, left: 0, right: width, width, height: 120 },
      { top: 0, bottom: 120, left: -400, right: 0, width: 400, height: 120 },
      { top: 0, bottom: 120, left: width, right: width + 400, width: 400, height: 120 },
    ];
    for (const rect of cases) {
      setRect(bar, rect);
      expect(defaultIsOffscreen(bar), JSON.stringify(rect)).toBe(true);
    }
  });

  it('大きさゼロは isVisible の担当なので偽', () => {
    document.body.innerHTML = '<div id="bar"></div>';
    const bar = document.getElementById('bar') as Element;
    setRect(bar, { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
    expect(defaultIsOffscreen(bar)).toBe(false);
  });
});
