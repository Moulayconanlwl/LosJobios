import { useEffect, useState } from 'react'
import { GeminiProvider, hasGeminiPermission } from '@/lib/ai/gemini'
import type { ResumeReview } from '@/lib/ai/provider'
import { scoreResumeAgainstJob, type AtsScore } from '@/lib/ats'
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

function Chip({ term, tone }: { term: string; tone: 'good' | 'bad' }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'good'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
      )}
    >
      {term}
    </span>
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
        {!resumeText.trim() && (
          <Banner tone="warn">
            There&rsquo;s no resume text to score yet. Upload a CV under <strong>Profile →
            Resume</strong>, or paste the text there.
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

        {result.missing.length ? (
          <div>
            <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              In the posting, not in your resume
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {result.missing.map((term) => (
                <Chip key={term} term={term} tone="bad" />
              ))}
            </div>
          </div>
        ) : null}

        {result.notes.length ? (
          <ul className="flex list-disc flex-col gap-1.5 pl-4 text-xs text-zinc-600 dark:text-zinc-400">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
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
