import contentScriptUrl from '@/content/index?script'
import { NoReceiverError, sendToTab } from '@/lib/messaging'

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
      target: { tabId },
      files: [contentScriptUrl],
    })
  } catch (err) {
    console.warn('[LosJobios] injection failed', err)
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

  return false
}

export function isLinkedInJobsPage(url: string | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return /(^|\.)linkedin\.com$/.test(parsed.hostname) && parsed.pathname.startsWith('/jobs/')
  } catch {
    return false
  }
}
