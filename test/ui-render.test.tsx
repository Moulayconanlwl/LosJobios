import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppShell } from '@/ui/components/AppShell'
import { BriefcaseIcon, SparkIcon } from '@/ui/components/icons'
import { JobsSection } from '@/ui/dashboard/JobsSection'
import { savedJobDefaults, defaultProfile, defaultSettings, type SavedJob } from '@/lib/schema'

/**
 * A render smoke test, not a visual one.
 *
 * Nothing here can tell you the sidebar looks right — that needs the
 * extension loaded in Chrome. What it does catch is the class of mistake
 * that takes a whole page down: a bad import, a hook reading a field that
 * isn't there, a detail panel that throws on a job with half its fields
 * empty. Those are worth catching without a browser.
 */

function installChrome(store: Record<string, unknown> = {}) {
  const area = {
    get: vi.fn(async (key: string) => (key in store ? { [key]: store[key] } : {})),
    set: vi.fn(async () => {}),
  }

  vi.stubGlobal('chrome', {
    storage: {
      local: area,
      session: area,
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => ({ ok: true })), openOptionsPage: vi.fn() },
    permissions: { contains: vi.fn(async () => false) },
  })
}

function job(overrides: Partial<SavedJob> = {}): SavedJob {
  return {
    ...savedJobDefaults(),
    id: 'job-1',
    externalId: '442',
    title: 'Backend Engineer',
    company: 'Acme',
    location: 'London',
    url: 'https://www.linkedin.com/jobs/view/442/',
    source: 'linkedin',
    savedAt: Date.now(),
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AppShell', () => {
  beforeEach(() => installChrome())

  const items = [
    { id: 'applications' as const, label: 'Applications', icon: BriefcaseIcon, badge: 3 },
    { id: 'jobs' as const, label: 'Jobs & materials', icon: SparkIcon },
  ]

  it('renders every section as a named control', () => {
    render(
      <AppShell title="LosJobios" items={items} active="applications" onSelect={() => {}}>
        <p>content</p>
      </AppShell>,
    )

    // The name is present for both sighted reading and hover, at every width.
    expect(screen.getByRole('button', { name: /Applications/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Jobs & materials/ })).toBeTruthy()
  })

  it('marks the active section for assistive tech, not just with colour', () => {
    render(
      <AppShell title="LosJobios" items={items} active="jobs" onSelect={() => {}}>
        <p>content</p>
      </AppShell>,
    )

    expect(screen.getByRole('button', { name: /Jobs & materials/ }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: /Applications/ }).getAttribute('aria-current')).toBeNull()
  })

  it('reports the section the user picked', async () => {
    const onSelect = vi.fn()
    render(
      <AppShell title="LosJobios" items={items} active="applications" onSelect={onSelect}>
        <p>content</p>
      </AppShell>,
    )

    await userEvent.click(screen.getByRole('button', { name: /Jobs & materials/ }))
    expect(onSelect).toHaveBeenCalledWith('jobs')
  })

  it('shows the badge count', () => {
    render(
      <AppShell title="LosJobios" items={items} active="applications" onSelect={() => {}}>
        <p>content</p>
      </AppShell>,
    )
    expect(screen.getByText('3')).toBeTruthy()
  })
})

describe('JobsSection', () => {
  it('renders the empty state without a stored job in sight', async () => {
    installChrome()
    render(<JobsSection />)

    expect(await screen.findByText(/No saved jobs yet/)).toBeTruthy()
  })

  it('lists a saved job and opens its detail panel', async () => {
    installChrome({
      savedJobs: [job()],
      profile: defaultProfile(),
      settings: defaultSettings(),
    })

    render(<JobsSection />)

    await waitFor(() => expect(screen.getAllByText('Backend Engineer').length).toBeGreaterThan(0))
    // The panel for the auto-selected job, with its tabs.
    expect(screen.getByRole('button', { name: 'Cover letter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy()
  })

  it('tells you to fetch the description when a job was scraped from a list', async () => {
    installChrome({ savedJobs: [job({ description: '' })], profile: defaultProfile() })
    render(<JobsSection />)

    // Everything downstream needs the posting text, so this is the prompt.
    expect(await screen.findByRole('button', { name: /Fetch description/ })).toBeTruthy()
  })

  it('survives a job whose fields are mostly empty', async () => {
    installChrome({
      savedJobs: [job({ title: '', company: '', location: '', url: '' })],
      profile: defaultProfile(),
    })

    render(<JobsSection />)
    // Appears twice — once in the list, once as the detail heading.
    expect((await screen.findAllByText('Untitled role')).length).toBeGreaterThan(0)
  })

  it('shows the score tab once a description is stored', async () => {
    installChrome({
      savedJobs: [job({ description: 'We need Python and Kubernetes in production.' })],
      profile: { ...defaultProfile(), skills: ['Python'] },
    })

    render(<JobsSection />)

    const scoreTab = await screen.findByRole('button', { name: 'ATS score' })
    await userEvent.click(scoreTab)

    expect(await screen.findByText('out of 100')).toBeTruthy()
  })
})
