// popup（docs/SPEC.md §14.4、docs/DESIGN.md §3「popup」）
//
// chrome API（storage / tabs）が無い環境（pnpm fixtures で配信される素の HTML）でも
// 既定値で描画されるようにし、操作だけを無効化する。

import type { Messages } from '../shared/i18n';
import type {
  CategoryKey,
  SiteHistoryEntry,
  SiteOverride,
  SiteOverrides,
  TabStatus,
  UnhandledReason,
} from '../shared/types';
import { CATEGORY_KEYS } from '../shared/types';
import { categoryCopy, essentialCopy } from '../shared/copy';
import { applyDocumentLang, applyI18n, getLang, initLangCache, resolveLang, setLang, t } from '../shared/i18n';
import {
  getSettings,
  getSiteHistoryEntry,
  getSiteOverrides,
  getTabStatus,
  hasChromeStorage,
  onStorageChanged,
  setSiteAllow,
  setSiteOff,
  setSiteOverride,
  clearTabStatus,
} from '../shared/storage';
import { openOnboardingPage, sendToTab } from '../shared/messages';
import { siteKey } from '../shared/siteKey';
import { createCategoryToggles } from '../ui/categoryToggles';
import type { CategoryTogglesHandle } from '../ui/categoryToggles';

/** content script が動かない / 対象にできないページ（レビュー L4 で追加分を含む） */
const UNSUPPORTED_PROTOCOLS = new Set([
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'arc:',
  'brave:',
  'devtools:',
  'view-source:',
  'file:',
]);
/** タブが complete なのに status が届かないとき、これだけ待って諦める（レビュー L4） */
const STATUS_TIMEOUT_MS = 1500;
/**
 * 状態バッジの文言（§14.4-1）。
 * ヘッダーではサイト名と並ぶので、状態が分かる最短の言い回しにする。
 * 詳しい説明は「このサイトでの結果」に任せる。
 * loading は status が届く前、timeout はタブが読み込み済みなのに status が届かないとき、
 * recorded は現在の結果が無く以前の対応記録があるとき（§14.8）。
 */
function badgeText(): Messages['popup']['badge'] {
  return t().popup.badge;
}
/** 「このサイトでの結果」の説明文（バッジの言い換えではなく、何が起きたかを書く） */
function resultText(): Messages['popup']['result'] {
  return t().popup.result;
}
/**
 * unhandled の説明文（§14.4-2）。何が起きて処理できなかったのかで出し分ける。
 * 理由が付いていない（古い記録・打ち切りなど）ときは resultText().unhandled のまま。
 */
function unhandledText(): Record<UnhandledReason, string> {
  const messages = t().popup.unhandled;
  return {
    'no-candidates': messages.noCandidates,
    'no-reject': t().popup.result.unhandled,
    'panel-aborted': messages.panelAborted,
    'click-failed': messages.clickFailed,
  };
}
/** 拡張外プレビュー（pnpm fixtures）で見た目を確認するためのダミーのサイト名 */
const PREVIEW_HOST = 'example.com';
/** 「このサイトの設定」行に出す要約（§14.9） */
function siteSummaryText(): Messages['popup']['siteSummary'] {
  return t().popup.siteSummary;
}

interface ActiveTab {
  id: number;
  url: string;
  /** chrome.tabs.Tab['status']。'complete' なら読み込み済み（L4 のタイムアウト判定に使う） */
  status?: string;
}

type StatusTone = 'neutral' | 'success' | 'warning';

interface StatusDisplay {
  badge: string;
  tone: StatusTone;
  /** 「このサイトでの結果」に出す説明（handled は decision から組み立て直す） */
  result: string;
}

function requireEl<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`要素が見つかりません: #${id}`);
  return el as unknown as T;
}

