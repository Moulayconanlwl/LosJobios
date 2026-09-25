/**
 * Rendering mammoth's HTML output as plain text, with hyperlinks preserved.
 *
 * `mammoth.extractRawText` throws hyperlink targets away entirely — a resume
 * header that links a "LinkedIn" icon or a name to a profile URL loses that
 * URL, and it never shows up anywhere in the plain text. `convertToHtml` keeps
 * `<a href>`, so this walks the HTML and renders each link as
 * `visible text (https://target)` — the same convention the reference
 * project's DOCX importer uses, and one both our regex heuristics and the AI
 * prompt already know how to read.
 *
 * Only depends on DOMParser, which is standard in both the extension's option
 * page and the vitest (happy-dom) test environment — no pdfjs/mammoth import
 * here, so this stays trivially unit-testable.
 */

const BLOCK_TAGS = new Set([
  'P', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'BR', 'TABLE',
])

export function htmlToTextWithLinks(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const lines: string[] = []
  let current = ''

  const flush = () => {
    const trimmed = current.trim()
    // Collapse runs of blank lines to one, but keep single blank separators —
    // they're what lets a line-oriented heuristic find a section's end.
    if (trimmed || lines[lines.length - 1] !== '') lines.push(trimmed)
    current = ''
  }

  const walk = (node: ChildNode) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as HTMLElement

    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? ''
      const text = (el.textContent ?? '').trim()
      const isRealLink = /^https?:\/\//i.test(href)
      current += isRealLink && text && !text.includes(href) ? `${text} (${href})` : text
      return
    }

    el.childNodes.forEach(walk)

    if (BLOCK_TAGS.has(el.tagName)) flush()
    // A table cell boundary isn't a line break, but adjacent cells' text
    // must not run together into one word either.
    else if (el.tagName === 'TD' || el.tagName === 'TH') current += '  '
  }

  doc.body.childNodes.forEach(walk)
  flush()

  // Trim a leading/trailing blank line the block-flushing can leave behind.
  while (lines.length && lines[0] === '') lines.shift()
  while (lines.length && lines[lines.length - 1] === '') lines.pop()

  return lines.join('\n')
}
