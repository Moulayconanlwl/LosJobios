import type { ApplyOutcome, AutofillReport } from '@/lib/messaging'
import type { JobRef, Profile, Settings } from '@/lib/schema'

/**
 * Everything an adapter needs to do its job, handed in rather than imported, so
 * adapters stay testable and have no opinion about where settings or answers
 * come from.
 */
export type ApplyContext = {
  profile: Profile
  settings: Settings
  job: JobRef | null
  /** Drive the whole flow but stop short of the final submit. */
  dryRun: boolean
  /** Aborts when the user stops or pauses the run. */
  signal: AbortSignal
  /** Job description text for AI context; may be empty. */
  jobDescription: string
  /** Progress line for the overlay and the popup. */
  report(message: string): void
}

export interface SiteAdapter {
  readonly id: string

  /** Does this adapter handle the current page? */
  matches(url: string): boolean

  /** Scrape applyable jobs from a search/listing page. */
  collectJobs(limit: number, ctx: ApplyContext): Promise<JobRef[]>

  /**
   * Called when `collectJobs` came back empty, to say *why* — signed out,
   * markup drift meaning nothing matched at all, or everything genuinely
   * filtered out — rather than leaving the run engine to guess.
   */
  diagnoseEmptyCollection?(): string

  /**
   * Does *this* frame have the site's real content? Some sites split their
   * app across a same-origin iframe, leaving the top-level document empty —
   * content/index.ts polls this on every frame the content script loads
   * into and reports back whichever one says yes, so the background knows
   * where to actually send commands. Sites that don't split like this can
   * leave it unimplemented.
   */
  hasAppContent?(): boolean

  /** Bring a specific job into view so it can be applied to. */
  openJob(job: JobRef, ctx: ApplyContext): Promise<boolean>

  /** Run the application flow for the currently-open job. */
  apply(ctx: ApplyContext): Promise<ApplyOutcome>

  /** Best-effort job description text from the current page. */
  jobDescription(): string

  /**
   * Best-effort identity of the job this page is showing — used by the ATS
   * scorer, which wants a title to compare against. Every field may come back
   * empty; the scorer treats a missing title as "don't score that component"
   * rather than as a failure, and the user can always type it in.
   */
  describeJob(): JobRef

  /** Fill whatever form is on this page, without submitting it. */
  autofill(ctx: ApplyContext): Promise<AutofillReport>
}
