// dist/ を Chrome ウェブストア提出用の zip にまとめる。
// dist/ ディレクトリ自体ではなく中身をそのまま zip 直下に入れる（manifest.json が zip 直下に来る必要があるため）。
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const RELEASE_DIR = resolve(ROOT, 'release');
const MANIFEST = resolve(ROOT, 'public/manifest.json');

async function readVersion() {
  const json = JSON.parse(await readFile(MANIFEST, 'utf8'));
  if (typeof json.version !== 'string') throw new Error('public/manifest.json に version がありません');
  return json.version;
}

async function main() {
  if (!(await stat(resolve(DIST, 'manifest.json')).catch(() => null))) {
    console.error('dist/manifest.json が見つかりません。先に `pnpm build` を実行してください。');
    process.exitCode = 1;
    return;
  }

  const version = await readVersion();
  await mkdir(RELEASE_DIR, { recursive: true });
  const zipPath = resolve(RELEASE_DIR, `cookie-autopilot-v${version}.zip`);
  await rm(zipPath, { force: true });

  // -r: 再帰 / -X: 拡張属性を含めない / -x: .DS_Store を除外
  // dist/ の中身がそのまま zip 直下に来るよう、dist/ を cwd にして "." を圧縮する
  await execFileAsync('zip', ['-r', '-X', zipPath, '.', '-x', '*.DS_Store'], { cwd: DIST });

  console.log(`パッケージ作成完了: ${zipPath}`);
}

await main();
