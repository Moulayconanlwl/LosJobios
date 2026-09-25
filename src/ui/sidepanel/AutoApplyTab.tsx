import { useEffect, useState } from 'react'
import { sendToBackground } from '@/lib/messaging'
import { MARKETS, MARKET_LABELS, buildSearchUrl, type Market } from '@/lib/search-url'
import type { RunState, SearchSpecSetting, Settings } from '@/lib/schema'
import { patchSettings } from '@/lib/storage'
import { Button, Input, Select, Textarea, cx } from '../components/ui'

/**
 * The run cockpit.
 *
 * The shape of this is the whole point: you say what job you want, and Start
 * goes and finds it. Previously a run refused unless you were already sitting
 * on a correctly-filtered search page, which is a strange thing to demand
 * when the extension knows the role and every board encodes its search in the
 * URL — and it is why starting a run from anywhere else appeared to do
 * nothing at all.
 */

type Props = {
  settings: Settings
  run: RunState | null
}

const PLATFORMS = [
  { id: 'indeed' as const, label: 'Indeed' },
  { id: 'linkedin' as const, label: 'LinkedIn' },
]

/** A collapsible group, matching the reference panel's disclosure sections. */
function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 marker:content-[''] dark:text-zinc-400">
        <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">&#9656;</span>
        {title}
      </summary>
      <div className="flex flex-col gap-3 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
        {children}
      </div>
    </details>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </span>
  )
}

