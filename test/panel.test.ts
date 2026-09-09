// 設定パネル層（docs/SPEC.md §5-5-e）の単体テスト。
// 行テキストからのカテゴリ推定・必須系の除外・トグルの読み書き・中止条件を確かめる。

import { afterEach, describe, expect, it } from 'vitest';
import type { EngineEnv } from '../src/engine/env';
import { findContainers } from '../src/engine/detect';
import type { RunDeps } from '../src/engine/run';
import { createRunState } from '../src/engine/run';
import { scoreCandidates } from '../src/engine/candidates';
import type { PanelBefore } from '../src/engine/panel';
import {
  categoryForRow,
  categoryToggles,
  clickTargetFor,
  collectToggles,
  findCloseButton,
  findPanel,
  findSaveButton,
  findSettingsButton,
  isRequiredRow,
  isSelectAllToggle,
  isToggleLocked,
  panelCandidates,
  radioPairs,
  radioSide,
  reachableControls,
  rowTextFor,
  shouldTryPanel,
  toggleState,
  tryPanel,
  wantsCategory,
} from '../src/engine/panel';
import { activeCategories } from '../src/shared/presets';
import { DEFAULT_SETTINGS } from '../src/shared/storage';
import type { CategoryKey, Settings } from '../src/shared/types';
import { setBody, testEnv } from './helpers';

/** 「設定」と「全てに同意する」しか無いバナー（fixtures/panel-ja.html 相当） */
const BAR_HTML = `
  <main><h1>記事</h1><p>本文です。</p></main>
  <div id="bar" class="cookie-bar" style="position:fixed">
    <p>当サイトでは Cookie を使用しています。</p>
    <button id="agree">全てに同意する</button>
    <button id="config">設定</button>
  </div>
`;

interface HarnessExtra {
  mode?: 'reject' | 'accept';
  allowCategories?: readonly CategoryKey[];
  env?: Partial<EngineEnv>;
}

function harness(patch: Partial<Settings> = {}, extra: HarnessExtra = {}): { deps: RunDeps; env: EngineEnv } {
  let clock = 0;
  const env = testEnv({
    sleep: async (ms) => void (clock += ms),
    now: () => clock,
    ...extra.env,
  });
  const deps: RunDeps = {
    doc: document,
    env,
    settings: { ...DEFAULT_SETTINGS, ...patch },
    mode: extra.mode ?? 'reject',
    allowCategories: extra.allowCategories ?? activeCategories(DEFAULT_SETTINGS.allowCategories),
    customRules: [],
    comRules: {},
    isSubFrame: false,
    state: createRunState(env.now()),
  };
  return { deps, env };
}

/** #config を押したらパネルの hidden を外す（サイトの挙動を模す） */
const listeners: EventListener[] = [];
function openPanelOnConfig(panelId = 'panel'): void {
  const listener: EventListener = (event) => {
    if ((event.target as Element).id !== 'config') return;
    document.getElementById(panelId)?.removeAttribute('hidden');
  };
  listeners.push(listener);
  document.addEventListener('click', listener, true);
}

/** バナーとパネルを消す（保存が効いたときのサイトの挙動） */
function closeOnClick(id: string): void {
  const listener: EventListener = (event) => {
    if ((event.target as Element).id !== id) return;
    document.getElementById('bar')?.remove();
    document.getElementById('panel')?.remove();
  };
  listeners.push(listener);
  document.addEventListener('click', listener, true);
}

afterEach(() => {
  for (const listener of listeners) document.removeEventListener('click', listener, true);
  listeners.length = 0;
  document.body.innerHTML = '';
});

/** 採用中の容器と採点結果を作る */
function containerOf(deps: RunDeps) {
  const container = findContainers(deps.doc, deps.env)[0];
  if (!container) throw new Error('容器が見つかりません');
  const candidates = scoreCandidates(container.buttons, deps.mode, {
    cookieSpecific: container.cookieSpecific,
    ageGate: container.ageGate,
  });
  return { container, candidates };
}

async function run(deps: RunDeps) {
  const { container, candidates } = containerOf(deps);
  return tryPanel(deps, { container, candidates, cloak: () => true });
}

describe('カテゴリの推定', () => {
  it('行テキストからカテゴリを引く（最初に一致したもの）', () => {
    expect(categoryForRow('機能 Cookie')).toBe('A');
    expect(categoryForRow('Functional cookies')).toBe('A');
    expect(categoryForRow('アクセス解析')).toBe('B');
    expect(categoryForRow('Analytics cookies')).toBe('B');
    expect(categoryForRow('Performance')).toBe('B');
    expect(categoryForRow('端末への保存')).toBe('D');
    expect(categoryForRow('Device storage')).toBe('D');
    expect(categoryForRow('おすすめの表示')).toBe('E');
    expect(categoryForRow('Personalised content')).toBe('E');
    expect(categoryForRow('広告 Cookie')).toBe('F');
    expect(categoryForRow('Advertising and marketing')).toBe('F');
  });

  it('どれにも当てはまらない行は X（＝許可しない）', () => {
    expect(categoryForRow('ソーシャルメディア')).toBe('X');
    expect(categoryForRow('')).toBe('X');
  });

  it('必須系の行は触らない', () => {
    expect(isRequiredRow('必須 Cookie（常に有効）')).toBe(true);
    expect(isRequiredRow('必要不可欠なもの')).toBe(true);
    expect(isRequiredRow('Strictly necessary cookies')).toBe(true);
    expect(isRequiredRow('Essential (always active)')).toBe(true);
    expect(isRequiredRow('分析 Cookie')).toBe(false);
    expect(isRequiredRow('')).toBe(false);
  });

  it('望む状態は実効カテゴリで決まる。X は許可されていても false', () => {
    expect(wantsCategory('A', ['A'])).toBe(true);
    expect(wantsCategory('B', ['A'])).toBe(false);
    expect(wantsCategory('X', ['A', 'X'])).toBe(false);
  });
});

