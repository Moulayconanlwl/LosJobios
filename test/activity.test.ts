import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_ACTIVITY } from '@/lib/activity'
import { clearActivity, getActivity, logActivity } from '@/lib/storage'

/**
 * The activity log's value is transparency, and its risk is becoming a second
 * copy of the most sensitive data in the extension. So the test that matters
 * most here is the negative one: entries carry labels and counts, never the
 * values that were typed into a form.
 */

function installFakeStorage() {
  let store: Record<string, unknown> = {}
  const area = {
    get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      store = { ...store, ...items }
    }),
  }
  vi.stubGlobal('chrome', { storage: { local: area, session: area } })
}

beforeEach(() => {
  installFakeStorage()
})

describe('logActivity', () => {
  it('starts empty', async () => {
    expect(await getActivity()).toEqual([])
  })

  it('records an entry with a timestamp and an id', async () => {
    await logActivity({ kind: 'applied', summary: 'Application submitted.' })

    const [entry] = await getActivity()
    expect(entry?.kind).toBe('applied')
    expect(entry?.summary).toBe('Application submitted.')
    expect(entry?.id).toBeTruthy()
    expect(entry?.at).toBeGreaterThan(0)
  })

  it('keeps the newest entry first', async () => {
    await logActivity({ kind: 'run-started', summary: 'first' })
    await logActivity({ kind: 'applied', summary: 'second' })

    const entries = await getActivity()
    expect(entries[0]?.summary).toBe('second')
    expect(entries[1]?.summary).toBe('first')
  })

  it('defaults the optional context fields rather than storing undefined', async () => {
    await logActivity({ kind: 'fields-filled', summary: 'Filled 3 fields.' })

    const [entry] = await getActivity()
    expect(entry?.jobTitle).toBe('')
    expect(entry?.company).toBe('')
    expect(entry?.site).toBe('')
  })

  it('carries which posting an action concerned', async () => {
    await logActivity({
      kind: 'applied',
      summary: 'Application submitted.',
      jobTitle: 'Chef de projet',
      company: 'Devoteam',
      site: 'linkedin.com',
    })

    const [entry] = await getActivity()
    expect(entry?.company).toBe('Devoteam')
    expect(entry?.site).toBe('linkedin.com')
  })

  it('caps the log instead of growing without limit', async () => {
    for (let i = 0; i < MAX_ACTIVITY + 20; i += 1) {
      await logActivity({ kind: 'fields-filled', summary: `entry ${i}` })
    }

    const entries = await getActivity()
    expect(entries).toHaveLength(MAX_ACTIVITY)
    // The oldest fell off the end, not the newest.
    expect(entries[0]?.summary).toBe(`entry ${MAX_ACTIVITY + 19}`)
  })

  it('never fails the operation it is recording', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => {
            throw new Error('storage is gone')
          }),
          set: vi.fn(async () => {}),
        },
      },
    })

    // Logging is a side effect of doing something useful. It must not be able
    // to take that something down with it.
    await expect(logActivity({ kind: 'applied', summary: 'x' })).resolves.toBeUndefined()
  })

  it('empties on request, which is the user-facing delete control', async () => {
    await logActivity({ kind: 'applied', summary: 'x' })
    await clearActivity()

    expect(await getActivity()).toEqual([])
  })

  it('discards a malformed stored value rather than throwing', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ activity: 'not an array' })),
          set: vi.fn(async () => {}),
        },
      },
    })

    expect(await getActivity()).toEqual([])
  })
})
