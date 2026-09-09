// fixtures/*.html を jsdom に読み込み、実際の Consent-O-Matic ルールを使って
// パイプライン全体（即決 CMP 表 → COM → ヒューリスティック → fallback）を通す統合テスト。

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import comRulesRaw from '../public/rules/consent-o-matic.json?raw';
import accordionPanelHtml from '../fixtures/accordion-panel.html?raw';
import adidasLikeHtml from '../fixtures/adidas-like.html?raw';
import comRuleHtml from '../fixtures/com-rule.html?raw';
import customElementButtonsHtml from '../fixtures/custom-element-buttons.html?raw';
import customEnHtml from '../fixtures/custom-en.html?raw';
import customJaHtml from '../fixtures/custom-ja.html?raw';
import dailymotionLikeHtml from '../fixtures/dailymotion-like.html?raw';
import dialogTosConsentClassHtml from '../fixtures/dialog-tos-consent-class.html?raw';
import dialogTosFixedHtml from '../fixtures/dialog-tos-fixed.html?raw';
import dialogTosHtml from '../fixtures/dialog-tos.html?raw';
import enContinueHtml from '../fixtures/en-continue.html?raw';
import enDivButtonsHtml from '../fixtures/en-div-buttons.html?raw';
import enIconBannerHtml from '../fixtures/en-icon-banner.html?raw';
import enNecessaryOnlyHtml from '../fixtures/en-necessary-only.html?raw';
import enStaticBannerHtml from '../fixtures/en-static-banner.html?raw';
import gakkenLikeHtml from '../fixtures/gakken-like.html?raw';
import legoAgeGateHtml from '../fixtures/lego-agegate.html?raw';
import linkButtonsJaHtml from '../fixtures/link-buttons-ja.html?raw';
import linkRejectJaHtml from '../fixtures/link-reject-ja.html?raw';
import longDialogJaHtml from '../fixtures/long-dialog-ja.html?raw';
import mercedesLikeHtml from '../fixtures/mercedes-like.html?raw';
import mercedesRealShadowHtml from '../fixtures/mercedes-real-shadow.html?raw';
import mercedesRealHtml from '../fixtures/mercedes-real.html?raw';
import noRejectHtml from '../fixtures/no-reject.html?raw';
import noticeAlreadyRejectedEnHtml from '../fixtures/notice-already-rejected-en.html?raw';
import noticeEnHtml from '../fixtures/notice-en.html?raw';
import noticeOnlyHtml from '../fixtures/notice-only.html?raw';
import onetrustHtml from '../fixtures/onetrust-like.html?raw';
import panelCloseOnlyHtml from '../fixtures/panel-close-only.html?raw';
import panelJaHtml from '../fixtures/panel-ja.html?raw';
import panelNoSaveHtml from '../fixtures/panel-no-save.html?raw';
import panelRejectAllHtml from '../fixtures/panel-reject-all.html?raw';
import radioPanelHtml from '../fixtures/radio-panel.html?raw';
import shadowHostRootHtml from '../fixtures/shadow-host-root.html?raw';
import shadowHtml from '../fixtures/shadow.html?raw';
import spaBannerHtml from '../fixtures/spa-banner.html?raw';
import trapAncestorCookieHtml from '../fixtures/trap-ancestor-cookie.html?raw';
import trapChatHtml from '../fixtures/trap-chat.html?raw';
import trapCustomElementHtml from '../fixtures/trap-custom-element.html?raw';
import trapNewsletterEnHtml from '../fixtures/trap-newsletter-en.html?raw';
import trapPanelHtml from '../fixtures/trap-panel.html?raw';
import trapTosEnHtml from '../fixtures/trap-tos-en.html?raw';
import trapHtml from '../fixtures/trap.html?raw';
import trustarcIbmHtml from '../fixtures/trustarc-ibm.html?raw';
import usercentricsShadowHtml from '../fixtures/usercentrics-shadow.html?raw';
import { parseComRules } from '../src/engine/com/engine';
import type { EngineEnv } from '../src/engine/env';
import type { RunOutcome, RunState } from '../src/engine/run';
import { FALLBACK_GRACE_MS, createRunState, runOnce } from '../src/engine/run';
import { activeCategories } from '../src/shared/presets';
import { DEFAULT_SETTINGS } from '../src/shared/storage';
import type { CategoryKey, ComRule, Settings } from '../src/shared/types';
import { makeEnv } from './helpers';

const FIXTURE_HTML: Record<string, string> = {
  'accordion-panel.html': accordionPanelHtml,
  'adidas-like.html': adidasLikeHtml,
  'com-rule.html': comRuleHtml,
  'custom-element-buttons.html': customElementButtonsHtml,
  'custom-en.html': customEnHtml,
  'custom-ja.html': customJaHtml,
  'dailymotion-like.html': dailymotionLikeHtml,
  'dialog-tos-consent-class.html': dialogTosConsentClassHtml,
  'dialog-tos-fixed.html': dialogTosFixedHtml,
  'dialog-tos.html': dialogTosHtml,
  'en-continue.html': enContinueHtml,
  'en-div-buttons.html': enDivButtonsHtml,
  'en-icon-banner.html': enIconBannerHtml,
  'en-necessary-only.html': enNecessaryOnlyHtml,
  'en-static-banner.html': enStaticBannerHtml,
  'gakken-like.html': gakkenLikeHtml,
  'lego-agegate.html': legoAgeGateHtml,
  'link-buttons-ja.html': linkButtonsJaHtml,
  'link-reject-ja.html': linkRejectJaHtml,
  'long-dialog-ja.html': longDialogJaHtml,
  'mercedes-like.html': mercedesLikeHtml,
  'mercedes-real-shadow.html': mercedesRealShadowHtml,
  'mercedes-real.html': mercedesRealHtml,
  'no-reject.html': noRejectHtml,
  'notice-already-rejected-en.html': noticeAlreadyRejectedEnHtml,
  'notice-en.html': noticeEnHtml,
  'notice-only.html': noticeOnlyHtml,
  'onetrust-like.html': onetrustHtml,
  'panel-close-only.html': panelCloseOnlyHtml,
  'panel-ja.html': panelJaHtml,
  'panel-no-save.html': panelNoSaveHtml,
  'panel-reject-all.html': panelRejectAllHtml,
  'radio-panel.html': radioPanelHtml,
  'shadow-host-root.html': shadowHostRootHtml,
  'shadow.html': shadowHtml,
  'spa-banner.html': spaBannerHtml,
  'trap-ancestor-cookie.html': trapAncestorCookieHtml,
  'trap-chat.html': trapChatHtml,
  'trap-custom-element.html': trapCustomElementHtml,
  'trap-newsletter-en.html': trapNewsletterEnHtml,
  'trap-panel.html': trapPanelHtml,
  'trap-tos-en.html': trapTosEnHtml,
  'trap.html': trapHtml,
  'trustarc-ibm.html': trustarcIbmHtml,
  'usercentrics-shadow.html': usercentricsShadowHtml,
};