const els = {
  extensionNotice: requireEl<HTMLElement>('extension-notice'),
  onboardingNotice: requireEl<HTMLElement>('onboarding-notice'),
  onboardingBtn: requireEl<HTMLButtonElement>('onboarding-btn'),
  siteSection: requireEl<HTMLElement>('site-section'),
  siteName: requireEl<HTMLElement>('site-name'),
  statusBadge: requireEl<HTMLElement>('status-badge'),
  resultSection: requireEl<HTMLElement>('result-section'),
  resultMessage: requireEl<HTMLElement>('result-message'),
  resultHint: requireEl<HTMLElement>('result-hint'),
  resultChips: requireEl<HTMLElement>('result-chips'),
  resultAllowChips: requireEl<HTMLElement>('result-allow-chips'),
  resultDenyChips: requireEl<HTMLElement>('result-deny-chips'),
  siteSettingsBtn: requireEl<HTMLButtonElement>('site-settings-btn'),
  siteSettingsSummary: requireEl<HTMLElement>('site-settings-summary'),
  siteDetail: requireEl<HTMLElement>('site-detail'),
  siteDetailBack: requireEl<HTMLButtonElement>('site-detail-back'),
  siteDetailHost: requireEl<HTMLElement>('site-detail-host'),
  siteCategorySlot: requireEl<HTMLElement>('site-category-slot'),
  siteOffToggle: requireEl<HTMLButtonElement>('site-off-toggle'),
  siteReset: requireEl<HTMLButtonElement>('site-reset'),
  popupBody: requireEl<HTMLElement>('popup-body'),
  popupFooter: requireEl<HTMLElement>('popup-footer'),
  actionButtons: requireEl<HTMLElement>('action-buttons'),
  teachReject: requireEl<HTMLButtonElement>('teach-reject'),
  rerun: requireEl<HTMLButtonElement>('rerun'),
  hud: requireEl<HTMLElement>('hud'),
};

let activeTab: ActiveTab | null = null;
let host = '';
let override: SiteOverride | null = null;
/** 全体の設定の許可カテゴリ。override が無いときの詳細画面の初期値になる（§14.9） */
let globalAllow: Record<CategoryKey, boolean> = { A: false, B: false, D: false, E: false, F: false, X: false };
let categoryToggles: CategoryTogglesHandle | null = null;
let lastStatus: TabStatus | null = null;
let statusTimedOut = false;
/** このサイトの以前の対応記録（§14.8）。host が決まったタイミングで一度だけ取得する */
let historyEntry: SiteHistoryEntry | null = null;
/** 初期設定がまだ（メイン画面の notice を出すか。詳細画面では隠す） */
let onboardingPending = false;
/** 「このページで再実行」を押した時刻。これより新しいステータスが届くまで結果を待つ（M-3） */
let rerunAt: number | null = null;
let unsubscribe: (() => void) | null = null;

void main();

