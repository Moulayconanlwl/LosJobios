import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnswerEntry } from '@/lib/schema'
import { deleteAnswer, putAnswer } from '@/lib/storage'
import { Badge } from '../../components/badge'
import { Button, Card, Input } from '../../components/ui'
import { useAnswers } from '../../hooks'

/**
 * The answer bank, and why it matters: every question answered here is one the
 * run never has to guess at again. AI-sourced answers land here unconfirmed so
 * there's a record of what was said on your behalf.
 */
export function AnswersSection() {
  const { data: answers } = useAnswers()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const sorted = [...answers].sort((a, b) => {
      // Unreviewed AI answers first — they're the ones worth looking at.
      if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1
      return b.lastUsedAt - a.lastUsedAt
    })
    if (!needle) return sorted
    return sorted.filter(
      (a) =>
        a.question.toLowerCase().includes(needle) || a.answer.toLowerCase().includes(needle),
    )
  }, [answers, query])

  const unconfirmed = answers.filter((a) => !a.confirmed).length

  return (
    <Card
      title="Answer bank"
      description={
        answers.length
          ? `${answers.length} saved${unconfirmed ? ` — ${unconfirmed} awaiting your review` : ''}.`
          : 'Empty for now. Answers are saved here as you go.'
      }
      actions={
        answers.length > 4 ? (
          <Input
            value={query}
            placeholder="Search…"
            className="w-48"
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : null
      }
    >
      {filtered.length === 0 ? (
        <p className="text-xs text-zinc-500">
          {answers.length
            ? 'Nothing matches that search.'
            : 'When an application asks something new, the answer lands here so the next one is instant.'}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {filtered.map((entry) => (
            <AnswerRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * One saved answer, edited locally and written once.
 *
 * The edit box deliberately doesn't write per keystroke. Every write fires a
 * storage change, which reloads this list and re-renders the box from the
 * stored value — so typing raced its own save and dropped characters. Local
 * state while you're in the field, one write when you leave it.
 */
function AnswerRow({ entry }: { entry: AnswerEntry }) {
  const [text, setText] = useState(entry.answer)
  const [editing, setEditing] = useState(false)

  // Adopt an outside change (a run just answered this again) unless the
  // field is currently being typed in.
  useEffect(() => {
    if (!editing) setText(entry.answer)
  }, [entry.answer, editing])

  // Held in refs so the page-close commit sees the latest text, not a
  // closure from the render that registered the listener.
  const latest = useRef({ text, entry })
  latest.current = { text, entry }

  const commit = () => {
    setEditing(false)
    const { text: current, entry: saved } = latest.current
    if (current === saved.answer) return
    // Editing an answer is reviewing it.
    void putAnswer({ ...saved, answer: current, confirmed: true })
  }

  // Closing the tab with the cursor still in the box never fires blur.
  useEffect(() => {
    const onHide = () => commit()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{entry.question}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={entry.source === 'ai' ? 'ai' : 'neutral'}>{entry.source}</Badge>
            {!entry.confirmed && <Badge tone="warn">unreviewed</Badge>}
            <span className="text-xs text-zinc-500">used {entry.useCount}×</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!entry.confirmed && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void putAnswer({ ...entry, confirmed: true })}
            >
              Approve
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={() => void deleteAnswer(entry.id)}>
            Delete
          </Button>
        </div>
      </div>

      <Input
        className="mt-2"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
      />
    </li>
  )
}
