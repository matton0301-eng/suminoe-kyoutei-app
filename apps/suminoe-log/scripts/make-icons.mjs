/**
 * PWA アイコンを生成する。
 *
 * 依存を増やさないため、Node 組み込みの zlib だけで PNG を書き出す。
 *
 * デザイン: 新聞の題字。朱の地に「ス」を白抜きで大きく置く。
 * **一目で何のアプリか分かることを優先した。**
 * 以前は枠番6色の縦バーだったが、ホーム画面の小さい表示では
 * 「黒地に六色の何か」にしか見えず、意味が伝わっていなかった。
 *
 * 文字はフォントを使わず、線分を3本引いて作る（外部依存を増やさないため）。
 *
 * maskable 対応: 主要要素は中央80%（セーフゾーン）の内側に収める。
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'icons');

/** 新聞の朱。差し色としてアプリ内でも使っている色 */
const BG = [0xc8, 0x10, 0x2e];
/** 生成りの紙 */
const INK = [0xfb, 0xf8, 0xf1];

// --- PNG エンコーダ（CRC32 + zlib） ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** RGB のピクセル配列（size*size*3）を PNG バッファにする。 */
function encodePng(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // フィルタなし
    rgb.copy(raw, rowStart + 1, y * size * 3, (y + 1) * size * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // カラータイプ: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- 描画 ---

function drawIcon(size) {
  // encodePng は Buffer を前提にしている（rgb.copy を使う）
  const rgb = Buffer.alloc(size * size * 3);

  const setPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 3;
    rgb[offset] = color[0];
    rgb[offset + 1] = color[1];
    rgb[offset + 2] = color[2];
  };

  // 地は朱で塗りつぶす
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) setPixel(x, y, BG);
  }

  /** 太さのある線分。丸い筆で撫でる要領で塗る */
  const stroke = (x0, y0, x1, y1, thickness, color) => {
    const ax = x0 * size;
    const ay = y0 * size;
    const bx = x1 * size;
    const by = y1 * size;
    const radius = (thickness * size) / 2;
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay)) * 2;
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const cx = ax + (bx - ax) * t;
      const cy = ay + (by - ay) * t;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy <= radius * radius) {
            setPixel(Math.round(cx + dx), Math.round(cy + dy), color);
          }
        }
      }
    }
  };

  // カタカナの「ス」。横棒 → 右上から左下への斜め → 中ほどから右下への払い。
  // 座標は size に対する比率で、maskable のセーフゾーン（中央80%）に収めてある
  const weight = 0.115;
  stroke(0.24, 0.3, 0.76, 0.3, weight, INK);
  stroke(0.68, 0.3, 0.3, 0.74, weight, INK);
  stroke(0.45, 0.52, 0.74, 0.76, weight, INK);

  return encodePng(size, rgb);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const png = drawIcon(size);
  const path = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`generated ${path} (${png.length.toLocaleString()} bytes)`);
}
