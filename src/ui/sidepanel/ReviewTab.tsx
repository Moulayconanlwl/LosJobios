import { useEffect, useMemo, useState } from 'react'
import type { ValidationError } from '@/content/validation'
import { sendToBackground, type FieldProposal, type SiteReport } from '@/lib/messaging'
import { Badge } from '../components/badge'
import { CheckIcon, DocIcon, SearchIcon, SparkIcon } from '../components/icons'
import { Banner, Button, Input, Select, Textarea, cx } from '../components/ui'
import { useProfile, useTranslation } from '../hooks'

/**
 * The review workspace.
 *
 * Everything here exists so that filling a form is something the user does
 * rather than something that happens to them. The panel scans, shows every
 * proposed value with where it came from, and writes only what survives that
 * review — which is why it lives in a side panel rather than the popup: a
 * popup closes the moment you click the form you are trying to check.
 *
 * The sequence is deliberately one-way. Nothing is written by scanning, and
 * the write button says how many fields it is about to touch, so the number
 * on the button is the promise being made.
 */

type Stage = 'idle' | 'scanning' | 'review' | 'done' | 'error'

function sourceTone(source: FieldProposal['source']) {
  switch (source) {
    case 'bank':
      return 'good' as const
    case 'profile':
    case 'heuristic':
      return 'info' as const
    case 'ai':
      return 'ai' as const
    default:
      return 'neutral' as const
  }
}

function sourceLabel(source: FieldProposal['source']): string {
  switch (source) {
    case 'bank':
      return 'saved answer'
    case 'profile':
    case 'heuristic':
      return 'profile'
    case 'ai':
      return 'AI draft'
    default:
      return 'unresolved'
  }
}

