import { useEffect, useState } from 'react'
import { sendToBackground } from '@/lib/messaging'
import type { PendingQuestion as Question } from '@/lib/schema'
import { Button, Input, Select, cx } from '../components/ui'

/**
 * The run stopped because a required question couldn't be answered.
 *
 * This is the load-bearing half of applying in bulk: the alternative to
 * stopping here is guessing, and a guess goes to a real employer under the
 * user's name. So the run waits — indefinitely — and the answer the user gives
 * is what unblocks it.
 *
 * It also earns its keep twice, because "remember this" writes the answer into
 * the answer bank. The same question on the next twenty applications is then
 * answered without stopping at all.
 */

/**
 * A short two-tone chime, synthesised rather than shipped as an audio file.
 *
 * The run can be blocked while the user is in another tab entirely — that is
 * the normal case, since the whole point is not having to watch it — so a
 * silent card nobody sees would stall the queue indefinitely. WebAudio needs
 * no asset, no permission and no network.
 */
function chime(): void {
  try {
    const AudioCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return

    const context = new AudioCtor()
    const now = context.currentTime

    for (const [index, frequency] of [660, 880].entries()) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.value = frequency

      // Shaped rather than switched: a square-edged gain change is heard as a
      // click on top of the note.
      const start = now + index * 0.16
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15)

      oscillator.connect(gain).connect(context.destination)
      oscillator.start(start)
      oscillator.stop(start + 0.18)
    }

    setTimeout(() => void context.close().catch(() => {}), 800)
  } catch {
    // Audio is a courtesy. Never let it break the thing that matters.
  }
}

type Props = {
  question: Question
  /** Play a sound when this question first appears. */
  sound: boolean
}

export function PendingQuestionCard({ question, sound }: Props) {
  const [answer, setAnswer] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Keyed on the question text: a new question is a new prompt and should
  // sound again, while a re-render of the same one must not.
  useEffect(() => {
    setAnswer('')
    setError('')
    if (sound) chime()
  }, [question.question, sound])

  const submit = async () => {
    if (!answer.trim()) return
    setBusy(true)
    setError('')
    try {
      const ack = await sendToBackground('run/answer', { answer, remember })
      if (!ack.ok) setError(ack.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="m-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 dark:border-amber-600 dark:bg-amber-950">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
          Waiting for you
        </p>
      </div>

      {question.jobTitle || question.company ? (
        <p className="mt-1.5 text-[11px] text-amber-800 dark:text-amber-300">
          {[question.jobTitle, question.company].filter(Boolean).join(' — ')}
        </p>
      ) : null}

      <p className="mt-2 text-sm font-medium text-amber-950 dark:text-amber-100">
        {question.question}
      </p>

      <div className="mt-3">
        {question.options.length ? (
          <Select value={answer} onChange={(e) => setAnswer(e.target.value)}>
            <option value="">Choose an answer…</option>
            {question.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        ) : (
          <Input
            autoFocus
            value={answer}
            placeholder="Your answer"
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        )}
      </div>

      <label className="mt-2 flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
        <input
          type="checkbox"
          className="mt-0.5 rounded"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <span>
          Remember this answer
          <span className="block text-[11px] opacity-80">
            Saved to your answer bank, so the same question is answered without stopping next time.
          </span>
        </span>
      </label>

      {error ? (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p>
      ) : null}

      <Button
        variant="primary"
        size="sm"
        className={cx('mt-3 w-full')}
        disabled={busy || !answer.trim()}
        onClick={() => void submit()}
      >
        Save &amp; continue
      </Button>
    </div>
  )
}
