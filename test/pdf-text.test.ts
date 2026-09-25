import { describe, expect, it } from 'vitest'
import { reconstructLines, type PositionedTextItem } from '@/lib/pdf-text'

/**
 * This is the regression guard for the actual reported bug: naive extraction
 * joined every fragment on a page into one line, which silently broke every
 * line-oriented heuristic (name guessing, skills-section reading) even though
 * regex-based email/phone/link extraction kept working — which is exactly why
 * it looked like "some info" was being recovered while the rest silently
 * wasn't.
 */

function item(
  str: string,
  x: number,
  y: number,
  opts: Partial<Omit<PositionedTextItem, 'str' | 'transform'>> = {},
): PositionedTextItem {
  return {
    str,
    transform: [1, 0, 0, 1, x, y],
    width: opts.width ?? str.length * 6,
    height: opts.height ?? 12,
    hasEOL: opts.hasEOL ?? false,
  }
}

describe('reconstructLines', () => {
  it('does not collapse an entire page into one line', () => {
    const items = [
      item('Ada Lovelace', 0, 700, { hasEOL: true }),
      item('Senior Engineer', 0, 680, { hasEOL: true }),
      item('ada@example.com', 0, 660, { hasEOL: true }),
    ]
    expect(reconstructLines(items)).toEqual([
      'Ada Lovelace',
      'Senior Engineer',
      'ada@example.com',
    ])
  })

  it('joins fragments on the same line with a space when a gap separates them', () => {
    // Two separate text runs for "Ada" and "Lovelace" on one visual line,
    // with no trailing space baked into either string — pdf.js does this
    // constantly when a font/style change splits a run mid-word-boundary.
    const first = item('Ada', 0, 700)
    const items = [first, item('Lovelace', 0 + first.width + 4, 700, { hasEOL: true })]
    expect(reconstructLines(items)).toEqual(['Ada Lovelace'])
  })

  it('does not insert a space inside a word split across two kerned fragments', () => {
    const first = item('Kuber', 0, 700)
    // No gap at all between the end of "Kuber" and the start of "netes".
    const items = [first, item('netes', 0 + first.width, 700, { hasEOL: true })]
    expect(reconstructLines(items)).toEqual(['Kubernetes'])
  })

  it('breaks a line on a vertical jump even without hasEOL set', () => {
    const items = [item('Line one', 0, 700), item('Line two', 0, 680)]
    expect(reconstructLines(items)).toEqual(['Line one', 'Line two'])
  })

  it('inserts a blank line at a gap much larger than the typical line spacing', () => {
    const items = [
      item('Experience', 0, 700, { hasEOL: true }),
      item('Senior Engineer', 0, 686, { hasEOL: true }),
      item('Staff Engineer', 0, 672, { hasEOL: true }),
      // A visibly larger gap before the next section heading.
      item('Education', 0, 630, { hasEOL: true }),
      item('BSc Computer Science', 0, 616, { hasEOL: true }),
    ]
    const lines = reconstructLines(items)
    expect(lines).toContain('')
    expect(lines.indexOf('')).toBeGreaterThan(lines.indexOf('Staff Engineer'))
    expect(lines.indexOf('')).toBeLessThan(lines.indexOf('Education'))
  })

  it('drops empty fragments without producing spurious blank output', () => {
    const items = [item('', 0, 700, { hasEOL: true }), item('Ada', 0, 680, { hasEOL: true })]
    expect(reconstructLines(items)).toEqual(['Ada'])
  })

  it('handles an empty page', () => {
    expect(reconstructLines([])).toEqual([])
  })
})
