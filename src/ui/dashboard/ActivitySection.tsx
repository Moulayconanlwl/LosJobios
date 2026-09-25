import type { ActivityEntry } from '@/lib/activity'
import { clearActivity } from '@/lib/storage'
import { Badge, type BadgeTone } from '../components/badge'
import { Banner, Button, Card } from '../components/ui'
import { TrashIcon } from '../components/icons'
import { useActivity } from '../hooks'

/**
 * What the extension did, and when.
 *
 * Its job is transparency before it is debugging: a tool that types into
 * other people's application forms on your behalf should be able to show you
 * what it did. That is also why the empty state is worth as much as the full
 * one — "nothing has happened yet" is a true and useful answer.
 *
 * Deliberately shows no field values. The log records that eleven fields were
 * filled on a host, not what went into them, so the log itself never becomes
 * a second copy of the answers.
 */

const TONES: Partial<Record<ActivityEntry['kind'], BadgeTone>> = {
  applied: 'good',
  'run-started': 'info',
  'run-finished': 'info',
  'fields-filled': 'good',
  'fields-reviewed': 'info',
  'draft-generated': 'ai',
  'document-generated': 'ai',
  'job-saved': 'neutral',
  skipped: 'neutral',
  failed: 'bad',
  blocked: 'warn',
  'data-exported': 'info',
  'data-restored': 'warn',
  'data-cleared': 'bad',
}

function label(kind: ActivityEntry['kind']): string {
  return kind.replace(/-/g, ' ')
}

function when(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`
  return new Date(at).toLocaleDateString()
}

export function ActivitySection() {
  const { data: entries } = useActivity()

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Activity"
        description="A local record of what this extension did on your behalf."
        actions={
          entries.length ? (
            <Button size="sm" variant="danger" onClick={() => void clearActivity()}>
              <TrashIcon className="h-3.5 w-3.5" />
              Clear
            </Button>
          ) : null
        }
      >
        <Banner tone="info">
          This records <strong>what happened, never what was written</strong>. Entries carry field
          counts and labels, so this log can never become a second copy of your answers. It stays
          on this machine, is capped at the most recent 300 entries, and is included in a backup.
        </Banner>

        {entries.length === 0 ? (
          <p className="py-10 text-center text-xs text-zinc-500">
            Nothing recorded yet. Start a run or fill a form and it will show up here.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 py-2.5">
                <Badge tone={TONES[entry.kind] ?? 'neutral'}>{label(entry.kind)}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-zinc-800 dark:text-zinc-200">{entry.summary}</p>
                  {entry.jobTitle || entry.company || entry.site ? (
                    <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                      {[entry.jobTitle, entry.company, entry.site].filter(Boolean).join(' · ')}
                    </p>
                  ) : null}
                </div>
                <span className="flex-none text-[11px] text-zinc-400">{when(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
