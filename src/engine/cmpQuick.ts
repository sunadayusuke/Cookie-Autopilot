// 既知 CMP の即決セレクタ表（docs/SPEC.md §5-5-b）
// container セレクタは cloak（document_start での opacity:0 注入）にも使う。
//
// 取得した Consent-O-Matic の実ルールと突き合わせて確認・補足したもの:
//  - OneTrust / Cookiebot / Didomi / Complianz / Borlabs / consentmanager / tarteaucitron /
//    Klaro の容器セレクタは COM 側と一致
//  - Usercentrics は SPEC の v2（shadow DOM）に加え COM が持つ v1 の容器を追加
//  - TrustArc / Osano / Quantcast は COM 側にある別バージョンの容器を追加
//  - Sourcepoint は SPEC の `.message-container` が汎用的すぎるため、SPEC の注記
//    「（iframe 内）」に従ってサブフレーム限定のエントリに分け、トップフレームでは
//    COM 側の `[class^="sp_message_container"]` を使う
//  - 英語圏・グローバル向けに追加した 15 件は、エントリごとに「COM で確認済み / 未確認」を
//    コメントで明示している（COM にルールが無いものは自動では裏取りできない）

export interface QuickCmp {
  /** 表示名（method は 'quick:<name>' になる） */
  name: string;
  /** 容器セレクタ（カンマ区切り可） */
  container: string;
  /** 拒否ボタン。無い CMP は文言ヒューリスティックに任せる */
  reject?: string;
  /** 許可ボタン */
  accept?: string;
  /** サブフレームでのみ有効にする（誤検出を避けるため） */
  iframeOnly?: boolean;
}

