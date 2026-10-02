// Generates the app icons (PNG) with no dependencies: node scripts/make-icons.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const out = path.join(__dirname, '..', 'docs', 'icons');

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Design: near-black rounded square, a coral progress ring (3/4 arc, round caps) with a dot in the middle.
const BG = [237, 237, 237], ACC = [255, 45, 45], TRACK = [17, 17, 17];
function make(size, { maskable, rounded }) {
  const SS = 3; // supersampling
  return png(size, (px, py) => {
    let rr = 0, gg = 0, bb = 0, aa = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / size - 0.5, y = (py + (sy + 0.5) / SS) / size - 0.5;
        let col = null;
        // background (rounded square unless maskable / apple which want full bleed)
        const rad = 0.22, ax = Math.abs(x) - (0.5 - rad), ay = Math.abs(y) - (0.5 - rad);
        const inside = !rounded || (ax <= 0 || ay <= 0 ? true : Math.hypot(ax, ay) <= rad);
        if (inside) col = BG;
        if (col) {
          const scale = maskable ? 0.62 : 0.78;
          const d = Math.hypot(x, y) / (scale * 0.5);
          const ringR = 0.78, w = 0.17;
          if (Math.abs(d - ringR) <= w / 2 * 1.0 + 0) {
            let ang = Math.atan2(x, -y); if (ang < 0) ang += Math.PI * 2; // 0 at top, clockwise
            const frac = ang / (Math.PI * 2);
            col = frac <= 0.74 ? ACC : TRACK;
          }
          // round caps for the arc ends
          const capAt = (a) => {
            const cx = Math.sin(a) * ringR, cy = -Math.cos(a) * ringR;
            return Math.hypot(x / (scale * 0.5) - cx, y / (scale * 0.5) - cy) <= w / 2;
          };
          if (capAt(0) || capAt(0.74 * Math.PI * 2)) col = ACC;
          if (d <= 0.2) col = TRACK;
        }
        if (col) { rr += col[0]; gg += col[1]; bb += col[2]; aa += 255; }
      }
    const n = SS * SS;
    const a = aa / n;
    return a ? [Math.round(rr / (a / 255 * n)), Math.round(gg / (a / 255 * n)), Math.round(bb / (a / 255 * n)), Math.round(a)] : [0, 0, 0, 0];
  });
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), make(192, { rounded: true }));
fs.writeFileSync(path.join(out, 'icon-512.png'), make(512, { rounded: true }));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), make(512, { maskable: true, rounded: false }));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), make(180, { rounded: false }));
console.log('icons written');
