// テストで使う vite の ?raw インポートと、型定義を持たない jsdom の最小宣言。
// （依存を増やさないため @types/node / @types/jsdom は入れていない）

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module 'jsdom' {
  export interface JSDOMOptions {
    url?: string;
    runScripts?: 'dangerously' | 'outside-only';
  }
  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: Window & { getComputedStyle(el: Element): CSSStyleDeclaration };
  }
}