describe('行テキストの取り出し', () => {
  const env = testEnv();

  it('他のトグルを含まない最小の祖先のテキストを使う', () => {
    setBody(`
      <div id="panel">
        <div class="row"><span>分析 Cookie</span><label class="sw"><input type="checkbox" id="a" /></label></div>
        <div class="row"><span>広告 Cookie</span><label class="sw"><input type="checkbox" id="b" /></label></div>
      </div>
    `);
    const toggles = collectToggles(document);
    expect(toggles).toHaveLength(2);
    expect(rowTextFor(toggles[0] as Element, toggles, env)).toBe('分析 Cookie');
    expect(rowTextFor(toggles[1] as Element, toggles, env)).toBe('広告 Cookie');
  });

  it('祖先からテキストが取れなければ aria-label / name / id で代用する', () => {
    setBody(`
      <div id="panel">
        <div><input type="checkbox" id="x1" aria-label="広告 Cookie" /></div>
        <div><input type="checkbox" name="analytics" /></div>
        <div><input type="checkbox" id="cookie-advertising" /></div>
      </div>
    `);
    const toggles = collectToggles(document);
    expect(rowTextFor(toggles[0] as Element, toggles, env)).toBe('広告 Cookie');
    expect(categoryForRow(rowTextFor(toggles[1] as Element, toggles, env))).toBe('B');
    expect(categoryForRow(rowTextFor(toggles[2] as Element, toggles, env))).toBe('F');
  });

  it('祖先のテキストが 400 文字以上なら使わない（パネル全体の文章を行と取り違えない）', () => {
    setBody(`
      <div id="panel">
        <p>${'あ'.repeat(420)}</p>
        <input type="checkbox" id="lonely" name="advertising" />
      </div>
    `);
    const toggles = collectToggles(document);
    expect(rowTextFor(toggles[0] as Element, toggles, env)).toBe('advertising');
  });
});

describe('トグルの読み書き', () => {
  const env = testEnv();

  it('radio は対象にしない', () => {
    setBody(`
      <div id="panel">
        <input type="checkbox" id="c" />
        <input type="radio" id="r" />
        <div role="switch" aria-checked="true" id="s"></div>
        <div role="radio" aria-checked="true" id="rr"></div>
        <div aria-checked="false" id="ac"></div>
      </div>
    `);
    expect(collectToggles(document).map((el) => el.id)).toEqual(['c', 's', 'ac']);
  });

  it('checkbox は checked、それ以外は aria-checked で状態を読む', () => {
    setBody(`
      <div id="panel">
        <input type="checkbox" id="on" checked />
        <input type="checkbox" id="off" />
        <div role="switch" aria-checked="true" id="son"></div>
        <div role="switch" aria-checked="false" id="soff"></div>
      </div>
    `);
    expect(toggleState(document.getElementById('on') as Element)).toBe(true);
    expect(toggleState(document.getElementById('off') as Element)).toBe(false);
    expect(toggleState(document.getElementById('son') as Element)).toBe(true);
    expect(toggleState(document.getElementById('soff') as Element)).toBe(false);
  });

  it('disabled / aria-disabled / readonly は触らない', () => {
    setBody(`
      <div id="panel">
        <input type="checkbox" id="normal" />
        <input type="checkbox" id="disabled" disabled />
        <input type="checkbox" id="readonly" readonly />
        <div role="switch" aria-checked="true" aria-disabled="true" id="ariadisabled"></div>
      </div>
    `);
    expect(isToggleLocked(document.getElementById('normal') as Element)).toBe(false);
    expect(isToggleLocked(document.getElementById('disabled') as Element)).toBe(true);
    expect(isToggleLocked(document.getElementById('readonly') as Element)).toBe(true);
    expect(isToggleLocked(document.getElementById('ariadisabled') as Element)).toBe(true);
  });

  it('不可視の input は label[for] か祖先の label を押す', () => {
    setBody(`
      <div id="panel">
        <input type="checkbox" id="hidden1" style="display:none" />
        <label for="hidden1" id="label1">分析</label>
        <label id="label2"><input type="checkbox" id="hidden2" style="display:none" />広告</label>
        <label id="label3"><input type="checkbox" id="shown" />機能</label>
      </div>
    `);
    const panel = document.getElementById('panel') as Element;
    expect(clickTargetFor(document.getElementById('hidden1') as Element, panel, env).id).toBe('label1');
    expect(clickTargetFor(document.getElementById('hidden2') as Element, panel, env).id).toBe('label2');
    // 見えている input はそのまま押す
    expect(clickTargetFor(document.getElementById('shown') as Element, panel, env).id).toBe('shown');
  });
});