async function main(): Promise<void> {
  // storage を待つ間に別の言語で描画されないよう、まずキャッシュの言語で描く（§14.10）
  initLangCache();
  renderLang();

  const extensionAvailable = hasChromeStorage() && hasChromeTabs();
  if (!extensionAvailable) els.extensionNotice.hidden = false;

  const [overrides, settings] = await Promise.all([getSiteOverrides(), getSettings()]);
  // 正は保存値。キャッシュと食い違っていたらここで描き直す（動的な部品はこのあと組み立てる）
  const lang = resolveLang(settings.lang);
  if (lang !== getLang()) {
    setLang(lang);
    renderLang();
  }
  globalAllow = settings.allowCategories;
  renderOnboardingNotice(settings.onboarded);
  bindOnboardingNotice();
  buildSiteDetail();
  bindSiteDetailEvents();

  if (!extensionAvailable) {
    setDisabled(document, true);
    host = PREVIEW_HOST;
    els.siteName.textContent = PREVIEW_HOST;
    override = overrides[PREVIEW_HOST] ?? null;
    renderSiteOverride();
    renderBadge(t().popup.previewBadge, 'neutral');
    renderResult(null);
    // プレビューでも詳細画面を確認できるよう、画面の行き来だけは有効に戻す
    els.siteSettingsBtn.disabled = false;
    els.siteDetailBack.disabled = false;
    // カテゴリ説明の開閉は chrome.storage 不要の読み取り専用操作なので、これも有効に戻す
    for (const trigger of document.querySelectorAll<HTMLButtonElement>('.category-toggle-trigger')) {
      trigger.disabled = false;
    }
    return;
  }

  const tab = await getActiveTab();
  const hostname = tab ? safeHostname(tab.url) : '';
  if (!tab || hostname === '' || isUnsupportedUrl(tab.url)) {
    showTabUnavailable();
    return;
  }

  activeTab = tab;
  host = siteKey(hostname);
  override = overrides[host] ?? null;
  els.siteName.textContent = host;
  renderSiteOverride();
  bindActionButtons();
  if (tab.status === 'complete') scheduleStatusTimeout();
  historyEntry = await getSiteHistoryEntry(host);
  await refreshStatus();

  unsubscribe = onStorageChanged((area, keys) => {
    if (area === 'session' && activeTab && keys.includes(`tab:${activeTab.id}`)) void refreshStatus();
    if (area !== 'sync') return;
    // options / onboarding で言語を切り替えたら、開いたままの popup も追従する（§14.10）
    if (keys.includes('settings')) void refreshLangFromStorage();
    if (keys.includes('siteOverrides')) void refreshOverrideFromStorage();
  });
  window.addEventListener('pagehide', () => unsubscribe?.(), { once: true });
}

/** 静的な文言（HTML の data-i18n）と <html lang> を現在の言語で描き直す */
function renderLang(): void {
  applyDocumentLang();
  applyI18n();
  document.title = t().popup.title;
}

/**
 * 他の画面で言語が変わったときの追従（§14.10）。
 * 言語が同じなら何もしないので、settings の他の変更で描き直しが走ることはない。
 * 動的に組んだ部品（詳細画面のカテゴリ行・結果のチップ）は作り直す。
 */
async function refreshLangFromStorage(): Promise<void> {
  const settings = await getSettings();
  const lang = resolveLang(settings.lang);
  if (lang === getLang()) return;
  setLang(lang);
  renderLang();
  buildSiteDetail();
  renderSiteOverride();
  renderStatus();
}

/** 非対応ページ: このサイトでの結果・このサイトの設定・フッターの操作ボタンを隠す */
function showTabUnavailable(): void {
  els.siteName.hidden = true;
  renderBadge(badgeText().unavailable, 'neutral');
  els.resultSection.hidden = true;
  els.siteSection.hidden = true;
  els.actionButtons.hidden = true;
}

// ---------------------------------------------------------------------------
// 最初の設定がまだ（§14.4-1）
// ---------------------------------------------------------------------------

function renderOnboardingNotice(onboarded: boolean): void {
  onboardingPending = !onboarded;
  els.onboardingNotice.hidden = onboarded;
}

function bindOnboardingNotice(): void {
  els.onboardingBtn.addEventListener('click', () => {
    // タブを開き終えてから閉じる（先に閉じるとメッセージが届かないことがある）
    void openOnboardingPage().finally(() => window.close());
  });
}

// ---------------------------------------------------------------------------
// chrome API ガード
// ---------------------------------------------------------------------------

function hasChromeTabs(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.tabs;
}

