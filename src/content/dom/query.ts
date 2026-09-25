/**
 * DOM lookup helpers built for hostile, frequently-redesigned pages.
 *
 * The rule throughout: never depend on a single selector. Job sites rewrite
 * their class names constantly, but the *accessible* structure (labels, roles,
 * button text) is far more stable because screen readers depend on it.
 */

export type Root = Document | Element | ShadowRoot

/**
 * Rendered at all — not `display:none`, not `visibility:hidden`, not `[hidden]`.
 *
 * This is the right test for *collecting* form fields. Custom-styled radios and
 * checkboxes are routinely painted as 1×1 or fully transparent boxes with a
 * styled label on top; they're real, answerable questions, and a stricter check
 * would silently drop them. Greenhouse, Lever and Ashby all do this.
 */
export function isDisplayed(el: Element | null | undefined): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false
  if (!el.isConnected) return false
  if (el.hidden || el.closest('[hidden]')) return false

  const style = getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false

  return true
}

/**
 * Displayed *and* occupying space — the right test for something we intend to
 * click, where a zero-size target means the click would go nowhere.
 */
export function isVisible(el: Element | null | undefined): el is HTMLElement {
  if (!isDisplayed(el)) return false
  if (Number(getComputedStyle(el).opacity) === 0) return false

  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

/** True when the control is disabled or read-only, directly or via a fieldset. */
export function isInteractable(el: Element): boolean {
  const input = el as HTMLInputElement
  if (input.disabled || input.readOnly) return false
  if (el.getAttribute('aria-disabled') === 'true') return false
  if (el.closest('fieldset[disabled]')) return false
  return true
}

/** Which visibility bar an element has to clear to be picked. */
export type Predicate = (el: Element) => el is HTMLElement

/** First match across a list of candidate CSS selectors, in priority order. */
export function pick(
  selectors: string[],
  root: Root = document,
  accept: Predicate = isVisible,
): HTMLElement | null {
  for (const selector of selectors) {
    let matches: NodeListOf<Element>
    try {
      matches = root.querySelectorAll(selector)
    } catch {
      continue // a bad selector shouldn't kill the whole lookup
    }
    for (const el of matches) {
      if (accept(el)) return el
    }
  }
  return null
}

/** All matches across candidate selectors, de-duplicated and in document order. */
export function pickAll(
  selectors: string[],
  root: Root = document,
  accept: Predicate = isVisible,
): HTMLElement[] {
  const seen = new Set<Element>()
  const out: HTMLElement[] = []
  for (const selector of selectors) {
    let matches: NodeListOf<Element>
    try {
      matches = root.querySelectorAll(selector)
    } catch {
      continue
    }
    for (const el of matches) {
      if (!seen.has(el) && accept(el)) {
        seen.add(el)
        out.push(el)
      }
    }
  }
  return out
}

export function byXPath(expression: string, root: Node = document): HTMLElement | null {
  try {
    const result = document.evaluate(
      expression,
      root,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    )
    const node = result.singleNodeValue
    return isVisible(node as Element) ? (node as HTMLElement) : null
  } catch {
    return null
  }
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/** Visible text of an element, collapsed to single spaces. */
export function text(el: Element | null | undefined): string {
  if (!el) return ''
  return normalizeText((el as HTMLElement).innerText ?? el.textContent)
}

/**
 * Find a clickable element whose visible text matches. Exact match wins over a
 * prefix match, which wins over a substring — otherwise "Save" would happily
 * match "Save and continue later" and abandon the application.
 */
export function findByText(
  needles: string[],
  selectors: string[] = ['button', 'a', '[role="button"]', 'input[type="submit"]'],
  root: Root = document,
): HTMLElement | null {
  const candidates = pickAll(selectors, root).filter(isInteractable)
  const wanted = needles.map((n) => n.toLowerCase())

  const label = (el: HTMLElement) =>
    (accessibleName(el) || text(el)).toLowerCase().replace(/\s+/g, ' ').trim()

  for (const needle of wanted) {
    const exact = candidates.find((el) => label(el) === needle)
    if (exact) return exact
  }
  for (const needle of wanted) {
    const prefixed = candidates.find((el) => label(el).startsWith(needle))
    if (prefixed) return prefixed
  }
  for (const needle of wanted) {
    const partial = candidates.find((el) => label(el).includes(needle))
    if (partial) return partial
  }
  return null
}

/**
 * Approximate the accessible name of a form control, following roughly the
 * precedence order browsers use. This is the single most reliable signal for
 * working out what a field is asking for.
 */
export function accessibleName(el: Element): string {
  const ariaLabel = normalizeText(el.getAttribute('aria-label'))
  if (ariaLabel) return ariaLabel

  const labelledBy = el.getAttribute('aria-labelledby')
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => Boolean(n))
      .map((n) => text(n))
      .filter(Boolean)
    if (parts.length) return normalizeText(parts.join(' '))
  }

  if (el.id) {
    // CSS.escape guards against ids containing characters that break selectors,
    // which Workday and Greenhouse both produce.
    const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    if (forLabel) {
      const label = text(forLabel)
      if (label) return label
    }
  }

  const wrapping = el.closest('label')
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as HTMLElement
    // Strip the control itself so a select's own option text doesn't leak in.
    clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove())
    const label = normalizeText(clone.textContent)
    if (label) return label
  }

  // Grouped controls (radios, checkbox sets) name themselves via the legend.
  const fieldset = el.closest('fieldset')
  if (fieldset) {
    const legend = fieldset.querySelector('legend')
    if (legend) {
      const label = text(legend)
      if (label) return label
    }
  }

  const grouped = el.closest('[role="group"], [role="radiogroup"]')
  const groupLabel = grouped ? normalizeText(grouped.getAttribute('aria-label')) : ''
  if (groupLabel) return groupLabel

  const placeholder = normalizeText(el.getAttribute('placeholder'))
  if (placeholder) return placeholder

  const title = normalizeText(el.getAttribute('title'))
  if (title) return title

  return normalizeText(el.getAttribute('name'))
}

export type WaitOptions = {
  timeoutMs?: number
  intervalMs?: number
  /** Aborts the wait early when the run is stopped. */
  signal?: AbortSignal
}

/**
 * Poll `probe` until it returns something truthy. Resolves null on timeout
 * rather than throwing — callers nearly always want to branch, not catch.
 */
export async function waitFor<T>(
  probe: () => T | null | undefined,
  { timeoutMs = 10_000, intervalMs = 200, signal }: WaitOptions = {},
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (signal?.aborted) return null
    const value = probe()
    if (value) return value
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/** Wait for something to disappear — a modal closing, a spinner finishing. */
export async function waitForGone(
  probe: () => Element | null | undefined,
  options: WaitOptions = {},
): Promise<boolean> {
  const result = await waitFor(() => (probe() ? null : true), options)
  return result === true
}

/** Settle until the DOM stops mutating, for pages that render in bursts. */
export async function waitForQuiet(
  target: Node = document.body,
  quietMs = 400,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve) => {
    let quietTimer = 0
    const observer = new MutationObserver(() => {
      clearTimeout(quietTimer)
      quietTimer = window.setTimeout(finish, quietMs)
    })

    const hardStop = window.setTimeout(finish, timeoutMs)

    function finish() {
      clearTimeout(quietTimer)
      clearTimeout(hardStop)
      observer.disconnect()
      resolve()
    }

    observer.observe(target, { childList: true, subtree: true, attributes: true })
    quietTimer = window.setTimeout(finish, quietMs)
  })
}
