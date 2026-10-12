import { useEffect, useState } from 'react'
import { GeminiProvider, hasGeminiPermission } from '@/lib/ai/gemini'
import type { ResumeReview } from '@/lib/ai/provider'
import { scoreResumeAgainstJob, type AtsScore, type AtsSeverity, type AtsSuggestion } from '@/lib/ats'
import { getCapturedJob } from '@/lib/storage'
import { Banner, Button, Card, Field, Textarea, Input, cx } from '../../components/ui'
import { useProfile, useSettings } from '../../hooks'

/**
 * The ATS scorer.
 *
 * The number comes from `lib/ats.ts` and is computed locally — no key, no
 * network, same answer every time. The AI review is a separate, optional
 * second opinion that says what to rewrite, and deliberately produces no
 * score of its own: two numbers that disagree would be worse than one.
 */

function toneFor(score: number): { bar: string; text: string; label: string } {
  if (score >= 75) {
    return {
      bar: 'bg-emerald-500',
      text: 'text-emerald-600 dark:text-emerald-400',
      label: 'Should get through a keyword screen',
    }
  }
  if (score >= 50) {
    return {
      bar: 'bg-amber-500',
      text: 'text-amber-600 dark:text-amber-400',
      label: 'Borderline — worth a pass before applying',
    }
  }
  return {
    bar: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    label: 'Likely filtered out before a human sees it',
  }
}

function Chip({ term, tone }: { term: string; tone: 'good' | 'bad' | 'easy' }) {
  const tones = {
    good: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    bad: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    easy: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  }

  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        tones[tone],
      )}
    >
      {term}
    </span>
  )
}

/**
 * Severity, shown as a word rather than only a colour.
 *
 * Colour alone would carry the whole meaning of "this is what gets you
 * filtered out", which is exactly the kind of thing that disappears for a
 * colour-blind reader or in a screenshot.
 */
