import { describe, expect, it } from 'vitest';
import { elementLabel, elementText, normalize } from '../src/engine/normalize';
import { setBody } from './helpers';

describe('normalize', () => {
  it('全角英数を半角にする', () => {
    expect(normalize('ＡＣＣＥＰＴ')).toBe('accept');
    expect(normalize('ＯＫ１２３')).toBe('ok123');
  });

  it('小文字化する', () => {
    expect(normalize('Reject All')).toBe('rejectall');
  });

  it('空白（全角スペース・改行・タブを含む）を除去する', () => {
    expect(normalize('  すべて 許可　 ')).toBe('すべて許可');
    expect(normalize('accept\n\tall')).toBe('acceptall');
  });

  it('句読点を除去する', () => {
    expect(normalize('同意する。')).toBe('同意する');
    expect(normalize('はい！')).toBe('はい');
    expect(normalize('ＯＫ！')).toBe('ok');
    expect(normalize('yes, please.')).toBe('yesplease');
    expect(normalize('拒否、しない')).toBe('拒否しない');
  });

  it('アポストロフィ・引用符を除去する（英語の否定形が語彙に一致するように）', () => {
    expect(normalize('Don’t accept')).toBe('dontaccept');
    expect(normalize("Don't accept")).toBe('dontaccept');
    expect(normalize('Don‘t allow')).toBe('dontallow');
    expect(normalize('“Accept”')).toBe('accept');
    expect(normalize('"Reject all"')).toBe('rejectall');
  });

  it('ハイフン・ダッシュを除去する', () => {
    expect(normalize('opt-out')).toBe('optout');
    expect(normalize('Reject non‐essential')).toBe('rejectnonessential');
    expect(normalize('Reject – all')).toBe('rejectall');
    expect(normalize('Reject — all')).toBe('rejectall');
  });

  it('& や + を除去する（"Accept & Close" を 1 語として扱う）', () => {
    expect(normalize('Accept & Close')).toBe('acceptclose');
    expect(normalize('Accept ＆ Close')).toBe('acceptclose');
    expect(normalize('Agree + continue')).toBe('agreecontinue');
  });

  it('括弧・中黒を除去する', () => {
    expect(normalize('Reject all (recommended)')).toBe('rejectallrecommended');
    expect(normalize('拒否（推奨）')).toBe('拒否推奨');
    expect(normalize('Cookie settings [beta]')).toBe('cookiesettingsbeta');
    expect(normalize('【重要】Cookie の設定')).toBe('重要cookieの設定');
    expect(normalize('同意・許可')).toBe('同意許可');
  });

  it('疑問符・コロン・三点リーダ・矢印を除去する', () => {
    expect(normalize('Why?')).toBe('why');
    expect(normalize('よろしいですか？')).toBe('よろしいですか');
    expect(normalize('設定：詳細；その他')).toBe('設定詳細その他');
    expect(normalize('Learn more…')).toBe('learnmore');
    expect(normalize('Manage » cookies')).toBe('managecookies');
    expect(normalize('Next → Accept')).toBe('nextaccept');
  });

  it('空・null・undefined は空文字になる', () => {
    expect(normalize('')).toBe('');
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });

  it('× や ✕ は残す', () => {
    expect(normalize(' × ')).toBe('×');
    expect(normalize('✕')).toBe('✕');
  });
});

describe('elementText', () => {
  it('テキスト → value → aria-label → title の順に拾う', () => {
    setBody(`
      <button id="a">  すべて 許可  </button>
      <input id="b" type="button" value="Reject All" />
      <button id="c" aria-label="閉じる"></button>
      <button id="d" title="Dismiss"></button>
    `);
    const text = (id: string): string => elementText(document.getElementById(id) as Element);
    expect(text('a')).toBe('すべて許可');
    expect(text('b')).toBe('rejectall');
    expect(text('c')).toBe('閉じる');
    expect(text('d')).toBe('dismiss');
  });
});

describe('elementLabel（表示用。H1）', () => {
  const label = (id: string): string => elementLabel(document.getElementById(id) as Element);

  it('elementText と同じ順で拾い、正規化はせずに空白だけ整える', () => {
    setBody(`
      <button id="a">  Reject   non-essential
      </button>
      <input id="b" type="button" value="Accept All" />
      <button id="c" aria-label="閉じる"></button>
      <button id="d" title="Got it!"></button>
    `);
    expect(label('a')).toBe('Reject non-essential');
    expect(label('b')).toBe('Accept All');
    expect(label('c')).toBe('閉じる');
    expect(label('d')).toBe('Got it!');
  });

  it('長すぎる文言は 80 文字で省略する', () => {
    setBody(`<button id="long">${'あ'.repeat(100)}</button>`);
    const value = label('long');
    expect(value).toHaveLength(81);
    expect(value.endsWith('…')).toBe(true);
  });

  it('文言が無ければ空文字', () => {
    setBody('<button id="empty"></button>');
    expect(label('empty')).toBe('');
  });
});