export function AutoApplyTab({ settings, run }: Props) {
  const [spec, setSpec] = useState<SearchSpecSetting>(settings.search)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Keep in step with settings changed elsewhere, without stamping on a value
  // the user is part-way through typing.
  useEffect(() => {
    setSpec((current) => (current.role ? current : settings.search))
  }, [settings.search])

  const running = run?.status === 'running'
  const paused = run?.status === 'paused' || run?.status === 'blocked'

  const patch = (next: Partial<SearchSpecSetting>) => {
    const merged = { ...spec, ...next }
    setSpec(merged)
    // Persisted as you type, so Start is one click next time and an
    // interrupted run can be restarted without retyping anything.
    void patchSettings({ search: merged }).catch(() => {})
  }

  const patchFilters = (next: Partial<SearchSpecSetting['filters']>) =>
    patch({ filters: { ...spec.filters, ...next } })

  /** What Start will actually open — shown so it is never a surprise. */
  let preview = ''
  try {
    preview = spec.role.trim() ? buildSearchUrl(spec) : ''
  } catch {
    preview = ''
  }

  const start = async () => {
    setBusy(true)
    setNote('')
    try {
      const ack = await sendToBackground('run/start', { spec })
      if (!ack.ok) setNote(ack.error)
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Run a one-shot action against the current tab and report what it said.
   *
   * Takes a thunk rather than a message name: each of these has a differently
   * shaped reply, and a generic over the message map ends up fighting the
   * union for no benefit at three call sites.
   */
  const act = async (run: () => Promise<string>) => {
    setBusy(true)
    setNote('')
    try {
      setNote(await run())
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const command = async (message: 'run/pause' | 'run/resume' | 'run/stop') => {
    setBusy(true)
    try {
      const ack = await sendToBackground(message, {})
      if (!ack.ok) setNote(ack.error)
      else setNote('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <Label>Platform</Label>
          <Select
            value={spec.platform}
            onChange={(e) => patch({ platform: e.target.value as SearchSpecSetting['platform'] })}
          >
            {PLATFORMS.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex w-20 flex-col gap-1">
          <Label>Max</Label>
          <Input
            type="number"
            min={1}
            max={25}
            value={spec.maxPerRun}
            onChange={(e) => patch({ maxPerRun: Number(e.target.value) || 1 })}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <Label>Market</Label>
        <Select value={spec.market} onChange={(e) => patch({ market: e.target.value as Market })}>
          {MARKETS.map((market) => (
            <option key={market} value={market}>
              {MARKET_LABELS[market]}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        <Label>Role</Label>
        <Textarea
          rows={2}
          value={spec.role}
          placeholder="product owner AI"
          spellCheck={false}
          onChange={(e) => patch({ role: e.target.value })}
        />
      </label>

      <Details title="Search filters">
        <label className="flex flex-col gap-1">
          <Label>Location</Label>
          <Input
            value={spec.filters.location}
            placeholder="Paris, France…"
            onChange={(e) => patchFilters({ location: e.target.value })}
          />
          <span className="text-[11px] text-zinc-500">
            Auto picks the country site from this. Set Market if results land on the wrong one.
          </span>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <Label>Work type</Label>
            <Select
              value={spec.filters.workType}
              onChange={(e) =>
                patchFilters({ workType: e.target.value as SearchSpecSetting['filters']['workType'] })
              }
            >
              <option value="">Any</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="on_site">On-site</option>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <Label>Posted</Label>
            <Select
              value={spec.filters.datePosted}
              onChange={(e) =>
                patchFilters({
                  datePosted: e.target.value as SearchSpecSetting['filters']['datePosted'],
                })
              }
            >
              <option value="">Any time</option>
              <option value="24h">24 hours</option>
              <option value="week">Past week</option>
              <option value="month">Past month</option>
            </Select>
          </label>
        </div>

        {spec.platform === 'indeed' ? (
          <p className="text-[11px] text-zinc-500">
            Work type is applied to the scraped titles rather than to Indeed&rsquo;s own search:
            Indeed encodes it as an opaque country-specific code, and a wrong guess returns zero
            results rather than fewer.
          </p>
        ) : null}
      </Details>

      <Details title="Auto apply settings">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={spec.easyApplyOnly}
            onChange={(e) => patch({ easyApplyOnly: e.target.checked })}
          />
          <span className="text-xs">
            <span className="font-medium">Only jobs I can apply to without leaving the site</span>
            <span className="block text-zinc-500">
              Uses the board&rsquo;s own filter, so nothing is opened just to find out it applies
              somewhere else.
            </span>
          </span>
        </label>

        <div
          className={cx(
            'rounded-md px-2.5 py-2 text-xs',
            settings.dryRun
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
          )}
        >
          {settings.dryRun ? (
            <>
              <strong>Dry run is on.</strong> The run walks the whole application and stops at
              Submit without clicking it.
            </>
          ) : (
            <>
              <strong>Dry run is off.</strong> Applications will really be submitted, up to your
              daily cap of {settings.dailyCap}.
            </>
          )}
          <span className="mt-1 block text-zinc-500">Change this under Settings &rarr; Automation.</span>
        </div>
      </Details>

      <div className="flex gap-2">
        {running ? (
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => void command('run/pause')}>
            Pause
          </Button>
        ) : (
          <Button
            variant="primary"
            className="flex-1"
            disabled={busy || !spec.role.trim()}
            onClick={() => void (paused ? command('run/resume') : start())}
          >
            {paused ? 'Resume' : 'Start'}
          </Button>
        )}
        <Button
          variant="secondary"
          className="flex-1"
          disabled={busy || run?.status === 'idle'}
          onClick={() => void command('run/stop')}
        >
          Stop
        </Button>
      </div>

      <p className="text-xs text-zinc-500">
        {note ? (
          <span className="text-red-600 dark:text-red-400">{note}</span>
        ) : run && run.status !== 'idle' ? (
          <>
            {run.lastMessage}
            {run.queue.length ? ` · ${run.cursor}/${run.queue.length}` : ''}
          </>
        ) : spec.role.trim() ? (
          'Ready. Start opens the search and works down the results.'
        ) : (
          'Ready. Choose a platform and type a role.'
        )}
      </p>

      {preview ? (
        <p className="break-all text-[11px] text-zinc-400" title={preview}>
          Opens: {preview}
        </p>
      ) : null}

      {/*
        These used to live in the popup, which the toolbar icon no longer
        opens. They act on whatever tab you are looking at rather than on a
        run, so they belong beside Start rather than being lost with it.
      */}
      <Details title="This page">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const result = await sendToBackground('jobs/scan-active-tab', {})
              return result.ok
                ? `Saved ${result.added ?? 0} new job${result.added === 1 ? '' : 's'} of ${result.found ?? 0} found.`
                : result.error
            })
          }
        >
          Scan this page for jobs
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const result = await sendToBackground('ats/capture-job', {})
              return result.ok
                ? `Captured “${result.job?.title || 'this posting'}”. Score it under Settings → ATS.`
                : result.error
            })
          }
        >
          Capture this posting for scoring
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const result = await sendToBackground('autofill/active-tab', {})
              return result.ok
                ? `Filled ${result.report?.filled ?? 0} field(s).`
                : result.error
            })
          }
        >
          Autofill this page
        </Button>
      </Details>
    </div>
  )
}
