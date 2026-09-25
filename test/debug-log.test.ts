import { describe, expect, it, vi, afterEach } from 'vitest'
import { clearLog, formatLog, logInfo, readLog, redact } from '@/lib/debug-log'

/**
 * The run log is a diagnostic, and a diagnostic that leaks is worse than no
 * diagnostic at all: it becomes a second copy of the most sensitive data the
 * extension holds, somewhere nobody thinks to look for it.
 */

function stubSession() {
  const store: Record<string, unknown> = {}
  vi.stubGlobal('chrome', {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (patch: Record<string, unknown>) => Object.assign(store, patch)),
        remove: vi.fn(async (key: string) => {
          delete store[key]
        }),
      },
    },
  })
  return store
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('redact', () => {
  it('strips an email address', () => {
    expect(redact('wrote ada@example.com')).not.toContain('ada@example.com')
  })

  it('strips a phone number', () => {
    expect(redact('typed +33 6 12 34 56 78')).toContain('[redacted]')
  })

  it('leaves an ordinary diagnostic alone', () => {
    expect(redact('Filled 11 fields on greenhouse.io')).toBe('Filled 11 fields on greenhouse.io')
  })
})

describe('log', () => {
  it('appends entries and reads them back', async () => {
    stubSession()
    await logInfo('run', 'Opening the indeed search', 'fr.indeed.com')

    const entries = await readLog()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ level: 'info', scope: 'run' })
  })

  it('redacts on the way in, not on the way out', async () => {
    // The backstop for a careless caller: nothing sensitive should ever be
    // sitting in storage waiting to be read.
    const store = stubSession()
    await logInfo('fill', 'answered with ada@example.com')

    expect(JSON.stringify(store)).not.toContain('ada@example.com')
  })

  it('never throws when session storage is unavailable', async () => {
    // Logging is a side effect of doing something useful, and must never be
    // able to fail the thing it was describing.
    vi.stubGlobal('chrome', {})
    await expect(logInfo('run', 'still fine')).resolves.toBeUndefined()
    await expect(readLog()).resolves.toEqual([])
  })

  it('clears', async () => {
    stubSession()
    await logInfo('run', 'one')
    await clearLog()
    expect(await readLog()).toEqual([])
  })
})

describe('formatLog', () => {
  it('renders a line per entry for pasting into a report', () => {
    const text = formatLog([
      { at: Date.UTC(2026, 0, 1, 10, 30, 0), level: 'warn', scope: 'run', message: 'Job skipped' },
    ])
    expect(text).toContain('WARN')
    expect(text).toContain('[run]')
    expect(text).toContain('Job skipped')
  })
})
