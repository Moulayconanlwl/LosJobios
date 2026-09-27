/**
 * Pull a job posting's text out of a page.
 *
 * **This function is serialized into the page by `chrome.scripting`**, so it
 * must close over nothing at all — every constant it needs is declared inside
 * it. That is why it looks repetitive rather than factored out.
 *
 * The bug it exists to prevent: taking `main` or `article` whole. LinkedIn's
 * footer, language picker and Premium upsell together run to several thousand
 * characters — more than most job descriptions — so "longest element wins"
 * reliably returns the page furniture instead of the posting, and the user
 * gets a cover letter written about LinkedIn's own marketing copy.
 */
export function extractDescription(useFallback: boolean): string {
  /** Containers that hold the posting itself. A match here is trusted. */
  const SPECIFIC = [
    // LinkedIn, authenticated.
    '#job-details',
    '.jobs-description__content',
    '.jobs-description-content__text',
    '.jobs-box__html-content',
    '[class*="jobs-description"]',
    // LinkedIn, signed-out guest posting.
    '.show-more-less-html__markup',
    '.description__text',
    '[class*="description__text"]',
    // Indeed.
    '#jobDescriptionText',
    '.jobsearch-JobComponent-description',
    '#vjs-desc',
  ]

  /** Page furniture, stripped before anything generic is measured. */
  const CHROME = [
    'nav',
    'header',
    'footer',
    'aside',
    'script',
    'style',
    'noscript',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[class*="upsell" i]',
    '[class*="premium" i]',
    '[class*="global-footer" i]',
    '[class*="language-selector" i]',
    '[data-test-global-footer]',
    '.msg-overlay-list-bubble',
  ]

  const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

  /** Text with the page furniture removed. */
  const textOf = (element: Element): string => {
    const copy = element.cloneNode(true) as HTMLElement
    for (const selector of CHROME) {
      copy.querySelectorAll(selector).forEach((node) => node.remove())
    }
    // textContent, not innerText: the clone is detached and so has no layout,
    // and innerText returns '' without one.
    return clean(copy.textContent || '')
  }

  let best = ''
  for (const selector of SPECIFIC) {
    for (const element of Array.from(document.querySelectorAll(selector))) {
      const text = textOf(element)
      if (text.length > best.length) best = text
    }
  }

  // A specific container that produced a real body is the answer.
  if (best.length > 200) return best.slice(0, 8000)

  if (!useFallback) return ''

  /*
   * Last resort: the densest *block*, not the whole of `main`.
   *
   * "Densest" means the element holding the most text that is not merely a
   * wrapper around one child that holds it all. That walks past the page
   * shell and lands on the element actually containing the prose.
   */
  const root = document.querySelector('main, article, [role="main"]') ?? document.body
  if (!root) return ''

  let densest = ''
  for (const block of Array.from(root.querySelectorAll('div, section, article, p'))) {
    if (block.closest(CHROME.join(','))) continue

    const text = textOf(block)
    if (text.length < 200 || text.length <= densest.length) continue

    const biggestChild = Array.from(block.children).reduce(
      (max, child) => Math.max(max, textOf(child).length),
      0,
    )
    // Mostly one child's text means this is a wrapper, not the body.
    if (biggestChild > text.length * 0.9) continue

    densest = text
  }

  return densest.slice(0, 8000)
}
