/**
 * Tracking which frame actually has a tab's real content.
 *
 * Some sites — LinkedIn's authenticated job search confirmed among them —
 * render everything inside a same-origin iframe, leaving the top-level
 * document an empty shell. With the content script now injected into every
 * frame (`all_frames: true`), each frame gets its own instance; this is how
 * the background learns which one is worth talking to instead of defaulting
 * to frame 0, which may have nothing in it.
 *
 * Content scripts self-report via the `cs/claim-frame` message — see
 * `content/index.ts`. A frame claims itself once it finds real page content
 * (job cards, the site's nav — whatever `SiteAdapter.hasAppContent()` checks
 * for), so this map is populated passively rather than the background having
 * to enumerate frames itself, which would need the `webNavigation`
 * permission this extension deliberately doesn't request.
 *
 * Claims live in `chrome.storage.session`, not a module-level Map. A content
 * script announces itself exactly once, when it loads — but the service
 * worker is torn down after ~30s idle and may well die between that
 * announcement and the run that needs it. In-memory state loses the claim in
 * that window, silently falling back to frame 0 and looking exactly like the
 * original bug. Session storage survives the worker; it's cleared when the
 * browser session ends, which is also when the frame ids stop being valid.
 */

import { sendToTab } from '@/lib/messaging'

const SESSION_KEY = 'contentFrames'

type ClaimMap = Record<string, number>

function session(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local
}

async function readClaims(): Promise<ClaimMap> {
  const bag = await session().get(SESSION_KEY)
  const raw = bag[SESSION_KEY]
  if (!raw || typeof raw !== 'object') return {}

  // Only keep entries that still look like tabId → frameId number pairs.
  const claims: ClaimMap = {}
  for (const [tabId, frameId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof frameId === 'number' && Number.isInteger(frameId)) claims[tabId] = frameId
  }
  return claims
}

export async function claimContentFrame(tabId: number, frameId: number): Promise<void> {
  const claims = await readClaims()
  claims[String(tabId)] = frameId
  await session().set({ [SESSION_KEY]: claims })
}

export async function getContentFrameId(tabId: number): Promise<number | undefined> {
  return (await readClaims())[String(tabId)]
}

export async function clearContentFrame(tabId: number): Promise<void> {
  const claims = await readClaims()
  if (!(String(tabId) in claims)) return
  delete claims[String(tabId)]
  await session().set({ [SESSION_KEY]: claims })
}

/**
 * Wait for a frame to claim itself, up to `timeoutMs`. A claim normally
 * arrives within a couple of seconds of the content script loading — this
 * exists to cover the gap between "the tab's frame-0 content script answered
 * a ping" (near-instant) and "the real app frame finished finding its own
 * content" (client-side rendered, so it takes a moment).
 */
export async function waitForContentFrame(
  tabId: number,
  timeoutMs = 8000,
): Promise<number | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const frameId = await getContentFrameId(tabId)
    if (frameId !== undefined) return frameId
    if (Date.now() >= deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

/**
 * Which frame to address for this tab: a claim that still answers, or
 * `undefined` for frame 0.
 *
 * Frame 0 answering a ping only proves the content script is alive — on
 * LinkedIn's authenticated job search the real content is in a same-origin
 * iframe and frame 0 is an empty shell that would answer every message while
 * finding nothing. So a claim is verified before it's trusted: a claim can
 * outlive the frame it named (a reload between claim and use), and a stale
 * one is dropped rather than used.
 *
 * `waitMs` is how long to wait for a claim that hasn't arrived yet. Starting
 * a run waits, because the run is worthless against the wrong frame and the
 * app frame may still be rendering. One-shot commands off a popup click pass
 * 0: a page that splits its content claimed on load, long before the user got
 * to the popup, and waiting would stall every ordinary page for nothing.
 */
export async function resolveContentFrame(
  tabId: number,
  waitMs = 0,
): Promise<number | undefined> {
  const claimed = waitMs > 0 ? await waitForContentFrame(tabId, waitMs) : await getContentFrameId(tabId)
  if (claimed === undefined) return undefined

  try {
    await sendToTab(tabId, 'cs/ping', {}, { frameId: claimed })
    return claimed
  } catch {
    await clearContentFrame(tabId)
    return undefined
  }
}
