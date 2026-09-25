/**
 * Reconstructing readable lines from pdf.js's flat text-item stream.
 *
 * pdf.js's `getTextContent()` hands back a flat array of text fragments with
 * no inherent notion of "line" — joining them with a single space (the naive
 * approach) collapses an entire page into one giant line. That's fatal for
 * anything line-oriented: the "candidate's name is the first line" heuristic,
 * a "Skills" section read until the next blank line, all of it. This module
 * uses each fragment's position to rebuild the actual visual lines.
 *
 * No pdfjs or DOM dependency here on purpose — this is pure arithmetic over
 * plain objects, so it can be unit-tested without a real PDF or a browser.
 */

export type PositionedTextItem = {
  str: string
  /** The item's transformation matrix; only the translation (x, y) is used. */
  transform: number[]
  width: number
  height: number
  /** pdf.js's own signal that a line break follows this fragment. */
  hasEOL: boolean
}

type Line = { text: string; y: number }

function buildLines(items: PositionedTextItem[]): Line[] {
  const lines: Line[] = []

  let current = ''
  let lineY: number | null = null
  let prevEndX: number | null = null
  let prevY: number | null = null

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed) lines.push({ text: trimmed, y: lineY ?? 0 })
    current = ''
    lineY = null
    prevEndX = null
  }

  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL) flush()
      continue
    }

    const x = item.transform[4] ?? 0
    const y = item.transform[5] ?? 0
    const height = item.height || 10

    // pdf.js occasionally under-reports hasEOL at a column break; a vertical
    // jump well past one line's height is a stronger signal than trusting
    // hasEOL alone.
    const jumpedLine = prevY !== null && Math.abs(y - prevY) > height * 0.4
    if (current && jumpedLine) flush()

    // Fragments that should read as separate words sometimes arrive with no
    // trailing space in `str` — a real horizontal gap between them is what
    // actually separates two words versus two halves of one kerned word.
    if (current && prevEndX !== null) {
      const gap = x - prevEndX
      if (gap > height * 0.18 && !current.endsWith(' ')) current += ' '
    }

    current += item.str
    lineY ??= y
    prevEndX = x + (item.width || 0)
    prevY = y

    if (item.hasEOL) flush()
  }
  flush()

  return lines
}

/**
 * Turn the position-carrying line list into plain text, inserting a blank
 * line wherever the vertical gap to the next line is well past the
 * document's typical line spacing — approximating a paragraph or section
 * break so line-count-dependent heuristics downstream (e.g. "read until the
 * next blank line") still have something to key off of.
 */
function withSectionBreaks(lines: Line[]): string[] {
  if (lines.length < 2) return lines.map((l) => l.text)

  const gaps: number[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const prev = lines[i - 1]
    const line = lines[i]
    if (!prev || !line) continue
    const gap = Math.abs(prev.y - line.y)
    if (gap > 0.5) gaps.push(gap)
  }

  gaps.sort((a, b) => a - b)
  const typicalGap = gaps.length ? (gaps[Math.floor(gaps.length / 2)] ?? 0) : 0

  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue

    if (i > 0 && typicalGap > 0) {
      const prev = lines[i - 1]
      const gap = prev ? Math.abs(prev.y - line.y) : 0
      if (gap > typicalGap * 1.6) out.push('')
    }

    out.push(line.text)
  }
  return out
}

/**
 * Reconstruct a single page's text as an array of visual lines, blank lines
 * inserted at apparent paragraph/section breaks.
 */
export function reconstructLines(items: PositionedTextItem[]): string[] {
  return withSectionBreaks(buildLines(items))
}
