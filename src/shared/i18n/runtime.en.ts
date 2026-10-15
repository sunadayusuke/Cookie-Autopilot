// content script / service worker が使う英語の文言（docs/SPEC.md §14.10）

import type { RuntimeMessages } from './types';

export const pickerEn: RuntimeMessages['picker'] = {
  rejectForbidden: 'This button cannot be registered (it looks like a risky action such as buying or deleting)',
  rejectNoText: 'A button with no text cannot be registered. Please pick a button with text.',
  rejectLabel: 'the reject button',
  acceptLabel: 'the allow button',
  clickPrefix: 'Click ',
  clickSuffix: ' (press Esc to cancel)',
};

export const backgroundEn: RuntimeMessages['background'] = {
  emptyRuleList: 'The rule list is empty',
  noRulesFetched: 'No rules could be fetched',
};
