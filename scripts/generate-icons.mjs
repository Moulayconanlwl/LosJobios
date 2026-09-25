import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Generates the extension's PNG icons.
 *
 * Chrome needs raster icons, and pulling in an image library to draw three
 * small squares isn't worth it — Node's zlib is all a valid PNG actually
 * requires. The mark is an upward chevron on an indigo field: "applications
 * going out", legible down to 16px where anything more detailed turns to mush.
 */

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const SIZES = [16, 48, 128]

const BG_TOP = [0x4f, 0x46, 0xe5] // indigo-600
const BG_BOTTOM = [0x7c, 0x3a, 0xed] // violet-600
const FG = [0xff, 0xff, 0xff]

function crc32(buf) {
  let crc = 0xffffffff
  for (const byte of buf) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)

  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])

  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))

  return Buffer.concat([length, typed, crc])
}

/** `pixels` is RGBA, row-major. */
function encodePng(size, pixels) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Each scanline is prefixed with its filter type; 0 means "none".
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Coverage of a rounded-rect at a point, antialiased by supersampling. */
function roundedRectCoverage(x, y, size, radius, inset) {
  const min = inset
  const max = size - inset
  let hits = 0

  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      const px = x + (sx + 0.5) / 4
      const py = y + (sy + 0.5) / 4

      if (px < min || px > max || py < min || py > max) continue

      // Distance to the nearest corner's centre, clamped into the corner box.
      const cx = Math.min(Math.max(px, min + radius), max - radius)
      const cy = Math.min(Math.max(py, min + radius), max - radius)
      if (Math.hypot(px - cx, py - cy) <= radius) hits += 1
    }
  }

  return hits / 16
}

/** Coverage of the chevron stroke — two arms meeting at an apex. */
function chevronCoverage(x, y, size) {
  const thickness = size * 0.12
  const halfWidth = size * 0.2
  const apexY = size * 0.37
  const baseY = size * 0.6
  const centre = size / 2

  let hits = 0
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      const px = x + (sx + 0.5) / 4
      const py = y + (sy + 0.5) / 4

      const dx = Math.abs(px - centre)
      // Stop the stroke cleanly at the arm ends rather than letting it bleed
      // toward the plate edge.
      if (dx > halfWidth) continue

      // The arm's ideal y at this horizontal distance from the apex.
      const armY = apexY + (dx / halfWidth) * (baseY - apexY)
      if (Math.abs(py - armY) <= thickness / 2) hits += 1
    }
  }

  return hits / 16
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const radius = size * 0.22
  const inset = size * 0.06

  for (let y = 0; y < size; y += 1) {
    const t = y / (size - 1)
    const bg = [
      Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t),
      Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t),
      Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t),
    ]

    for (let x = 0; x < size; x += 1) {
      const plate = roundedRectCoverage(x, y, size, radius, inset)
      const mark = chevronCoverage(x, y, size) * plate

      // Composite the white mark over the gradient plate.
      const r = bg[0] * (1 - mark) + FG[0] * mark
      const g = bg[1] * (1 - mark) + FG[1] * mark
      const b = bg[2] * (1 - mark) + FG[2] * mark

      const offset = (y * size + x) * 4
      pixels[offset] = Math.round(r)
      pixels[offset + 1] = Math.round(g)
      pixels[offset + 2] = Math.round(b)
      pixels[offset + 3] = Math.round(plate * 255)
    }
  }

  return encodePng(size, pixels)
}

mkdirSync(OUT_DIR, { recursive: true })

for (const size of SIZES) {
  const file = resolve(OUT_DIR, `icon${size}.png`)
  writeFileSync(file, render(size))
  console.log(`wrote ${file}`)
}
