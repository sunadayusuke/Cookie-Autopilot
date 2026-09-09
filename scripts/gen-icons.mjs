// 仮アイコンの生成（docs/SPEC.md §10）
// 丸いクッキー風。デザイナーが差し替える前提の暫定素材。
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/icons');
const SIZES = [16, 32, 48, 128];

const DOUGH = [216, 160, 91];
const DOUGH_EDGE = [180, 126, 64];
const CHIP = [92, 58, 32];
// 中心からの相対位置（クッキーの半径に対する比）と半径（同じ比）
const CHIPS = [
  { x: -0.38, y: -0.34, r: 0.16 },
  { x: 0.34, y: -0.2, r: 0.13 },
  { x: -0.02, y: 0.04, r: 0.15 },
  { x: -0.4, y: 0.36, r: 0.12 },
  { x: 0.3, y: 0.42, r: 0.14 },
];

function blend(png, index, color, alpha) {
  for (let channel = 0; channel < 3; channel++) {
    const current = png.data[index + channel];
    png.data[index + channel] = Math.round(current * (1 - alpha) + color[channel] * alpha);
  }
  png.data[index + 3] = Math.max(png.data[index + 3], Math.round(255 * alpha));
}

/** 円のアンチエイリアス係数（0..1） */
function coverage(dx, dy, radius) {
  const distance = Math.sqrt(dx * dx + dy * dy);
  const edge = 0.7; // ピクセル単位のぼかし幅
  if (distance <= radius - edge) return 1;
  if (distance >= radius + edge) return 0;
  return (radius + edge - distance) / (edge * 2);
}

function render(size) {
  const png = new PNG({ width: size, height: size });
  png.data.fill(0);
  const center = (size - 1) / 2;
  const radius = size / 2 - Math.max(0.5, size * 0.02);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const dx = x - center;
      const dy = y - center;
      const inside = coverage(dx, dy, radius);
      if (inside <= 0) continue;
      // 外周を少し濃くする
      const distance = Math.sqrt(dx * dx + dy * dy) / radius;
      const color = distance > 0.82 ? DOUGH_EDGE : DOUGH;
      blend(png, index, color, inside);

      for (const chip of CHIPS) {
        const chipCover = coverage(dx - chip.x * radius, dy - chip.y * radius, chip.r * radius);
        if (chipCover > 0) blend(png, index, CHIP, chipCover * inside);
      }
    }
  }
  return PNG.sync.write(png);
}

await mkdir(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon${size}.png`);
  await writeFile(file, render(size));
  console.log(`生成: ${file}`);
}
