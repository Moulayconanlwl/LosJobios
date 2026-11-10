/**
 * Pacing. Uniform, machine-speed interaction is both the most obvious
 * automation tell and the most reliable way to race a page that hasn't
 * finished rendering. Everything here adds deliberate, randomized slack.
 */

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function randomBetween(min: number, max: number): number {
  if (max <= min) return min
  return Math.floor(min + Math.random() * (max - min))
}

/** Pause for a randomized interval inside the configured action band. */
export function pause(minMs: number, maxMs: number, signal?: AbortSignal): Promise<void> {
  return sleep(randomBetween(minMs, maxMs), signal)
}

/**
 * Scroll an element into the middle of the viewport and give the page a beat to
 * settle. Many sites lazily hydrate controls only once they're on screen.
 */
export async function revealElement(el: HTMLElement, signal?: AbortSignal): Promise<void> {
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  await sleep(randomBetween(180, 420), signal)
}

/**
 * Click through the full pointer/mouse event sequence a real click produces.
 * A bare `el.click()` skips pointerdown/mouseup, and components built on
 * pointer events (LinkedIn's dropdowns among them) simply won't respond.
 */
/**
 * Click something without letting the browser follow it.
 *
 * A dispatched `click` on an `<a href>` still performs the default action, so
 * clicking a job card's title link navigates the tab to the posting — which
 * tears down this content script and ends the run mid-queue. The site's own
 * single-page handler is supposed to intercept that, and usually does, but it
 * only takes one layout where the handler sits somewhere else for every job
 * to turn into a page load.
 *
 * The listener is on `window` in the bubble phase deliberately. React attaches
 * its handlers to the app's root container, which is below `window`, so by the
 * time this runs the site's own handler has already seen the event
 * un-prevented and done its work. Cancelling here stops only the browser's
 * navigation, which happens after dispatch finishes.
 *
 * `isTrusted` is what keeps this honest: it is false for the events dispatched
 * here and true for a real one, so a person clicking a link during the brief
 * window this is armed still gets to follow it.
 */
export async function clickInPlace(el: HTMLElement, signal?: AbortSignal): Promise<void> {
  const suppress = (event: Event) => {
    if (!event.isTrusted) event.preventDefault()
  }

  window.addEventListener('click', suppress)
  try {
    await humanClick(el, signal)
  } finally {
    window.removeEventListener('click', suppress)
  }
}

export async function humanClick(el: HTMLElement, signal?: AbortSignal): Promise<void> {
  await revealElement(el, signal)

  const rect = el.getBoundingClientRect()
  // Aim somewhere in the middle half of the element rather than dead centre.
  const clientX = rect.left + rect.width * (0.3 + Math.random() * 0.4)
  const clientY = rect.top + rect.height * (0.3 + Math.random() * 0.4)
  const base = { bubbles: true, cancelable: true, composed: true, clientX, clientY }

  el.dispatchEvent(new PointerEvent('pointerover', { ...base, pointerType: 'mouse' }))
  el.dispatchEvent(new MouseEvent('mouseover', base))
  el.dispatchEvent(new MouseEvent('mousemove', base))
  await sleep(randomBetween(40, 120), signal)

  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerType: 'mouse', button: 0 }))
  el.dispatchEvent(new MouseEvent('mousedown', { ...base, button: 0 }))

  if (typeof el.focus === 'function') el.focus()
  await sleep(randomBetween(30, 90), signal)

  el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerType: 'mouse', button: 0 }))
  el.dispatchEvent(new MouseEvent('mouseup', { ...base, button: 0 }))
  el.dispatchEvent(new MouseEvent('click', { ...base, button: 0 }))
}
