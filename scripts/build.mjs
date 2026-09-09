// esbuild によるバンドル（docs/SPEC.md §1）
// エントリは content / background / popup / options / onboarding の 5 つ。public/ は dist/ にコピーする。
// third_party/consent-o-matic/LICENSE は dist/THIRD_PARTY_LICENSES.txt にコピーする（配布物へのライセンス同梱）。
// --watch でファイル監視。
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const PUBLIC = resolve(ROOT, 'public');
const WATCH = process.argv.includes('--watch');
const THIRD_PARTY_LICENSE_SRC = resolve(ROOT, 'third_party/consent-o-matic/LICENSE');
const THIRD_PARTY_LICENSES_DEST = resolve(DIST, 'THIRD_PARTY_LICENSES.txt');
const THIRD_PARTY_LICENSES_HEADER =
  'このファイルは同梱している Consent-O-Matic のルール（rules/consent-o-matic.json）のライセンスです。\n' +
  '出典: https://github.com/cavi-au/Consent-O-Matic\n\n';

const shared = {
  bundle: true,
  target: 'chrome111',
  platform: 'browser',
  outdir: DIST,
  logLevel: 'info',
  sourcemap: WATCH ? 'inline' : false,
  minify: !WATCH,
  charset: 'utf8',
  legalComments: 'none',
};

// service worker は type: "module"、それ以外は iife
const configs = [
  {
    ...shared,
    format: 'iife',
    entryPoints: {
      content: resolve(ROOT, 'src/content/index.ts'),
      popup: resolve(ROOT, 'src/popup/popup.ts'),
      options: resolve(ROOT, 'src/options/options.ts'),
      onboarding: resolve(ROOT, 'src/onboarding/onboarding.ts'),
    },
  },
  {
    ...shared,
    format: 'esm',
    entryPoints: { background: resolve(ROOT, 'src/background/index.ts') },
  },
];

async function copyPublic() {
  if (!(await stat(PUBLIC).catch(() => null))) return;
  await mkdir(DIST, { recursive: true });
  await cp(PUBLIC, DIST, { recursive: true });
}

/** MIT 本文と著作権表示は改変せず、説明用のヘッダーのみ加えて dist/ に同梱する */
async function copyThirdPartyLicenses() {
  const license = await readFile(THIRD_PARTY_LICENSE_SRC, 'utf8');
  await mkdir(DIST, { recursive: true });
  await writeFile(THIRD_PARTY_LICENSES_DEST, THIRD_PARTY_LICENSES_HEADER + license);
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await copyPublic();
  await copyThirdPartyLicenses();

  if (!WATCH) {
    await Promise.all(configs.map((config) => esbuild.build(config)));
    console.log(`ビルド完了: ${DIST}`);
    return;
  }

  const contexts = await Promise.all(configs.map((config) => esbuild.context(config)));
  await Promise.all(contexts.map((context) => context.watch()));
  let timer = null;
  watch(PUBLIC, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void copyPublic().then(() => console.log('public/ をコピーしました'));
    }, 100);
  });
  console.log('監視中（Ctrl+C で終了）');
}

await main();
