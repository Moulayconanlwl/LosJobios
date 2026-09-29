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

/** Field counts carried across a page boundary mid-application. */
export type ApplyCounts = {
  questionsAnswered: number
  aiAnswersUsed: number
}

export interface SiteAdapter {
  readonly id: string

  /** Does this adapter handle the current page? */
  matches(url: string): boolean

  /**
   * Scrape applyable jobs from a search/listing page.
   *
   * `withDescriptions` asks the adapter to also read each posting's body,
   * which means bringing each one into the page's own details pane. Costly,
   * and the only reliable way to get it: a posting opened in a background tab
   * never renders its body at all.
   */
  collectJobs(limit: number, ctx: ApplyContext, withDescriptions?: boolean): Promise<JobRef[]>

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

  /**
   * Resume an application that continued onto a page this script didn't start
   * on — a hosted apply form the Apply button navigated to.
   *
   * Only adapters whose flow leaves the listing page implement this. The
   * background calls it after re-establishing a content script on the new
   * page, passing the field counts already earned so the tracked application
   * reflects the whole flow rather than just its second half.
   */
  continueApply?(ctx: ApplyContext, carried: ApplyCounts): Promise<ApplyOutcome>

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