async function getActiveTab(): Promise<ActiveTab | null> {
  if (!hasChromeTabs()) return null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || typeof tab.id !== 'number' || !tab.url) return null;
    return { id: tab.id, url: tab.url, status: tab.status };
  } catch {
    return null;
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isUnsupportedUrl(url: string): boolean {
  try {
    return UNSUPPORTED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return true;
  }
}

function setDisabled(scope: ParentNode, disabled: boolean): void {
  for (const el of scope.querySelectorAll('input, button, select')) {
    (el as HTMLInputElement | HTMLButtonElement | HTMLSelectElement).disabled = disabled;
  }
}

// ---------------------------------------------------------------------------
// 状態バッジ（既存の状態判定・タイムアウト・watching の挙動はそのまま。文言だけ §14.7 に統一）
// ---------------------------------------------------------------------------

/** タブが読み込み済みなのに 1.5 秒たっても status が届かない場合の表示に切り替える（L4） */
function scheduleStatusTimeout(): void {
  window.setTimeout(() => {
    if (lastStatus) return;
    statusTimedOut = true;
    renderStatus();
  }, STATUS_TIMEOUT_MS);
}

/** 現在のタブの結果が確定しているか（true なら記録より現在の結果を優先する。§14.8） */
function hasCurrentResult(status: TabStatus | null): boolean {
  return status !== null && (status.status === 'handled' || status.status === 'unhandled' || status.status === 'off');
}

function statusDisplay(status: TabStatus | null): StatusDisplay {
  // none / watching / タイムアウト / 読み込み中で以前の記録があれば、それを優先して表示する（§14.8）
  if (!hasCurrentResult(status) && historyEntry) {
    return { badge: badgeText().recorded, tone: 'success', result: historyResult(historyEntry).message };
  }
  if (!status) {
    // 再実行を頼んだ直後。直前が handled のタブでは service worker が watching を
    // 保存しないので、結果が届くまでは popup 側で「確認中」を出す（M-3）
    if (rerunAt !== null) return { badge: badgeText().watching, tone: 'neutral', result: resultText().watching };
    if (statusTimedOut) return { badge: badgeText().timeout, tone: 'neutral', result: resultText().timeout };
    return { badge: badgeText().loading, tone: 'neutral', result: resultText().loading };
  }
  switch (status.status) {
    // 監視窓が開いている間。結果が出るまでの経過なのでタイムアウト扱いにしない
    case 'watching':
      return { badge: badgeText().watching, tone: 'neutral', result: resultText().watching };
    case 'off':
      return { badge: badgeText().off, tone: 'neutral', result: resultText().off };
    case 'none':
      return { badge: badgeText().none, tone: 'neutral', result: resultText().none };
    case 'unhandled':
      return { badge: badgeText().unhandled, tone: 'warning', result: unhandledResult(status) };
    case 'handled':
      return { badge: badgeText().handled, tone: 'success', result: resultText().handled };
    default:
      return { badge: '', tone: 'neutral', result: '' };
  }
}

/** unhandled の説明文。理由が無い・知らない値なら従来の文言にする（§14.4-2） */
function unhandledResult(status: TabStatus): string {
  const reason = status.reason;
  return (reason ? unhandledText()[reason] : undefined) ?? resultText().unhandled;
}

function renderBadge(text: string, tone: StatusTone): void {
  els.statusBadge.textContent = text;
  els.statusBadge.classList.remove('badge-neutral', 'badge-success', 'badge-warning');
  els.statusBadge.classList.add(`badge-${tone}`);
}

function renderStatus(): void {
  const { badge, tone } = statusDisplay(lastStatus);
  renderBadge(badge, tone);
  renderResult(lastStatus);
}

async function refreshStatus(): Promise<void> {
  if (!activeTab) return;
  const status = await getTabStatus(activeTab.id);
  // 再実行を頼んだあとは、押下より前（＝前回の実行）のステータスを結果として出さない
  if (rerunAt !== null && status !== null && status.at >= rerunAt) rerunAt = null;
  lastStatus = rerunAt === null ? status : null;
  renderStatus();
}

async function refreshOverrideFromStorage(): Promise<void> {
  if (!host) return;
  const [overrides, settings] = await Promise.all([getSiteOverrides(), getSettings()]);
  override = overrides[host] ?? null;
  globalAllow = settings.allowCategories;
  renderSiteOverride();
  renderStatus();
}

// ---------------------------------------------------------------------------
// このサイトでの結果（§14.4-2。TabStatus.decision で分岐。文言そのまま）
// ---------------------------------------------------------------------------

interface ResultChips {
  allow: string[];
  deny: string[];
}

function renderResult(status: TabStatus | null): void {
  let message = statusDisplay(status).result;
  let hint = '';
  let chips: ResultChips | null = null;

  if (status?.status === 'handled') {
    const decided = handledResult(status);
    if (decided.message) message = decided.message;
    chips = decided.chips;
  } else if (status?.status === 'unhandled') {
    hint = t().popup.teachHint;
  } else if (!hasCurrentResult(status) && historyEntry) {
    // none / watching / タイムアウト / 読み込み中で以前の記録があれば、それを優先して表示する（§14.8）
    const decided = historyResult(historyEntry);
    message = decided.message;
    chips = decided.chips;
  }

  els.resultMessage.textContent = message;
  els.resultHint.textContent = hint;
  els.resultHint.hidden = hint === '';
  if (chips) renderResultChips(chips);
  else hideResultChips();
}

/** 押したボタンの表示用文言。無ければ照合用の正規化済み文言で代用する（H1） */
function clickedLabel(status: TabStatus): string {
  return status.clickedLabel || status.clickedText || '';
}

function handledResult(status: TabStatus): { message?: string; chips: ResultChips | null } {
  const label = clickedLabel(status);
  const copy = t().popup;
  switch (status.decision) {
    case 'granular':
      return { message: copy.granular, chips: categoryChips(status.allowed ?? []) };
    // 文言の取れないボタン（アイコンだけ）でも、チップと食い違わない文にする
    case 'reject-all':
      return { message: label ? copy.pressed(label) : copy.pressedReject, chips: rejectRestChips() };
    case 'custom':
      return {
        message: label ? copy.pressedCustom(label) : copy.pressedCustomNoLabel,
        chips: rejectRestChips(),
      };
    case 'dismissed':
      return { message: copy.dismissed, chips: null };
    case 'hidden':
      return { message: copy.hidden, chips: null };
    default:
      return { chips: null };
  }
}

/** granular のチップ: 許可した項目（「必要なもの」は常に許可なので先頭に固定）と、それ以外 */
function categoryChips(allowed: readonly CategoryKey[]): ResultChips {
  const allowedSet = new Set(allowed);
  const categories = categoryCopy();
  return {
    allow: [essentialCopy().name, ...CATEGORY_KEYS.filter((key) => allowedSet.has(key)).map((key) => categories[key].name)],
    deny: CATEGORY_KEYS.filter((key) => !allowedSet.has(key)).map((key) => categories[key].name),
  };
}

/** 断る系のチップ: 個別のカテゴリ名は並べず「それ以外すべて」にまとめる（§14.4） */
function rejectRestChips(): ResultChips {
  return { allow: [essentialCopy().name], deny: [t().popup.denyRest] };
}

/** 「<日付>」の日付部分。年が違うときだけ年も付ける（§14.8） */
function formatHistoryDate(at: number): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'long', day: 'numeric' }
    : { year: 'numeric', month: 'long', day: 'numeric' };
  return new Intl.DateTimeFormat(getLang() === 'ja' ? 'ja-JP' : 'en-US', options).format(date);
}

