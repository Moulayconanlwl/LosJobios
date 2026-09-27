import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LinkedInAdapter } from '@/content/adapters/linkedin'
import type { ApplyContext } from '@/content/adapters/types'
import { defaultProfile, defaultSettings, type Settings } from '@/lib/schema'

/**
 * The Easy Apply modal loop.
 *
 * The failure worth guarding against here is a subtle one: LinkedIn routinely
 * renders the modal as an empty shell — a loader, no fields, no footer
 * buttons — for several seconds before the real step arrives. Reading that as
 * "stuck" fails a perfectly good application the instant it opens, and on a
 * slow connection it fails *every* application, which looks exactly like the
 * selectors being wrong.
 */

function context(settings: Partial<Settings> = {}): ApplyContext {
  return {
    profile: defaultProfile(),
    settings: { ...defaultSettings(), ...settings },
    job: null,
    dryRun: true,
    signal: new AbortController().signal,
    jobDescription: '',
    report: () => {},
  }
}

type HappyDomWindow = Window & { happyDOM?: { setURL?: (href: string) => void } }

function setLocation(href: string): void {
  ;(window as HappyDomWindow).happyDOM?.setURL?.(href)
}

function paintEverything(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 40, width: 200, height: 40,
    toJSON: () => ({}),
  } as DOMRect)
}

beforeEach(() => {
  document.body.innerHTML = ''
  setLocation('https://www.linkedin.com/jobs/search/')
  paintEverything()
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async () => ({ answer: null, source: 'none', confidence: 0 })),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a modal that has not rendered its step yet', () => {
  const adapter = new LinkedInAdapter()

  it('waits for the step instead of calling it stuck', async () => {
    // Opens as a loader with nothing in it, then the real step arrives.
    document.body.innerHTML = `
      <button class="jobs-apply-button">Easy Apply</button>
      <div role="dialog" id="modal"><div class="loader"><button></button></div></div>
    `

    setTimeout(() => {
      const modal = document.getElementById('modal')
      if (modal) {
        modal.innerHTML = `
          <h3>Contact info</h3>
          <label for="email">Email</label><input id="email" />
          <footer><button aria-label="Submit application">Submit application</button></footer>
        `
      }
    }, 900)

    const outcome = await adapter.apply(context())

    // Dry run stops at Submit and reports the application as walked.
    expect(outcome).toMatchObject({ result: 'applied' })
  }, 30_000)

  it('gives up with a loading error when the step never arrives', async () => {
    // Deliberately distinct wording from "stuck": the cause is different and
    // so is what the user should do about it.
    document.body.innerHTML = `
      <button class="jobs-apply-button">Easy Apply</button>
      <div role="dialog" id="modal"><div class="loader"><button></button></div></div>
    `

    const outcome = await adapter.apply(context())

    expect(outcome.result).toBe('failed')
    expect(outcome).toMatchObject({ error: expect.stringMatching(/never finished loading/i) })
  }, 40_000)
})

describe('page health gates the whole run', () => {
  const adapter = new LinkedInAdapter()

  it('refuses to apply while LinkedIn is showing a checkpoint', async () => {
    // Carrying on here means twenty more failures and a louder signal to
    // LinkedIn that something automated is driving the account.
    setLocation('https://www.linkedin.com/checkpoint/challenge/verify')
    document.body.innerHTML = '<button class="jobs-apply-button">Easy Apply</button>'

    const outcome = await adapter.apply(context())

    expect(outcome.result).toBe('failed')
    expect(outcome).toMatchObject({ error: expect.stringMatching(/checkpoint/i) })
  })

  it('refuses while rate limited', async () => {
    document.body.innerHTML = `
      <div role="alert">Too many requests, try again later</div>
      <button class="jobs-apply-button">Easy Apply</button>
    `

    expect(await adapter.apply(context())).toMatchObject({
      result: 'failed',
      error: expect.stringMatching(/rate limit/i),
    })
  })
})
