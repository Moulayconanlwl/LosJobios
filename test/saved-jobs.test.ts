import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addScrapedJobs, deleteSavedJob, getSavedJobs, putSavedJob } from '@/lib/storage'
import { savedJobDefaults, type SavedJob } from '@/lib/schema'

/**
 * Scraping the same search twice is the normal case, not the edge case — you
 * run it, refine the filters, run it again. So the thing worth pinning down
 * is that a second pass updates rather than duplicates, and above all that a
 * card scrape (title only) can't wipe a description that cost a whole tab
 * open to fetch.
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

let seq = 0
function job(overrides: Partial<SavedJob> = {}): SavedJob {
  seq += 1
  return {
    ...savedJobDefaults(),
    id: `id-${seq}`,
    externalId: '4421154534',
    title: 'Backend Engineer',
    company: 'Acme',
    url: 'https://www.linkedin.com/jobs/view/4421154534/',
    source: 'linkedin',
    savedAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  seq = 0
  installFakeStorage()
})

describe('addScrapedJobs', () => {
  it('saves new postings', async () => {
    const added = await addScrapedJobs([job(), job({ externalId: '999', title: 'Other' })])

    expect(added).toBe(2)
    expect(await getSavedJobs()).toHaveLength(2)
  })

  it('does not duplicate a posting seen in a second scan', async () => {
    await addScrapedJobs([job()])
    const added = await addScrapedJobs([job({ id: 'different-id' })])

    expect(added).toBe(0)
    expect(await getSavedJobs()).toHaveLength(1)
  })

  it('keeps a fetched description when the same job is scraped again from a card', async () => {
    await addScrapedJobs([job({ description: 'The full posting text.' })])

    // A list scrape carries no description. Writing it through would undo
    // the one expensive thing already done for this job.
    await addScrapedJobs([job({ id: 'second', description: '' })])

    const [stored] = await getSavedJobs()
    expect(stored?.description).toBe('The full posting text.')
  })

  it('fills in a description when the re-scrape is the one that has it', async () => {
    await addScrapedJobs([job({ description: '' })])
    await addScrapedJobs([job({ id: 'second', description: 'Now with detail.' })])

    const [stored] = await getSavedJobs()
    expect(stored?.description).toBe('Now with detail.')
  })

  it('treats the same job id on a different source as a different job', async () => {
    await addScrapedJobs([job({ source: 'linkedin' })])
    await addScrapedJobs([job({ id: 'other', source: 'universal' })])

    expect(await getSavedJobs()).toHaveLength(2)
  })

  it('falls back to the url when a posting carries no id', async () => {
    await addScrapedJobs([job({ externalId: '', url: 'https://jobs.example.com/1' })])
    const added = await addScrapedJobs([
      job({ id: 'second', externalId: '', url: 'https://jobs.example.com/1' }),
    ])

    expect(added).toBe(0)
  })

  it('does nothing when handed an empty list', async () => {
    expect(await addScrapedJobs([])).toBe(0)
  })
})

describe('putSavedJob', () => {
  it('replaces a job in place rather than adding a copy', async () => {
    await addScrapedJobs([job()])
    const [stored] = await getSavedJobs()
    if (!stored) throw new Error('nothing stored')

    await putSavedJob({ ...stored, coverLetter: 'Dear team…' })

    const all = await getSavedJobs()
    expect(all).toHaveLength(1)
    expect(all[0]?.coverLetter).toBe('Dear team…')
  })

  it('removes only the job asked for', async () => {
    await addScrapedJobs([job(), job({ externalId: '999' })])
    const all = await getSavedJobs()
    const target = all[0]
    if (!target) throw new Error('nothing stored')

    await deleteSavedJob(target.id)

    const left = await getSavedJobs()
    expect(left).toHaveLength(1)
    expect(left[0]?.id).not.toBe(target.id)
  })
})