const comRules: Record<string, ComRule> = parseComRules(
  (JSON.parse(comRulesRaw) as { rules: unknown }).rules,
);

interface FixtureRun {
  outcome: RunOutcome | null;
  log: string;
  doc: Document;
  /** 仮想時計で測った経過時間（fallback の猶予が効いたかを見る） */
  elapsed: number;
  /** パスの状態（何かを検出したか・診断） */
  state: RunState;
}

async function runFixture(
  name: keyof typeof FIXTURE_HTML,
  mode: 'reject' | 'accept',
  patch: Partial<Settings> = {},
  /** 実効の許可カテゴリ。既定は DEFAULT_SETTINGS（= プリセット minimal）と同じ */
  allowCategories: readonly CategoryKey[] = activeCategories(DEFAULT_SETTINGS.allowCategories),
  /** env の差し替え（jsdom はレイアウトしないので、大きさを再現したいときに使う） */
  envOverrides: Partial<EngineEnv> = {},
): Promise<FixtureRun> {
  const html = FIXTURE_HTML[name];
  if (html === undefined) throw new Error(`fixture が見つかりません: ${name}`);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: `http://localhost:4173/fixtures/${name}`,
  });
  const doc = dom.window.document;
  const env = makeEnv(dom.window, envOverrides);
  const state = createRunState(env.now());
  const outcome = await runOnce({
    doc,
    env,
    settings: { ...DEFAULT_SETTINGS, ...patch },
    mode,
    allowCategories,
    customRules: [],
    comRules,
    isSubFrame: false,
    state,
  });
  return { outcome, log: doc.getElementById('log')?.textContent ?? '', doc, elapsed: env.now(), state };
}

