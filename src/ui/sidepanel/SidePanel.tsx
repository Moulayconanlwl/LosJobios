import { useState } from 'react'
import { sendToBackground } from '@/lib/messaging'
import { Button, cx } from '../components/ui'
import { useRunState, useSettings } from '../hooks'
import { AutoApplyTab } from './AutoApplyTab'
import { PendingQuestionCard } from './PendingQuestion'
import { LogsTab } from './LogsTab'
import { ReviewTab } from './ReviewTab'

/**
 * The side panel shell.
 *
 * The panel, not the popup, is the place a run is driven from — and that is a
 * functional decision rather than a stylistic one. A popup closes the instant
 * you click anything on the page, which is exactly what you do while watching
 * a run work or checking what it proposes to type. The panel stays open beside
 * the tab it is driving.
 */

type Tab = 'auto' | 'review' | 'logs'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'auto', label: 'Auto apply' },
  { id: 'review', label: 'Review' },
  { id: 'logs', label: 'Logs' },
]

/** Run status as a colour and a word, never a colour alone. */
function statusOf(status: string | undefined): { dot: string; label: string } {
  switch (status) {
    case 'running':
      return { dot: 'bg-emerald-500', label: 'Running' }
    case 'paused':
      return { dot: 'bg-amber-500', label: 'Paused' }
    case 'blocked':
      return { dot: 'bg-amber-500', label: 'Needs you' }
    case 'finished':
      return { dot: 'bg-sky-500', label: 'Finished' }
    default:
      return { dot: 'bg-zinc-400', label: 'Idle' }
  }
}

/** One number with its name under it. */
function Kpi({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'good' | 'bad' | 'muted'
}) {
  const tones = {
    good: 'text-emerald-600 dark:text-emerald-400',
    bad: 'text-red-600 dark:text-red-400',
    muted: 'text-zinc-700 dark:text-zinc-300',
  }

  return (
    <div className="rounded-md bg-zinc-100 px-1.5 py-1 text-center dark:bg-zinc-900">
      <div className={cx('text-base font-semibold tabular-nums leading-none', tones[tone])}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  )
}

export function SidePanel() {
  const [tab, setTab] = useState<Tab>('auto')
  const { data: settings } = useSettings()
  const { data: run } = useRunState()

  const status = statusOf(run?.status)
  const done = (run?.applied ?? 0) + (run?.skipped ?? 0) + (run?.failed ?? 0)
  const total = run?.queue.length ?? 0

  return (
    <div className="flex h-screen flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-semibold">LosJobios</div>
            <div className="truncate text-[11px] text-zinc-500">
              Stop retyping your life story.
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => void sendToBackground('dashboard/open', {})}
          >
            Dashboard
          </Button>
        </div>

        <div className="flex items-center gap-2 px-3 pb-2">
          <span className={cx('h-2 w-2 shrink-0 rounded-full', status.dot)} />
          <span className="text-xs font-medium">{status.label}</span>
          {total > 0 ? (
            <span className="ml-auto text-xs tabular-nums text-zinc-500">
              {done} / {total}
            </span>
          ) : null}
        </div>

        {total > 0 ? (
          <div className="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.round((done / total) * 100)}%` }}
            />
          </div>
        ) : null}

        {/*
          The counts, always visible rather than buried in a status sentence.
          "3 applied, 1 failed" is the question anyone actually has while a run
          is working, and it should not require reading prose to answer.
        */}
        {run && run.status !== 'idle' ? (
          <div className="mx-3 mb-2 grid grid-cols-4 gap-1.5">
            <Kpi label="Applied" value={run.applied} tone="good" />
            <Kpi label="Skipped" value={run.skipped} tone="muted" />
            <Kpi label="Failed" value={run.failed} tone="bad" />
            <Kpi label="Left" value={Math.max(0, total - done)} tone="muted" />
          </div>
        ) : null}

        {run?.lastError ? (
          <p className="mx-3 mb-2 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">
            {run.lastError}
          </p>
        ) : null}

        <nav className="flex border-t border-zinc-200 dark:border-zinc-800">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cx(
                'flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors',
                tab === entry.id
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200',
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      {/*
        Above the tab content on purpose: a run waits indefinitely for this,
        so it must not be something the user can be on the wrong tab to see.
      */}
      {run?.status === 'blocked' && run.pendingQuestion ? (
        <PendingQuestionCard question={run.pendingQuestion} sound />
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'auto' ? (
          settings ? (
            <AutoApplyTab settings={settings} run={run} />
          ) : (
            <p className="p-4 text-xs text-zinc-500">Loading…</p>
          )
        ) : null}
        {tab === 'review' ? <ReviewTab /> : null}
        {tab === 'logs' ? <LogsTab /> : null}
      </main>

      <footer className="border-t border-zinc-200 px-3 py-1.5 text-center text-[11px] text-zinc-400 dark:border-zinc-800">
        This never submits a form you haven&rsquo;t reviewed.
      </footer>
    </div>
  )
}