describe('ボタンの選び方', () => {
  const env = testEnv();

  it('設定ボタンを容器の中から探す（実リンクと HARD 禁止語は除く）', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>Cookie を使用しています。</p>
        <a href="/policy">Cookie 設定のご案内</a>
        <button id="agree">全てに同意する</button>
        <button id="config">設定</button>
      </div>
    `);
    const { deps } = harness();
    const { container } = containerOf(deps);
    expect(findSettingsButton(container.buttons)?.el.id).toBe('config');
  });

  it('実リンクの「設定」は設定ボタンにしない（押すと別ページへ遷移する）', () => {
    setBody(`
      <div id="bar" role="dialog" aria-modal="true" style="position:fixed">
        <p>当サイトでは Cookie を使用します。</p>
        <a id="config" href="/settings">設定</a>
        <a id="wrapped" href="/settings2"><span class="btn">設定</span></a>
        <a id="agree" href="/consent/all">全てに同意</a>
      </div>
    `);
    const { deps } = harness();
    const { container } = containerOf(deps);
    // 実リンクでも「全てに同意」は候補に入るが（§5-5-d）、設定ボタンには選ばない
    expect(container.buttons.map((button) => button.el.id)).toEqual(['agree']);
    expect(findSettingsButton(container.buttons)).toBeNull();

    // 候補に混ざっていても（リンク自身・リンクの中の要素とも）設定ボタンにはしない
    const link = document.getElementById('config') as Element;
    const inner = document.querySelector('#wrapped .btn') as Element;
    expect(findSettingsButton([{ el: link, text: '設定', label: '設定', index: 0 }])).toBeNull();
    expect(findSettingsButton([{ el: inner, text: '設定', label: '設定', index: 0 }])).toBeNull();
  });

  it('保存ボタンは拒否語が最優先、次に保存語', () => {
    setBody(`
      <div id="panel" role="dialog">
        <button id="save">選択を保存</button>
        <button id="reject">全て拒否</button>
      </div>
    `);
    const panel = document.getElementById('panel') as Element;
    expect(findSaveButton(panel, env)).toMatchObject({ kind: 'reject' });
    document.getElementById('reject')?.remove();
    expect(findSaveButton(panel, env)).toMatchObject({ kind: 'save', text: '選択を保存' });
  });

  it('「設定の保存」系の言い回しも保存ボタンにする（F3）', () => {
    for (const label of ['設定の保存', '選択の保存', '保存する', '選んだ設定を保存', 'この設定で保存']) {
      setBody(`
        <div id="panel" role="dialog">
          <button id="save">${label}</button>
          <button id="agree">全てに同意</button>
        </div>
      `);
      const save = findSaveButton(document.getElementById('panel') as Element, env);
      expect(save, label).toMatchObject({ kind: 'save' });
      expect(save?.el.id, label).toBe('save');
    }
  });

  it('「全てに同意」は保存ボタンにしない（F3）', () => {
    setBody(`
      <div id="panel" role="dialog">
        <button id="agree">全てに同意</button>
      </div>
    `);
    expect(findSaveButton(document.getElementById('panel') as Element, env)).toBeNull();
  });

  it('「設定を送信」型はパネル層に限って保存ボタンにする（ROUND2-002）', () => {
    for (const label of ['設定を送信', '選択を送信', 'Submit preferences', 'Submit my choices', 'Submit settings']) {
      setBody(`
        <div id="panel" role="dialog">
          <button id="save">${label}</button>
          <button id="agree">全てに同意</button>
        </div>
      `);
      const save = findSaveButton(document.getElementById('panel') as Element, env);
      expect(save, label).toMatchObject({ kind: 'save' });
      expect(save?.el.id, label).toBe('save');
    }
  });

  it('submit 句と別の HARD 禁止語が同居するラベルは保存ボタンにしない（免除は submit 句だけ）', () => {
    for (const label of ['設定を送信して登録', 'Submit my choices and subscribe']) {
      setBody(`
        <div id="panel" role="dialog">
          <button id="save">${label}</button>
          <button id="agree">全てに同意</button>
        </div>
      `);
      expect(findSaveButton(document.getElementById('panel') as Element, env), label).toBeNull();
    }
    for (const label of ['設定を送信', 'Submit Preferences']) {
      setBody(`
        <div id="panel" role="dialog">
          <button id="save">${label}</button>
          <button id="agree">全てに同意</button>
        </div>
      `);
      const save = findSaveButton(document.getElementById('panel') as Element, env);
      expect(save, label).toMatchObject({ kind: 'save' });
      expect(save?.el.id, label).toBe('save');
    }
    for (const label of ['送信', 'Submit']) {
      setBody(`
        <div id="panel" role="dialog">
          <button id="send">${label}</button>
        </div>
      `);
      expect(findSaveButton(document.getElementById('panel') as Element, env), label).toBeNull();
    }
  });

  it('裸の「送信」「Submit」は保存ボタンにしない（HARD 禁止語のまま）', () => {
    for (const label of ['送信', '送信する', 'Submit', 'Submit form', '保存して送信']) {
      setBody(`
        <div id="panel" role="dialog">
          <button id="send">${label}</button>
        </div>
      `);
      expect(findSaveButton(document.getElementById('panel') as Element, env), label).toBeNull();
    }
  });

  it('「すべて許可して保存」と HARD 禁止語は保存ボタンにしない', () => {
    setBody(`
      <div id="panel" role="dialog">
        <button id="allow">すべて許可して保存</button>
        <button id="send">保存して送信</button>
      </div>
    `);
    expect(findSaveButton(document.getElementById('panel') as Element, env)).toBeNull();
  });
});

describe('発動条件', () => {
  it('reject モード・Cookie 固有語・断る候補なし・未実行のときだけ試す', () => {
    setBody(BAR_HTML);
    const { deps } = harness();
    const { container, candidates } = containerOf(deps);
    expect(shouldTryPanel(deps, container, candidates)).toBe(true);

    const accept = harness({}, { mode: 'accept' }).deps;
    expect(shouldTryPanel(accept, container, candidates)).toBe(false);

    deps.state.panelTried = true;
    expect(shouldTryPanel(deps, container, candidates)).toBe(false);
    deps.state.panelTried = false;

    expect(shouldTryPanel(deps, { ...container, cookieSpecific: false }, candidates)).toBe(false);
  });

  it('断る候補があるときは試さない', () => {
    setBody(`
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>Cookie を使用しています。</p>
        <button id="deny">拒否</button>
        <button id="config">設定</button>
      </div>
    `);
    const { deps } = harness();
    const { container, candidates } = containerOf(deps);
    expect(candidates[0]?.kind).toBe('reject-strong');
    expect(shouldTryPanel(deps, container, candidates)).toBe(false);
  });

  it('監視窓の残りが時間予算に満たないときは試さない', () => {
    setBody(BAR_HTML);
    const { deps } = harness({ observeSeconds: 5 });
    const { container, candidates } = containerOf(deps);
    expect(shouldTryPanel(deps, container, candidates)).toBe(false);
  });
});

describe('パネルの検出と中止条件', () => {
  it('設定を押してパネルが出なければ何も返さない', async () => {
    setBody(BAR_HTML);
    const { deps } = harness();
    expect(await run(deps)).toBeNull();
    expect(deps.state.panelTried).toBe(true);
  });

  it('容器の中にトグルが現れたら、その場展開として扱う', () => {
    setBody(`
      <main><h1>記事</h1></main>
      <div id="bar" class="cookie-bar" style="position:fixed">
        <p>当サイトでは Cookie を使用しています。</p>
        <button id="agree">全てに同意する</button>
        <button id="config">設定</button>
        <div id="rows" hidden>
          <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
        </div>
      </div>
    `);
    const { deps } = harness();
    const { container } = containerOf(deps);
    openPanelOnConfig('rows');
    document.getElementById('config')?.click();
    expect(findPanel(container.el, deps)).toBe(container.el);
  });

  it('設定を押す前から見えている固定ウィジェットはパネルにしない', async () => {
    setBody(`${BAR_HTML}
      <div id="widget" role="dialog" style="position:fixed">
        <p>通知の設定</p>
        <label><input type="checkbox" id="notify" checked />メールでお知らせ</label>
        <button id="store">保存</button>
      </div>
    `);
    const { deps } = harness();
    const result = await run(deps);
    // パネルが出てこなかった扱いになり、ウィジェットには触らない
    expect(result).toBeNull();
    expect((document.getElementById('notify') as HTMLInputElement).checked).toBe(true);
  });

  it('入力欄のあるパネルはトグルに触らず中止する', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定</p>
        <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
        <input type="text" id="keyword" />
        <button id="save">選択を保存</button>
      </div>
    `);
    openPanelOnConfig();
    const { deps } = harness();
    const result = await run(deps);
    expect(result?.outcome).toBeUndefined();
    expect(result?.panel?.id).toBe('panel');
    expect((document.getElementById('analytics') as HTMLInputElement).checked).toBe(true);
  });

  it('危険文脈語のあるパネルはトグルに触らず中止する', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定。アカウントを削除する場合もこちらから。</p>
        <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
        <button id="save">選択を保存</button>
      </div>
    `);
    openPanelOnConfig();
    const { deps } = harness();
    const result = await run(deps);
    expect(result?.outcome).toBeUndefined();
    expect((document.getElementById('analytics') as HTMLInputElement).checked).toBe(true);
  });

  it('「設定を送信」があっても、その言い回しだけを除いて危険文脈語を判定するので中止しない（ROUND2-002 追補）', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定</p>
        <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
        <button id="save">設定を送信</button>
      </div>
    `);
    openPanelOnConfig();
    closeOnClick('save');
    const { deps } = harness();

    const result = await run(deps);
    expect(result?.outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      clickedText: '設定を送信',
    });
  });

  it('「お問い合わせを送信」「アカウントを削除」のような本物の危険文脈は、「設定を送信」があっても中止する', async () => {
    for (const context of ['お問い合わせを送信する場合もこちらから。', 'アカウントを削除する場合もこちらから。']) {
      setBody(`${BAR_HTML}
        <div id="panel" role="dialog" hidden>
          <p>Cookie の設定。${context}</p>
          <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
          <button id="save">設定を送信</button>
        </div>
      `);
      openPanelOnConfig();
      const { deps } = harness();
      const result = await run(deps);
      expect(result?.outcome, context).toBeUndefined();
      expect((document.getElementById('analytics') as HTMLInputElement).checked, context).toBe(true);
    }
  });

  it('保存にも「閉じる」にも使えるボタンが無ければトグルに触らず中止する', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定</p>
        <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
        <button id="more">詳細を見る</button>
      </div>
    `);
    openPanelOnConfig();
    const { deps } = harness();
    const result = await run(deps);
    expect(result?.outcome).toBeUndefined();
    expect(result?.panel?.id).toBe('panel');
    expect((document.getElementById('analytics') as HTMLInputElement).checked).toBe(true);
  });

  it('触れるトグルが必須系だけなら中止する', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定</p>
        <label><input type="checkbox" id="essential" checked />必須 Cookie（常に有効）</label>
        <button id="save">選択を保存</button>
      </div>
    `);
    openPanelOnConfig();
    const { deps } = harness();
    const result = await run(deps);
    expect(result?.outcome).toBeUndefined();
    expect((document.getElementById('essential') as HTMLInputElement).checked).toBe(true);
  });
});