describe('fixtures（実ルール込みの統合）', () => {
  it('custom-ja: reject で「拒否」が押されてバナーが消える', async () => {
    const { outcome, log, doc } = await runFixture('custom-ja.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', action: 'reject', clickedText: '拒否' });
    expect(log).toContain('クリック: 拒否');
    expect(log).toContain('バナーを閉じました');
    expect(doc.getElementById('fx-cookie-strip')).toBeNull();
  });

  it('custom-ja: accept で「すべて許可」が押される', async () => {
    const { outcome, log } = await runFixture('custom-ja.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: 'すべて許可' });
    expect(log).toContain('クリック: すべて許可');
  });

  it('notice-only: 選択肢のない通知バナーは OK が押される', async () => {
    const { outcome, log, doc } = await runFixture('notice-only.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: 'ok' });
    expect(log).toContain('クリック: OK');
    expect(doc.getElementById('fx-cookie-toast')).toBeNull();
  });

  it('notice-only: すべて拒否（pressCloseOnNotice: false）では OK を押さず非表示にする', async () => {
    const { outcome, log, doc, elapsed } = await runFixture('notice-only.html', 'reject', {
      pressCloseOnNotice: false,
    });
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
    expect(log).not.toContain('クリック:');
    const toast = doc.getElementById('fx-cookie-toast') as HTMLElement;
    expect(toast.style.display).toBe('none');
    expect(elapsed).toBeGreaterThanOrEqual(FALLBACK_GRACE_MS);
  });

  it('notice-only: すべて拒否 + fallback=leave なら何も押さず unhandled', async () => {
    const { outcome, log, doc } = await runFixture('notice-only.html', 'reject', {
      pressCloseOnNotice: false,
      fallbackWhenNoReject: 'leave',
    });
    expect(outcome).toMatchObject({ status: 'unhandled' });
    expect(log).not.toContain('クリック:');
    const toast = doc.getElementById('fx-cookie-toast') as HTMLElement;
    expect(toast.style.display).toBe('');
    expect(toast.hasAttribute('data-cookie-autopilot-cloak')).toBe(false);
  });

  it('shadow: shadow DOM 内の Reject all が押される', async () => {
    const { outcome, log } = await runFixture('shadow.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: 'rejectall' });
    expect(log).toContain('クリック: Reject all');
  });

  it('onetrust-like: 即決 CMP 表で処理される', async () => {
    const { outcome, log, doc } = await runFixture('onetrust-like.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'quick:OneTrust',
      action: 'reject',
      clickedLabel: 'すべて拒否',
    });
    expect(log).toContain('クリック: すべて拒否');
    expect(doc.getElementById('onetrust-banner-sdk')).toBeNull();
  });

  it('onetrust-like: accept では accept ボタンが押される', async () => {
    const { log } = await runFixture('onetrust-like.html', 'accept');
    expect(log).toContain('クリック: すべて受け入れる');
  });

  it('com-rule: 既定（最低限）では「設定の記憶」だけ残して選択が保存される', async () => {
    const { outcome, log, doc } = await runFixture('com-rule.html', 'reject');
    expect(outcome?.status).toBe('handled');
    expect(outcome?.method).toBe('com:cookiebot');
    // カテゴリごとに選んで保存したので granular（§14.6）
    expect(outcome).toMatchObject({ decision: 'granular', allowed: ['A'] });
    // OPEN_OPTIONS → DO_CONSENT → SAVE_CONSENT の順
    expect(log).toContain('詳細を開きました');
    // 既定のプリセット minimal は A（設定の記憶）を許可するので preferences は触らない
    expect(log).not.toContain('チェックボックス: preferences');
    expect(log).toContain('チェックボックス: statistics -> off');
    expect(log).toContain('チェックボックス: marketing -> off');
    expect(log).toContain('選択を許可 -> バナーを閉じました');
    expect(doc.getElementById('CybotCookiebotDialog')).toBeNull();
  });

  it('com-rule: すべて拒否なら preferences も外す', async () => {
    const { outcome, log } = await runFixture('com-rule.html', 'reject', {}, []);
    expect(outcome).toMatchObject({ status: 'handled', method: 'com:cookiebot', decision: 'granular', allowed: [] });
    expect(log).toContain('チェックボックス: preferences -> off');
    expect(log).toContain('チェックボックス: statistics -> off');
    expect(log).toContain('チェックボックス: marketing -> off');
  });

  it('com-rule: まぁ許すなら「設定の記憶」と「アクセス解析」を残す', async () => {
    const { outcome, log } = await runFixture('com-rule.html', 'reject', {}, ['A', 'B', 'E']);
    expect(outcome).toMatchObject({ decision: 'granular', allowed: ['A', 'B', 'E'] });
    expect(log).not.toContain('チェックボックス: preferences');
    expect(log).not.toContain('チェックボックス: statistics');
    expect(log).toContain('チェックボックス: marketing -> off');
  });

  it('no-reject: 既定の fallback（hide）で display:none が付く', async () => {
    const { outcome, log, doc, elapsed } = await runFixture('no-reject.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide' });
    // 設定パネル層（§5-5-e）が「設定」を開こうとするが、このページはパネルを出さないので
    // 何も触らず hide に落ちる。「同意する」は押さない
    expect(log).toContain('クリック: 設定');
    expect(log).not.toContain('クリック: 同意する');
    const bar = doc.getElementById('fx-cookie-bar') as HTMLElement;
    expect(bar.style.display).toBe('none');
    expect(bar.getAttribute('data-cookie-autopilot-hidden')).toBe('');
    // 即座には hide せず、猶予が切れてから適用する
    expect(elapsed).toBeGreaterThanOrEqual(FALLBACK_GRACE_MS);
  });

  it('no-reject: fallback=leave なら何も押さず cloak も外す', async () => {
    const { outcome, doc, elapsed } = await runFixture('no-reject.html', 'reject', {
      fallbackWhenNoReject: 'leave',
    });
    expect(outcome).toMatchObject({ status: 'unhandled' });
    expect(elapsed).toBeGreaterThanOrEqual(FALLBACK_GRACE_MS);
    const bar = doc.getElementById('fx-cookie-bar') as HTMLElement;
    expect(bar.style.display).toBe('');
    expect(bar.hasAttribute('data-cookie-autopilot-cloak')).toBe(false);
  });

  it('no-reject: accept モードでは「同意する」が押される', async () => {
    const { log } = await runFixture('no-reject.html', 'accept');
    expect(log).toContain('クリック: 同意する');
  });

  it('trap: 何も押されない（reject / accept どちらでも）', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log } = await runFixture('trap.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
    }
  });

  it('trap-chat: 固定チャット・sticky ヘッダーは押しも消しもしない', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('trap-chat.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
      const widget = doc.getElementById('chat-widget') as HTMLElement;
      expect(widget.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
    }
  });

  it('dialog-tos: 規約更新ダイアログの「はい」を押さない（accept モードでも）', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('dialog-tos.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
      const dialog = doc.getElementById('tos-dialog') as HTMLElement;
      expect(dialog.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
    }
  });

  it('dialog-tos-consent-class: class="consent-modal" だけの規約モーダルは何も押さない（H-1）', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('dialog-tos-consent-class.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
      const modal = doc.getElementById('tos-modal') as HTMLElement;
      expect(modal.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
    }
  });

  it('dialog-tos-fixed: fixed なだけの規約モーダルは「同意する」も「同意しない」も押さない', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('dialog-tos-fixed.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
      const modal = doc.getElementById('tos-modal') as HTMLElement;
      expect(modal.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
    }
  });

  it('trap-custom-element: Cookie 語の無いモーダルのカスタム要素は押さない・消さない', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('trap-custom-element.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
      const modal = doc.getElementById('account-modal') as HTMLElement;
      expect(modal.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
    }
  });
});

describe('fixtures（取りこぼしの緩和 §5-5-d）', () => {
  it('custom-element-buttons: reject で <x-btn> の「すべて拒否」が押される', async () => {
    const { outcome, log, doc } = await runFixture('custom-element-buttons.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedLabel: 'すべて拒否',
    });
    expect(log).toContain('クリック: すべて拒否');
    expect(log).toContain('バナーを閉じました');
    expect(doc.getElementById('fx-cookie-strip')).toBeNull();
  });

  it('custom-element-buttons: accept で「すべて許可」が押される', async () => {
    const { log } = await runFixture('custom-element-buttons.html', 'accept');
    expect(log).toContain('クリック: すべて許可');
  });

  it('long-dialog-ja: 本文 5000 文字弱の fixed ダイアログでも「同意しない」が押される', async () => {
    const { outcome, log, doc } = await runFixture('long-dialog-ja.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedLabel: '同意しない',
    });
    expect(log).toContain('クリック: 同意しない');
    expect(doc.getElementById('fx-long-dialog')).toBeNull();
  });

  it('long-dialog-ja: accept では「同意する」が押される', async () => {
    const { log } = await runFixture('long-dialog-ja.html', 'accept');
    expect(log).toContain('クリック: 同意する');
  });

  it('shadow-host-root: ホスト自身が容器でも shadow の中の「すべて拒否」が押される', async () => {
    const { outcome, log } = await runFixture('shadow-host-root.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedLabel: 'すべて拒否',
    });
    expect(log).toContain('クリック: すべて拒否');
    expect(log).toContain('バナーを閉じました');
  });

  it('shadow-host-root: accept では「すべて許可」が押される', async () => {
    const { log } = await runFixture('shadow-host-root.html', 'accept');
    expect(log).toContain('クリック: すべて許可');
  });
});

