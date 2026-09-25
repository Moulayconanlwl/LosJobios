import { useCallback, useEffect, useRef, useState } from 'react'
import { sendToBackground } from '@/lib/messaging'
import { formatLog, type LogEntry, type LogLevel } from '@/lib/debug-log'
import { Button, cx } from '../components/ui'

/**
 * What the run is actually doing.
 *
 * When a run stalls the only question that matters is *where*, and without
 * this the answer lives in a service-worker console most people never open —
 * one that Chrome wipes every time it tears the worker down. Reading the log
 * is the difference between "Indeed doesn't work" and "it opened the search,
 * found 0 cards, and said you were signed out".
 */

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: 'text-zinc-400',
  info: 'text-sky-600 dark:text-sky-400',
  warn: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400',
}

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false })
}

export function LogsTab() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [copied, setCopied] = useState(false)
  const [follow, setFollow] = useState(true)
  const endRef = useRef<HTMLDivElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const { entries: next } = await sendToBackground('run/log', {})
      setEntries(next)
    } catch {
      // The worker being asleep is not itself worth reporting here.
    }
  }, [])

  // Polled rather than pushed: the log is written from the background, and a
  // port held open by a panel that may not be visible is a worse trade than
  // a one-second read of a capped array.
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 1000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (follow) endRef.current?.scrollIntoView({ block: 'end' })
  }, [entries, follow])

  const copy = async () => {
    await navigator.clipboard.writeText(formatLog(entries))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
          {entries.length} line{entries.length === 1 ? '' : 's'}
        </span>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-zinc-500">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
        <Button size="sm" variant="secondary" disabled={!entries.length} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!entries.length}
          onClick={() => {
            void sendToBackground('run/log-clear', {}).then(refresh)
          }}
        >
          Clear
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {entries.length === 0 ? (
          <p className="py-8 text-center font-sans text-xs text-zinc-500">
            Nothing logged yet. Start a run and the steps it takes appear here.
          </p>
        ) : (
          entries.map((entry, index) => (
            <div key={`${entry.at}-${index}`} className="border-b border-zinc-100 py-1 dark:border-zinc-900">
              <div className="flex gap-2">
                <span className="shrink-0 text-zinc-400">{timeOf(entry.at)}</span>
                <span className={cx('shrink-0 font-semibold uppercase', LEVEL_STYLE[entry.level])}>
                  {entry.level}
                </span>
                <span className="shrink-0 text-zinc-400">[{entry.scope}]</span>
              </div>
              <div className="pl-1 text-zinc-700 dark:text-zinc-300">{entry.message}</div>
              {entry.detail ? (
                <div className="whitespace-pre-wrap break-all pl-1 text-zinc-500">{entry.detail}</div>
              ) : null}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <p className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
        Kept for this browser session only, and it records what happened &mdash; never a value that
        was typed into a form.
      </p>
    </div>
  )
}
