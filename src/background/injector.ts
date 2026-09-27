import contentScriptUrl from '@/content/index?script'
import { NoReceiverError, sendToTab } from '@/lib/messaging'
import { logError, logWarn } from '@/lib/debug-log'

/**
 * Getting a content script into a tab.
 *
 * On LinkedIn the manifest injects it declaratively, but the universal autofill
 * runs on sites we have no standing permission for — there, `activeTab` grants
 * access for exactly one user gesture, and we inject on the spot.
 */

/** Pages Chrome refuses to inject into, where a clear message beats a stack trace. */
const BLOCKED_SCHEMES = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'devtools:']

export function isInjectable(url: string | undefined): boolean {
  if (!url) return false
  if (BLOCKED_SCHEMES.some((scheme) => url.startsWith(scheme))) return false
  if (url.startsWith('https://chromewebstore.google.com')) return false
  return url.startsWith('http://') || url.startsWith('https://')
}

/** The tab the user is looking at. */
export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

/**
 * Make sure a tab has a live content script, injecting one if not.
 *
 * The ping-then-inject order matters: injecting a second copy into a tab that
 * already has one leaves two listeners answering every message.
 */
export async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    const pong = await sendToTab(tabId, 'cs/ping')
    if (pong.ready) return true
  } catch (err) {
    if (!(err instanceof NoReceiverError)) throw err
  }

  try {
    await chrome.scripting.executeScript({
      // `allFrames` matters on any site that renders its real content in a
      // same-origin iframe — LinkedIn's authenticated job search among them.
      // Injecting only frame 0 there puts the script in an empty shell, and
      // the frame holding the job list never gets one, so the run reports
      // that it cannot reach the page.
      target: { tabId, allFrames: true },
      files: [contentScriptUrl],
    })
  } catch (err) {
    console.warn('[LosJobios] injection failed', err)
    void logError('inject', 'Could not inject the content script', describeError(err))
    return false
  }

  // Give the freshly-injected script a moment to register its listeners.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    try {
      const pong = await sendToTab(tabId, 'cs/ping')
      if (pong.ready) return true
    } catch {
      // Still coming up.
    }
  }

  void logWarn('inject', 'Injected the content script but it never answered a ping')
  return false
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