export function ReviewTab() {
  const { data: profile } = useProfile()
  const t = useTranslation()

  const [stage, setStage] = useState<Stage>('idle')
  const [site, setSite] = useState<SiteReport | null>(null)
  const [proposals, setProposals] = useState<FieldProposal[]>([])
  const [skipped, setSkipped] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [errors, setErrors] = useState<ValidationError[]>([])

  const selectedCount = useMemo(
    () => proposals.filter((proposal) => proposal.selected && proposal.value.trim()).length,
    [proposals],
  )

  // Report what the page is as soon as the panel opens, so the user knows
  // where they stand before pressing anything.
  useEffect(() => {
    let cancelled = false
    void sendToBackground('panel/site-report')
      .then((report) => {
        if (!cancelled && report.ok && report.site) setSite(report.site)
      })
      .catch(() => {
        // An unsupported page simply has nothing to report.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const scan = async () => {
    setStage('scanning')
    setError('')
    setResult('')
    setErrors([])
    try {
      const response = await sendToBackground('panel/plan-fields')
      if (!response.ok) throw new Error(response.error)
      if (!response.plan) throw new Error('Could not read this page.')

      setProposals(response.plan.proposals)
      setSkipped(response.plan.skipped)
      setSite(response.plan.site)
      setStage('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  const draft = async () => {
    setDrafting(true)
    setError('')
    try {
      const response = await sendToBackground('panel/draft-answers')
      if (!response.ok) throw new Error(response.error)
      if (!response.proposals) throw new Error('Could not draft answers.')

      // Drafts replace the unresolved entry for the same field rather than
      // appearing twice.
      setProposals((current) => {
        const drafted = new Map(response.proposals?.map((p) => [p.handle, p]) ?? [])
        const merged = current.map((existing) => drafted.get(existing.handle) ?? existing)
        for (const [handle, proposal] of drafted) {
          if (!merged.some((entry) => entry.handle === handle)) merged.push(proposal)
        }
        return merged
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDrafting(false)
    }
  }

  const fill = async () => {
    setError('')
    try {
      const response = await sendToBackground('panel/apply-plan', { decisions: proposals })
      if (!response.ok) throw new Error(response.error)
      if (!response.result) throw new Error('Could not fill the form.')

      const { filled, failed, skipped: left, errors: rejected } = response.result
      setResult(
        `Filled ${filled} field${filled === 1 ? '' : 's'}.` +
          (left.length ? ` Left ${left.length} for you.` : '') +
          (failed ? ` ${failed} could not be written.` : ''),
      )
      setErrors(rejected)
      setStage('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStage('error')
    }
  }

  const update = (handle: string, patch: Partial<FieldProposal>) => {
    setProposals((current) =>
      current.map((proposal) => (proposal.handle === handle ? { ...proposal, ...patch } : proposal)),
    )
  }

  const setAll = (selected: boolean) => {
    setProposals((current) =>
      current.map((proposal) =>
        proposal.value.trim() ? { ...proposal, selected } : proposal,
      ),
    )
  }

  const profileThin = profile ? !profile.firstName || !profile.email : false

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-zinc-50 p-3 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex items-center gap-2">
        <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-indigo-600 text-xs font-bold text-white">
          LJ
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{t('panel.title')}</h1>
          <p className="truncate text-xs text-zinc-500">{t('panel.subtitle')}</p>
        </div>
      </header>

      {site ? <SiteBanner site={site} /> : null}

      {profileThin ? (
        <Banner tone="warn">
          {t('panel.profileThin')}{' '}
          <button className="font-semibold underline" onClick={() => void chrome.runtime.openOptionsPage()}>
            {t('panel.fillItIn')}
          </button>
          .
        </Banner>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={stage === 'scanning'} onClick={() => void scan()}>
          <SearchIcon className="h-3.5 w-3.5" />
          {stage === 'scanning' ? t('panel.scanning') : t('panel.scan')}
        </Button>
        {stage === 'review' ? (
          <Button variant="secondary" size="sm" disabled={drafting} onClick={() => void draft()}>
            <SparkIcon className="h-3.5 w-3.5" />
            {drafting ? t('panel.drafting') : t('panel.draft')}
          </Button>
        ) : null}
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {result ? <Banner tone="success">{result}</Banner> : null}

      {errors.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
            {t('panel.rejected')} ({errors.length})
          </p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs text-amber-900 dark:text-amber-200">
            {errors.map((entry, index) => (
              <li key={index}>
                {entry.fieldLabel ? <strong>{entry.fieldLabel}: </strong> : null}
                {entry.message}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-amber-800 dark:text-amber-300">
            {t('panel.rejectedHint')}
          </p>
        </div>
      ) : null}

      {stage === 'idle' ? (
        <EmptyState />
      ) : null}

      {stage === 'review' || stage === 'done' ? (
        <>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>
              {proposals.length} proposed
              {skipped ? ` · ${skipped} already filled` : ''}
            </span>
            <span className="flex gap-2">
              <button className="underline" onClick={() => setAll(true)}>
                {t('panel.selectAll')}
              </button>
              <button className="underline" onClick={() => setAll(false)}>
                {t('panel.selectNone')}
              </button>
            </span>
          </div>

          <ul className="flex flex-col gap-2">
            {proposals.map((proposal) => (
              <ProposalRow key={proposal.handle} proposal={proposal} onChange={update} />
            ))}
          </ul>

          {proposals.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">
              {t('panel.nothingLeft')}
            </p>
          ) : null}
        </>
      ) : null}

      {stage === 'review' && proposals.length > 0 ? (
        <div className="sticky bottom-0 -mx-3 mt-auto border-t border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <Button
            variant="primary"
            className="w-full"
            disabled={selectedCount === 0}
            onClick={() => void fill()}
          >
            <CheckIcon className="h-4 w-4" />
            {selectedCount === 0
              ? t('panel.nothingSelected')
              : `Fill ${selectedCount} selected field${selectedCount === 1 ? '' : 's'}`}
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-zinc-500">
            {t('panel.neverSubmits')}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function SiteBanner({ site }: { site: SiteReport }) {
  const tone = site.kind === 'no-form' ? 'warn' : site.kind === 'known-ats' ? 'success' : 'info'
  return <Banner tone={tone}>{site.message}</Banner>
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
      <DocIcon className="h-8 w-8 text-zinc-300 dark:text-zinc-700" />
      <p className="text-sm font-medium">Open an application form</p>
      <p className="max-w-[16rem] text-xs text-zinc-500">
        Press <strong>Scan this form</strong> and every field it can fill is listed here first,
        with where each value came from. You decide what gets written.
      </p>
    </div>
  )
}

function ProposalRow({
  proposal,
  onChange,
}: {
  proposal: FieldProposal
  onChange: (handle: string, patch: Partial<FieldProposal>) => void
}) {
  const unresolved = !proposal.value.trim()
  const isLong = proposal.kind === 'textarea' || proposal.value.length > 60

  return (
    <li
      className={cx(
        'rounded-xl border p-2.5 transition-colors',
        proposal.selected
          ? 'border-indigo-300 bg-white dark:border-indigo-800 dark:bg-zinc-900'
          : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40',
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 flex-none rounded"
          checked={proposal.selected}
          disabled={unresolved}
          aria-label={`Fill ${proposal.label}`}
          onChange={(e) => onChange(proposal.handle, { selected: e.target.checked })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-medium">{proposal.label}</span>
            {proposal.required ? <Badge tone="warn">required</Badge> : null}
            <Badge tone={sourceTone(proposal.source)}>{sourceLabel(proposal.source)}</Badge>
          </div>

          <p className="mt-0.5 text-[11px] text-zinc-500">{proposal.reason}</p>

          {proposal.attachment ? (
            <p className="mt-1.5 rounded-md bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
              {proposal.value}
            </p>
          ) : unresolved ? (
            <Input
              className="mt-1.5 text-xs"
              placeholder="Type an answer to include this field…"
              value={proposal.value}
              onChange={(e) =>
                onChange(proposal.handle, { value: e.target.value, selected: Boolean(e.target.value.trim()) })
              }
            />
          ) : proposal.options.length ? (
            <Select
              className="mt-1.5 text-xs"
              value={proposal.value}
              onChange={(e) => onChange(proposal.handle, { value: e.target.value })}
            >
              {proposal.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          ) : isLong ? (
            <Textarea
              rows={4}
              className="mt-1.5 text-xs"
              value={proposal.value}
              onChange={(e) => onChange(proposal.handle, { value: e.target.value })}
            />
          ) : (
            <Input
              className="mt-1.5 text-xs"
              value={proposal.value}
              onChange={(e) => onChange(proposal.handle, { value: e.target.value })}
            />
          )}
        </div>
      </div>
    </li>
  )
}
