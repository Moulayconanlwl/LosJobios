import { z } from 'zod'

/**
 * A local record of what the extension did on your behalf.
 *
 * Two reasons this exists, and the second is the one that matters. The first
 * is debugging: when a run goes wrong, "which job, which step, what did it
 * say" is the only way to find out. The second is that software which types
 * on your behalf into other people's forms should be able to show you what
 * it typed — an autofill tool with no record is asking for trust it hasn't
 * earned.
 *
 * **It records what happened, never what was written.** Entries carry field
 * *labels* and counts; they never carry a field's value. A log of answers
 * would be a second copy of the most sensitive data here, sitting in a place
 * the user doesn't think of as storage — so the log is deliberately built so
 * that leaking it would reveal activity, not content.
 */

export const ACTIVITY_KINDS = [
  'run-started',
  'run-finished',
  'applied',
  'skipped',
  'failed',
  'blocked',
  'fields-filled',
  'fields-reviewed',
  'draft-generated',
  'document-generated',
  'job-saved',
  'data-exported',
  'data-restored',
  'data-cleared',
] as const

export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

export const activityEntrySchema = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.enum(ACTIVITY_KINDS),
  /** One line, already phrased for a human. Never contains a field value. */
  summary: z.string().default(''),
  /** Which posting this concerned, when it concerned one. */
  jobTitle: z.string().default(''),
  company: z.string().default(''),
  /** Host the action touched, for "what did it do on which site". */
  site: z.string().default(''),
})

export type ActivityEntry = z.infer<typeof activityEntrySchema>

/**
 * Newest-first, capped. Old entries fall off the end rather than growing
 * without limit — this is a recent history, not an archive, and an unbounded
 * log in `chrome.storage.local` eventually costs the user their quota.
 */
export const MAX_ACTIVITY = 300
