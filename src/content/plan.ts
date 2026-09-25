import { CONFIDENCE_FLOOR } from '@/lib/fieldrules'
import type { FieldProposal, FieldSource } from '@/lib/messaging'
import type { ApplyContext } from './adapters/types'
import type { DetectedField } from './fields'
import { applyValue, isFieldFilled, resolveFieldValue } from './filler'

/**
 * Proposing what to fill, separately from filling it.
 *
 * The run engine resolves a value and writes it in one motion, which is right
 * for a supervised run but wrong for a form the user is standing in front of:
 * a misclassified field lands in a real employer's application with no
 * opportunity to catch it. Splitting the two means the same resolution logic
 * can produce a *proposal* the user reviews, edits, or drops, and only what
 * survives that review is ever written.
 *
 * The default matters more than the mechanism. Anything the resolver was not
 * confident about arrives **deselected**, so the safe outcome is what happens
 * if the user simply presses the button — skipping an uncertain field, never
 * writing a guess into a form on someone's behalf.
 */

/** A stable handle for a field across the propose → review → apply round trip. */
const HANDLE = 'data-losjobios-field'

let handleSeq = 0

function handleFor(el: HTMLElement): string {
  const existing = el.getAttribute(HANDLE)
  if (existing) return existing

  handleSeq += 1
  const id = `f${handleSeq}`
  el.setAttribute(HANDLE, id)
  return id
}

function findByHandle(id: string, fields: DetectedField[]): DetectedField | null {
  return fields.find((field) => field.el.getAttribute(HANDLE) === id) ?? null
}

/**
 * Should this proposal be ticked when the review list opens?
 *
 * Confidence alone isn't the test. A value the answer bank or the profile
 * supplied is something the user already stated; a value a model produced for
 * a required field is not, and starts unticked however sure the model sounded.
 */
function defaultSelected(
  source: FieldSource,
  confidence: number,
  field: DetectedField,
): boolean {
  if (source === 'none') return false
  if (confidence < CONFIDENCE_FLOOR) return false
  // An AI draft in a required field is exactly where a confident-sounding
  // wrong answer does the most damage.
  if (source === 'ai' && field.required) return false
  return true
}

function reasonFor(source: FieldSource, confidence: number): string {
  switch (source) {
    case 'bank':
      return 'You answered this before'
    case 'heuristic':
    case 'profile':
      return 'From your profile'
    case 'ai':
      return confidence >= CONFIDENCE_FLOOR ? 'AI draft — check it' : 'AI draft, low confidence'
    default:
      return 'Nothing could answer this'
  }
}

export type FieldPlan = {
  proposals: FieldProposal[]
  /** Fields that already hold a value, reported but never proposed. */
  skipped: number
}

/**
 * Work out what *would* be filled, without touching the page.
 *
 * Read-only by construction: it resolves values and tags elements with a
 * handle so the later write can find them again, but writes no user data into
 * any control.
 */
export async function planFields(
  fields: DetectedField[],
  ctx: ApplyContext,
): Promise<FieldPlan> {
  const proposals: FieldProposal[] = []
  let skipped = 0

  for (const field of fields) {
    if (ctx.signal.aborted) break

    if (isFieldFilled(field)) {
      skipped += 1
      continue
    }

    // A file input is offered as an attachment, not as a text proposal — it
    // has no value a user can read or edit in a review list.
    if (field.kind === 'file') {
      if (field.key !== null && field.key !== 'resume') continue
      if (!ctx.profile.resume) continue

      proposals.push({
        handle: handleFor(field.el),
        label: field.label || 'Attachment',
        kind: field.kind,
        required: field.required,
        options: [],
        value: ctx.profile.resume.fileName,
        source: 'profile',
        confidence: 0.9,
        reason: 'Your stored CV',
        selected: true,
        attachment: true,
      })
      continue
    }

    const { value, source, confidence } = await resolveFieldValue(field, ctx)

    proposals.push({
      handle: handleFor(field.el),
      label: field.label || '(unlabelled field)',
      kind: field.kind,
      required: field.required,
      options: field.options,
      value: value ?? '',
      source,
      confidence,
      reason: reasonFor(source, confidence),
      selected: value !== null && defaultSelected(source, confidence, field),
      attachment: false,
    })
  }

  return { proposals, skipped }
}

/** Kinds where a written answer is the point, rather than a choice. */
const FREE_TEXT: ReadonlySet<string> = new Set(['textarea', 'text', 'unknown'])

/**
 * Draft the open-ended questions this form asks and nothing else.
 *
 * Restricted to free-text fields with no options: a select or a radio group
 * has a right answer to be matched, not written, and drafting prose into one
 * would be nonsense. Long labels are the signal that a "text" input is really
 * a question rather than a name box.
 *
 * Everything produced here is a draft. It arrives unselected, is labelled as
 * a draft in the review list, and is editable before it can be written.
 */
export async function draftOpenQuestions(
  fields: DetectedField[],
  ctx: ApplyContext,
): Promise<FieldProposal[]> {
  const proposals: FieldProposal[] = []

  for (const field of fields) {
    if (ctx.signal.aborted) break
    if (isFieldFilled(field)) continue
    if (field.options.length > 0) continue
    if (!FREE_TEXT.has(field.kind)) continue
    if (!field.label) continue

    // A short label on a single-line input is a form field ("First name"),
    // not a question worth drafting an answer to.
    const looksLikeQuestion = field.kind === 'textarea' || field.label.length > 40
    if (!looksLikeQuestion) continue

    const { value, source, confidence } = await resolveFieldValue(field, ctx)
    if (value === null || !value.trim()) continue

    proposals.push({
      handle: handleFor(field.el),
      label: field.label,
      kind: field.kind,
      required: field.required,
      options: [],
      value,
      source,
      confidence,
      reason: source === 'ai' ? 'AI draft — read it before you keep it' : reasonFor(source, confidence),
      // A draft is never pre-approved, however confident its source.
      selected: false,
      attachment: false,
    })
  }

  return proposals
}

export type ApplyPlanResult = {
  filled: number
  failed: number
  /** Labels of fields that were offered but the user chose to leave. */
  skipped: string[]
}

/**
 * Write back exactly what the user approved — no more.
 *
 * Deliberately takes the decisions rather than re-deriving them: whatever the
 * resolver would say now, this writes the values that were on screen when the
 * user pressed the button. Re-resolving could substitute a different value for
 * the one they actually read and approved.
 */
export async function applyPlan(
  decisions: FieldProposal[],
  fields: DetectedField[],
  ctx: ApplyContext,
): Promise<ApplyPlanResult> {
  const result: ApplyPlanResult = { filled: 0, failed: 0, skipped: [] }

  for (const decision of decisions) {
    if (ctx.signal.aborted) break

    if (!decision.selected) {
      result.skipped.push(decision.label)
      continue
    }

    const field = findByHandle(decision.handle, fields)
    if (!field) {
      result.failed += 1
      continue
    }

    try {
      const ok = await applyValue(field, decision.value, ctx)
      if (ok) result.filled += 1
      else result.failed += 1
    } catch (err) {
      console.warn('[LosJobios] could not write an approved field', decision.label, err)
      result.failed += 1
    }
  }

  return result
}
