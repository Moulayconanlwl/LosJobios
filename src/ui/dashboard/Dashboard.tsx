import { useMemo, useState } from 'react'
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from '@/lib/schema'
import { deleteApplication, updateApplication } from '@/lib/storage'
import { Badge, type BadgeTone } from '../components/badge'
import { Button, Card, Input, Select, Stat } from '../components/ui'
import { useApplications } from '../hooks'
import { downloadCsv } from './csv'

/**
 * The application tracker. Every row here was written by a run; the status
 * column is yours to move as you hear back.
 */

const STATUS_TONES: Record<ApplicationStatus, BadgeTone> = {
  applied: 'info',
  screening: 'warn',
  interview: 'ai',
  offer: 'good',
  rejected: 'bad',
  withdrawn: 'neutral',
}

const DAY = 24 * 60 * 60 * 1000

function relativeDate(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / DAY)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(timestamp).toLocaleDateString()
}

export function Dashboard() {
  const { data: applications } = useApplications()

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('all')
  const [includeDryRuns, setIncludeDryRuns] = useState(false)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return applications.filter((app) => {
      if (!includeDryRuns && app.dryRun) return false
      if (statusFilter !== 'all' && app.status !== statusFilter) return false
      if (!needle) return true
      return (
        app.title.toLowerCase().includes(needle) ||
        app.company.toLowerCase().includes(needle) ||
        app.location.toLowerCase().includes(needle)
      )
    })
  }, [applications, query, statusFilter, includeDryRuns])

  const stats = useMemo(() => {
    // Statistics only ever describe real applications, whatever the table shows.
    const real = applications.filter((a) => !a.dryRun)
    const weekAgo = Date.now() - 7 * DAY

    const inProgress = real.filter((a) =>
      ['screening', 'interview', 'offer'].includes(a.status),
    ).length

    return {
      total: real.length,
      thisWeek: real.filter((a) => a.appliedAt >= weekAgo).length,
      inProgress,
      // Share of applications that got past the initial screen.
      responseRate: real.length ? Math.round((inProgress / real.length) * 100) : 0,
    }
  }, [applications])

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Applications</h1>
          <p className="text-sm text-zinc-500">
            Everything the autopilot has sent, plus anything you move by hand.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void chrome.runtime.openOptionsPage()}>
            Settings
          </Button>
          <Button
            variant="primary"
            disabled={visible.length === 0}
            onClick={() => downloadCsv(visible)}
          >
            Export CSV
          </Button>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total applications" value={stats.total} />
        <Stat label="This week" value={stats.thisWeek} />
        <Stat label="In progress" value={stats.inProgress} tone="good" />
        <Stat label="Response rate" value={`${stats.responseRate}%`} />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            value={query}
            placeholder="Search title, company or location…"
            className="max-w-xs"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            value={statusFilter}
            className="max-w-[10rem]"
            onChange={(e) => setStatusFilter(e.target.value as 'all' | ApplicationStatus)}
          >
            <option value="all">All statuses</option>
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={includeDryRuns}
              onChange={(e) => setIncludeDryRuns(e.target.checked)}
              className="rounded"
            />
            Show dry runs
          </label>
          <span className="ml-auto text-xs text-zinc-500">
            {visible.length} of {applications.length}
          </span>
        </div>

        {visible.length === 0 ? (
          <EmptyState hasAny={applications.length > 0} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
                  <th className="pb-2 pr-3 font-medium">Role</th>
                  <th className="pb-2 pr-3 font-medium">Company</th>
                  <th className="pb-2 pr-3 font-medium">Applied</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {visible.map((app) => (
                  <ApplicationRow key={app.id} app={app} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function ApplicationRow({ app }: { app: Application }) {
  return (
    <tr className="align-middle">
      <td className="py-3 pr-3">
        <div className="flex items-center gap-2">
          {app.url ? (
            <a
              href={app.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {app.title || 'Untitled role'}
            </a>
          ) : (
            <span className="font-medium">{app.title || 'Untitled role'}</span>
          )}
          {app.dryRun && <Badge tone="neutral">dry run</Badge>}
        </div>
        {app.location ? (
          <div className="mt-0.5 text-xs text-zinc-500">{app.location}</div>
        ) : null}
      </td>

      <td className="py-3 pr-3 text-zinc-700 dark:text-zinc-300">{app.company || '—'}</td>

      <td className="py-3 pr-3 text-xs text-zinc-500" title={new Date(app.appliedAt).toLocaleString()}>
        {relativeDate(app.appliedAt)}
      </td>

      <td className="py-3 pr-3">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONES[app.status]}>{app.status}</Badge>
          <Select
            value={app.status}
            className="w-32 py-1 text-xs"
            onChange={(e) =>
              void updateApplication(app.id, { status: e.target.value as ApplicationStatus })
            }
          >
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </div>
      </td>

      <td className="py-3 text-right">
        <Button size="sm" variant="ghost" onClick={() => void deleteApplication(app.id)}>
          Delete
        </Button>
      </td>
    </tr>
  )
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {hasAny ? 'Nothing matches those filters.' : 'No applications yet.'}
      </p>
      <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
        {hasAny
          ? 'Try clearing the search, or tick “Show dry runs” if you’ve only done test runs so far.'
          : 'Open a LinkedIn job search, click the extension, and press Start. Dry run is on by default, so the first pass won’t submit anything.'}
      </p>
    </div>
  )
}
