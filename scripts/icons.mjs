import fs from 'node:fs';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const PAPER = [242, 239, 231];
const BLUE = [61, 126, 166];
const BLUE_DARK = [43, 94, 126];
const BLUE_LIGHT = [111, 166, 197];
const ORANGE = [217, 93, 57];
const ORANGE_DARK = [168, 62, 37];
const ORANGE_LIGHT = [244, 155, 128];
const WHITE = [255, 253, 248];
const INK = [35, 33, 28];

function inRR(x, y, rx, ry, rw, rh, r) {
  if (x < rx || y < ry || x > rx + rw || y > ry + rh) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + rw - r);
  const cy = Math.min(Math.max(y, ry + r), ry + rh - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inC(x, y, cx, cy, r) {
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inStar(x, y, cx, cy, ro, ri) {
  let a = Math.atan2(y - cy, x - cx) + Math.PI / 2;
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const seg = Math.PI / 5;
  const t = a % seg;
  return Math.hypot(x - cx, y - cy) <= ro - (ro - ri) * (t / seg);
}

function sample(x, y) {
  let c = PAPER;
  // soft shadow under brick
  if (inRR(x, y + 14, 106, 286, 300, 132, 30)) c = [224, 219, 208];
  // brick dark edge + body
  if (inRR(x, y, 102, 276, 308, 140, 34)) c = BLUE_DARK;
  if (inRR(x, y, 106, 280, 300, 132, 31)) c = BLUE;
  // studs (behind body top)
  for (const sx of [168, 256, 344]) {
    if (inC(x, y, sx, 264, 36)) c = BLUE_DARK;
    if (inC(x, y, sx, 260, 31)) c = BLUE;
    if (inC(x, y, sx - 8, 250, 8)) c = BLUE_LIGHT;
  }
  // brick highlight
  if (inRR(x, y, 112, 286, 288, 9, 4)) c = BLUE_LIGHT;
  // marble dark rim
  if (inC(x, y, 372, 206, 76)) c = ORANGE_DARK;
  if (inC(x, y, 372, 206, 70)) c = ORANGE;
  if (inC(x, y, 350, 184, 24)) c = ORANGE_LIGHT;
  if (inC(x, y, 346, 180, 12)) c = WHITE;
  // tiny shine
  if (inC(x, y, 390, 224, 7)) c = WHITE;
  // sparkle
  if (inStar(x, y, 132, 180, 30, 9)) c = [233, 180, 76];
  if (inStar(x, y, 432, 320, 18, 6)) c = [233, 180, 76];
  return c;
}

function make(size) {
  const ss = 2;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(((x + (sx + 0.5) / ss) / size) * 512, ((y + (sy + 0.5) / ss) / size) * 512);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = 255;
    }
  }
  return png(size, size, rgba);
}

fs.mkdirSync('public', { recursive: true });
for (const size of [512, 192, 180]) {
  fs.writeFileSync(`public/icon-${size}.png`, make(size));
  console.log(`public/icon-${size}.png`);
}
