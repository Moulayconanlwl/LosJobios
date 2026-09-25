import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimContentFrame,
  clearContentFrame,
  getContentFrameId,
  resolveContentFrame,
  waitForContentFrame,
} from '@/background/frames'

/**
 * `frames.ts` is what makes commands reach the frame that actually has a
 * page's content, on sites (LinkedIn's authenticated job search, confirmed
 * live) that render everything inside a same-origin iframe rather than the
 * top-level document. Wrong frame targeting here reproduces exactly the
 * reported bug — 0 jobs found, every time, regardless of selectors.
 *
 * The claims deliberately live in chrome.storage.session rather than a
 * module-level Map: a content script announces itself once at load, and the
 * MV3 service worker is routinely torn down between that announcement and
 * the run that needs it. An in-memory map loses the claim in that window and
 * silently falls back to frame 0 — which looks identical to the original
 * bug, and is exactly what happened in testing before this was fixed.
 */

/** Minimal in-memory stand-in for chrome.storage.session. */
function installFakeSessionStorage() {
  let store: Record<string, unknown> = {}
  const area = {
    get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      store = { ...store, ...items }
    }),
  }
  vi.stubGlobal('chrome', { storage: { session: area } })
  return {
    area,
    /** Everything the worker forgets when it dies — which is nothing here. */
    simulateWorkerRestart: () => {
      /* storage.session survives; no-op by design */
    },
  }
}

describe('content frame tracking', () => {
  let tabId = 1

  beforeEach(() => {
    tabId += 1
    installFakeSessionStorage()
  })

  it('has no claim for a tab that never announced one', async () => {
    await expect(getContentFrameId(tabId)).resolves.toBeUndefined()
  })

  it('returns the frame that claimed itself', async () => {
    await claimContentFrame(tabId, 3)
    await expect(getContentFrameId(tabId)).resolves.toBe(3)
  })

  it('records frame 0 as a real claim, not a missing one', async () => {
    // Frame 0 is the legitimate answer on any page without an iframe split;
    // treating it as falsy would break every ordinary page.
    await claimContentFrame(tabId, 0)
    await expect(getContentFrameId(tabId)).resolves.toBe(0)
  })

  it('lets a later claim replace an earlier one', async () => {
    await claimContentFrame(tabId, 3)
    await claimContentFrame(tabId, 7)
    await expect(getContentFrameId(tabId)).resolves.toBe(7)
  })

  it('forgets the claim once cleared', async () => {
    await claimContentFrame(tabId, 3)
    await clearContentFrame(tabId)
    await expect(getContentFrameId(tabId)).resolves.toBeUndefined()
  })

  it('keeps different tabs independent', async () => {
    const otherTab = tabId + 1000
    await claimContentFrame(tabId, 3)
    await claimContentFrame(otherTab, 9)
    await expect(getContentFrameId(tabId)).resolves.toBe(3)
    await expect(getContentFrameId(otherTab)).resolves.toBe(9)
  })

  it('survives the service worker being torn down between claim and use', async () => {
    const { simulateWorkerRestart } = installFakeSessionStorage()
    await claimContentFrame(tabId, 4)

    // The worker dies here. Anything held only in module scope is gone;
    // session storage is not.
    simulateWorkerRestart()

    await expect(getContentFrameId(tabId)).resolves.toBe(4)
  })

  it('ignores a malformed stored value instead of throwing', async () => {
    const area = {
      get: vi.fn(async () => ({ contentFrames: 'not an object' })),
      set: vi.fn(async () => {}),
    }
    vi.stubGlobal('chrome', { storage: { session: area } })
    await expect(getContentFrameId(tabId)).resolves.toBeUndefined()
  })

  it('resolves immediately when a claim already exists', async () => {
    await claimContentFrame(tabId, 5)
    const start = performance.now()
    await expect(waitForContentFrame(tabId, 5000)).resolves.toBe(5)
    expect(performance.now() - start).toBeLessThan(200)
  })

  it('picks up a claim that arrives while waiting', async () => {
    const promise = waitForContentFrame(tabId, 3000)
    setTimeout(() => void claimContentFrame(tabId, 2), 50)
    await expect(promise).resolves.toBe(2)
  })

  it('gives up and returns undefined after the timeout, rather than hanging', async () => {
    const start = performance.now()
    await expect(waitForContentFrame(tabId, 300)).resolves.toBeUndefined()
    expect(performance.now() - start).toBeLessThan(1500)
  })
})

/**
 * `resolveContentFrame` is the single door every background → content command
 * goes through. Trusting a claim without checking it is how a command ends up
 * addressed to a frame that no longer exists; waiting for one that will never
 * come is how an ordinary page stalls for eight seconds.
 */
describe('resolveContentFrame', () => {
  let tabId = 500

  /** Fake session storage plus a tabs.sendMessage whose outcome each test picks. */
  function install(pingSucceeds: boolean) {
    let store: Record<string, unknown> = {}
    const sendMessage = vi.fn(async () => {
      if (!pingSucceeds) throw new Error('Could not establish connection.')
      return { ready: true, site: 'linkedin' }
    })

    vi.stubGlobal('chrome', {
      storage: {
        session: {
          get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
          set: async (items: Record<string, unknown>) => {
            store = { ...store, ...items }
          },
        },
      },
      tabs: { sendMessage },
    })

    return sendMessage
  }

  beforeEach(() => {
    tabId += 1
  })

  it('returns the claimed frame once it answers a ping', async () => {
    const sendMessage = install(true)
    await claimContentFrame(tabId, 4)

    await expect(resolveContentFrame(tabId)).resolves.toBe(4)
    // Addressed to the claimed frame, not to frame 0 by default.
    expect(sendMessage).toHaveBeenCalledWith(tabId, expect.anything(), { frameId: 4 })
  })

  it('falls back to frame 0 when no frame ever claimed the tab', async () => {
    const sendMessage = install(true)

    await expect(resolveContentFrame(tabId)).resolves.toBeUndefined()
    // Nothing to verify, so nothing was sent.
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('drops a claim that no longer answers, rather than addressing a dead frame', async () => {
    install(false)
    await claimContentFrame(tabId, 7)

    await expect(resolveContentFrame(tabId)).resolves.toBeUndefined()
    await expect(getContentFrameId(tabId)).resolves.toBeUndefined()
  })

  it('does not wait around for a claim when asked not to', async () => {
    install(true)

    const start = performance.now()
    await resolveContentFrame(tabId)
    expect(performance.now() - start).toBeLessThan(150)
  })
})
