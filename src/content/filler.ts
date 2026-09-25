import { sendToBackground } from '@/lib/messaging'
import type { AnswerResponse } from '@/lib/messaging'
import { CONFIDENCE_FLOOR, valueForKey } from '@/lib/fieldrules'
import {
  attachFile,
  fillAriaCombobox,
  fillCheckbox,
  fillRadio,
  fillSelect,
  fillText,
  isPlaceholderOption,
} from './dom/fill'
import { pause } from './dom/human'
import type { DetectedField } from './fields'
import type { ApplyContext } from './adapters/types'

/**
 * Filling one detected field, and then a whole form.
 *
 * This is the single place that decides *what* goes in a field and *how* it
 * gets written there. Both the universal autofill and the LinkedIn Easy Apply
 * driver run through it, so a fix to option matching or file upload improves
 * both at once.
 */

export type FillStatus =
  | 'filled'
  /** Already had a value, or we intentionally left it alone. */
  | 'skipped'
  /** Nothing could answer it. Blocks the run if it was required. */
  | 'unanswered'
  | 'failed'

export type FillResult = {
  field: DetectedField
  status: FillStatus
  /** Which tier produced the value, for the stats shown after a run. */
  source: AnswerResponse['source'] | 'profile'
}

/** True when a control already holds a usable value. */
function alreadyFilled(field: DetectedField): boolean {
  const el = field.el

  if (el instanceof HTMLInputElement) {
    if (el.type === 'radio') return field.group.some((r) => r.checked)
    if (el.type === 'checkbox') return false // a cleared box is a real answer
    if (el.type === 'file') return (el.files?.length ?? 0) > 0
    return el.value.trim() !== ''
  }

  if (el instanceof HTMLTextAreaElement) return el.value.trim() !== ''

  if (el instanceof HTMLSelectElement) {
    const selected = el.options[el.selectedIndex]
    if (!selected) return false
    // Sitting on "Please select" is not an answer.
    return !isPlaceholderOption(selected)
  }

  if (el.getAttribute('role') === 'combobox') {
    return (el.getAttribute('aria-expanded') !== 'true' && (el.textContent ?? '').trim() !== '')
  }

  return false
}

/**
 * Work out what should go in this field.
 *
 * Profile-backed fields resolve locally — there's no reason to round-trip to
 * the background to learn your own email address. Everything else becomes a
 * question for the three-tier resolver.
 */
async function resolveValue(
  field: DetectedField,
  ctx: ApplyContext,
): Promise<{ value: string | null; source: FillResult['source']; confidence: number }> {
  // A high-confidence profile match, with no options to satisfy, is a direct
  // hit — except a cover letter, which needs a background round-trip so it
  // can be generated fresh for this job rather than read verbatim off the
  // profile (see resolveCoverLetter in lib/answers.ts).
  if (
    field.key &&
    field.key !== 'coverLetter' &&
    field.confidence >= 0.65 &&
    field.options.length === 0
  ) {
    const value = valueForKey(field.key, ctx.profile)
    if (value !== null) return { value, source: 'profile', confidence: field.confidence }
  }

  if (!field.label) return { value: null, source: 'none', confidence: 0 }

  const response = await sendToBackground('answers/resolve', {
    question: field.label,
    kind: field.kind,
    options: field.options,
    required: field.required,
    job: ctx.job,
    jobDescription: ctx.jobDescription,
  })

  return {
    value: response.answer,
    source: response.source,
    confidence: response.confidence,
  }
}

