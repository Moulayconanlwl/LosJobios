import { useEffect, useMemo, useState } from 'react'
import { GeminiProvider, hasGeminiPermission } from '@/lib/ai/gemini'
import { scoreResumeAgainstJob, type AtsScore } from '@/lib/ats'
import { sendToBackground } from '@/lib/messaging'
import { renderResume, resumeToText } from '@/lib/tailored-resume'
import type { Profile, SavedJob, Settings } from '@/lib/schema'
import { deleteSavedJob, putSavedJob } from '@/lib/storage'
import { Badge } from '../components/badge'
import { Banner, Button, Card, Input, cx } from '../components/ui'
import { CopyIcon, DocIcon, DownloadIcon, SearchIcon, SparkIcon, TrashIcon } from '../components/icons'
import { useProfile, useSavedJobs, useSettings } from '../hooks'

/**
 * The jobs library, and everything you can make from one posting.
 *
 * A job arrives here from a run, from "Scan this page", or from scoring one
 * in the popup. Selecting it is what gives the cover letter, the tailored
 * resume and the ATS score something specific to be about — all three are
 * useless against a job title alone, which is why fetching the description
 * is the first thing this offers when a posting doesn't have one yet.
 */

type Tab = 'description' | 'letter' | 'resume' | 'score'

function timeAgo(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

async function buildProvider(settings: Settings | null): Promise<GeminiProvider> {
  if (!settings?.ai.apiKey || !settings.ai.model || !(await hasGeminiPermission())) {
    throw new Error('Set up a Gemini key under Settings → AI first.')
  }
  return new GeminiProvider(settings.ai.apiKey, settings.ai.model)
}

function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
    >
      <CopyIcon className="h-3.5 w-3.5" />
      {done ? 'Copied' : label}
    </Button>
  )
}

