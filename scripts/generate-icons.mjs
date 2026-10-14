// Renders the Sendero mark to the PNG sizes the Outlook manifest asks for.
// No dependencies: a signed-distance rasteriser and a hand-rolled PNG encoder.
// Run once; the output is committed under public/addin.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const TEAL = [31, 111, 106]
const WHITE = [255, 255, 255]

// The mark on a 24-unit grid: the curve "M6 18 C6 13 9 11.5 12 11.5 S18 10 18 6",
// the stem from (12,11.5) to (12,18) and a dot at (18,6).
function cubic(p0, p1, p2, p3, n = 24) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return pts
}
const curve = [...cubic([6, 18], [6, 13], [9, 11.5], [12, 11.5]), ...cubic([12, 11.5], [15, 11.5], [18, 10], [18, 6])]
const segments = []
for (let i = 1; i < curve.length; i++) segments.push([curve[i - 1], curve[i]])
segments.push([[12, 11.5], [12, 18]])

function distSeg(px, py, [[ax, ay], [bx, by]]) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function roundedRect(px, py) {
  // Signed distance to a 24×24 square with corner radius 6 (negative = inside).
  const r = 6
  const qx = Math.abs(px - 12) - (12 - r)
  const qy = Math.abs(py - 12) - (12 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function render(size) {
  const ss = 4 // supersampling per axis
  const rgba = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = ((x + (sx + 0.5) / ss) / size) * 24
          const py = ((y + (sy + 0.5) / ss) / size) * 24
          if (roundedRect(px, py) <= 0) {
            bg++
            const d = Math.min(...segments.map((s) => distSeg(px, py, s)))
            if (d <= 1.25 || Math.hypot(px - 18, py - 6) <= 1.9) fg++
          }
        }
      }
      const n = ss * ss, a = bg / n, f = bg ? fg / bg : 0
      const i = (y * size + x) * 4
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(TEAL[c] * (1 - f) + WHITE[c] * f)
      rgba[i + 3] = Math.round(a * 255)
    }
  }
  return png(size, size, rgba)
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

mkdirSync('public/addin', { recursive: true })
for (const size of [16, 32, 64, 80, 128]) {
  writeFileSync(`public/addin/icon-${size}.png`, render(size))
  console.log(`public/addin/icon-${size}.png`)
}