describe('fixtures（実サイト巡回で見つかった取りこぼし）', () => {
  /**
   * usercentrics-shadow.html の実サイト条件（deepl.com）。
   * ホスト `ASIDE#usercentrics-cmp-ui` は横幅を持つが**高さが 0** で、画面に出ているのは
   * open shadow root の中の `position: fixed` な子だけ。jsdom はレイアウトしないので注入する。
   */
  const zeroHeightHost: Partial<EngineEnv> = {
    getRect: (el) =>
      el.id === 'usercentrics-cmp-ui' ? { width: 1280, height: 0 } : { width: 460, height: 120 },
  };

  it('usercentrics-shadow: reject では「すべて許可」を押さずに非表示にする（REAL-001）', async () => {
    const { outcome, log, doc, elapsed } = await runFixture(
      'usercentrics-shadow.html',
      'reject',
      {},
      undefined,
      zeroHeightHost,
    );
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
    expect(log).not.toContain('クリック:');
    const host = doc.getElementById('usercentrics-cmp-ui') as HTMLElement;
    expect(host.style.display).toBe('none');
    expect(host.getAttribute('data-cookie-autopilot-hidden')).toBe('');
    expect(elapsed).toBeGreaterThanOrEqual(FALLBACK_GRACE_MS);
  });

  it('usercentrics-shadow: fallback=leave なら何も押さず unhandled（no-reject）', async () => {
    const { outcome, log, doc } = await runFixture(
      'usercentrics-shadow.html',
      'reject',
      { fallbackWhenNoReject: 'leave' },
      undefined,
      zeroHeightHost,
    );
    expect(outcome).toMatchObject({ status: 'unhandled', reason: 'no-reject' });
    expect(log).not.toContain('クリック:');
    const host = doc.getElementById('usercentrics-cmp-ui') as HTMLElement;
    expect(host.style.display).toBe('');
    expect(host.hasAttribute('data-cookie-autopilot-cloak')).toBe(false);
  });

  it('usercentrics-shadow: accept では shadow の中の #accept が押される', async () => {
    const { outcome, log, doc } = await runFixture(
      'usercentrics-shadow.html',
      'accept',
      {},
      undefined,
      zeroHeightHost,
    );
    expect(outcome).toMatchObject({ status: 'handled', method: 'quick:Usercentrics', clickedText: 'すべて許可' });
    expect(log).toContain('クリック: すべて許可');
    expect(doc.getElementById('usercentrics-cmp-ui')).toBeNull();
  });

  it('dailymotion-like: 既定では「内容を理解した」が押される（REAL-002）', async () => {
    const { outcome, log, doc } = await runFixture('dailymotion-like.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedText: '内容を理解した',
      // 断ったわけではないので dismissed（§14.6）
      decision: 'dismissed',
    });
    expect(log).toContain('クリック: 内容を理解した');
    expect(log).toContain('バナーを閉じました');
    expect(doc.querySelector('[role="dialog"]')).toBeNull();
  });

  it('dailymotion-like: すべて拒否（pressCloseOnNotice: false）では押さずに非表示', async () => {
    const { outcome, log, doc } = await runFixture('dailymotion-like.html', 'reject', {
      pressCloseOnNotice: false,
    });
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
    expect(log).not.toContain('クリック:');
    const popup = doc.querySelector('[role="dialog"]') as HTMLElement;
    expect(popup.style.display).toBe('none');
    // 「当社のクッキーに関する方針。」のリンクは押さない
    expect(log).not.toContain('方針');
  });

  it('dailymotion-like: accept でも「内容を理解した」が押される', async () => {
    const { outcome, log } = await runFixture('dailymotion-like.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: '内容を理解した' });
    expect(log).toContain('クリック: 内容を理解した');
  });

  it('notice-already-rejected-en: 拒否済みの案内は押さない・消さない・未処理としても報告しない（REAL-003）', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('notice-already-rejected-en.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
      const notice = doc.querySelector('.dcr-17eqobb') as HTMLElement;
      expect(notice.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
    }
  });

  it('notice-already-rejected-en: 何も検出しないので監視終了時の報告は none になる', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { state } = await runFixture('notice-already-rejected-en.html', mode);
      // detectedAny が立たなければ content script は unhandled ではなく none を送る（§5-7）
      expect(state.detectedAny, mode).toBe(false);
      expect(state.reason, mode).toBeNull();
    }
  });
});

describe('fixtures（実サイト巡回・第2巡で見つかった取りこぼし）', () => {
  /**
   * adidas-like.html の実サイト条件（adidas.co.uk）。
   * jsdom はレイアウトしないので矩形を注入する。**ボタンだけを小さく**するのが肝で、
   * 全要素が同じ大きさだと面積が並んで文書順（= 外側の容器が先）で決まってしまい、
   * 「accept ボタン自身が最小の容器として採用される」という実サイトの状況が再現できない。
   */
  const smallButtons: Partial<EngineEnv> = {
    getRect: (el) => (el.tagName === 'BUTTON' ? { width: 320, height: 48 } : { width: 600, height: 300 }),
  };

  it('adidas-like: 兄弟の Reject all を即決 CMP 表で押す（ROUND2-001）', async () => {
    const { outcome, log, doc } = await runFixture('adidas-like.html', 'reject', {}, undefined, smallButtons);
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'quick:adidas (Glass)',
      action: 'reject',
      clickedLabel: 'Reject all',
      decision: 'reject-all',
    });
    expect(log).toContain('クリック: Reject all');
    // accept ボタン（id に gdpr / consent を含む）は押さない
    expect(log).not.toContain('Accept all cookies');
    expect(doc.querySelector('.cookie-consent-modal')).toBeNull();
  });

  it('adidas-like: accept では Accept all cookies が押される', async () => {
    const { outcome, log } = await runFixture('adidas-like.html', 'accept', {}, undefined, smallButtons);
    expect(outcome).toMatchObject({ status: 'handled', method: 'quick:adidas (Glass)' });
    expect(log).toContain('クリック: Accept all cookies');
    expect(log).not.toContain('クリック: Reject all');
  });

  /**
   * trustarc-ibm.html の実サイト条件（ibm.com）。
   * 即決 CMP 表が名指しした `#truste-consent-track` より、中の説明文だけの
   * `#truste-consent-text` の方が小さい（= ヒューリスティックはそちらを採る）状況を作る。
   */
  const trustarcRects: Partial<EngineEnv> = {
    getRect: (el) =>
      el.id === 'truste-consent-text' ? { width: 480, height: 80 } : { width: 900, height: 220 },
  };

  it('trustarc-ibm: 即決表の容器から設定パネルを開いて保存する（ROUND2-002）', async () => {
    const { outcome, log, doc } = await runFixture('trustarc-ibm.html', 'reject', {}, undefined, trustarcRects);
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      // 既定の「ほどよく守る」は A（設定の記憶 = 機能性 Cookie）だけ許可する
      allowed: ['A'],
      clickedLabel: '設定を送信',
    });
    expect(log).toContain('クリック: オプションの続き');
    expect(log).toContain('設定パネルを開きました');
    expect(log).toContain('トグル: 分析Cookie -> off');
    expect(log).toContain('トグル: 広告Cookie -> off');
    // 機能性（A）は許可なのでそのまま、必須は disabled なので触らない
    expect(log).not.toContain('トグル: 機能性Cookie');
    expect(log).not.toContain('トグル: 必須Cookie');
    // 「すべて承諾」は一度も押さない
    expect(log).not.toContain('クリック: すべて承諾');
    expect(doc.getElementById('truste-consent-track')).toBeNull();
    expect(doc.getElementById('truste-consent-panel')).toBeNull();
  });

  it('trustarc-ibm: accept では即決表が「すべて承諾」を押す', async () => {
    const { outcome, log } = await runFixture('trustarc-ibm.html', 'accept', {}, undefined, trustarcRects);
    expect(outcome).toMatchObject({ status: 'handled', method: 'quick:TrustArc' });
    expect(log).toContain('クリック: すべて承諾');
    expect(log).not.toContain('設定パネルを開きました');
  });

  it('lego-agegate: 入口ゲートは同意画面として扱わない（ROUND2-003）', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc, state } = await runFixture('lego-agegate.html', mode);
      expect(outcome, mode).toBeNull();
      // 検出もしないので、監視終了時の報告は unhandled ではなく none になる（§5-7）
      expect(state.detectedAny, mode).toBe(false);
      expect(state.reason, mode).toBeNull();
      expect(log, mode).not.toContain('クリック');
      const dialog = doc.querySelector('dialog') as HTMLElement;
      expect(dialog.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
    }
  });
});