/** 以前の対応記録から「このサイトでの結果」を組み立てる（§14.8。handledResult の記録版） */
function historyResult(entry: SiteHistoryEntry): { message: string; chips: ResultChips | null } {
  const date = formatHistoryDate(entry.at);
  const answered = t().popup.historyAnswered(date);
  switch (entry.decision) {
    case 'granular':
      return { message: answered, chips: categoryChips(entry.allowed ?? []) };
    case 'reject-all':
    case 'custom':
      return { message: answered, chips: rejectRestChips() };
    case 'dismissed':
      return { message: t().popup.historyDismissed(date), chips: null };
    default:
      return { message: answered, chips: null };
  }
}

function renderResultChips(chips: ResultChips): void {
  els.resultChips.hidden = false;
  fillChipRow(els.resultAllowChips, chips.allow, 'chip-allow');
  fillChipRow(els.resultDenyChips, chips.deny, 'chip-deny');
}

function hideResultChips(): void {
  els.resultChips.hidden = true;
  els.resultAllowChips.replaceChildren();
  els.resultDenyChips.replaceChildren();
}

function fillChipRow(container: HTMLElement, labels: string[], tone: 'chip-allow' | 'chip-deny'): void {
  container.replaceChildren();
  for (const label of labels) {
    const chip = document.createElement('span');
    chip.className = `chip ${tone}`;
    chip.textContent = label;
    container.append(chip);
  }
}

