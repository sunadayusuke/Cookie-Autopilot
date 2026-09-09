// Consent-O-Matic（MIT, https://github.com/cavi-au/Consent-O-Matic）の公開ルールを取得して
// public/rules/consent-o-matic.json に 1 ファイルへ統合する。
// 取得は Node の fetch で行う（curl は使わない）。
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://github.com/cavi-au/Consent-O-Matic';
const RULES_LIST = 'https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/rules-list.json';
const LICENSE_URL = 'https://raw.githubusercontent.com/cavi-au/Consent-O-Matic/master/LICENSE';
const OUT_RULES = resolve(ROOT, 'public/rules/consent-o-matic.json');
const OUT_LICENSE = resolve(ROOT, 'third_party/consent-o-matic/LICENSE');
const CONCURRENCY = 8;

/** @param {string} url */
async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** rules-list.json から個別ルール JSON の URL 配列を取り出す */
function extractReferences(list) {
  if (Array.isArray(list)) return list.filter((u) => typeof u === 'string');
  for (const key of ['references', 'rulesLists', 'rules']) {
    const v = list?.[key];
    if (Array.isArray(v)) return v.filter((u) => typeof u === 'string');
  }
  throw new Error('rules-list.json の形式が想定と違います');
}

/** 並列度を制限して map する */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`ルール一覧を取得: ${RULES_LIST}`);
  const references = extractReferences(await fetchJson(RULES_LIST));
  console.log(`  ${references.length} 件のルール JSON を取得します（並列 ${CONCURRENCY}）`);

  const failures = [];
  const rules = {};
  let ruleCount = 0;

  const fetched = await mapLimit(references, CONCURRENCY, async (url) => {
    try {
      return { url, json: await fetchJson(url) };
    } catch (err) {
      failures.push({ url, message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  });

  // 1 ファイルに複数ルールが入る場合があるので、ファイル内のトップレベルキーをそのまま採用する
  for (const item of fetched) {
    if (!item) continue;
    const { url, json } = item;
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      failures.push({ url, message: 'ルール JSON の形式が想定と違います' });
      continue;
    }
    for (const [name, rule] of Object.entries(json)) {
      if (!rule || typeof rule !== 'object') continue;
      if (rules[name]) console.warn(`  ! ルール名の重複: ${name}（後勝ち: ${url}）`);
      rules[name] = rule;
      ruleCount++;
    }
  }

  const payload = { fetchedAt: Date.now(), source: SOURCE, rules };
  await mkdir(dirname(OUT_RULES), { recursive: true });
  await writeFile(OUT_RULES, JSON.stringify(payload));

  let licenseNote = '';
  try {
    const res = await fetch(LICENSE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const license = await res.text();
    await mkdir(dirname(OUT_LICENSE), { recursive: true });
    await writeFile(
      OUT_LICENSE,
      `Consent-O-Matic のルール（public/rules/consent-o-matic.json）の出典とライセンス\n` +
        `出典: ${SOURCE}\n` +
        `ルール一覧: ${RULES_LIST}\n` +
        `ライセンス本文: ${LICENSE_URL}\n\n` +
        `----------------------------------------------------------------\n\n` +
        license,
    );
  } catch (err) {
    licenseNote = `LICENSE の取得に失敗: ${err instanceof Error ? err.message : String(err)}`;
  }

  const bytes = JSON.stringify(payload).length;
  console.log('');
  console.log(`取得成功: ${references.length - failures.length} / ${references.length} ファイル`);
  console.log(`ルール件数: ${ruleCount}`);
  console.log(`出力: ${OUT_RULES}（${(bytes / 1024).toFixed(1)} KiB）`);
  if (licenseNote) console.warn(licenseNote);
  else console.log(`出力: ${OUT_LICENSE}`);
  if (failures.length) {
    console.warn(`\n取得失敗 ${failures.length} 件:`);
    for (const f of failures) console.warn(`  - ${f.url}: ${f.message}`);
  }
  if (ruleCount === 0) process.exitCode = 1;
}

await main();