export const QUICK_CMPS: readonly QuickCmp[] = [
  {
    name: 'OneTrust',
    container: '#onetrust-banner-sdk',
    reject: '#onetrust-reject-all-handler',
    accept: '#onetrust-accept-btn-handler',
  },
  {
    name: 'Cookiebot',
    container: '#CybotCookiebotDialog',
    reject:
      '#CybotCookiebotDialogBodyButtonDecline, #CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    accept:
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept',
  },
  {
    name: 'Didomi',
    container: '#didomi-host, #didomi-notice',
    reject: '#didomi-notice-disagree-button, .didomi-continue-without-agreeing',
    accept: '#didomi-notice-agree-button',
  },
  {
    name: 'Usercentrics',
    container: '#usercentrics-root, #usercentrics-cmp-ui, .uc-banner-wrapper, .uc-banner-content',
    reject: '[data-testid="uc-deny-all-button"], #deny',
    accept: '[data-testid="uc-accept-all-button"], #accept',
  },
  {
    // ボタンは文言ヒューリスティックで拾う（容器の cloak と検出のみ）
    name: 'Quantcast',
    container: '.qc-cmp2-container, .qc-cmp-ui-container',
  },
  {
    name: 'TrustArc',
    container: '#truste-consent-track, #truste-consent-content, .truste-consent-content',
    reject: '#truste-consent-required',
    accept: '#truste-consent-button',
  },
  {
    name: 'Osano',
    container: '.osano-cm-dialog, .osano-cm-window',
    reject: '.osano-cm-denyAll, .osano-cm-deny',
    accept: '.osano-cm-accept-all, .osano-cm-accept',
  },
  {
    name: 'CookieYes',
    container: '.cky-consent-container',
    reject: '.cky-btn-reject',
    accept: '.cky-btn-accept',
  },
  {
    name: 'Termly',
    container: '#termly-code-snippet-support, .t-consentPrompt',
    reject: '[data-tid="banner-decline"]',
    accept: '[data-tid="banner-accept"]',
  },
  {
    name: 'Iubenda',
    container: '#iubenda-cs-banner',
    reject: '.iubenda-cs-reject-btn',
    accept: '.iubenda-cs-accept-btn',
  },
  {
    name: 'Klaro',
    container: '.klaro .cookie-notice, .klaro .cookie-modal',
    reject: '.cm-btn-decline, .cm-btn-danger',
    accept: '.cm-btn-accept-all, .cm-btn-success',
  },
  {
    name: 'Complianz',
    container: '#cmplz-cookiebanner-container',
    reject: '.cmplz-deny',
    accept: '.cmplz-accept',
  },
  {
    name: 'Borlabs',
    container: '#BorlabsCookieBox',
    reject: '[data-cookie-refuse]',
    accept: '[data-cookie-accept-all]',
  },
  {
    name: 'Funding Choices',
    container: '.fc-consent-root',
    reject: '.fc-cta-do-not-consent',
    accept: '.fc-cta-consent',
  },
  {
    name: 'Sourcepoint',
    container: '[class^="sp_message_container"]',
    reject: '.sp_choice_type_13, button[title="Reject All"]',
    accept: '.sp_choice_type_11',
  },
  {
    name: 'Sourcepoint (frame)',
    container: '.message-container',
    reject: '.sp_choice_type_13, button[title="Reject All"]',
    accept: '.sp_choice_type_11',
    iframeOnly: true,
  },
  {
    name: 'HubSpot',
    container: '#hs-eu-cookie-confirmation',
    reject: '#hs-eu-decline-button',
    accept: '#hs-eu-confirmation-button',
  },
  {
    name: 'Cookie Notice',
    container: '#cookie-notice',
    reject: '#cn-refuse-cookie',
    accept: '#cn-accept-cookie',
  },
  {
    name: 'Moove GDPR',
    container: '#moove_gdpr_cookie_info_bar',
    reject: '.moove-gdpr-infobar-reject-btn',
    accept: '.moove-gdpr-infobar-allow-all',
  },
  {
    name: 'consentmanager',
    container: '#cmpbox',
    reject: '.cmpboxbtnno',
    accept: '.cmpboxbtnyes',
  },
  {
    name: 'tarteaucitron',
    container: '#tarteaucitronAlertBig',
    reject: '#tarteaucitronAllDenied2',
    accept: '#tarteaucitronPersonalize2',
  },
  {
    name: 'Axeptio',
    container: '#axeptio_overlay',
    reject: '#axeptio_btn_dismiss',
    accept: '#axeptio_btn_acceptAll',
  },
  {
    name: 'Wix',
    container: '[data-hook="consent-banner-root"]',
    reject: '[data-hook="consent-banner-decline-button"]',
    accept: '[data-hook="consent-banner-apply-button"]',
  },
  // --- 以下、英語圏・グローバルで多い CMP（COM ルールとの突き合わせ結果はコメントに残す）---
  {
    // COM 未確認（COM に該当ルール無し）。Insites cookieconsent の既定 class
    name: 'Insites cookieconsent',
    container: '.cc-window',
    reject: '.cc-deny',
    accept: '.cc-allow, .cc-btn.cc-dismiss',
  },
  {
    // COM 未確認（COM に該当ルール無し）
    name: 'CookieFirst',
    container: '.cookiefirst-root, [data-cookiefirst-widget="banner"]',
    reject: '[data-cookiefirst-action="reject"]',
    accept: '[data-cookiefirst-action="accept"]',
  },
  {
    // 容器は COM の cookiescript ルールと一致。ボタンは COM 未確認
    name: 'Cookie Script',
    container: '#cookiescript_injected',
    reject: '#cookiescript_reject',
    accept: '#cookiescript_accept',
  },
  {
    // 容器は COM の cookiebar ルールと一致（`.wt-cli-cookie-bar-container` も同ルールにある）。
    // ボタンは COM 未確認
    name: 'Cookie Law Info',
    container: '#cookie-law-info-bar, .wt-cli-cookie-bar-container',
    reject: '#cookie_action_close_header_reject, #wt-cli-reject-btn, [data-cli_action="reject"]',
    accept: '#cookie_action_close_header, #wt-cli-accept-all-btn, [data-cli_action="accept"]',
  },
  {
    // 容器・accept は COM の cookiecontrolcivic ルールと一致（`#ccc[open]` / `#ccc-recommended-settings`）。
    // reject は COM 未確認。`#ccc` は閉じていても DOM に残るので `[open]` まで含めて一致させる
    name: 'Civic Cookie Control',
    container: '#ccc[open]',
    reject: '#ccc-notify-reject, #ccc-reject-settings',
    accept: '#ccc-notify-accept, #ccc-recommended-settings',
  },
  {
    // `#coiOverlay` `#declineButton` `.coi-banner__accept` は COM の cookieinformation ルールと一致。
    // `#Coi-Renew` `.coi-banner__decline` `#acceptButton` は COM 未確認。
    // `#declineButton` `#acceptButton` は汎用的すぎるので容器スコープ付きで書く
    name: 'Cookie Information',
    container: '#coiOverlay, #Coi-Renew',
    reject:
      '#coiOverlay #declineButton, #coiOverlay .coi-banner__decline, #Coi-Renew #declineButton, #Coi-Renew .coi-banner__decline',
    accept:
      '#coiOverlay #acceptButton, #coiOverlay .coi-banner__accept, #Coi-Renew #acceptButton, #Coi-Renew .coi-banner__accept',
  },
  {
    // `#ppms_cm_popup_overlay` は COM の piwikproconsent ルールと一致。
    // `.ppms_cm_popup_overlay` とボタンは COM 未確認
    name: 'Piwik PRO',
    container: '.ppms_cm_popup_overlay, #ppms_cm_popup_overlay',
    reject: '#ppms_cm_reject-all',
    accept: '#ppms_cm_agree-to-all',
  },
  {
    // COM 未確認（COM に該当ルール無し）
    name: 'Shopify',
    container: '#shopify-pc__banner',
    reject: '#shopify-pc__banner__btn-decline',
    accept: '#shopify-pc__banner__btn-accept',
  },
  {
    // 容器は COM の amazon ルールと一致。ボタンは COM 未確認
    name: 'Amazon',
    container: '#sp-cc',
    reject: '#sp-cc-rejectall-link',
    accept: '#sp-cc-accept',
  },
  {
    // COM 未確認（COM に該当ルール無し）
    name: 'eBay',
    container: '#gdpr-banner',
    reject: '#gdpr-banner-decline',
    accept: '#gdpr-banner-accept',
  },
  {
    // COM の linkedin_popup は `div[type="COOKIE_CONSENT"]` を見ている（属性は一致）。
    // `.artdeco-global-alert` の class とボタンは COM 未確認
    name: 'LinkedIn',
    container: '.artdeco-global-alert[type="COOKIE_CONSENT"]',
    reject: 'button[action-type="DENY"]',
    accept: 'button[action-type="ACCEPT"]',
  },
  {
    // COM 未確認（COM に該当ルール無し）。adidas の Glass デザインシステム。
    // reject は `-central` 以外の派生（`…-reject-button-…`）も拾えるよう前方一致で書く。
    // ボタン自身の id に gdpr / consent が入っているため、容器を名指ししないと
    // ヒューリスティックが accept ボタンをバナー容器として拾ってしまう（§5-5-d）
    name: 'adidas (Glass)',
    container: '.cookie-consent-modal',
    reject: '[id^="glass-gdpr-default-consent-reject-button"]',
    accept: '#glass-gdpr-default-consent-accept-button',
  },
  {
    // 容器は COM の yahoo_consent ルール（`#consent-page .consent-form`）と一致。
    // ボタンは COM 未確認。`.consent-form` 単独は任意サイトの同意フォームに一致してしまい、
    // cloak で 20 秒不可視にしたうえ `button[name="agree"]` で送信まで進むので使わない
    name: 'Yahoo consent',
    container: '#consent-page .consent-form',
    reject: 'button[name="reject"]',
    accept: 'button[name="agree"]',
  },
  {
    // 容器・accept は COM の EvidonBanner ルールと一致（`#_evidon_banner` / `button#_evidon-accept-button`）。
    // reject は COM 未確認
    name: 'Evidon',
    container: '#_evidon_banner',
    reject: '#_evidon-decline-button',
    accept: '#_evidon-accept-button',
  },
  {
    // COM 未確認（COM に該当ルール無し）。Webflow 向け Finsweet Cookie Consent
    name: 'Finsweet',
    container: '[fs-cc="banner"]',
    reject: '[fs-cc="deny"]',
    accept: '[fs-cc="allow"]',
  },
  {
    // COM 未確認（COM に該当ルール無し）。拒否ボタンは無いので accept のみ
    name: 'Squarespace',
    container: '.sqs-cookie-banner-v2',
    accept: '.sqs-cookie-banner-v2-accept',
  },
];

/** cloak に使う容器セレクタ一覧。isSubFrame=false のときは iframeOnly のものを除く */
export function cloakSelectors(isSubFrame: boolean): string[] {
  const out: string[] = [];
  for (const cmp of QUICK_CMPS) {
    if (cmp.iframeOnly && !isSubFrame) continue;
    out.push(cmp.container);
  }
  return out;
}

/** そのフレームで有効な即決 CMP 表 */
export function quickCmpsFor(isSubFrame: boolean): QuickCmp[] {
  return QUICK_CMPS.filter((cmp) => !cmp.iframeOnly || isSubFrame);
}
