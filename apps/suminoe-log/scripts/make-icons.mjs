/**
 * PWA アイコンを生成する。
 *
 * 依存を増やさないため、Node 組み込みの zlib だけで PNG を書き出す。
 * デザイン: 深い水面色の背景に、枠番6色の縦バー。
 * このアプリは「艇色がUIの基本言語」なので、アイコンもその6色で表す。
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

const BG = [0xee, 0xf8, 0xfb];
const PANEL = [0x0a, 0x2a, 0x33];
const BOAT_COLORS = [
  [0xff, 0xff, 0xff], // 1 白
  [0x2b, 0x2b, 0x2b], // 2 黒
  [0xd8, 0x3a, 0x34], // 3 赤
  [0x2a, 0x6f, 0xc9], // 4 青
  [0xf2, 0xc2, 0x30], // 5 黄
  [0x3f, 0x9a, 0x54], // 6 緑
];

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
  const rgb = Buffer.alloc(size * size * 3);

  const setPixel = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 3;
    rgb[offset] = color[0];
    rgb[offset + 1] = color[1];
    rgb[offset + 2] = color[2];
  };

  // 背景
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      setPixel(x, y, BG);
    }
  }

  // 中央パネル（角丸の矩形）。セーフゾーン内に収める
  const panelInset = Math.round(size * 0.16);
  const panelSize = size - panelInset * 2;
  const panelRadius = Math.round(panelSize * 0.18);
  const inPanel = (x, y) => {
    const left = panelInset;
    const top = panelInset;
    const right = panelInset + panelSize - 1;
    const bottom = panelInset + panelSize - 1;
    if (x < left || x > right || y < top || y > bottom) return false;
    // 角の丸み
    const corners = [
      [left + panelRadius, top + panelRadius],
      [right - panelRadius, top + panelRadius],
      [left + panelRadius, bottom - panelRadius],
      [right - panelRadius, bottom - panelRadius],
    ];
    for (const [cx, cy] of corners) {
      const outsideX = (x < cx && cx === left + panelRadius) || (x > cx && cx === right - panelRadius);
      const outsideY = (y < cy && cy === top + panelRadius) || (y > cy && cy === bottom - panelRadius);
      if (outsideX && outsideY) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > panelRadius * panelRadius) return false;
      }
    }
    return true;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (inPanel(x, y)) setPixel(x, y, PANEL);
    }
  }

  // 枠番6色の縦バー
  const barsWidth = Math.round(size * 0.56);
  const barsHeight = Math.round(size * 0.42);
  const barsLeft = Math.round((size - barsWidth) / 2);
  const barsTop = Math.round((size - barsHeight) / 2);
  const gap = Math.max(1, Math.round(size * 0.014));
  const barWidth = Math.floor((barsWidth - gap * 5) / 6);
  const barRadius = Math.max(1, Math.round(barWidth * 0.25));

  BOAT_COLORS.forEach((color, index) => {
    const left = barsLeft + index * (barWidth + gap);
    for (let y = barsTop; y < barsTop + barsHeight; y += 1) {
      for (let x = left; x < left + barWidth; x += 1) {
        // 上下端を軽く丸める
        const fromTop = y - barsTop;
        const fromBottom = barsTop + barsHeight - 1 - y;
        const fromLeft = x - left;
        const fromRight = left + barWidth - 1 - x;
        const nearCornerY = Math.min(fromTop, fromBottom);
        const nearCornerX = Math.min(fromLeft, fromRight);
        if (nearCornerY < barRadius && nearCornerX < barRadius) {
          const dx = barRadius - nearCornerX;
          const dy = barRadius - nearCornerY;
          if (dx * dx + dy * dy > barRadius * barRadius) continue;
        }
        setPixel(x, y, color);
      }
    }
  });

  return encodePng(size, rgb);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const png = drawIcon(size);
  const path = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(path, png);
  console.log(`generated ${path} (${png.length.toLocaleString()} bytes)`);
}
