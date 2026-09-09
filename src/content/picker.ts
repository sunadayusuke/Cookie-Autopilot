// ボタンを教える（docs/SPEC.md §6）

import { setCloakSuspended, setHiddenSuspended } from '../engine/cloak';
import { elementText } from '../engine/normalize';
import { isForbiddenHard } from '../shared/phrases';

/** picker で拾えるクリック可能要素 */
const PICKABLE = 'button, a, [role="button"], input';
/** 自分 + 最大 3 階層上まで遡る */
const MAX_DEPTH = 3;
const Z_INDEX = '2147483647';
/** トーストの背景（既定 / 登録を断ったとき。docs/DESIGN.md の --wb-900 / --danger-fg） */
const TOAST_BG = '#111827';
const TOAST_BG_DANGER = '#ce0000';
/** 登録を断ったメッセージを出しておく時間 */
const REJECT_TOAST_MS = 2400;

/** 登録を断る理由（トーストに出す文言） */
const REJECT_FORBIDDEN = 'このボタンは登録できません（購入・削除など危険な操作に見えます）';
const REJECT_NO_TEXT = '文言のないボタンは登録できません。文字の入ったボタンを選んでください';

/** 安定セレクタに使う属性（優先順） */
const STABLE_ATTRS = ['data-testid', 'data-test', 'data-tid', 'data-cy', 'data-hook', 'name', 'aria-label'] as const;

export interface PickerOptions {
  doc: Document;
  action: 'reject' | 'accept';
  onPicked(picked: { el: Element; selector?: string; text: string }): void | Promise<void>;
  onCancel?(): void;
}

/** picker 中に握りつぶすポインタ系イベント（click だけでは押下時に反応するサイトがある） */
const SWALLOWED_EVENTS = ['mousedown', 'pointerdown', 'mouseup', 'pointerup'] as const;

interface PickerSession {
  doc: Document;
  root: HTMLElement;
  highlight: HTMLElement;
  toast: HTMLElement;
  action: 'reject' | 'accept';
  /** 「登録できません」を出しているときの復帰タイマー */
  rejectTimer: ReturnType<typeof setTimeout> | null;
  onMouseMove(event: Event): void;
  onClick(event: Event): void;
  onKeyDown(event: Event): void;
  onSwallow(event: Event): void;
  onCancel?(): void;
}

let session: PickerSession | null = null;

// ---------------------------------------------------------------------------
// セレクタ生成
// ---------------------------------------------------------------------------

function isStableId(id: string): boolean {
  return /^[A-Za-z]/.test(id) && id.length < 40 && !/\d{3,}/.test(id);
}

function isStableClass(className: string): boolean {
  if (className === '' || className.length > 30) return false;
  if (/^css-[0-9a-z]+$/i.test(className)) return false;
  if (/\d{3,}/.test(className)) return false;
  return true;
}

