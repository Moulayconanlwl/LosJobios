import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clickInPlace } from '@/content/dom/human'
import { isListingPage } from '@/background/boards'

/**
 * Clicking a job card without leaving the page.
 *
 * The reported failure: selecting a job navigated the tab to the posting,
 * which tears down the content script and ends the run with a queue still in
 * it. The cause is that a dispatched `click` on an `<a href>` performs the
 * browser's default action just like a real one — the site's own single-page
 * handler is supposed to intercept it, and mostly does, but it only takes one
 * layout where the handler sits elsewhere for every job to become a page load.
 */

function anchor(): HTMLAnchorElement {
  document.body.innerHTML = '<a id="link" href="/jobs/view/123">Senior Engineer</a>'
  const el = document.getElementById('link') as HTMLAnchorElement
  // Nothing is laid out in a test DOM, and humanClick needs a painted target.
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}) }) as DOMRect
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('clickInPlace', () => {
  it('cancels the navigation the click would otherwise cause', async () => {
    const link = anchor()
    let atAnchor: boolean | null = null
    let event: Event | null = null

    link.addEventListener('click', (e) => {
      atAnchor = e.defaultPrevented
      event = e
    })

    await clickInPlace(link)

    // At the anchor the event is still live — the site's own handler runs on
    // an un-cancelled event, which is the whole reason the suppression sits
    // on window rather than here.
    expect(atAnchor).toBe(false)
    // By the end of dispatch it is cancelled, so the browser does not follow
    // the href. That is the fix.
    expect((event as unknown as Event).defaultPrevented).toBe(true)
  }, 15_000)

  it('leaves the page’s own handler free to run', async () => {
    /*
     * The suppression sits on `window` in the bubble phase, below which the
     * site's handlers live. Preventing earlier would hand those handlers an
     * already-cancelled event, and single-page routers routinely bail on one.
     */
    const link = anchor()
    const handler = vi.fn()
    link.addEventListener('click', handler)

    await clickInPlace(link)

    expect(handler).toHaveBeenCalledTimes(1)
  }, 15_000)

  it('still fires the full pointer sequence', async () => {
    // Components built on pointer events ignore a bare click.
    const link = anchor()
    const seen: string[] = []
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      link.addEventListener(type, () => seen.push(type))
    }

    await clickInPlace(link)

    expect(seen).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
  }, 15_000)

  it('does not suppress a real click from the user', async () => {
    /*
     * `isTrusted` separates the two. The listener is armed for a couple of
     * hundred milliseconds, and in that window a person clicking a link must
     * still be able to follow it.
     *
     * A trusted event cannot be created, so this forges the one property the
     * guard reads and checks both sides of it.
     */
    const link = anchor()
    const clicking = clickInPlace(link)

    const trusted = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(trusted, 'isTrusted', { value: true })
    document.body.dispatchEvent(trusted)

    const synthetic = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(synthetic)

    await clicking

    expect(trusted.defaultPrevented, 'a real click must still navigate').toBe(false)
    expect(synthetic.defaultPrevented, 'our own click must not').toBe(true)
  }, 15_000)

  it('removes its listener afterwards', async () => {
    // Otherwise every later click on the page would be swallowed.
    await clickInPlace(anchor())

    const later = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(later)
    expect(later.defaultPrevented).toBe(false)
  }, 15_000)
})

describe('isListingPage', () => {
  it('accepts the pages a run works down', () => {
    expect(isListingPage('https://www.linkedin.com/jobs/search/?keywords=dev')).toBe(true)
    expect(isListingPage('https://www.linkedin.com/jobs/collections/recommended/')).toBe(true)
    expect(isListingPage('https://fr.indeed.com/jobs?q=dev')).toBe(true)
  })

  it('rejects a single posting, which is where a stray navigation lands', () => {
    // This is the state the run has to notice and recover from.
    expect(isListingPage('https://www.linkedin.com/jobs/view/4421154534/')).toBe(false)
    expect(isListingPage('https://fr.indeed.com/viewjob?jk=9f2c41ab7de05613')).toBe(false)
  })

  it('ignores the query string, which boards rewrite as you browse', () => {
    /*
     * LinkedIn appends `currentJobId` every time a card is selected. Comparing
     * whole URLs would read each selection as a navigation and reload the
     * search forever.
     */
    expect(
      isListingPage('https://www.linkedin.com/jobs/search/?keywords=dev&currentJobId=442115'),
    ).toBe(true)
  })

  it('returns false for anywhere else, and for junk', () => {
    expect(isListingPage('https://example.com/jobs/search')).toBe(false)
    expect(isListingPage('not a url')).toBe(false)
    expect(isListingPage(undefined)).toBe(false)
  })
})
