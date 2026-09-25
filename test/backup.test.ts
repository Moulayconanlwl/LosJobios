import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBackup, parseBackup, restoreBackup, backupFileName } from '@/lib/backup'
import { addScrapedJobs, getApplications, getProfile, getSavedJobs } from '@/lib/storage'
import { savedJobDefaults, type Application, type SavedJob } from '@/lib/schema'

/**
 * A backup is the only copy of any of this that survives the extension being
 * uninstalled, so the restore has to be trustworthy in both directions: it
 * must never let arbitrary JSON overwrite a real profile, and merging an old
 * file must never revert work done since it was written.
 */

function installFakeStorage(seed: Record<string, unknown> = {}) {
  let store: Record<string, unknown> = { ...seed }
  const area = {
    get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      store = { ...store, ...items }
    }),
  }
  vi.stubGlobal('chrome', { storage: { local: area, session: area } })
}

let seq = 0
function job(overrides: Partial<SavedJob> = {}): SavedJob {
  seq += 1
  return {
    ...savedJobDefaults(),
    id: `job-${seq}`,
    externalId: `ext-${seq}`,
    title: 'Engineer',
    company: 'Acme',
    url: `https://example.com/${seq}`,
    source: 'linkedin',
    savedAt: 1,
    ...overrides,
  }
}

function application(overrides: Partial<Application> = {}): Application {
  seq += 1
  return {
    id: `app-${seq}`,
    externalId: `ext-${seq}`,
    title: 'Engineer',
    company: 'Acme',
    location: '',
    url: '',
    source: 'linkedin',
    status: 'applied',
    appliedAt: 1,
    updatedAt: 1,
    dryRun: false,
    questionsAnswered: 0,
    aiAnswersUsed: 0,
    notes: '',
    ...overrides,
  }
}

beforeEach(() => {
  seq = 0
  installFakeStorage()
})

describe('createBackup', () => {
  it('captures everything the extension knows', async () => {
    await addScrapedJobs([job()])
    const backup = await createBackup()

    expect(backup.app).toBe('losjobios')
    expect(backup.savedJobs).toHaveLength(1)
    expect(backup.profile).toBeDefined()
    expect(backup.settings).toBeDefined()
    expect(backup.exportedAt).toBeGreaterThan(0)
  })

  it('names the file by when it was taken', () => {
    expect(backupFileName(new Date('2026-09-25T14:30:05Z'))).toBe(
      'losjobios-backup-2026-09-25-14-30-05.json',
    )
  })
})

describe('parseBackup', () => {
  it('accepts a backup this version wrote', async () => {
    const backup = await createBackup()
    expect(parseBackup(JSON.parse(JSON.stringify(backup))).app).toBe('losjobios')
  })

  it('refuses arbitrary JSON', () => {
    // Importing this would otherwise blank a real profile.
    expect(() => parseBackup({ hello: 'world' })).toThrow(/not a LosJobios backup/)
    expect(() => parseBackup(null)).toThrow()
    expect(() => parseBackup([1, 2, 3])).toThrow()
  })

  it('refuses a file from a newer version rather than mangling it', () => {
    expect(() => parseBackup({ app: 'losjobios', format: 99 })).toThrow(/newer version/)
  })
})

describe('restoreBackup — merge', () => {
  it('adds what is missing and keeps what is already here', async () => {
    await addScrapedJobs([job({ externalId: 'keep' })])

    const incoming = await createBackup()
    incoming.savedJobs = [job({ id: 'x', externalId: 'new' })]

    const report = await restoreBackup(incoming, 'merge')

    expect(report.savedJobs).toBe(1)
    const stored = await getSavedJobs()
    expect(stored.map((entry) => entry.externalId).sort()).toEqual(['keep', 'new'])
  })

  it('does not duplicate a job the backup and this machine both have', async () => {
    await addScrapedJobs([job({ externalId: 'same' })])

    const incoming = await createBackup()
    incoming.savedJobs = [job({ id: 'different-id', externalId: 'same' })]

    const report = await restoreBackup(incoming, 'merge')

    expect(report.savedJobs).toBe(0)
    expect(await getSavedJobs()).toHaveLength(1)
  })

  it('leaves the profile alone, so an old file cannot revert it', async () => {
    installFakeStorage({ profile: { ...(await getProfile()), firstName: 'Current' } })

    const incoming = await createBackup()
    incoming.profile = { ...(await getProfile()), firstName: 'Stale' }

    const report = await restoreBackup(incoming, 'merge')

    expect(report.profile).toBe(false)
    expect((await getProfile()).firstName).toBe('Current')
  })

  it('matches applications on the posting, not on the per-machine id', async () => {
    const incoming = await createBackup()
    incoming.applications = [application({ externalId: 'job-1' })]
    await restoreBackup(incoming, 'merge')

    // Same posting, different id — restoring twice must not double it up.
    const second = await createBackup()
    second.applications = [application({ id: 'elsewhere', externalId: 'job-1' })]
    const report = await restoreBackup(second, 'merge')

    expect(report.applications).toBe(0)
    expect(await getApplications()).toHaveLength(1)
  })
})

describe('restoreBackup — replace', () => {
  it('overwrites everything, profile included', async () => {
    await addScrapedJobs([job({ externalId: 'local' })])

    const incoming = await createBackup()
    incoming.savedJobs = [job({ id: 'only', externalId: 'from-backup' })]
    incoming.profile = { ...(await getProfile()), firstName: 'Restored' }

    const report = await restoreBackup(incoming, 'replace')

    expect(report.profile).toBe(true)
    expect((await getProfile()).firstName).toBe('Restored')

    const stored = await getSavedJobs()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.externalId).toBe('from-backup')
  })
})