describe('パネルの操作', () => {
  const PANEL_HTML = `${BAR_HTML}
    <div id="panel" role="dialog" hidden>
      <p>Cookie の設定</p>
      <label><input type="checkbox" id="essential" checked disabled />必須 Cookie（常に有効）</label>
      <label><input type="checkbox" id="functional" checked />機能 Cookie</label>
      <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
      <label><input type="checkbox" id="ads" checked />広告 Cookie</label>
      <button id="save">選択を保存</button>
    </div>
  `;

  it('許可カテゴリだけ残して保存する', async () => {
    setBody(PANEL_HTML);
    openPanelOnConfig();
    closeOnClick('save');
    const { deps } = harness();

    const result = await run(deps);
    expect(result?.outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      allowed: ['A'],
      clickedText: '選択を保存',
      clickedLabel: '選択を保存',
    });
  });

  it('許可カテゴリが無ければ機能も外す', async () => {
    setBody(PANEL_HTML);
    openPanelOnConfig();
    const { deps } = harness({}, { allowCategories: [] });

    const result = await run(deps);
    // 保存しても閉じないサイトなので成功にはならないが、トグルの状態は望みどおりになる
    expect(result?.outcome).toBeUndefined();
    expect((document.getElementById('functional') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('analytics') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('ads') as HTMLInputElement).checked).toBe(false);
    // disabled な必須は触らない
    expect((document.getElementById('essential') as HTMLInputElement).checked).toBe(true);
  });

  it('保存しても消えなければ失敗（パネルは返すので fallback で消せる）', async () => {
    setBody(PANEL_HTML);
    openPanelOnConfig();
    const { deps } = harness();
    const result = await run(deps);
    expect(result?.outcome).toBeUndefined();
    expect(result?.panel?.id).toBe('panel');
  });

  it('パネルに拒否ボタンがあればトグルに触らずそれを押す', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定</p>
        <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
        <button id="rejectall">全て拒否</button>
        <button id="save">選択を保存</button>
      </div>
    `);
    openPanelOnConfig();
    closeOnClick('rejectall');
    const { deps } = harness();

    const result = await run(deps);
    expect(result?.outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      decision: 'granular',
      allowed: [],
      clickedText: '全て拒否',
    });
  });
});

describe('パネル内の「すべてオフ」（B）', () => {
  const env = testEnv();

  it('「すべてオフ」系の言い回しも拒否ボタンにする', () => {
    for (const label of ['すべてオフにする', '全ての項目を無効にする', 'すべての選択を解除', 'Turn all off', 'Disable all']) {
      setBody(`
        <div id="panel" role="dialog">
          <button id="alloff">${label}</button>
          <button id="save">選択を保存</button>
        </div>
      `);
      const save = findSaveButton(document.getElementById('panel') as Element, env);
      expect(save, label).toMatchObject({ kind: 'reject' });
      expect(save?.el.id, label).toBe('alloff');
    }
  });

  it('「すべてオフにする」はトグルに触れずに押される', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定</p>
        <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
        <button id="alloff">すべてオフにする</button>
        <button id="save">選択を保存</button>
      </div>
    `);
    openPanelOnConfig();
    const analytics = document.getElementById('analytics') as HTMLInputElement;
    closeOnClick('alloff');
    const { deps } = harness();

    const result = await run(deps);
    expect(result?.outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      decision: 'granular',
      allowed: [],
      clickedText: 'すべてオフにする',
    });
    // トグルには触らない（押した先のサイトが落とす）
    expect(analytics.checked).toBe(true);
  });
});