/** Write a resolved value into the control, using the right mechanism per kind. */
async function applyValue(
  field: DetectedField,
  value: string,
  ctx: ApplyContext,
): Promise<boolean> {
  const el = field.el
  const { signal } = ctx

  if (el instanceof HTMLSelectElement) return fillSelect(el, value)

  if (el instanceof HTMLInputElement) {
    switch (el.type) {
      case 'radio':
        return fillRadio(el, value, signal)
      case 'checkbox': {
        // Consent and acknowledgement boxes read as yes/no questions.
        const wantChecked = /^(yes|true|1|i agree|agree|accept)$/i.test(value.trim())
        return fillCheckbox(el, wantChecked, signal)
      }
      case 'file': {
        if (!ctx.profile.resume) return false
        return attachFile(el, ctx.profile.resume)
      }
      default:
        // Type into short fields so autocomplete widgets open; paste long ones.
        await fillText(el, value, { type: field.options.length === 0 && value.length <= 40, signal })
        return true
    }
  }

  if (el instanceof HTMLTextAreaElement) {
    await fillText(el, value, { signal })
    return true
  }

  if (el.getAttribute('role') === 'combobox') {
    return fillAriaCombobox(el, value, signal)
  }

  if (el.getAttribute('contenteditable') === 'true') {
    el.focus()
    el.textContent = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  return false
}

export async function fillField(field: DetectedField, ctx: ApplyContext): Promise<FillResult> {
  if (ctx.signal.aborted) return { field, status: 'skipped', source: 'none' }

  // Never overwrite an answer that's already there. On a multi-step modal the
  // same fields are re-scanned on each pass, and a resume attached on step one
  // must not be attached again on step two.
  if (alreadyFilled(field)) return { field, status: 'skipped', source: 'none' }

  if (field.kind === 'file') {
    // The résumé goes in the résumé slot, or in an unlabelled "attach a file"
    // one — never in an upload that named a different document. A form with
    // separate Résumé and Cover letter uploads would otherwise get the same
    // PDF in both, and the wrong one is worse than an empty one the user is
    // asked about.
    if (field.key !== null && field.key !== 'resume') {
      return { field, status: 'unanswered', source: 'none' }
    }
    if (!ctx.profile.resume) return { field, status: 'unanswered', source: 'none' }
    const ok = attachFile(field.el as HTMLInputElement, ctx.profile.resume)
    return { field, status: ok ? 'filled' : 'failed', source: 'profile' }
  }

  const { value, source, confidence } = await resolveValue(field, ctx)

  if (value === null) return { field, status: 'unanswered', source: 'none' }

  // A weak answer to a required field is worse than no answer: it gets
  // submitted and can't be taken back. Escalate to the user instead.
  if (field.required && confidence < CONFIDENCE_FLOOR) {
    return { field, status: 'unanswered', source }
  }

  try {
    const ok = await applyValue(field, value, ctx)
    return { field, status: ok ? 'filled' : 'failed', source }
  } catch (err) {
    if (ctx.signal.aborted) return { field, status: 'skipped', source: 'none' }
    console.warn('[LosJobios] fill failed', field.label, err)
    return { field, status: 'failed', source }
  }
}

export type FormFillSummary = {
  filled: number
  skipped: number
  failed: number
  /** Required fields nothing could answer — these block a submit. */
  blocking: DetectedField[]
  /** All unanswered fields, required or not. */
  unanswered: DetectedField[]
  results: FillResult[]
}

/** Fill every field in order, pacing between them. */
export async function fillFields(
  fields: DetectedField[],
  ctx: ApplyContext,
): Promise<FormFillSummary> {
  const summary: FormFillSummary = {
    filled: 0,
    skipped: 0,
    failed: 0,
    blocking: [],
    unanswered: [],
    results: [],
  }

  for (const field of fields) {
    if (ctx.signal.aborted) break

    const result = await fillField(field, ctx)
    summary.results.push(result)

    switch (result.status) {
      case 'filled':
        summary.filled += 1
        await pause(ctx.settings.minActionDelayMs, ctx.settings.maxActionDelayMs, ctx.signal)
        break
      case 'skipped':
        summary.skipped += 1
        break
      case 'failed':
        summary.failed += 1
        summary.unanswered.push(field)
        if (field.required) summary.blocking.push(field)
        break
      case 'unanswered':
        summary.unanswered.push(field)
        if (field.required) summary.blocking.push(field)
        break
    }
  }

  return summary
}