export function JobsSection() {
  const { data: jobs } = useSavedJobs()
  const { data: profile } = useProfile()
  const { data: settings } = useSettings()

  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('description')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return jobs
    return jobs.filter((job) =>
      `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(needle),
    )
  }, [jobs, query])

  // Keep a selection that still exists, and select the first job by default.
  useEffect(() => {
    if (selectedId && jobs.some((job) => job.id === selectedId)) return
    setSelectedId(visible[0]?.id ?? null)
  }, [jobs, visible, selectedId])

  const selected = jobs.find((job) => job.id === selectedId) ?? null

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Saved jobs"
        description="Everything a run has seen, plus anything you scanned or scored. Pick one to write materials for it."
        actions={
          <div className="flex items-center gap-2">
            <Input
              value={query}
              placeholder="Search…"
              className="w-44"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        }
      >
        {jobs.length === 0 ? (
          <EmptyJobs />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <ul className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto pr-1">
              {visible.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(job.id)}
                    className={cx(
                      'w-full rounded-xl border px-3 py-2.5 text-left transition-colors',
                      job.id === selectedId
                        ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950'
                        : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800',
                    )}
                  >
                    <div className="truncate text-sm font-medium">{job.title || 'Untitled role'}</div>
                    <div className="truncate text-xs text-zinc-500">
                      {job.company || 'Unknown company'}
                      {job.location ? ` · ${job.location}` : ''}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {job.description ? (
                        <Badge tone="good">description</Badge>
                      ) : (
                        <Badge tone="neutral">no description</Badge>
                      )}
                      {job.coverLetter ? <Badge tone="ai">letter</Badge> : null}
                      {job.resume ? <Badge tone="ai">resume</Badge> : null}
                      <span className="ml-auto text-[11px] text-zinc-400">{timeAgo(job.savedAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
              {visible.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-zinc-500">
                  Nothing matches that search.
                </li>
              ) : null}
            </ul>

            {selected ? (
              <JobDetail
                key={selected.id}
                job={selected}
                profile={profile}
                settings={settings}
                tab={tab}
                onTab={setTab}
              />
            ) : null}
          </div>
        )}
      </Card>
    </div>
  )
}

function EmptyJobs() {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const scan = async () => {
    setBusy(true)
    setNote('')
    try {
      const result = await sendToBackground('jobs/scan-active-tab')
      setNote(
        result.ok
          ? `Saved ${result.added ?? 0} new job${result.added === 1 ? '' : 's'} of ${result.found ?? 0} found.`
          : (result.error ?? 'Could not scan that page.'),
      )
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="py-10 text-center">
      <SearchIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-700" />
      <p className="mt-3 text-sm font-medium">No saved jobs yet.</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
        Open a LinkedIn job search and press <strong>Scan this page for jobs</strong> in the
        extension popup — or just start a run, and everything it sees lands here.
      </p>
      <Button variant="secondary" className="mt-4" disabled={busy} onClick={() => void scan()}>
        {busy ? 'Scanning…' : 'Scan the page I have open'}
      </Button>
      {note ? <p className="mt-3 text-xs text-zinc-500">{note}</p> : null}
    </div>
  )
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'description', label: 'Posting' },
  { id: 'letter', label: 'Cover letter' },
  { id: 'resume', label: 'Resume' },
  { id: 'score', label: 'ATS score' },
]

function JobDetail({
  job,
  profile,
  settings,
  tab,
  onTab,
}: {
  job: SavedJob
  profile: Profile | null
  settings: Settings | null
  tab: Tab
  onTab: (tab: Tab) => void
}) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const resumeText = profile?.resume?.text ?? ''

  const score: AtsScore | null = useMemo(() => {
    if (!profile || !job.description) return null
    return scoreResumeAgainstJob({
      resumeText,
      profile,
      jobTitle: job.title,
      jobDescription: job.description,
    })
  }, [profile, job.description, job.title, resumeText])

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  const fetchDescription = () =>
    run('description', async () => {
      const result = await sendToBackground('jobs/fetch-description', { id: job.id })
      if (!result.ok) throw new Error(result.error)
    })

  const writeLetter = () =>
    run('letter', async () => {
      if (!profile) throw new Error('Profile is still loading.')
      const provider = await buildProvider(settings)
      const { text } = await provider.generateCoverLetter({
        profile,
        job: {
          externalId: job.externalId,
          title: job.title,
          company: job.company,
          location: job.location,
          url: job.url,
        },
        jobDescription: job.description,
      })
      await putSavedJob({ ...job, coverLetter: text, coverLetterAt: Date.now() })
      onTab('letter')
    })

  const writeResume = () =>
    run('resume', async () => {
      if (!profile) throw new Error('Profile is still loading.')
      const provider = await buildProvider(settings)
      const generated = await provider.generateResume({
        profile,
        resumeText,
        jobTitle: job.title,
        jobDescription: job.description,
        missingKeywords: score?.missing ?? [],
      })
      await putSavedJob({
        ...job,
        resume: { ...generated, generatedAt: Date.now() },
      })
      onTab('resume')
    })

  return (
    <div className="min-w-0 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{job.title || 'Untitled role'}</h3>
          <p className="truncate text-xs text-zinc-500">
            {job.company || 'Unknown company'}
            {job.location ? ` · ${job.location}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {job.url ? (
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Open posting
            </a>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            title="Remove from saved jobs"
            onClick={() => void deleteSavedJob(job.id)}
          >
            <TrashIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
            className={cx(
              'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
              tab === item.id
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {!job.description ? (
        <Banner tone="warn">
          This posting was scraped from a list, so only its title came with it. Fetch the
          description and everything else on this panel starts working.
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={busy !== ''}
            onClick={() => void fetchDescription()}
          >
            {busy === 'description' ? 'Opening the posting…' : 'Fetch description'}
          </Button>
        </Banner>
      ) : null}

      {error ? (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      ) : null}

      <div className="mt-3">
        {tab === 'description' ? (
          job.description ? (
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
              {job.description}
            </pre>
          ) : (
            <p className="text-xs text-zinc-500">Nothing read from this posting yet.</p>
          )
        ) : null}

        {tab === 'letter' ? (
          <Material
            body={job.coverLetter}
            emptyHint="Written fresh for this posting, from your profile and its description."
            fileName={`cover-letter-${(job.company || 'role').toLowerCase().replace(/\W+/g, '-')}.txt`}
            actionLabel={job.coverLetter ? 'Write it again' : 'Write cover letter'}
            busy={busy === 'letter'}
            disabled={busy !== '' || !job.description}
            onGenerate={() => void writeLetter()}
          />
        ) : null}

        {tab === 'resume' ? (
          <ResumePanel
            job={job}
            profile={profile}
            busy={busy === 'resume'}
            disabled={busy !== '' || !job.description}
            onGenerate={() => void writeResume()}
          />
        ) : null}

        {tab === 'score' ? (
          score ? (
            <ScoreSummary score={score} />
          ) : (
            <p className="text-xs text-zinc-500">
              {job.description
                ? 'Add a resume under Settings → Profile to score against this posting.'
                : 'Fetch the description first.'}
            </p>
          )
        ) : null}
      </div>
    </div>
  )
}

function Material({
  body,
  emptyHint,
  fileName,
  actionLabel,
  busy,
  disabled,
  onGenerate,
}: {
  body: string
  emptyHint: string
  fileName: string
  actionLabel: string
  busy: boolean
  disabled: boolean
  onGenerate: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={disabled} onClick={onGenerate}>
          <SparkIcon className="h-3.5 w-3.5" />
          {busy ? 'Writing…' : actionLabel}
        </Button>
        {body ? (
          <>
            <CopyButton text={body} />
            <Button size="sm" variant="secondary" onClick={() => download(fileName, body)}>
              <DownloadIcon className="h-3.5 w-3.5" />
              Download
            </Button>
          </>
        ) : null}
      </div>

      {body ? (
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-sans text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-950">
          {body}
        </pre>
      ) : (
        <p className="text-xs text-zinc-500">{emptyHint}</p>
      )}
    </div>
  )
}

function ResumePanel({
  job,
  profile,
  busy,
  disabled,
  onGenerate,
}: {
  job: SavedJob
  profile: Profile | null
  busy: boolean
  disabled: boolean
  onGenerate: () => void
}) {
  if (!profile) return null

  const rendered = job.resume ? renderResume(profile, job.resume) : null
  const asText = rendered ? resumeToText(rendered) : ''

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={disabled} onClick={onGenerate}>
          <SparkIcon className="h-3.5 w-3.5" />
          {busy ? 'Rewriting…' : job.resume ? 'Rewrite for this job' : 'Tailor my resume'}
        </Button>
        {asText ? (
          <>
            <CopyButton text={asText} label="Copy as text" />
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                download(
                  `resume-${(job.company || 'role').toLowerCase().replace(/\W+/g, '-')}.txt`,
                  asText,
                )
              }
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              Download
            </Button>
          </>
        ) : null}
      </div>

      {!rendered ? (
        <p className="text-xs text-zinc-500">
          Rewrites your real roles to lead with what this posting asks for. It never adds
          experience you don&rsquo;t have — companies, titles and dates come straight from your
          profile, and anything the posting wants that your history can&rsquo;t back up is listed
          as a gap instead.
        </p>
      ) : (
        <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div>
            <p className="text-sm font-semibold">{rendered.name || 'Your name'}</p>
            {rendered.contact.length ? (
              <p className="text-xs text-zinc-500">{rendered.contact.join(' | ')}</p>
            ) : null}
          </div>

          {rendered.summary ? (
            <section>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Summary
              </h4>
              <p className="text-xs leading-relaxed">{rendered.summary}</p>
            </section>
          ) : null}

          {rendered.skills.length ? (
            <section>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Skills
              </h4>
              <div className="flex flex-wrap gap-1">
                {rendered.skills.map((skill) => (
                  <span
                    key={skill}
                    className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] dark:bg-zinc-800"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {rendered.roles.length ? (
            <section>
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Experience
              </h4>
              <div className="flex flex-col gap-3">
                {rendered.roles.map((role, index) => (
                  <div key={`${role.company}-${index}`}>
                    <p className="text-xs font-medium">
                      {[role.title, role.company].filter(Boolean).join(' — ')}
                    </p>
                    {role.dates || role.location ? (
                      <p className="text-[11px] text-zinc-500">
                        {[role.location, role.dates].filter(Boolean).join(' | ')}
                      </p>
                    ) : null}
                    <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-xs leading-relaxed">
                      {role.bullets.map((bullet, i) => (
                        <li key={i}>{bullet}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {rendered.education.length ? (
            <section>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                Education
              </h4>
              <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs">
                {rendered.education.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {rendered.notes.length ? (
            <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
              <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                <DocIcon className="h-3.5 w-3.5" />
                What changed, and what it couldn&rsquo;t claim
              </h4>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-amber-900 dark:text-amber-200">
                {rendered.notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  )
}

function ScoreSummary({ score }: { score: AtsScore }) {
  const tone =
    score.score >= 75
      ? 'text-emerald-600 dark:text-emerald-400'
      : score.score >= 50
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <span className={cx('text-4xl font-semibold tabular-nums', tone)}>{score.score}</span>
        <span className="pb-1.5 text-xs text-zinc-500">out of 100</span>
      </div>

      {score.missing.length ? (
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            In the posting, not in your resume
          </h4>
          <div className="flex flex-wrap gap-1">
            {score.missing.map((term) => (
              <span
                key={term}
                className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              >
                {term}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <p className="text-xs text-zinc-500">
        The full breakdown, with what to do about it, lives under{' '}
        <strong>Settings → ATS score</strong>.
      </p>
    </div>
  )
}
