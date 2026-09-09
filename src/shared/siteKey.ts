// 登録可能ドメイン（eTLD+1）の近似（docs/SPEC.md §3）

/** これらが末尾 2 ラベルに来たときは 3 ラベル残す */
const SECOND_LEVEL_TLDS = new Set([
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'lg.jp',
  'ed.jp',
  'co.uk',
  'org.uk',
  'ac.uk',
  'com.au',
  'net.au',
  'com.br',
  'com.cn',
  'co.kr',
  'co.nz',
  'co.in',
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function siteKey(hostname: string | null | undefined): string {
  const host = (hostname ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (host === '') return '';
  if (host.includes(':')) return host; // IPv6 リテラル
  if (IPV4.test(host)) return host;

  const labels = host.split('.');
  if (labels.length <= 2) return host; // localhost, example.com
  const last2 = labels.slice(-2).join('.');
  const keep = SECOND_LEVEL_TLDS.has(last2) ? 3 : 2;
  return labels.slice(-keep).join('.');
}