// ---------------------------------------------------------------------------
// HUD 通知（保存失敗時のみ。フッター内に inline 表示。H6）
// ---------------------------------------------------------------------------

let hudRevealFrame: number | null = null;
let hudHideTimer: number | null = null;
let hudFinalizeTimer: number | null = null;

function showHudError(error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error);
  showHud(t().common.saveFailed(reason));
}

function showHud(message: string): void {
  if (hudRevealFrame !== null) cancelAnimationFrame(hudRevealFrame);
  if (hudHideTimer !== null) window.clearTimeout(hudHideTimer);
  if (hudFinalizeTimer !== null) window.clearTimeout(hudFinalizeTimer);

  els.hud.textContent = message;
  els.hud.classList.add('is-danger');
  els.hud.hidden = false;
  els.hud.classList.remove('is-visible');

  // 2 フレーム待ってから is-visible を付ける（hidden 解除直後だと transition が飛ぶため）
  hudRevealFrame = requestAnimationFrame(() => {
    hudRevealFrame = requestAnimationFrame(() => {
      els.hud.classList.add('is-visible');
    });
  });

  hudHideTimer = window.setTimeout(() => {
    els.hud.classList.remove('is-visible');
    hudFinalizeTimer = window.setTimeout(() => {
      els.hud.hidden = true;
    }, 180);
  }, 1200);
}

// ---------------------------------------------------------------------------
// このサイトの設定（行ボタン + ドリルダウンの詳細画面。§14.9）
// ---------------------------------------------------------------------------

/**
 * このサイトの設定の保存を直列に流すためのキュー。
 * どれも siteOverrides を読んで書き戻すので、続けてトグルしたときに読み取りが交差すると
 * 直前の変更が失われてしまう。
 */
let siteSaveQueue: Promise<unknown> = Promise.resolve();

function queueSiteSave(save: () => Promise<SiteOverrides>): Promise<SiteOverrides> {
  const next = siteSaveQueue.then(save, save);
  siteSaveQueue = next.catch(() => undefined);
  return next;
}

/**
 * 詳細画面のカテゴリ行を組み立てる（トグルの状態は renderSiteOverride が入れる）。
 * 言語の切り替えで作り直すので、要素が二重に並ばないよう replaceChildren で入れ替える。
 */
function buildSiteDetail(): void {
  categoryToggles = createCategoryToggles({
    allow: globalAllow,
    onToggle: (key, on) => void onCategoryToggle(key, on),
  });
  els.siteCategorySlot.replaceChildren(categoryToggles.element);
}

function bindSiteDetailEvents(): void {
  els.siteSettingsBtn.addEventListener('click', () => showSiteDetail(true));
  els.siteDetailBack.addEventListener('click', () => showSiteDetail(false));
  els.siteOffToggle.addEventListener('click', () => {
    // カテゴリのトグルと同じく、押した時点で見た目を先に変える（失敗時は renderSiteOverride が戻す）
    const next = els.siteOffToggle.getAttribute('aria-checked') !== 'true';
    setToggleState(els.siteOffToggle, next);
    void onSiteOffToggle(next);
  });
  els.siteReset.addEventListener('click', () => void onResetSiteOverride());
}

/** 詳細画面とメイン（notice・結果・サイト設定行・フッター）を入れ替える */
function showSiteDetail(open: boolean): void {
  els.popupBody.hidden = open;
  els.popupFooter.hidden = open;
  els.siteDetail.hidden = !open;
  // 詳細画面は 550px ほどあり、notice を残すと popup の高さ上限（600px）を超えるので一緒に隠す
  els.onboardingNotice.hidden = open || !onboardingPending;
  els.siteSettingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) els.siteDetailBack.focus();
  else els.siteSettingsBtn.focus();
}

