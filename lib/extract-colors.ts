// lib/extract-colors.ts
// Client-only helper: pull a small brand palette out of an uploaded logo so the
// super admin doesn't have to hand-pick colours. Runs entirely in the browser
// (canvas) — the image never leaves the page. The result is only a SUGGESTION;
// the colour fields stay editable so it can be overridden.

export interface Palette {
  primary: string
  secondary: string
  accent: string
}

interface Bucket {
  r: number
  g: number
  b: number
  count: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("Could not load image"))
    img.src = src
  })
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}

// HSL components we actually use: hue (0–360), saturation and lightness (0–1).
function hsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0))
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
  }
  return { h, s, l }
}

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function darken(r: number, g: number, b: number, factor: number): string {
  return toHex(r * factor, g * factor, b * factor)
}

/**
 * Extract a suggested {primary, secondary, accent} palette from an image source
 * (a data URL or same-origin URL). Returns null if the image can't be read.
 */
export async function extractLogoColors(src: string): Promise<Palette | null> {
  let img: HTMLImageElement
  try {
    img = await loadImage(src)
  } catch {
    return null
  }

  const natW = img.naturalWidth || img.width || 64
  const natH = img.naturalHeight || img.height || 64
  const scale = Math.min(1, 64 / Math.max(natW, natH))
  const w = Math.max(1, Math.round(natW * scale))
  const h = Math.max(1, Math.round(natH * scale))

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(0, 0, w, h).data
  } catch {
    return null // tainted canvas (shouldn't happen for same-origin/data URLs)
  }

  // Quantise to 4 bits per channel and accumulate average colour per bucket.
  const buckets = new Map<number, Bucket>()
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 125) continue // ignore transparent pixels (logo background)
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const cur = buckets.get(key)
    if (cur) {
      cur.r += r; cur.g += g; cur.b += b; cur.count++
    } else {
      buckets.set(key, { r, g, b, count: 1 })
    }
  }
  if (buckets.size === 0) return null

  const swatches = [...buckets.values()].map((bk) => {
    const r = bk.r / bk.count, g = bk.g / bk.count, b = bk.b / bk.count
    const { h: hue, s, l } = hsl(r, g, b)
    return { r, g, b, count: bk.count, hue, s, l }
  })

  // Coloured candidates for primary/accent: skip near-greys and extreme light/dark.
  const colored = swatches
    .filter((c) => c.s > 0.15 && c.l > 0.12 && c.l < 0.9)
    .map((c) => ({ ...c, score: c.count * (0.25 + c.s * c.s) * (1 - Math.abs(c.l - 0.5) * 0.5) }))
    .sort((a, b) => b.score - a.score)

  // Fall back to the most common colour overall if nothing is vivid enough.
  const fallback = [...swatches].sort((a, b) => b.count - a.count)[0]
  const primary = colored[0] ?? fallback

  // Accent: the strongest candidate whose hue is clearly different from primary.
  const accent =
    colored.find((c) => c !== primary && hueDelta(c.hue, primary.hue) > 40) ??
    colored[1] ??
    null

  // Secondary: a dark neutral for text/ink. Prefer a genuinely dark, common
  // swatch; otherwise derive a deep shade from the primary colour.
  const dark = [...swatches]
    .filter((c) => c.l < 0.4 && c.count > primary.count * 0.05)
    .sort((a, b) => a.l - b.l)[0]

  return {
    primary: toHex(primary.r, primary.g, primary.b),
    secondary: dark ? toHex(dark.r, dark.g, dark.b) : darken(primary.r, primary.g, primary.b, 0.35),
    accent: accent ? toHex(accent.r, accent.g, accent.b) : darken(primary.r, primary.g, primary.b, 1.25),
  }
}