describe('fixtures（英語バナー）', () => {
  it('custom-en: reject で Reject non-essential が押されてバナーが消える', async () => {
    const { outcome, log, doc } = await runFixture('custom-en.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedText: 'rejectnonessential',
      // popup にはボタンの生の文言を出す（正規化後の 'rejectnonessential' ではなく。H1）
      clickedLabel: 'Reject non-essential',
    });
    expect(log).toContain('クリック: Reject non-essential');
    expect(log).toContain('バナーを閉じました');
    expect(doc.getElementById('fx-cookie-bar-en')).toBeNull();
  });

  it('custom-en: accept で Accept all cookies が押される', async () => {
    const { outcome, log } = await runFixture('custom-en.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: 'acceptallcookies' });
    expect(log).toContain('クリック: Accept all cookies');
  });

  it('notice-en: 選択肢のない通知バナーは両モードで Got it! が押される', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('notice-en.html', mode);
      expect(outcome, mode).toMatchObject({
        status: 'handled',
        method: 'heuristic',
        clickedText: 'gotit',
        clickedLabel: 'Got it!',
      });
      expect(log, mode).toContain('クリック: Got it!');
      expect(doc.getElementById('fx-cookie-toast-en'), mode).toBeNull();
    }
  });

  it('notice-en: すべて拒否（pressCloseOnNotice: false）では Got it! を押さない', async () => {
    const { outcome, log, doc } = await runFixture('notice-en.html', 'reject', { pressCloseOnNotice: false });
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
    expect(log).not.toContain('クリック:');
    expect((doc.getElementById('fx-cookie-toast-en') as HTMLElement).style.display).toBe('none');
  });

  it('notice-en: accept モード（fixtures 用）は pressCloseOnNotice に関係なく押す', async () => {
    const { outcome, log } = await runFixture('notice-en.html', 'accept', { pressCloseOnNotice: false });
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: 'gotit' });
    expect(log).toContain('クリック: Got it!');
  });

  it('en-necessary-only: reject で Necessary cookies only が押される', async () => {
    const { outcome, log } = await runFixture('en-necessary-only.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedText: 'necessarycookiesonly',
    });
    expect(log).toContain('クリック: Necessary cookies only');
  });

  it('en-necessary-only: accept では Accept all が押される', async () => {
    const { log } = await runFixture('en-necessary-only.html', 'accept');
    expect(log).toContain('クリック: Accept all');
    expect(log).not.toContain('クリック: Necessary cookies only');
  });

  it('en-continue: 両モードで Continue が押される', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('en-continue.html', mode);
      expect(outcome, mode).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: 'continue' });
      expect(log, mode).toContain('クリック: Continue');
      expect(doc.getElementById('fx-cookie-continue'), mode).toBeNull();
    }
  });

  it('en-div-buttons: role なしの div ボタンでも押せる', async () => {
    const { outcome, log } = await runFixture('en-div-buttons.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', action: 'reject', clickedText: 'decline' });
    expect(log).toContain('クリック: Decline');

    const accepted = await runFixture('en-div-buttons.html', 'accept');
    expect(accepted.outcome).toMatchObject({ status: 'handled', clickedText: 'allowcookies' });
    expect(accepted.log).toContain('クリック: Allow cookies');
  });

  it('en-icon-banner: 本文にバナー語が無くても加点で採用して Reject を押す（§5-5-d）', async () => {
    const { outcome, log, doc } = await runFixture('en-icon-banner.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedText: 'reject',
      clickedLabel: 'Reject',
    });
    expect(log).toContain('クリック: Reject');
    expect(log).not.toContain('クリック: Accept');
    expect(doc.getElementById('fx-cookie-icons')).toBeNull();
  });

  it('en-icon-banner: accept では Accept が押される', async () => {
    const { outcome, log } = await runFixture('en-icon-banner.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: 'accept' });
    expect(log).toContain('クリック: Accept');
    expect(log).not.toContain('クリック: Reject');
  });

  it('en-static-banner: position: static でも属性ヒントで検出して押す', async () => {
    const { outcome, log } = await runFixture('en-static-banner.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', action: 'reject', clickedText: 'reject' });
    expect(log).toContain('クリック: Reject');

    const accepted = await runFixture('en-static-banner.html', 'accept');
    expect(accepted.outcome).toMatchObject({ status: 'handled', clickedText: 'accept' });
    expect(accepted.log).toContain('クリック: Accept');
  });

  it('trap-newsletter-en: Cookie 語の無いモーダルの No thanks は押さない', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('trap-newsletter-en.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
      const modal = doc.getElementById('fx-newsletter') as HTMLElement;
      expect(modal.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
    }
  });

  it('trap-tos-en: 英語の規約更新モーダルは I agree も Decline も押さない', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('trap-tos-en.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
      const modal = doc.getElementById('fx-tos') as HTMLElement;
      expect(modal.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
    }
  });
});