describe('許可 / 拒否のラジオ（A）', () => {
  const env = testEnv();

  /** 「名前 + [許可][拒否]」の 1 行 */
  function radioRow(name: string, label: string, checked: 'allow' | 'deny'): string {
    return `
      <div class="row">
        <span class="name">${label}</span>
        <label><input type="radio" name="${name}" ${checked === 'allow' ? 'checked' : ''} />許可</label>
        <label><input type="radio" name="${name}" ${checked === 'deny' ? 'checked' : ''} />拒否</label>
      </div>
    `;
  }

  const RADIO_PANEL_HTML = `${BAR_HTML}
    <div id="panel" role="dialog" hidden>
      <p>Cookie の設定</p>
      ${radioRow('pref', '設定の記憶', 'deny')}
      ${radioRow('analytics', '分析 Cookie', 'allow')}
      ${radioRow('ads', '広告 Cookie', 'allow')}
      <button id="save">選択を保存</button>
    </div>
  `;

  it('行文言から許可寄り / 拒否寄りを見分ける（否定形は拒否側）', () => {
    expect(radioSide('許可する')).toBe('allow');
    expect(radioSide('有効')).toBe('allow');
    expect(radioSide('オン')).toBe('allow');
    expect(radioSide('Allow')).toBe('allow');
    expect(radioSide('On')).toBe('allow');
    expect(radioSide('拒否する')).toBe('deny');
    expect(radioSide('無効')).toBe('deny');
    expect(radioSide('オフ')).toBe('deny');
    expect(radioSide('Off')).toBe('deny');
    expect(radioSide('Deny')).toBe('deny');
    // 「許可しない」は許可語に部分一致するが拒否側
    expect(radioSide('許可しない')).toBe('deny');
    expect(radioSide('同意しない')).toBe('deny');
    // どちらとも読めない行は触らない
    expect(radioSide('あとで決める')).toBeNull();
    expect(radioSide('')).toBeNull();
  });

  it('同じ name の 2 択だけをペアにする', () => {
    setBody(RADIO_PANEL_HTML);
    const pairs = radioPairs(document.getElementById('panel') as Element, env);
    expect(pairs.map((pair) => pair.category)).toEqual(['A', 'B', 'F']);
    expect(pairs[0]?.rowText).toBe('設定の記憶 許可 拒否');
    expect((pairs[0]?.deny as HTMLInputElement).checked).toBe(true);
  });

  it('グループが 1 つだけでも、パネル全体の見出しからカテゴリを引かない', () => {
    setBody(`
      <div id="panel" role="dialog">
        <h2>Cookie の設定</h2>
        <div class="opts">
          <label><input type="radio" name="ads" checked /> 許可</label>
          <label><input type="radio" name="ads" /> 拒否</label>
        </div>
        <button id="save">選択を保存</button>
      </div>
    `);
    const pairs = radioPairs(document.getElementById('panel') as Element, env);
    expect(pairs).toHaveLength(1);
    // 行に名前が無いので X（＝許可しない）。見出しの「設定」で A に化けさせない
    expect(pairs[0]?.rowText).toBe('許可 拒否');
    expect(pairs[0]?.category).toBe('X');
  });

  it('3 つ以上の選択肢と、片側しか読めないグループは扱わない', () => {
    setBody(`
      <div id="panel" role="dialog">
        <div class="row">
          <span>分析 Cookie</span>
          <label><input type="radio" name="analytics" />許可</label>
          <label><input type="radio" name="analytics" />一部のみ</label>
          <label><input type="radio" name="analytics" checked />拒否</label>
        </div>
        <div class="row">
          <span>広告 Cookie</span>
          <label><input type="radio" name="ads" checked />あとで決める</label>
          <label><input type="radio" name="ads" />いまは決めない</label>
        </div>
        <div class="row">
          <span>おすすめ表示</span>
          <label><input type="radio" name="reco" checked />許可</label>
          <label><input type="radio" name="reco" />許可する</label>
        </div>
      </div>
    `);
    expect(radioPairs(document.getElementById('panel') as Element, env)).toEqual([]);
  });

  it('ほどよく守る（A のみ許可）では設定の記憶が許可側、分析と広告が拒否側になる', async () => {
    setBody(RADIO_PANEL_HTML);
    openPanelOnConfig();
    const panel = document.getElementById('panel') as Element;
    closeOnClick('save');
    const { deps } = harness();

    const result = await run(deps);
    expect(result?.outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      decision: 'granular',
      allowed: ['A'],
      clickedText: '選択を保存',
    });

    const checked = (name: string): string[] =>
      Array.from(panel.querySelectorAll(`input[name="${name}"]`))
        .filter((input) => (input as HTMLInputElement).checked)
        .map((input) => (input.closest('label') as HTMLElement).textContent?.trim() ?? '');
    expect(checked('pref')).toEqual(['許可']);
    expect(checked('analytics')).toEqual(['拒否']);
    expect(checked('ads')).toEqual(['拒否']);
  });

  it('3 択しか無いパネルは触らずに中止する', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定</p>
        <div class="row">
          <span>分析 Cookie</span>
          <label><input type="radio" id="on" name="analytics" checked />許可</label>
          <label><input type="radio" id="some" name="analytics" />一部のみ</label>
          <label><input type="radio" id="off" name="analytics" />拒否</label>
        </div>
        <button id="save">選択を保存</button>
      </div>
    `);
    openPanelOnConfig();
    const { deps } = harness();

    const result = await run(deps);
    expect(result?.outcome).toBeUndefined();
    expect(result?.panel?.id).toBe('panel');
    expect((document.getElementById('on') as HTMLInputElement).checked).toBe(true);
  });
});

describe('アコーディオン展開型のパネル検出（C）', () => {
  /** 元から可視の容器の中に、あとからトグルが現れる構造 */
  const ACCORDION_HTML = `
    <main><h1>記事</h1></main>
    <div id="bar" class="cookie-bar" style="position:fixed">
      <p>当サイトでは Cookie を使用しています。</p>
      <button id="agree">全てに同意する</button>
      <button id="config">設定</button>
    </div>
    <div id="panel" class="cookie-details">
      <h2>Cookie の設定</h2>
      <ul id="rows" hidden>
        <li><label><input type="checkbox" id="analytics" checked />分析 Cookie</label></li>
        <li><label><input type="checkbox" id="ads" checked />広告 Cookie</label></li>
      </ul>
      <button id="save">選択を保存</button>
    </div>
  `;

  /** tryPanel が設定ボタンを押す前に取る記録と同じもの */
  function snapshot(origin: Element, deps: RunDeps): PanelBefore {
    return {
      containers: new Set(panelCandidates(origin, deps)),
      controls: new Set(reachableControls(deps.doc, deps.env)),
    };
  }

  it('操作できるトグルが増えたら、保存ボタンまで含む祖先をパネルとみなす', () => {
    setBody(ACCORDION_HTML);
    const { deps } = harness();
    const { container } = containerOf(deps);
    const before = snapshot(container.el, deps);

    // 押す前はパネルではない（容器は元から可視で、トグルはまだ操作できない）
    expect(findPanel(container.el, deps, before)).toBeNull();

    openPanelOnConfig('rows');
    document.getElementById('config')?.click();
    expect(findPanel(container.el, deps, before)?.id).toBe('panel');
  });

  it('元から操作できたトグルだけならパネルにしない', () => {
    setBody(ACCORDION_HTML.replace('<ul id="rows" hidden>', '<ul id="rows">'));
    const { deps } = harness();
    const { container } = containerOf(deps);
    expect(findPanel(container.el, deps, snapshot(container.el, deps))).toBeNull();
  });

  it('開いたパネルのチェックを外して保存する', async () => {
    setBody(ACCORDION_HTML);
    openPanelOnConfig('rows');
    closeOnClick('save');
    const { deps } = harness();

    const result = await run(deps);
    expect(result?.outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      decision: 'granular',
      allowed: [],
      clickedText: '選択を保存',
    });
  });
});

describe('保存ボタンが無いパネルの「閉じる」（D）', () => {
  const env = testEnv();

  it('閉じる語のボタンだけを最後の手段にする', () => {
    setBody(`
      <div id="panel" role="dialog">
        <button id="more">詳細を見る</button>
        <button id="close">閉じる</button>
      </div>
    `);
    const panel = document.getElementById('panel') as Element;
    expect(findSaveButton(panel, env)).toBeNull();
    expect(findCloseButton(panel, env)).toMatchObject({ kind: 'close', el: { id: 'close' } });
  });

  it('トグルを望む状態にしてから「閉じる」を押す', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定</p>
        <label><input type="checkbox" id="functional" checked />機能 Cookie</label>
        <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
        <button id="close">閉じる</button>
      </div>
    `);
    openPanelOnConfig();
    const functional = document.getElementById('functional') as HTMLInputElement;
    const analytics = document.getElementById('analytics') as HTMLInputElement;
    closeOnClick('close');
    const { deps } = harness();

    const result = await run(deps);
    expect(result?.outcome).toMatchObject({
      status: 'handled',
      method: 'panel',
      action: 'reject',
      decision: 'granular',
      // 既定の「ほどよく守る」は A（機能）だけ許可する
      allowed: ['A'],
      clickedText: '閉じる',
    });
    expect(functional.checked).toBe(true);
    expect(analytics.checked).toBe(false);
  });

  it('操作できないトグルが残るなら、閉じる経路には進まない', async () => {
    setBody(`${BAR_HTML}
      <div id="panel" role="dialog" hidden>
        <p>Cookie の設定</p>
        <label><input type="checkbox" id="analytics" checked />分析 Cookie</label>
        <label><input type="checkbox" id="ads" checked disabled />広告 Cookie</label>
        <button id="close">閉じる</button>
      </div>
    `);
    openPanelOnConfig();
    const { deps } = harness();

    const result = await run(deps);
    expect(result?.outcome).toBeUndefined();
    expect(result?.panel?.id).toBe('panel');
    expect((document.getElementById('analytics') as HTMLInputElement).checked).toBe(true);
  });

  it('保存ボタンがあるときは「閉じる」を使わない', () => {
    setBody(`
      <div id="panel" role="dialog">
        <button id="close">閉じる</button>
        <button id="save">選択を保存</button>
      </div>
    `);
    const panel = document.getElementById('panel') as Element;
    expect(findSaveButton(panel, env)).toMatchObject({ kind: 'save', el: { id: 'save' } });
  });
});

