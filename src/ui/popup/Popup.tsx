import { useState } from 'react'
import { NoReceiverError, sendToBackground } from '@/lib/messaging'
import { patchSettings } from '@/lib/storage'
import { Banner, Button, Input, Select, Stat, Toggle } from '../components/ui'
import { useProfile, useRunState, useSettings } from '../hooks'

/**
 * The popup is the run cockpit: start/pause/stop, live counters, and the one
 * escape hatch — answering a question that blocked the run.
 */

/** The options page, opened straight onto its ATS tab. */
const ATS_PAGE = 'src/ui/options/index.html#ats'

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<{ ok: boolean; error?: string } | unknown>) => {
    setBusy(true)
    setError('')
    try {
      const result = (await fn()) as { ok?: boolean; error?: string }
      if (result && result.ok === false) setError(result.error ?? 'Something went wrong.')
    } catch (err) {
      setError(
        err instanceof NoReceiverError
          ? 'The extension background is still waking up. Try again.'
          : err instanceof Error
            ? err.message
            : String(err),
      )
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, run, setError }
}

export function Popup() {
  const { data: state } = useRunState()
  const { data: settings } = useSettings()
  const { data: profile } = useProfile()
  const { busy, error, run } = useAction()
  const [autofillNote, setAutofillNote] = useState('')

  const status = state?.status ?? 'idle'
  const running = status === 'running'
  const blocked = status === 'blocked'

  const profileReady = Boolean(profile?.firstName && profile?.email)

  return (
    <div className="flex w-[360px] flex-col gap-3 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold">LosJobios</h1>
          <p className="text-xs text-zinc-500">
            {running ? 'Running' : blocked ? 'Waiting on you' : status === 'paused' ? 'Paused' : 'Idle'}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void sendToBackground('dashboard/open')}>
          Dashboard
        </Button>
      </header>

      {!profileReady && (
        <Banner tone="warn">
          Your profile is empty. Autofill needs at least a name and email —{' '}
          <button
            className="font-semibold underline"
            onClick={() => void chrome.runtime.openOptionsPage()}
          >
            set it up
          </button>
          .
        </Banner>
      )}

      {settings?.dryRun && (
        <Banner tone="info">
          <strong>Dry run is on.</strong> Applications are filled and driven to the final step, then
          discarded. Nothing is submitted.
        </Banner>
      )}

      {blocked && state?.pendingQuestion ? (
        <PendingQuestionCard
          question={state.pendingQuestion.question}
          options={state.pendingQuestion.options}
        />
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Applied" value={state?.applied ?? 0} tone="good" />
        <Stat label="Skipped" value={state?.skipped ?? 0} />
        <Stat label="Failed" value={state?.failed ?? 0} tone={state?.failed ? 'bad' : undefined} />
      </div>

      {state?.lastMessage ? (
        <p className="truncate text-xs text-zinc-500" title={state.lastMessage}>
          {state.lastMessage}
        </p>
      ) : null}

      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="flex gap-2">
        {running ? (
          <Button
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={() => void run(() => sendToBackground('run/pause'))}
          >
            Pause
          </Button>
        ) : (
          <Button
            variant="primary"
            className="flex-1"
            disabled={busy || !profileReady}
            onClick={() =>
              void run(() =>
                status === 'paused'
                  ? sendToBackground('run/resume')
                  : sendToBackground('run/start'),
              )
            }
          >
            {status === 'paused' ? 'Resume' : 'Start on this page'}
          </Button>
        )}

        <Button
          variant="danger"
          disabled={busy || status === 'idle'}
          onClick={() => void run(() => sendToBackground('run/stop'))}
        >
          Stop
        </Button>
      </div>

      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await sendToBackground('autofill/active-tab')
            if (result.ok && result.report) {
              const { filled, unfilled } = result.report
              setAutofillNote(
                `Filled ${filled} field${filled === 1 ? '' : 's'}.` +
                  (unfilled.length ? ` ${unfilled.length} left for you.` : ''),
              )
            }
            return result
          })
        }
      >
        Autofill this page
      </Button>

      <Button
        variant="secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await sendToBackground('ats/capture-job')
            if (result.ok) {
              // The scorer needs room the popup doesn't have, and the result
              // is worth keeping on screen while you edit your CV.
              await chrome.tabs.create({ url: chrome.runtime.getURL(ATS_PAGE) })
            }
            return result
          })
        }
      >
        Score this job against my CV
      </Button>

      {autofillNote ? <Banner tone="success">{autofillNote}</Banner> : null}

      {settings ? (
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <Toggle
            checked={settings.dryRun}
            label="Dry run"
            hint="Fill and navigate, but never submit."
            onChange={(next) => void patchSettings({ dryRun: next })}
          />
          <label className="mt-3 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
            <span>Daily cap</span>
            <Input
              type="number"
              min={1}
              max={200}
              value={settings.dailyCap}
              onChange={(e) => void patchSettings({ dailyCap: Number(e.target.value) || 1 })}
              className="ml-3 w-20"
            />
          </label>
          <p className="mt-2 text-xs text-zinc-500">
            {state?.dailyCount ?? 0} of {settings.dailyCap} used today.
          </p>
        </div>
      ) : null}

      <button
        className="text-left text-xs text-zinc-500 underline"
        onClick={() => void chrome.runtime.openOptionsPage()}
      >
        Profile &amp; settings
      </button>
    </div>
  )
}

/**
 * The run stopped because a required question couldn't be answered confidently.
 * Answering here is what makes bulk applying safe — it's the alternative to
 * guessing.
 */
function PendingQuestionCard({ question, options }: { question: string; options: string[] }) {
  const [answer, setAnswer] = useState('')
  const [remember, setRemember] = useState(true)
  const { busy, error, run } = useAction()

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
      <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
        This application asks:
      </p>
      <p className="mt-1 text-sm text-amber-950 dark:text-amber-100">{question}</p>

      <div className="mt-3">
        {options.length ? (
          <Select value={answer} onChange={(e) => setAnswer(e.target.value)}>
            <option value="">Choose an answer…</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            value={answer}
            placeholder="Your answer"
            onChange={(e) => setAnswer(e.target.value)}
          />
        )}
      </div>

      <label className="mt-2 flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="rounded"
        />
        Remember this answer for next time
      </label>

      {error ? <p className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p> : null}

      <Button
        variant="primary"
        size="sm"
        className="mt-3 w-full"
        disabled={busy || !answer.trim()}
        onClick={() => void run(() => sendToBackground('run/answer', { answer, remember }))}
      >
        Save &amp; continue
      </Button>
    </div>
  )
}