describe('fixtures（設定パネル層 §5-5-e）', () => {
  it('panel-ja: 設定を開いて分析と広告のチェックを外し、選択を保存する', async () => {
    const { outcome, log, doc } = await runFixture('panel-ja.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      // 既定の「ほどよく守る」は A（設定の記憶）だけ許可する
      allowed: ['A'],
      clickedText: '選択を保存',
      clickedLabel: '選択を保存',
    });
    expect(log).toContain('クリック: 設定');
    expect(log).toContain('設定パネルを開きました');
    expect(log).toContain('トグル: 分析 Cookie -> off');
    expect(log).toContain('トグル: 広告 Cookie -> off');
    // 機能（A）は許可なのでそのまま、必須は disabled なので触らない
    expect(log).not.toContain('トグル: 機能 Cookie');
    expect(log).not.toContain('トグル: 必須');
    expect(log).toContain('選択を保存 -> 残ったのは: 必須 Cookie（常に有効） / 機能 Cookie');
    expect(doc.getElementById('fx-cookie-bar')).toBeNull();
    expect(doc.getElementById('fx-cookie-prefs')).toBeNull();
  });

  it('panel-ja: すべて拒否（許可カテゴリなし）なら機能も外す', async () => {
    const { outcome, log } = await runFixture('panel-ja.html', 'reject', {}, []);
    expect(outcome).toMatchObject({ status: 'handled', method: 'panel', decision: 'granular', allowed: [] });
    expect(log).toContain('トグル: 機能 Cookie -> off');
    expect(log).toContain('選択を保存 -> 残ったのは: 必須 Cookie（常に有効）');
  });

  it('panel-ja: accept では「全てに同意する」が押される（パネルは開かない）', async () => {
    const { outcome, log } = await runFixture('panel-ja.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: '全てに同意する' });
    expect(log).toContain('クリック: 全てに同意する');
    expect(log).not.toContain('設定パネルを開きました');
  });

  it('panel-reject-all: パネルの「全て拒否」をトグルに触れずに押す', async () => {
    const { outcome, log, doc } = await runFixture('panel-reject-all.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      allowed: [],
      clickedText: '全て拒否',
      clickedLabel: '全て拒否',
    });
    expect(log).toContain('クリック: 全て拒否');
    expect(log).not.toContain('トグル');
    expect(log).not.toContain('クリック: 選択を保存');
    expect(doc.getElementById('fx-cookie-bar')).toBeNull();
    expect(doc.getElementById('fx-cookie-prefs')).toBeNull();
  });

  it('panel-reject-all: accept では「全てに同意する」が押される', async () => {
    const { log } = await runFixture('panel-reject-all.html', 'accept');
    expect(log).toContain('クリック: 全てに同意する');
    expect(log).not.toContain('クリック: 全て拒否');
  });

  it('panel-no-save: 「閉じる」でチェックを外し、閉じても残るのでバナーもパネルも非表示にする', async () => {
    const { outcome, log, doc } = await runFixture('panel-no-save.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
    expect(log).toContain('クリック: 設定');
    // 保存ボタンは無いが「閉じる」があるので、望む状態にしてから閉じる（§5-5-e の最後の手段）
    expect(log).toContain('トグル（本来は起きないはず）: 分析 Cookie');
    expect(log).toContain('トグル（本来は起きないはず）: 広告 Cookie');
    // 機能（A）は既定で許可なので触らない
    expect(log).not.toContain('トグル（本来は起きないはず）: 機能 Cookie');
    expect(log).toContain('クリック: 閉じる');
    // 閉じてもバナーは残るので処理は失敗。「全てに同意する」は押さない
    expect(log).not.toContain('クリック: 全てに同意する');
    expect((doc.getElementById('fx-cookie-bar') as HTMLElement).style.display).toBe('none');
    expect((doc.getElementById('fx-cookie-prefs') as HTMLElement).style.display).toBe('none');
  });

  it('panel-no-save: fallback=leave なら unhandled の理由が panel-aborted になる', async () => {
    const { outcome } = await runFixture('panel-no-save.html', 'reject', {
      fallbackWhenNoReject: 'leave',
    });
    expect(outcome).toMatchObject({ status: 'unhandled', reason: 'panel-aborted' });
  });

  it('panel-no-save: accept では「全てに同意する」が押される', async () => {
    const { log } = await runFixture('panel-no-save.html', 'accept');
    expect(log).toContain('クリック: 全てに同意する');
  });

  it('mercedes-like: カスタム要素のバナーで設定を開き、カテゴリだけ外して保存する', async () => {
    const { outcome, log, doc } = await runFixture('mercedes-like.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      // 分析（B）・マーケティング（F）・データ共有（X）はどれも許可しない
      allowed: [],
      clickedText: '設定の保存',
      clickedLabel: '設定の保存',
    });
    expect(log).toContain('クリック: 設定');
    expect(log).toContain('設定パネルを開きました');
    expect(log).toContain('チェック: 分析と統計 -> off');
    expect(log).toContain('チェック: マーケティング -> off');
    expect(log).toContain('チェック: メルセデス・ベンツ関連会社へのデータ共有 -> off');
    // 必須・「すべて選択する」・個別サービスのトグルには触らない
    expect(log).not.toContain('チェック: 必須Cookie');
    expect(log).not.toContain('チェック: すべて選択する');
    expect(log).not.toContain('チェック: Google Analytics');
    expect(log).toContain('クリック: 設定の保存');
    expect(log).toContain('設定の保存 -> 残ったのは: 必須Cookie');
    expect(doc.getElementById('fx-cookie-banner')).toBeNull();
  });

  it('mercedes-like: accept では「全てに同意」が押される（パネルは開かない）', async () => {
    const { outcome, log, doc } = await runFixture('mercedes-like.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: '全てに同意' });
    expect(log).toContain('クリック: 全てに同意');
    expect(log).not.toContain('設定パネルを開きました');
    expect(doc.getElementById('fx-cookie-banner')).toBeNull();
  });

  // mercedes-benz.co.jp の同意画面を、構造は実 HTML のまま（説明文は書き直し）で通す（light DOM / open shadow root の 2 通り）。
  // 簡略版（mercedes-like）との違いは、空の `<wb7-text>`・`<cmm-languages-list>`・個別 consent の
  // aria-label が「詳細を表示する」ではなくサービス名そのもの・`checked` を持たない
  // `selected-all` / `selected-partial` の class 表現・カテゴリの詳細が畳まれていること。
  for (const name of ['mercedes-real.html', 'mercedes-real-shadow.html'] as const) {
    const where = name.includes('shadow') ? 'shadow DOM' : 'light DOM';

    it(`${name}: 実 HTML（${where}）でも設定を開き、カテゴリだけ外して保存する`, async () => {
      const { outcome, log, doc } = await runFixture(name, 'reject');
      expect(outcome).toMatchObject({
        status: 'handled',
        method: 'panel',
        action: 'reject',
        decision: 'granular',
        // 分析（B）・マーケティング（F）・データ共有（X）はどれも許可しない
        allowed: [],
        clickedText: '設定の保存',
        clickedLabel: '設定の保存',
      });
      expect(log).toContain('クリック: 設定');
      expect(log).toContain('設定パネルを開きました');
      expect(log).toContain('チェック: 分析と統計 -> off');
      expect(log).toContain('チェック: マーケティング -> off');
      expect(log).toContain('チェック: メルセデス・ベンツ関連会社へのデータ共有 -> off');
      // 必須・「すべて選択する」・個別サービスのトグルには触らない
      expect(log).not.toContain('チェック: 必須Cookie');
      expect(log).not.toContain('チェック: すべて選択する');
      expect(log).not.toContain('チェック: Google Analytics');
      expect(log).toContain('クリック: 設定の保存');
      expect(log).toContain('設定の保存 -> 残ったカテゴリ: 必須Cookie');
      // カテゴリを外せば配下の個別項目も落ちる（`selected-partial` のマーケティングも残らない）
      expect(log).toContain(
        '設定の保存 -> 残った個別項目: Usercentrics Consent Management Platform | JP / Content-Management-System / Mercedes Me Login',
      );
      expect(doc.querySelector('cmm-cookie-banner')).toBeNull();
    });

    it(`${name}: accept では「全てに同意」が押される（パネルは開かない）`, async () => {
      const { outcome, log, doc } = await runFixture(name, 'accept');
      expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: '全てに同意' });
      expect(log).toContain('クリック: 全てに同意');
      expect(log).not.toContain('設定パネルを開きました');
      expect(doc.querySelector('cmm-cookie-banner')).toBeNull();
    });
  }

  it('trap-panel: Cookie 語の無い会員設定モーダルは何も押さない・消さない', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc } = await runFixture('trap-panel.html', mode);
      expect(outcome, mode).toBeNull();
      expect(log, mode).not.toContain('本来は起きないはず');
      const modal = doc.getElementById('fx-member-modal') as HTMLElement;
      expect(modal.style.display, mode).toBe('');
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
    }
  });

  it('radio-panel: 許可 / 拒否のラジオで設定の記憶だけ残して保存する', async () => {
    const { outcome, log, doc } = await runFixture('radio-panel.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      allowed: ['A'],
      clickedText: '選択を保存',
    });
    expect(log).toContain('設定パネルを開きました');
    expect(log).toContain('ラジオ: 分析 Cookie -> 拒否');
    expect(log).toContain('ラジオ: 広告 Cookie -> 拒否');
    // 設定の記憶（A）は既に「許可」なので触らない。必須と 3 択の行にも触らない
    expect(log).not.toContain('ラジオ: 設定の記憶');
    expect(log).not.toContain('ラジオ: 必須');
    expect(log).not.toContain('ラジオ: ソーシャル連携');
    expect(log).toContain('選択を保存 -> 必須 Cookie（常に有効）=許可 / 設定の記憶=許可');
    expect(doc.getElementById('fx-cookie-bar')).toBeNull();
    expect(doc.getElementById('fx-cookie-prefs')).toBeNull();
  });

  it('radio-panel: accept では「全てに同意する」が押される（パネルは開かない）', async () => {
    const { outcome, log } = await runFixture('radio-panel.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: '全てに同意する' });
    expect(log).not.toContain('設定パネルを開きました');
  });

  it('accordion-panel: 元から見えている設定セクションが開いてもパネルとして扱う', async () => {
    const { outcome, log, doc } = await runFixture('accordion-panel.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      allowed: ['A'],
      clickedText: '選択を保存',
    });
    expect(log).toContain('設定パネルを開きました');
    expect(log).toContain('トグル: 分析 Cookie -> off');
    expect(log).toContain('トグル: 広告 Cookie -> off');
    expect(log).not.toContain('トグル: 機能 Cookie');
    expect(log).toContain('選択を保存 -> 残ったのは: 必須 Cookie（常に有効） / 機能 Cookie');
    expect(doc.getElementById('fx-cookie-bar')).toBeNull();
    expect(doc.getElementById('fx-cookie-details')).toBeNull();
  });

  it('accordion-panel: accept では「全てに同意する」が押される', async () => {
    const { outcome, log } = await runFixture('accordion-panel.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: '全てに同意する' });
    expect(log).not.toContain('設定パネルを開きました');
  });

  it('panel-close-only: 保存ボタンが無くてもチェックを外して「閉じる」を押す', async () => {
    const { outcome, log, doc } = await runFixture('panel-close-only.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      allowed: ['A'],
      clickedText: '閉じる',
      clickedLabel: '閉じる',
    });
    expect(log).toContain('トグル: 分析 Cookie -> off（その場で反映）');
    expect(log).toContain('トグル: 広告 Cookie -> off（その場で反映）');
    expect(log).not.toContain('トグル: 機能 Cookie');
    expect(log).toContain('クリック: 閉じる');
    expect(log).not.toContain('クリック: 全てに同意する');
    expect(doc.getElementById('fx-cookie-bar')).toBeNull();
    expect(doc.getElementById('fx-cookie-prefs')).toBeNull();
  });

  it('panel-close-only: accept では「全てに同意する」が押される', async () => {
    const { outcome, log } = await runFixture('panel-close-only.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedText: '全てに同意する' });
    expect(log).not.toContain('設定パネルを開きました');
  });
});

