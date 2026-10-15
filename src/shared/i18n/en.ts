// 英語の文言（docs/SPEC.md §14.2 / §14.10）
//
// 用語はストア掲載文と揃える（Strict / Balanced / Relaxed / Reject all など）。
// 直訳ではなく、日本語と同じ情報量・同じ丁寧さで自然な英語にする。
// picker / background は ja.ts と同じく runtime.en.ts に分けてある（§14.10）。

import type { Messages } from './types';
import { backgroundEn, pickerEn } from './runtime.en';

export const en: Messages = {
  common: {
    extensionNotice: 'This only works when loaded as an extension. This page is a visual preview.',
    presetHeading: 'How much do you want to allow?',
    categoryHeading: 'What does each cookie do?',
    yourSetting: 'Your setting',
    recommended: 'Recommended',
    allow: 'Allowed',
    deny: 'Declined',
    delete: 'Delete',
    saved: 'Saved',
    saveFailed: (reason) => `Could not save: ${reason}`,
    langLabel: 'Language',
  },

  copy: {
    essential: {
      name: 'Essential',
      short: 'Always allowed',
      description:
        'Things the site needs to work, such as staying signed in or keeping your cart. The site is unusable without them, so they are always allowed.',
    },
    categories: {
      A: {
        name: 'Preferences',
        short: 'Virtually harmless',
        description:
          'Remembers settings such as language, text size, and region for your next visit. Only the choices you made are stored, and they almost never go to other companies.',
      },
      B: {
        name: 'Analytics',
        short: 'Anonymous usage data',
        description:
          'Lets the site owner see how often each page is viewed (Google Analytics and the like). The pages you open, how long you stay, your rough location, and your device type go to the analytics company. Most of it is processed so that you cannot be identified.',
      },
      D: {
        name: 'Device storage',
        short: 'Basis for ads and analytics',
        description:
          'Stores an identifying number on your device and reads it back later. It has no purpose on its own; it is the basis for analytics and ads. Since the purpose is open-ended, declining is the safer choice.',
      },
      E: {
        name: 'Personalized content',
        short: 'Records what you do',
        description:
          'Picks recommended articles and videos based on what you have viewed on the site, and measures how well they work. It is not advertising, but what you do on the site is recorded.',
      },
      F: {
        name: 'Targeted ads',
        short: 'Best avoided',
        description:
          'The mechanism that makes an ad for a product you once viewed follow you to other sites. Your browsing history and interests are shared with dozens to hundreds of ad companies and kept for a long time.',
      },
      X: {
        name: 'Other',
        short: 'Purpose unknown',
        description: 'Purposes that fit none of the above. There is no telling what they do, so declining is the safe choice.',
      },
    },
    presets: {
      strict: {
        name: 'Strict',
        description:
          'Declines everything except the essentials. The safest choice, but on some sites your display settings will not carry over to your next visit.',
      },
      minimal: {
        name: 'Balanced',
        recommended: true,
        description: 'Allows only the preferences that keep a site comfortable to use, and declines analytics and ads.',
      },
      relaxed: {
        name: 'Relaxed',
        description:
          "Also allows the site owner's analytics and personalized content. Targeted ads and anything with an unknown purpose are still declined.",
      },
      none: {
        name: 'Reject all',
        description:
          'Presses the reject button when there is one, and on screens that offer only "OK" it presses nothing and hides the screen instead. Since no answer is sent back, the same screen may appear again and again, or some features may not work.',
      },
    },
    notes: {
      alwaysRejected: 'Targeted ads and anything with an unknown purpose are declined on every setting.',
      granularOnly:
        'When a site lets you choose in detail, these settings are applied as they are. When it does not, everything except the essentials is declined.',
    },
  },

  popup: {
    title: 'Cookie Autopilot',
    onboardingNotice: "Setup isn't finished yet",
    onboardingBtn: 'Set up',
    resultTitle: 'What happened on this site',
    siteSettings: 'Settings for this site',
    back: '← Back',
    siteOff: "Don't run on this site",
    resetToGlobal: 'Reset to global settings',
    siteDetailNote: 'Your changes here apply to this site only.',
    teachReject: 'Teach the reject button',
    rerun: 'Run again on this page',
    optionsLink: 'Advanced settings →',
    badge: {
      handled: '✓ Handled',
      unhandled: 'Not found',
      none: 'No banner',
      off: 'Off',
      watching: 'Checking',
      loading: 'Checking…',
      timeout: 'No banner',
      unavailable: 'Not available here',
      recorded: '✓ Already handled',
    },
    result: {
      watching: 'No cookie banner so far. If one appears, it will be handled automatically.',
      loading: 'Checking the status…',
      timeout: 'No cookie banner appeared on this page.',
      off: 'This site is set not to run.',
      none: 'No cookie banner appeared on this page.',
      unhandled: 'No reject button was found.',
      handled: "Closed the site's consent banner.",
    },
    unhandled: {
      noCandidates: 'A consent banner was found, but no button could be identified.',
      panelAborted: 'The settings screen opened, but its options could not be identified.',
      clickFailed: 'A button was pressed, but the consent banner did not close.',
    },
    previewBadge: 'Preview',
    siteSummary: {
      inherit: 'Same as global',
      custom: 'Customized',
      off: 'Turned off',
    },
    denyRest: 'Everything else',
    teachHint: 'You can register one with "Teach the reject button" below',
    granular: "Chose the options on the site's own screen",
    pressed: (label) => `Pressed "${label}"`,
    pressedReject: 'Pressed the reject button',
    pressedCustom: (label) => `Pressed the button you taught: "${label}"`,
    pressedCustomNoLabel: 'Pressed the button you taught',
    dismissed: 'Closed a notice that offered no choices. This site uses cookies',
    hidden: 'Hid the consent banner. Nothing was allowed',
    historyAnswered: (date) => `You answered this site's consent banner on ${date}, so it is not showing this time.`,
    historyDismissed: (date) => `The consent banner was closed on ${date}. It is not showing this time.`,
  },

  options: {
    title: 'Cookie Autopilot settings',
    customBadge: 'Custom',
    fallbackTitle: "When rejecting isn't possible",
    fallbackGroupLabel: "What to do when rejecting isn't possible",
    fallbackHide: 'Hide the consent banner (recommended)',
    fallbackHideNote: 'When no reject button is found, only the consent banner is hidden.',
    fallbackLeave: 'Leave it showing',
    fallbackLeaveNote: 'Does nothing and leaves the consent banner on screen.',
    siteTitle: 'Per-site settings',
    siteEmpty: 'No per-site settings yet.',
    customTitle: 'Taught buttons',
    customEmpty: 'No taught buttons yet.',
    rulesTitle: 'Detection rule updates',
    rulesNote: 'The rules for recognizing consent banners update automatically once a week.',
    loading: 'Loading…',
    updateNow: 'Update now',
    miscTitle: 'Other',
    showBadge: 'Show a result badge on the tab icon',
    observeSeconds: 'Seconds to watch for a consent banner',
    debug: 'Print debug logs to the console (console.debug)',
    debugAria: 'Print debug logs to the console',
    siteHistoryCount: 'Recorded sites',
    siteHistoryUnit: '',
    clearHistory: 'Clear records',
    reopenOnboarding: 'Show the initial setup again',
    open: 'Open',
    backupTitle: 'Backup',
    backupNote: 'Importing replaces your current per-site settings and taught buttons.',
    exportBtn: 'Export',
    importBtn: 'Import',
    overrideOff: 'Turned off',
    overrideCustom: 'Customized',
    actionReject: 'Reject',
    actionAccept: 'Accept',
    allowedNames: (names) => `Allowed: ${names.join(', ')}`,
    noDate: '—',
    lastUpdated: (date) => `Last updated: ${date}`,
    lastUpdateFailed: (error) => `The last update failed: ${error}`,
    updating: 'Updating…',
    updateUnavailable: 'Could not update (the extension is not running)',
    updated: 'Updated',
    updateFailed: (error) => `Update failed: ${error}`,
    unknownError: 'Unknown error',
    handledOn: (date) => `Handled on ${date}`,
    ruleText: (text) => `Text: ${text}`,
    historyCleared: 'Records cleared',
    exported: 'Exported',
    exportFailed: (reason) => `Could not export: ${reason}`,
    imported: (applied, siteOverrides, customRules) =>
      `Imported (settings: ${applied ? 'applied' : 'unchanged'} / ` +
      `per-site settings: ${siteOverrides} / taught buttons: ${customRules})`,
    importFailed: (reason) => `Import failed: ${reason}`,
  },

  onboarding: {
    title: 'Welcome to Cookie Autopilot',
    lead: "Answers the cookie consent banners that appear when you open a site, so you don't have to.",
    customNotice: 'Some categories are currently set individually in the advanced settings. Choosing here will overwrite them.',
    start: 'Start with these settings',
    doneHeading: 'All set',
    doneMessage: 'Try opening a site that shows a cookie consent banner.',
    currentSetting: (presetName) => `Your setting: ${presetName}`,
    countdown: (seconds) => `Closing this tab in ${seconds} seconds`,
    closeNow: 'Close now',
    keepOpen: 'Keep open',
    openOptions: 'Open advanced settings',
  },

  picker: pickerEn,

  background: backgroundEn,

  errors: {
    'import:malformed': () => 'The file is not in a valid format',
    'import:settings': () => 'settings is not in a valid format',
    'import:site-overrides': () => 'siteOverrides is not in a valid format',
    'import:site-overrides-limit': ([limit]) => `siteOverrides exceeds the limit of ${limit} entries`,
    'import:site-override-host': ([host]) => `siteOverrides has an invalid host: ${host}`,
    'import:site-override-value': ([host]) => `siteOverrides has an invalid value (host: ${host})`,
    'import:custom-rules': () => 'customRules is not in a valid format',
    'import:custom-rules-limit': ([limit]) => `customRules exceeds the limit of ${limit} entries`,
    'import:custom-rule-shape': () => 'customRules contains an entry that is not an object',
    'import:custom-rule-host': ([limit]) => `customRules has an invalid host (it must be a string of ${limit} characters or fewer)`,
    'import:custom-rule-action': ([host]) => `customRules has an invalid action (host: ${host})`,
    'import:custom-rule-selector': ([host, limit]) => `customRules has a selector that is too long (host: ${host}, limit ${limit} characters)`,
    'import:custom-rule-text': ([host, limit]) => `customRules has a text that is too long (host: ${host}, limit ${limit} characters)`,
  },
};
