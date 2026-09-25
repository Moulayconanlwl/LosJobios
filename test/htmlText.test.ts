import { describe, expect, it } from 'vitest'
import { htmlToTextWithLinks } from '@/ui/options/htmlText'

/**
 * The regression guard for the other real gap: mammoth's raw-text mode drops
 * hyperlink targets entirely, so a resume that links a "LinkedIn" icon (or the
 * candidate's name) to a profile URL loses that URL with no trace left in the
 * plain text. This renders links as "text (url)" instead — same convention the
 * AI prompt and our own regexes both know how to read.
 */

describe('htmlToTextWithLinks', () => {
  it('renders a hyperlink as "text (url)"', () => {
    const html = '<p><a href="https://linkedin.com/in/ada">LinkedIn</a></p>'
    expect(htmlToTextWithLinks(html)).toBe('LinkedIn (https://linkedin.com/in/ada)')
  })

  it('does not duplicate the url when the link text already is the url', () => {
    const html = '<p><a href="https://github.com/ada">https://github.com/ada</a></p>'
    expect(htmlToTextWithLinks(html)).toBe('https://github.com/ada')
  })

  it('ignores an internal anchor link (no real URL to recover)', () => {
    const html = '<p><a href="#section-1">Jump to Experience</a></p>'
    expect(htmlToTextWithLinks(html)).toBe('Jump to Experience')
  })

  it('puts each paragraph on its own line', () => {
    const html = '<p>Ada Lovelace</p><p>Senior Engineer</p>'
    expect(htmlToTextWithLinks(html)).toBe('Ada Lovelace\nSenior Engineer')
  })

  it('puts each list item on its own line', () => {
    const html = '<ul><li>Python</li><li>TypeScript</li></ul>'
    expect(htmlToTextWithLinks(html)).toBe('Python\nTypeScript')
  })

  it('keeps a blank line between sections so section-scanning heuristics still work', () => {
    const html = '<p>Skills</p><p>Python, TypeScript</p><p></p><p>Experience</p>'
    const lines = htmlToTextWithLinks(html).split('\n')
    expect(lines).toContain('')
  })

  it('does not run adjacent table cells together', () => {
    const html = '<table><tr><td>Python</td><td>TypeScript</td></tr></table>'
    const text = htmlToTextWithLinks(html)
    expect(text).not.toContain('PythonTypeScript')
    expect(text.replace(/\s+/g, ' ').trim()).toBe('Python TypeScript')
  })

  it('recovers a link hidden behind an icon-only label', () => {
    const html = '<p><a href="https://github.com/ada">GitHub</a> · <a href="https://linkedin.com/in/ada">LinkedIn</a></p>'
    const text = htmlToTextWithLinks(html)
    expect(text).toContain('github.com/ada')
    expect(text).toContain('linkedin.com/in/ada')
  })

  it('handles empty input', () => {
    expect(htmlToTextWithLinks('')).toBe('')
  })
})