describe('fixtures（画面遷移。§5-4）', () => {
  it('spa-banner: 1 枚目のバナーは reject で「拒否」が押される', async () => {
    const { outcome, log, doc } = await runFixture('spa-banner.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', action: 'reject', clickedText: '拒否' });
    expect(log).toContain('バナーを閉じました: fx-cookie-bar');
    expect(doc.getElementById('fx-cookie-bar')).toBeNull();
  });

  it('spa-banner: accept では「同意する」が押される', async () => {
    const { log } = await runFixture('spa-banner.html', 'accept');
    expect(log).toContain('クリック: 同意する');
  });
});

describe('fixtures（リンクで作られた決定ボタン §5-5-d）', () => {
  it('link-buttons-ja: 断るボタンが無いので非表示にする（ポリシー・インプリントは押さない）', async () => {
    const { outcome, log, doc, elapsed } = await runFixture('link-buttons-ja.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
    // リンクは 1 つも押さない（「全てに同意」は押さずに残すので hide の条件を満たす）
    expect(log).not.toContain('クリック:');
    const modal = doc.getElementById('fx-link-modal') as HTMLElement;
    expect(modal.style.display).toBe('none');
    expect(modal.getAttribute('data-cookie-autopilot-hidden')).toBe('');
    expect(elapsed).toBeGreaterThanOrEqual(FALLBACK_GRACE_MS);
  });

  it('link-buttons-ja: fallback=leave なら unhandled の理由が no-reject になる', async () => {
    const { outcome, log } = await runFixture('link-buttons-ja.html', 'reject', {
      fallbackWhenNoReject: 'leave',
    });
    expect(outcome).toMatchObject({ status: 'unhandled', reason: 'no-reject' });
    expect(log).not.toContain('クリック:');
  });

  it('link-buttons-ja: accept ではリンクの「全てに同意」が押される', async () => {
    const { outcome, log, doc } = await runFixture('link-buttons-ja.html', 'accept');
    expect(outcome).toMatchObject({ status: 'handled', method: 'heuristic', clickedLabel: '全てに同意' });
    expect(log).toContain('クリック: 全てに同意');
    expect(doc.getElementById('fx-link-modal')).toBeNull();
  });

  it('link-reject-ja: reject ではリンクの「全て拒否」が押される', async () => {
    const { outcome, log, doc } = await runFixture('link-reject-ja.html', 'reject');
    expect(outcome).toMatchObject({
      status: 'handled',
      method: 'heuristic',
      action: 'reject',
      clickedText: '全て拒否',
      clickedLabel: '全て拒否',
      decision: 'reject-all',
    });
    expect(log).toContain('クリック: 全て拒否');
    expect(log).not.toContain('クリック: 設定');
    expect(log).not.toContain('クリック: プライバシーポリシー');
    expect(doc.getElementById('fx-link-modal')).toBeNull();
  });

  it('link-reject-ja: accept では「全てに同意」が押される', async () => {
    const { log } = await runFixture('link-reject-ja.html', 'accept');
    expect(log).toContain('クリック: 全てに同意');
    expect(log).not.toContain('クリック: 全て拒否');
  });
});

describe('fixtures（独自ボタンの取りこぼし。2026-09-08 / gakken.co.jp）', () => {
  it('gakken-like: 断るボタンが無いので非表示にする（「同意」は押さない）', async () => {
    const { outcome, log, doc, elapsed } = await runFixture('gakken-like.html', 'reject');
    expect(outcome).toMatchObject({ status: 'handled', method: 'hide', decision: 'hidden' });
    expect(log).not.toContain('クリック:');
    const banner = doc.getElementById('multiColumn1-13') as HTMLElement;
    expect(banner.style.display).toBe('none');
    expect(elapsed).toBeGreaterThanOrEqual(FALLBACK_GRACE_MS);
  });

  it('gakken-like: fallback=leave なら何も押さず unhandled', async () => {
    const { outcome, log, doc } = await runFixture('gakken-like.html', 'reject', {
      fallbackWhenNoReject: 'leave',
    });
    expect(outcome).toMatchObject({ status: 'unhandled' });
    expect(log).not.toContain('クリック:');
    const banner = doc.getElementById('multiColumn1-13') as HTMLElement;
    expect(banner.style.display).toBe('');
  });
});

describe('fixtures（祖先の本文にだけ Cookie 語がある div soup。2026-09-09）', () => {
  /**
   * `main` / `nav` / `article` を使わないページでは `canUseAncestorText()` が祖先を止めないので、
   * フッターの「Cookie Policy」リンク 1 本で 5 階層ぶんの子孫がすべて `cookieSpecific` になる。
   * 自身の本文にバナー語があることを必須にしないと、規約更新モーダルの「Decline」を押す・
   * 削除確認ダイアログを消す・無関係な固定 UI を押す、が起きる（§5-5-d のハード条件 8.）。
   * `fx-terms-update`（⑤）はバナー語だけを持つので 8. を通ってしまう分——祖先の本文を
   * 根拠にしてよいのは**その祖先自身がバナーらしいとき**だけ、という⒞の限定で止める。
   */
  const traps = ['fx-tos-modal', 'fx-delete-dialog', 'fx-promo', 'fx-newsletter', 'fx-terms-update'];

  it('trap-ancestor-cookie: 1 つも押さず・1 つも消さない（reject / accept どちらでも）', async () => {
    for (const mode of ['reject', 'accept'] as const) {
      const { outcome, log, doc, state } = await runFixture('trap-ancestor-cookie.html', mode);
      expect(outcome, mode).toBeNull();
      // 容器として採用もしない（監視終了時の報告は unhandled ではなく none。§5-7）
      expect(state.detectedAny, mode).toBe(false);
      expect(log, mode).not.toContain('本来は起きないはず');
      for (const id of traps) {
        expect((doc.getElementById(id) as HTMLElement).style.display, `${mode} ${id}`).toBe('');
      }
      expect(doc.querySelectorAll('[data-cookie-autopilot-cloak]'), mode).toHaveLength(0);
      expect(doc.querySelectorAll('[data-cookie-autopilot-hidden]'), mode).toHaveLength(0);
    }
  });
});