const SEVERITY_STYLE: Record<AtsSeverity, { label: string; className: string }> = {
  critical: {
    label: 'Filters you out',
    className: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  },
  important: {
    label: 'Costs you ranking',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  polish: {
    label: 'Worth a look',
    className: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  },
}

function SuggestionList({ suggestions }: { suggestions: AtsSuggestion[] }) {
  if (!suggestions.length) return null

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        What to change, worst first
      </h3>
      <ul className="flex flex-col gap-2.5">
        {suggestions.map((suggestion) => {
          const severity = SEVERITY_STYLE[suggestion.severity]
          return (
            <li
              key={suggestion.id}
              className="rounded-md border border-zinc-200 p-2.5 dark:border-zinc-800"
            >
              <div className="mb-1 flex flex-wrap items-baseline gap-2">
                <span
                  className={cx(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    severity.className,
                  )}
                >
                  {severity.label}
                </span>
                <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  {suggestion.title}
                </span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{suggestion.detail}</p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function AtsSection() {
  const { data: profile } = useProfile()
  const { data: settings } = useSettings()

  const [jobTitle, setJobTitle] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [result, setResult] = useState<AtsScore | null>(null)

  const [review, setReview] = useState<ResumeReview | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState('')

  // Prefill from whatever the popup last scraped, so "Score this job" lands
  // here with the posting already in the box.
  useEffect(() => {
    let cancelled = false
    void getCapturedJob().then((captured) => {
      if (cancelled || !captured) return
      setJobTitle((current) => current || captured.title)
      setJobDescription((current) => current || captured.description)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!profile) return null

  const resumeText = profile.resume?.text ?? ''
  const canScore = jobDescription.trim().length > 0
  const aiConfigured = Boolean(settings?.ai.apiKey && settings.ai.model)

  const runScore = () => {
    setReview(null)
    setReviewError('')
    setResult(scoreResumeAgainstJob({ resumeText, profile, jobTitle, jobDescription }))
  }

  const runReview = async () => {
    setReviewing(true)
    setReviewError('')
    try {
      if (!settings?.ai.apiKey || !settings.ai.model || !(await hasGeminiPermission())) {
        throw new Error('Set up a Gemini key under Settings → AI first.')
      }
      const provider = new GeminiProvider(settings.ai.apiKey, settings.ai.model)
      setReview(
        await provider.reviewResume({
          resumeText,
          profile,
          jobTitle,
          jobDescription,
          missingKeywords: result?.missing ?? [],
        }),
      )
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Could not get a review.')
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="ATS score"
        description="How a keyword-matching applicant tracking system would read your resume against one posting. Scored on this machine — no key needed."
      >
        {/*
          Say plainly whether there is CV text and how much.
          "No resume text to match" in the results is a symptom; the cause is
          either no upload or an extraction that silently came back empty, and
          only one of those is fixed by uploading again. A character count
          tells the two apart at a glance.
        */}
        {resumeText.trim() ? (
          <Banner tone="info">
            Scoring against <strong>{profile.resume?.fileName || 'your stored CV text'}</strong> —{' '}
            {resumeText.trim().length.toLocaleString()} characters of text.{' '}
            {resumeText.trim().length < 300 ? (
              <>
                That is very little; the extraction may have failed. Check the text under{' '}
                <strong>Profile → Resume</strong>.
              </>
            ) : null}
          </Banner>
        ) : (
          <Banner tone="warn">
            There&rsquo;s no resume text to score yet, so only your profile can be matched. Upload a
            CV under <strong>Profile → Resume</strong> — and if you already did, open that section
            and check the extracted text is there, because a PDF with no text layer extracts to
            nothing.
          </Banner>
        )}

        <div className="mt-4 flex flex-col gap-4">
          <Field label="Job title" hint="Used to check your own titles against the posting's wording. Optional.">
            <Input
              value={jobTitle}
              placeholder="Senior Backend Engineer"
              onChange={(e) => setJobTitle(e.target.value)}
            />
          </Field>

          <Field
            label="Job description"
            hint="Paste the posting. Or open it in a tab and press “Score this job against my CV” in the extension popup, which fills this in for you."
          >
            <Textarea
              rows={10}
              value={jobDescription}
              placeholder="Paste the full job description here…"
              onChange={(e) => setJobDescription(e.target.value)}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!canScore} onClick={runScore}>
              Score my resume
            </Button>
            {result ? (
              <Button
                variant="secondary"
                disabled={reviewing || !aiConfigured || !resumeText.trim()}
                title={aiConfigured ? undefined : 'Set up a Gemini key under Settings → AI'}
                onClick={() => void runReview()}
              >
                {reviewing ? 'Reading your resume…' : 'Ask AI what to change'}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {result ? <ScoreCard result={result} /> : null}

      {reviewError ? <Banner tone="error">{reviewError}</Banner> : null}
      {review ? <ReviewCard review={review} /> : null}
    </div>
  )
}

function ScoreCard({ result }: { result: AtsScore }) {
  const tone = toneFor(result.score)

  return (
    <Card title="Result">
      <div className="flex flex-col gap-5">
        <div className="flex items-end gap-4">
          <div className={cx('text-5xl font-semibold tabular-nums', tone.text)}>{result.score}</div>
          <div className="pb-1">
            <div className="text-sm font-medium">{tone.label}</div>
            <div className="text-xs text-zinc-500">out of 100</div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {result.components.map((component) => (
            <div key={component.id}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {component.label}
                </span>
                <span className="tabular-nums text-zinc-500">
                  {Math.round(component.score * 100)}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className={cx('h-full rounded-full', toneFor(component.score * 100).bar)}
                  style={{ width: `${Math.round(component.score * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-zinc-500">{component.detail}</p>
            </div>
          ))}
        </div>

        {result.matched.length ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Found in your resume
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {result.matched.map((term) => (
                <Chip key={term} term={term} tone="good" />
              ))}
            </div>
          </div>
        ) : null}

        {result.easyWins.length ? (
          <div>
            <h3 className="mb-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Your profile says these; the document doesn&rsquo;t
            </h3>
            <p className="mb-2 text-xs text-zinc-500">
              The tracker reads the file you upload, not this profile. Nothing here has to become
              true &mdash; the resume just has to say it.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.easyWins.map((term) => (
                <Chip key={term} term={term} tone="easy" />
              ))}
            </div>
          </div>
        ) : null}

        {result.missing.length ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              In the posting, nowhere in your application
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {result.missing.map((term) => (
                <Chip key={term} term={term} tone="bad" />
              ))}
            </div>
          </div>
        ) : null}

        <SuggestionList suggestions={result.suggestions} />
      </div>
    </Card>
  )
}

function ReviewCard({ review }: { review: ResumeReview }) {
  const lists: Array<{ title: string; items: string[] }> = [
    { title: 'Strengths', items: review.strengths },
    { title: 'Gaps', items: review.gaps },
    { title: 'What to change', items: review.suggestions },
  ]

  return (
    <Card title="AI review" description="A second opinion on the same posting. No score — that's above.">
      <div className="flex flex-col gap-4">
        {review.verdict ? <p className="text-sm">{review.verdict}</p> : null}

        {lists
          .filter((list) => list.items.length > 0)
          .map((list) => (
            <div key={list.title}>
              <h3 className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {list.title}
              </h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm text-zinc-700 dark:text-zinc-300">
                {/* Model output, so two identical lines are possible — index keys. */}
                {list.items.map((item, index) => (
                  <li key={`${list.title}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </Card>
  )
}