/** この時点の実効の許可カテゴリ（override があればそれ、無ければ全体の設定） */
function effectiveAllow(): Record<CategoryKey, boolean> {
  return override?.kind === 'custom' ? override.allow : globalAllow;
}

/** 行の要約・詳細画面のトグル・「全体の設定に戻す」の活性を、いまの override に合わせる */
function renderSiteOverride(): void {
  els.siteSettingsSummary.textContent =
    override === null ? siteSummaryText().inherit : override.kind === 'off' ? siteSummaryText().off : siteSummaryText().custom;
  els.siteDetailHost.textContent = host;

  const off = override?.kind === 'off';
  setToggleState(els.siteOffToggle, off);
  categoryToggles?.setAllow(effectiveAllow());
  // 動かさないサイトではカテゴリの選択に意味が無いので触れなくする
  categoryToggles?.setDisabled(off);
  els.siteReset.disabled = override === null;
}

function setToggleState(toggle: HTMLButtonElement, on: boolean): void {
  toggle.setAttribute('aria-checked', on ? 'true' : 'false');
}

/** 項目のトグル。override が無ければこの時点で全体の設定を土台に作られる（§14.9） */
async function onCategoryToggle(key: CategoryKey, on: boolean): Promise<void> {
  if (!host) return;
  try {
    const overrides = await queueSiteSave(() => setSiteAllow(host, { [key]: on }));
    override = overrides[host] ?? null;
    renderSiteOverride();
  } catch (error) {
    renderSiteOverride();
    showHudError(error);
  }
}

/** 「このサイトでは動かさない」。OFF に戻すと override ごと消えて全体の設定に従う（§14.9） */
async function onSiteOffToggle(on: boolean): Promise<void> {
  if (!host) return;
  try {
    const overrides = await queueSiteSave(() => setSiteOff(host, on));
    override = overrides[host] ?? null;
    renderSiteOverride();
  } catch (error) {
    renderSiteOverride();
    showHudError(error);
  }
}

/** 「全体の設定に戻す」: override を消して、トグルを全体の設定に同期し直す */
async function onResetSiteOverride(): Promise<void> {
  if (!host) return;
  try {
    await queueSiteSave(() => setSiteOverride(host, null));
    override = null;
    globalAllow = (await getSettings()).allowCategories;
    renderSiteOverride();
  } catch (error) {
    showHudError(error);
  }
}

// ---------------------------------------------------------------------------
// フッターのボタン行
// ---------------------------------------------------------------------------

function bindActionButtons(): void {
  els.teachReject.addEventListener('click', () => void teachReject());
  els.rerun.addEventListener('click', () => void rerun());
}

/** 断るボタンを教える: content script にモード開始を伝えてから popup を閉じる */
async function teachReject(): Promise<void> {
  if (!activeTab) return;
  await sendToTab(activeTab.id, { type: 'startPicker', action: 'reject' });
  window.close();
}

/**
 * このページで再実行: 監視窓をやり直す。結果は onStorageChanged 経由で反映される。
 * 直前が handled のタブでは service worker が watching を保存しない（handled を
 * 上書きしないため）ので、押下から結果が届くまでの「確認中」は popup 側で出す（M-3）。
 */
async function rerun(): Promise<void> {
  if (!activeTab) return;
  lastStatus = null;
  statusTimedOut = false;
  rerunAt = Date.now();
  renderStatus();
  // 直前の handled が残っていると SW の上書き規則で新しい結果が保存されないので、先に消す
  await clearTabStatus(activeTab.id).catch(() => undefined);
  const delivered = await sendToTab(activeTab.id, { type: 'rerun' });
  // content script が居ないページでは待っても報告は来ないので、従来どおり 1.5 秒で諦める
  if (delivered) return;
  rerunAt = null;
  renderStatus();
  scheduleStatusTimeout();
}
