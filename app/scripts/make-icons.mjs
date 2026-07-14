// Generates the PWA placeholder icons (a small planet on deep space) into
// public/ with zero image dependencies — hand-rolled PNG encoding via zlib.
// Regenerate with: npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// ---- minimal PNG writer (8-bit RGBA, no filtering) ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // rows prefixed with filter byte 0
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++)
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---- the artwork ----
const mix = (a, b, t) => a + (b - a) * t
const clamp01 = (t) => Math.min(1, Math.max(0, t))

function draw(size, { planetScale = 0.38 } = {}) {
  const buf = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const R = size * planetScale
  // light source up-left of center
  const lx = cx - R * 0.55
  const ly = cy - R * 0.55
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      // background: deep-space vertical gradient (#0b1020 → #111a36)
      const g = y / size
      let r = mix(0x0b, 0x11, g)
      let gr = mix(0x10, 0x1a, g)
      let b = mix(0x20, 0x36, g)

      const dx = x - cx
      const dy = y - cy
      const d = Math.hypot(dx, dy)

      // soft atmosphere glow just outside the limb
      const glow = clamp01(1 - Math.abs(d - R * 1.06) / (R * 0.22))
      r = mix(r, 0x2d, glow * 0.18)
      gr = mix(gr, 0xd4, glow * 0.18)
      b = mix(b, 0xa7, glow * 0.18)

      // planet disc with anti-aliased limb
      const cover = clamp01(R + 0.5 - d)
      if (cover > 0) {
        // base: teal at the lit pole → deep sea-green at the dark pole
        const v = clamp01((y - (cy - R)) / (2 * R))
        let pr = mix(0x4f, 0x14, v)
        let pg = mix(0xe0, 0x50, v)
        let pb = mix(0xb8, 0x4a, v)
        // terminator shading away from the light
        const ld = Math.hypot(x - lx, y - ly) / (2 * R)
        const shade = clamp01(1.15 - ld)
        pr *= shade
        pg *= shade
        pb *= shade
        r = mix(r, pr, cover)
        gr = mix(gr, pg, cover)
        b = mix(b, pb, cover)
      }

      buf[i] = Math.round(r)
      buf[i + 1] = Math.round(gr)
      buf[i + 2] = Math.round(b)
      buf[i + 3] = 255
    }
  }
  return png(size, buf)
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'icon-192.png'), draw(192))
writeFileSync(join(OUT, 'icon-512.png'), draw(512))
// maskable: shrink the planet into the safe zone so OS masks don't clip it
writeFileSync(
  join(OUT, 'icon-512-maskable.png'),
  draw(512, { planetScale: 0.3 }),
)
writeFileSync(join(OUT, 'apple-touch-icon.png'), draw(180))
console.log('icons written to', OUT)