function escapeIdent(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/([^\w-])/g, '\\$1');
}

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isUnique(scope: ParentNode, selector: string, el: Element): boolean {
  try {
    const found = scope.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** どのサイトにもある汎用クラス・状態クラス（単独では要素を特定できない） */
const GENERIC_CLASS =
  /^(btn|button|primary|secondary|tertiary|active|selected|open|show|shown|visible|hidden|disabled|default|link|large|small|medium|is-[a-z-]+|js-[a-z-]+)$/i;

function isGenericClass(className: string): boolean {
  return GENERIC_CLASS.test(className);
}

function classSelector(el: Element): string | null {
  const classes = Array.from(el.classList).filter(isStableClass);
  if (classes.length === 0) return null;
  return `${el.tagName.toLowerCase()}.${classes.map(escapeIdent).join('.')}`;
}

/** 汎用・状態クラスしか無いセレクタは、祖先を前置しない限り採用しない */
function isGenericSelector(el: Element): boolean {
  const classes = Array.from(el.classList).filter(isStableClass);
  return classes.length === 0 || classes.every(isGenericClass);
}

/** 祖先に前置できるセレクタ（id 持ち or 安定クラス持ち） */
function ancestorSelector(el: Element): string | null {
  const id = el.getAttribute('id');
  if (id && isStableId(id)) return `#${escapeIdent(id)}`;
  return classSelector(el);
}

/**
 * 安定セレクタを生成する。document 内でちょうど 1 件になるものを順に試し、
 * 見つからなければ undefined（= text だけで運用する）。
 */
export function buildSelector(el: Element, scope?: ParentNode): string | undefined {
  const root: ParentNode = scope ?? el.ownerDocument ?? el;
  const tag = el.tagName.toLowerCase();

  // ① #id
  const id = el.getAttribute('id');
  if (id && isStableId(id)) {
    const selector = `#${escapeIdent(id)}`;
    if (isUnique(root, selector, el)) return selector;
  }

  // ② tag[属性="値"]
  for (const attr of STABLE_ATTRS) {
    const value = el.getAttribute(attr);
    if (!value || value.length > 80) continue;
    const selector = `${tag}[${attr}="${escapeString(value)}"]`;
    if (isUnique(root, selector, el)) return selector;
  }

  // ③ tag + 安定クラス（一意でなければ祖先を最大 3 階層前置）。
  //    `.btn` `.primary` のような汎用・状態クラスだけの場合は、
  //    たまたま 1 件でも別の要素に化けやすいので祖先の前置を必須にする。
  const base = classSelector(el) ?? tag;
  const generic = isGenericSelector(el);
  if (!generic && isUnique(root, base, el)) return base;

  let current = el.parentElement;
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    const prefix = ancestorSelector(current);
    if (prefix) {
      const selector = `${prefix} ${base}`;
      if (isUnique(root, selector, el)) return selector;
    }
    current = current.parentElement;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function pickFromPath(path: readonly EventTarget[]): Element | null {
  let checked = 0;
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    try {
      if (node.matches(PICKABLE)) return node;
    } catch {
      /* 無視 */
    }
    if (++checked > MAX_DEPTH + 1) break;
  }
  return null;
}

function eventPath(event: Event): EventTarget[] {
  if (typeof event.composedPath === 'function') {
    const path = event.composedPath();
    if (path.length > 0) return path;
  }
  return event.target ? [event.target] : [];
}

/** トーストを「◯◯ボタンをクリックしてください（Esc で中止）」に戻す */
function fillToast(doc: Document, toast: HTMLElement, action: 'reject' | 'accept'): void {
  toast.textContent = '';
  toast.style.background = TOAST_BG;
  const label = doc.createElement('strong');
  label.textContent = action === 'reject' ? '断るボタン' : '許可ボタン';
  toast.appendChild(label);
  toast.appendChild(doc.createTextNode('をクリックしてください（Esc で中止）'));
}

/**
 * 登録できないボタン（HARD 禁止語・文言なし）を断る。
 * picker は続けたままにして、別のボタンを選べるようにする。
 */
function rejectPick(current: PickerSession, message: string): void {
  const { doc, toast } = current;
  if (current.rejectTimer !== null) clearTimeout(current.rejectTimer);
  toast.textContent = message;
  toast.style.background = TOAST_BG_DANGER;
  current.rejectTimer = setTimeout(() => {
    if (session !== current) return;
    current.rejectTimer = null;
    fillToast(doc, toast, current.action);
  }, REJECT_TOAST_MS);
}

function createUi(
  doc: Document,
  action: 'reject' | 'accept',
): { root: HTMLElement; highlight: HTMLElement; toast: HTMLElement } {
  const root = doc.createElement('div');
  root.setAttribute('data-cookie-autopilot-picker', '');
  root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${Z_INDEX};`;

  const toast = doc.createElement('div');
  toast.style.cssText = [
    'position:fixed',
    'top:16px',
    'right:16px',
    'max-width:320px',
    'padding:12px 16px',
    'border-radius:10px',
    `background:${TOAST_BG}`,
    'color:#f9fafb',
    'font:14px/1.7 system-ui,-apple-system,"Hiragino Sans",sans-serif',
    'box-shadow:0 8px 24px rgba(0,0,0,.3)',
    'pointer-events:none',
  ].join(';');
  fillToast(doc, toast, action);

  const highlight = doc.createElement('div');
  highlight.style.cssText = [
    'position:fixed',
    'display:none',
    'border:2px solid #2563eb',
    'border-radius:6px',
    'background:rgba(37,99,235,.15)',
    'pointer-events:none',
    `z-index:${Z_INDEX}`,
  ].join(';');

  root.appendChild(toast);
  root.appendChild(highlight);
  (doc.body ?? doc.documentElement).appendChild(root);
  return { root, highlight, toast };
}

function stopImmediate(event: Event): void {
  const target = event as Event & { stopImmediatePropagation?: () => void };
  if (typeof target.stopImmediatePropagation === 'function') target.stopImmediatePropagation();
}

function moveHighlight(highlight: HTMLElement, el: Element | null): void {
  if (!el || typeof el.getBoundingClientRect !== 'function') {
    highlight.style.display = 'none';
    return;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    highlight.style.display = 'none';
    return;
  }
  highlight.style.display = 'block';
  highlight.style.left = `${rect.left - 2}px`;
  highlight.style.top = `${rect.top - 2}px`;
  highlight.style.width = `${rect.width}px`;
  highlight.style.height = `${rect.height}px`;
}

export function isPickerActive(): boolean {
  return session !== null;
}

/** picker を開始する。すでに動いていれば作り直す */
export function startPicker(options: PickerOptions): void {
  // 作り直しでは前のセッションの onCancel は呼ばない（自動処理を再開させないため）
  if (session) stop(session.doc, true, false);
  const { doc } = options;
  // cloak と hide を一時解除して、バナーが見える状態にする
  setCloakSuspended(doc, true);
  setHiddenSuspended(doc, true);

  const { root, highlight, toast } = createUi(doc, options.action);
  let current: PickerSession | null = null;

  const onMouseMove = (event: Event): void => {
    moveHighlight(highlight, pickFromPath(eventPath(event)));
  };

  const onClick = (event: Event): void => {
    const el = pickFromPath(eventPath(event));
    event.preventDefault();
    event.stopPropagation();
    stopImmediate(event);
    if (!el) return;
    const text = elementText(el);
    // 文言はカスタムルールの照合に必ず使うので、空のボタン（aria-label も title も無い
    // アイコンボタン）を登録しても二度と押せない。その場で断る
    if (text === '') {
      if (current) rejectPick(current, REJECT_NO_TEXT);
      return;
    }
    // 購入・削除などのボタンは教えられても登録しない（HARD 禁止語）
    if (isForbiddenHard(text)) {
      if (current) rejectPick(current, REJECT_FORBIDDEN);
      return;
    }
    const selector = buildSelector(el, doc);
    stop(doc, false, false);
    void options.onPicked(selector ? { el, selector, text } : { el, text });
  };

  const onKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    stop(doc, true, true);
  };

  // click だけでなく押下・離しも止める（mousedown で反応するサイトの誤操作よけ）
  const onSwallow = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    stopImmediate(event);
  };

  current = {
    doc,
    root,
    highlight,
    toast,
    action: options.action,
    rejectTimer: null,
    onMouseMove,
    onClick,
    onKeyDown,
    onSwallow,
    ...(options.onCancel ? { onCancel: options.onCancel } : {}),
  };
  session = current;
  doc.addEventListener('mousemove', onMouseMove, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKeyDown, true);
  for (const type of SWALLOWED_EVENTS) doc.addEventListener(type, onSwallow, true);
}

/** restoreHidden: hide（display:none）を戻すか / notifyCancel: onCancel を呼ぶか */
function stop(doc: Document, restoreHidden: boolean, notifyCancel: boolean): void {
  if (!session) return;
  const { onCancel } = session;
  doc.removeEventListener('mousemove', session.onMouseMove, true);
  doc.removeEventListener('click', session.onClick, true);
  doc.removeEventListener('keydown', session.onKeyDown, true);
  for (const type of SWALLOWED_EVENTS) doc.removeEventListener(type, session.onSwallow, true);
  if (session.rejectTimer !== null) clearTimeout(session.rejectTimer);
  session.root.remove();
  session = null;
  setCloakSuspended(doc, false);
  // 選ばれた場合は続けてクリックするので、hide の復帰は中止時だけ
  if (restoreHidden) setHiddenSuspended(doc, false);
  if (notifyCancel) onCancel?.();
}

export function cancelPicker(): void {
  if (session) stop(session.doc, true, true);
}