describe('入れ子のパネル（mercedes-benz 型。F4）', () => {
  /** カテゴリのチェックボックスの下に個別サービスのチェックボックスがぶら下がる構造 */
  const NESTED_HTML = `${BAR_HTML}
    <div id="panel" role="dialog" hidden>
      <p>Cookie の設定</p>
      <ul>
        <li class="select-all-item">
          <label class="select-all--label">
            <input type="checkbox" class="cmm-checkbox-input--category" data-test="handle-select-all-change" id="select-all" />すべて選択する
          </label>
        </li>
        <li class="category-item">
          <div class="category-select-all">
            <label><input type="checkbox" id="cat-essential" class="selected-all" checked disabled data-test="handle-category-change" />必須Cookie</label>
          </div>
          <ul class="consent-list">
            <li class="consent-item"><label><input type="checkbox" id="svc-essential-1" checked disabled />Usercentrics Consent Management Platform | JP</label></li>
            <li class="consent-item"><label><input type="checkbox" id="svc-essential-2" checked disabled />Session Cookie</label></li>
          </ul>
        </li>
        <li class="category-item">
          <div class="category-select-all">
            <label><input type="checkbox" id="cat-analytics" class="selected-all" checked data-test="handle-category-change" />分析と統計</label>
          </div>
          <ul class="consent-list">
            <li class="consent-item"><label><input type="checkbox" id="svc-analytics-1" checked />Google Analytics | JP</label></li>
            <li class="consent-item"><label><input type="checkbox" id="svc-analytics-2" checked />Adobe Analytics</label></li>
          </ul>
        </li>
        <li class="category-item">
          <div class="category-select-all">
            <label><input type="checkbox" id="cat-marketing" class="selected-all" checked data-test="handle-category-change" />マーケティング</label>
          </div>
          <ul class="consent-list">
            <li class="consent-item"><label><input type="checkbox" id="svc-marketing-1" checked />Google Ads</label></li>
          </ul>
        </li>
        <li class="category-item">
          <div class="category-select-all">
            <label><input type="checkbox" id="cat-share" class="selected-all" checked data-test="handle-category-change" />メルセデス・ベンツ関連会社へのデータ共有</label>
          </div>
          <ul class="consent-list">
            <li class="consent-item"><label><input type="checkbox" id="svc-share-1" checked />Mercedes-Benz Group</label></li>
          </ul>
        </li>
      </ul>
      <button id="save">設定の保存</button>
      <button id="acceptall">全てに同意</button>
    </div>
  `;

  const idsOf = (elements: readonly Element[]): string[] => elements.map((el) => el.id);

  it('カテゴリ側のトグルだけをカテゴリ級とみなす（個別サービスは含めない）', () => {
    setBody(NESTED_HTML);
    const toggles = collectToggles(document.getElementById('panel') as Element);
    expect(idsOf(categoryToggles(toggles))).toEqual([
      'select-all',
      'cat-essential',
      'cat-analytics',
      'cat-marketing',
      'cat-share',
    ]);
  });

  it('入れ子のない 1 段のパネルではカテゴリ級を作らない（従来どおり全トグルを扱う）', () => {
    setBody(`
      <div id="panel">
        <ul>
          <li><label><input type="checkbox" id="a" checked />分析 Cookie</label></li>
          <li><label><input type="checkbox" id="b" checked />広告 Cookie</label></li>
        </ul>
      </div>
    `);
    expect(categoryToggles(collectToggles(document.getElementById('panel') as Element))).toEqual([]);
  });

  it('「すべて選択する」は行テキストでも data-test でも除外する', () => {
    setBody(NESTED_HTML);
    const selectAll = document.getElementById('select-all') as Element;
    expect(isSelectAllToggle(selectAll, 'すべて選択する')).toBe(true);
    // 行テキストが取れなくても属性で分かる
    expect(isSelectAllToggle(selectAll, '')).toBe(true);
    expect(isSelectAllToggle(document.getElementById('cat-analytics') as Element, '分析と統計')).toBe(false);
    // カテゴリの `selected-all` は「すべて選択する」ではない
    expect(isSelectAllToggle(document.getElementById('cat-share') as Element, '')).toBe(false);
  });

  it('カテゴリだけを操作し、個別トグルと「すべて選択する」には触らない', async () => {
    setBody(NESTED_HTML);
    openPanelOnConfig();
    // カテゴリを外すと配下の個別チェックも外れる（実サイトと同じ）
    const listener: EventListener = (event) => {
      const input = event.target as HTMLInputElement;
      if (!input.id?.startsWith('cat-')) return;
      const item = input.closest('.category-item');
      item?.querySelectorAll('.consent-item input').forEach((child) => {
        (child as HTMLInputElement).checked = input.checked;
      });
    };
    document.addEventListener('click', listener, true);
    closeOnClick('save');
    const { deps } = harness();
    // 保存するとパネルごと DOM から外れるので、状態を読む先を先に押さえておく
    const panel = document.getElementById('panel') as Element;

    try {
      const result = await run(deps);
      expect(result?.outcome).toMatchObject({
        status: 'handled',
        method: 'panel',
        decision: 'granular',
        allowed: [],
        clickedText: '設定の保存',
      });
    } finally {
      document.removeEventListener('click', listener, true);
    }

    const checked = (id: string): boolean =>
      (panel.querySelector(`#${id}`) as HTMLInputElement).checked;
    // 分析（B）・マーケティング（F）・データ共有（X）はどれも許可しないので off
    expect(checked('cat-analytics')).toBe(false);
    expect(checked('cat-marketing')).toBe(false);
    expect(checked('cat-share')).toBe(false);
    // 配下はサイト側が追随しただけ。必須と「すべて選択する」は触らない
    expect(checked('cat-essential')).toBe(true);
    expect(checked('svc-essential-1')).toBe(true);
    expect(checked('select-all')).toBe(false);
  });
});

describe('カテゴリ推定の優先順', () => {
  it('「広告の設定」は設定（A）ではなく広告（F）にする', () => {
    expect(categoryForRow('広告の設定')).toBe('F');
    expect(categoryForRow('広告表示の機能')).toBe('F');
  });

  it('「分析の設定」は分析（B）にする', () => {
    expect(categoryForRow('分析の設定')).toBe('B');
  });

  it('設定・機能だけの行は A のまま', () => {
    expect(categoryForRow('サイトの設定を覚える')).toBe('A');
  });

  it('mercedes-benz 型のカテゴリ名を引く（F5）', () => {
    expect(categoryForRow('分析と統計')).toBe('B');
    expect(categoryForRow('マーケティング')).toBe('F');
    // データ共有は用途が分からないので X（＝許可しない）のまま
    expect(categoryForRow('メルセデス・ベンツ関連会社へのデータ共有')).toBe('X');
  });

  it('共有・第三者提供の行は X のまま（許可しない）', () => {
    for (const row of ['データ共有', 'Data sharing', 'パートナーへの提供', 'Partner services', '第三者提供', 'Third party services']) {
      expect(categoryForRow(row), row).toBe('X');
    }
  });
});
