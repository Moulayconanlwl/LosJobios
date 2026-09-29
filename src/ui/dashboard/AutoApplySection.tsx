import { useMemo, useState } from 'react'
import { sendToBackground } from '@/lib/messaging'
import type { SavedJob } from '@/lib/schema'
import { Badge } from '../components/badge'
import { Banner, Button, Card, Input, cx } from '../components/ui'
import { useRunState, useSavedJobs, useSettings } from '../hooks'

/**
 * Pick the jobs to apply to, then apply to them.
 *
 * The alternative — a run that works down whatever a search happened to
 * return — spends the daily cap on whatever the board felt like ranking
 * first. Choosing from what has already been scraped puts the cap on postings
 * the user has actually looked at, with the description right there to judge
 * by.
 */

function timeAgo(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export function AutoApplySection() {
  const { data: jobs } = useSavedJobs()
  const { data: settings } = useSettings()
  const { data: run } = useRunState()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Only postings with a link are applyable — there is nothing to open
    // otherwise, and listing them would offer a button that always fails.
    const applyable = jobs.filter((job) => job.url)
    if (!needle) return applyable
    return applyable.filter((job) =>
      `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(needle),
    )
  }, [jobs, query])

  const running = run?.status === 'running'
  const chosen = visible.filter((job) => selected.has(job.id))

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const start = async () => {
    setBusy(true)
    setNote('')
    try {
      const ack = await sendToBackground('run/apply-selected', {
        ids: chosen.map((job) => job.id),
      })
      setNote(ack.ok ? 'Started — watch it in the side panel.' : ack.error)
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const allVisibleChosen = visible.length > 0 && chosen.length === visible.length

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Auto apply"
        description="Pick the postings worth your daily cap, then let it work through them."
        actions={
          <Input
            value={query}
            placeholder="Search…"
            className="w-44"
            onChange={(e) => setQuery(e.target.value)}
          />
        }
      >
        {settings?.dryRun ? (
          <Banner tone="info">
            <strong>Dry run is on.</strong> Each application is walked in full and stopped at
            Submit without sending anything. Turn it off under Settings &rarr; Automation when you
            want to apply for real.
          </Banner>
        ) : (
          <Banner tone="warn">
            <strong>Dry run is off.</strong> These applications will really be sent, up to your
            daily cap of {settings?.dailyCap ?? 25}.
          </Banner>
        )}

        <p className="mt-3 text-xs text-zinc-500">
          {settings?.onUnknownQuestion === 'skip'
            ? 'A question nothing can answer will skip that posting and notify you, rather than stopping the run.'
            : 'A question nothing can answer will stop the run and ask you. Change that under Settings → Automation.'}
        </p>

        {visible.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500">
            {jobs.length === 0
              ? 'No saved jobs yet. Scan a search from the side panel first.'
              : 'Nothing matches that search.'}
          </p>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={allVisibleChosen}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(visible.map((j) => j.id)) : new Set())
                  }
                />
                Select all {visible.length}
              </label>
              <span className="ml-auto text-xs tabular-nums text-zinc-500">
                {chosen.length} selected
              </span>
            </div>

            <ul className="mt-2 flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto pr-1">
              {visible.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  checked={selected.has(job.id)}
                  onToggle={() => toggle(job.id)}
                />
              ))}
            </ul>
          </>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={busy || running || chosen.length === 0}
            onClick={() => void start()}
          >
            {running
              ? 'A run is already going'
              : `Apply to ${chosen.length} selected job${chosen.length === 1 ? '' : 's'}`}
          </Button>
          {note ? <span className="text-xs text-zinc-500">{note}</span> : null}
        </div>
      </Card>
    </div>
  )
}

function JobRow({
  job,
  checked,
  onToggle,
}: {
  job: SavedJob
  checked: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <label
        className={cx(
          'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors',
          checked
            ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950'
            : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800',
        )}
      >
        <input type="checkbox" className="mt-1" checked={checked} onChange={onToggle} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{job.title || 'Untitled role'}</span>
          <span className="block truncate text-xs text-zinc-500">
            {job.company || 'Unknown company'}
            {job.location ? ` · ${job.location}` : ''}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {/*
              Whether the posting's text was captured matters more here than
              anywhere else: it is what the AI reads to answer screening
              questions, so a job without one is likelier to stop the run.
            */}
            {job.description ? (
              <Badge tone="good">description</Badge>
            ) : (
              <Badge tone="neutral">no description</Badge>
            )}
            <span className="ml-auto text-[11px] text-zinc-400">{timeAgo(job.savedAt)}</span>
          </span>
        </span>
      </label>
    </li>
  )
}
