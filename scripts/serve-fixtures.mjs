// fixtures と dist を配信する簡易サーバ（docs/SPEC.md §11）
// /fixtures/* は fixtures/ から、それ以外は dist/ から返す。
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const FIXTURES = resolve(ROOT, 'fixtures');
const PORT = Number(process.env.PORT ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

/** パスを base 配下に閉じ込める */
function safeJoin(base, pathname) {
  const target = normalize(join(base, decodeURIComponent(pathname)));
  return target === base || target.startsWith(base + sep) ? target : null;
}

async function listFixtures() {
  try {
    const files = (await readdir(FIXTURES)).filter((name) => name.endsWith('.html')).sort();
    const items = files
      .map((name) => `<li><a href="/fixtures/${name}">${name}</a> <a href="/fixtures/${name}?mode=accept">(accept)</a></li>`)
      .join('\n');
    return `<!doctype html><meta charset="utf-8"><title>fixtures</title>
<h1>Cookie Autopilot fixtures</h1><ul>${items}</ul>`;
  } catch {
    return '<!doctype html><meta charset="utf-8">fixtures が見つかりません';
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const body = await listFixtures();
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(body);
      return;
    }

    const isFixture = url.pathname.startsWith('/fixtures/');
    const base = isFixture ? FIXTURES : DIST;
    const pathname = isFixture ? url.pathname.slice('/fixtures'.length) : url.pathname;
    const file = safeJoin(base, pathname);
    if (!file) {
      response.writeHead(403).end('403');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`404 ${url.pathname}\n（dist/ が無い場合は pnpm build を実行してください）`);
      return;
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  })();
});

server.listen(PORT, () => {
  console.log(`fixtures: http://localhost:${PORT}/`);
  console.log(`  dist/     -> http://localhost:${PORT}/content.js`);
  console.log(`  fixtures/ -> http://localhost:${PORT}/fixtures/custom-ja.html`);
});
