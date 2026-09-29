import type { ApplyOutcome, AutofillReport } from '@/lib/messaging'
import type { JobRef, PendingQuestion } from '@/lib/schema'
import { collectFields, type DetectedField } from '../fields'
import { fillFields } from '../filler'
import { humanClick, pause, sleep } from '../dom/human'
import {
  findByText,
  isDisplayed,
  normalizeText,
  pick,
  pickAll,
  text,
  waitFor,
} from '../dom/query'
import {
  CARD_SELECTORS,
  badgeRootOf,
  cardAlreadyApplied,
  cardApplyKind,
  challengePresent,
  confirmationPresent,
  controlLabel,
  isAppliedLabel,
  isApplyFlowUrl,
  isContinueLabel,
  isSubmitLabel,
  jobIdFromCard,
  jobIdFromUrl,
  securityCheckpointPresent,
} from './indeed-dom'
import type { ApplyContext, ApplyCounts, SiteAdapter } from './types'

/**
 * Indeed, including its hosted "Indeed Apply" form.
 *
 * Structurally different from LinkedIn in the one way that matters: Easy Apply
 * is a modal on the page you were already on, whereas Indeed Apply *navigates*
 * — clicking Apply takes the tab to a separate multi-step form (historically
 * `smartapply.indeed.com`), which tears this content script down mid-call.
 *
 * So the flow is split in two halves that never share a JavaScript context:
 *
 *   1. `apply()` runs on the listing, decides the posting is applyable, clicks
 *      Apply and returns `handoff`.
 *   2. `continueApply()` runs on the hosted form after the background has
 *      injected a fresh script there, and drives the wizard to the end.
 *
 * Everything else — the wizard loop, the fingerprint check, the fill-then-
 * advance rhythm — mirrors the LinkedIn adapter, because the shape of the
 * problem really is the same once the navigation is accounted for.
 */

/** A hard ceiling on wizard steps, so a loop in the UI can't become a loop here. */
const MAX_STEPS = 12


/**
 * Button and status wording, per locale.
 *
 * Indeed renders in the site's country language, so an English-only match
 * silently breaks the entire flow on `fr.indeed.com` — where the button says
 * "Postuler maintenant", never "Apply now". Accents appear both ways because
 * `findByText` lowercases but doesn't fold diacritics.
 */
const TEXT = {
  apply: [
    'apply now',
    'easily apply',
    'apply on indeed',
    'postuler maintenant',
    'candidature simplifiée',
    'candidature simplifiee',
    'postuler',
    'jetzt bewerben',
    'solicitar ahora',
    'candidatura semplice',
  ],
  /**
   * An off-site apply. Matching these is what stops a run from wandering into
   * an unknown ATS it has no business driving unattended.
   */
  external: [
    'apply on company site',
    'apply on employer site',
    "postuler sur le site de l'entreprise",
    'postuler sur le site',
    'auf unternehmenswebsite bewerben',
    'solicitar en el sitio',
  ],
  applied: [
    'applied',
    'application submitted',
    'candidature envoyée',
    'candidature envoyee',
    'déjà postulé',
    'deja postule',
    'beworben',
    'solicitado',
  ],
  continue: [
    'continue',
    'continuer',
    'suivant',
    'next',
    'weiter',
    'continuar',
    'siguiente',
    'avanti',
  ],
  review: ['review your application', 'review', 'vérifier', 'verifier', 'revoir', 'revisar'],
  submit: [
    'submit your application',
    'submit application',
    'submit',
    'envoyer ma candidature',
    'envoyer la candidature',
    'envoyer',
    'bewerbung absenden',
    'enviar solicitud',
    'invia candidatura',
  ],
  sent: [
    'your application has been submitted',
    'application submitted',
    'applied to',
    'votre candidature a été envoyée',
    'votre candidature a ete envoyee',
    'candidature envoyée',
    'candidature envoyee',
    'bewerbung gesendet',
    'solicitud enviada',
  ],
}

const APPLY_BUTTON_SELECTORS = [
  '#indeedApplyButton',
  '[id^="indeedApplyButton"]',
  '.ia-IndeedApplyButton',
  '[data-testid="indeedApplyButton"]',
  '.jobsearch-IndeedApplyButton-newDesign',
  '#applyButtonLinkContainer button',
  '.jobsearch-ApplyButton',
]

const DESCRIPTION_SELECTORS = [
  '#jobDescriptionText',
  '.jobsearch-JobComponent-description',
  '[id*="jobDescriptionText"]',
  '#vjs-desc',
  '[data-testid="jobsearch-JobComponent-description"]',
  '.job-description',
]

const TITLE_SELECTORS = [
  '[data-testid="jobsearch-JobInfoHeader-title"]',
  '.jobsearch-JobInfoHeader-title',
  'h2.jobsearch-JobInfoHeader-title',
  '#vjs-jobtitle',
  'h1',
]

const COMPANY_SELECTORS = [
  '[data-testid="inlineHeader-companyName"]',
  '[data-testid="jobsearch-CompanyInfoContainer"] a',
  '.jobsearch-CompanyInfoWithoutHeaderImage a',
  '#vjs-cn',
  '.jobsearch-InlineCompanyRating div',
]

/**
 * Re-exported so the background can ask the same question without importing
 * the whole adapter. The background has to decide whether a navigation was a
 * mid-application handoff, and it must get the same answer as the page does.
 */
export { isApplyFlowUrl as isIndeedApplyUrl }



type StepAction =
  | { kind: 'continue'; button: HTMLElement }
  | { kind: 'review'; button: HTMLElement }
  | { kind: 'submit'; button: HTMLElement }
  | { kind: 'none' }

export class IndeedAdapter implements SiteAdapter {
  readonly id = 'indeed'

  /**
   * Indeed runs one site per country, on a mix of subdomains
   * (`fr.indeed.com`) and country TLDs (`indeed.co.uk`). The TLD is matched
   * loosely on purpose: a country this doesn't anticipate should still be
   * recognised rather than silently falling through to the generic adapter.
   */
  matches(url: string): boolean {
    return /(^|\.)indeed\.[a-z]{2,3}(\.[a-z]{2})?$/.test(new URL(url).hostname)
  }

  // -------------------------------------------------------------------------
  // Job list
  // -------------------------------------------------------------------------

  async collectJobs(limit: number, ctx: ApplyContext): Promise<JobRef[]> {
    await this.scrollResults(ctx)

    const jobs: JobRef[] = []
    const seen = new Set<string>()

    for (const card of pickAll(CARD_SELECTORS, document, isDisplayed)) {
      const externalId = jobIdFromCard(card)
      if (!externalId || seen.has(externalId)) continue
      seen.add(externalId)

      /*
       * Triage from the card, before anything is opened.
       *
       * An off-site apply is one this must never drive unattended, and a job
       * already applied to is one the employer should not hear about twice.
       * Discovering either *after* navigating to the posting costs the
       * navigation and, on Indeed, a page load each way.
       */
      const badges = badgeRootOf(card)
      if (cardApplyKind(badges) === false) continue
      if (ctx.settings.skipAlreadyApplied && cardAlreadyApplied(badges)) continue

      const job = this.readCard(card, externalId)
      if (!this.passesFilters(job, ctx)) continue

      jobs.push(job)
      if (jobs.length >= limit) break
    }

    return jobs
  }

  diagnoseEmptyCollection(): string {
    if (this.challengePresent()) {
      return 'Indeed is showing a human-verification check. Clear it yourself, then start the run again.'
    }
    if (pickAll(CARD_SELECTORS, document, isDisplayed).length === 0) {
      return 'No job cards were found on this page at all — open an Indeed search (indeed.com/jobs?q=…) and try again.'
    }
    return 'Jobs were found on the page, but all of them were filtered out by your settings or already applied to.'
  }

  /**
   * Indeed renders the results list in the top document, but the hosted apply
   * form has historically been served inside an iframe. Claiming on either
   * means commands reach whichever half of the flow is live.
   */
  hasAppContent(): boolean {
    // `isDisplayed`, never `isVisible`: frame claiming happens while the page
    // is still coming up, and an unpainted frame reports a zero-size box for
    // every real element in it. A visibility test that needs a painted box
    // means no frame ever claims, and every command goes to frame 0.
    return (
      pickAll(CARD_SELECTORS, document, isDisplayed).length > 0 ||
      Boolean(pick(DESCRIPTION_SELECTORS, document, isDisplayed)) ||
      this.onApplyForm()
    )
  }

  private readCard(card: HTMLElement, externalId: string): JobRef {
    // `isDisplayed` throughout: this reads text rather than clicking it, and
    // a card below the fold in a tab that was never painted reports a
    // zero-size box for every element inside it.
    const title = pick(
      [
        'h2.jobTitle span[title]',
        'h2.jobTitle a',
        '[data-testid="job-title"] a',
        'a[data-jk] span',
        '.jobTitle',
      ],
      card,
      isDisplayed,
    )
    const company = pick(
      [
        '[data-testid="company-name"]',
        '[data-testid="attribute_snippet_testid"]',
        '.companyName',
      ],
      card,
      isDisplayed,
    )
    const where = pick(
      ['[data-testid="text-location"]', '.companyLocation', '[data-testid="job-location"]'],
      card,
      isDisplayed,
    )

    return {
      externalId,
      // `title` on the span carries the full, untruncated string; the visible
      // text is ellipsised by CSS on narrow layouts.
      title: normalizeText(title?.getAttribute('title') ?? (title ? text(title) : '')).slice(0, 200),
      company: company ? normalizeText(text(company)).slice(0, 200) : '',
      location: where ? normalizeText(text(where)).slice(0, 200) : '',
      url: `${location.origin}/viewjob?jk=${encodeURIComponent(externalId)}`,
      description: '',
    }
  }

  private passesFilters(job: JobRef, ctx: ApplyContext): boolean {
    const { titleIncludeKeywords, titleExcludeKeywords, blockedCompanies } = ctx.settings
    const title = job.title.toLowerCase()
    const company = job.company.toLowerCase()

    if (blockedCompanies.some((c) => c.trim() && company.includes(c.toLowerCase().trim()))) {
      return false
    }
    if (titleExcludeKeywords.some((k) => k.trim() && title.includes(k.toLowerCase().trim()))) {
      return false
    }
    const includes = titleIncludeKeywords.filter((k) => k.trim())
    if (includes.length && !includes.some((k) => title.includes(k.toLowerCase().trim()))) {
      return false
    }
    return true
  }

  /**
   * Indeed paginates rather than infinitely scrolling, so this is only here to
   * force lazily-rendered cards below the fold to mount. One page of results
   * is one page of results — the run works through what this page holds and
   * the user moves to page 2 themselves, which is also the honest reading of
   * a daily cap.
   */
  private async scrollResults(ctx: ApplyContext): Promise<void> {
    const pane =
      pick(['#mosaic-provider-jobcards', '.jobsearch-ResultsList', '#resultsCol'], document, isDisplayed) ??
      null

    /*
     * Scrolling is an optimisation — it materialises cards below the fold —
     * so it must never be what stops the cards already on the page from being
     * collected. Anything that goes wrong here is swallowed deliberately.
     */
    try {
      for (let i = 0; i < 4; i += 1) {
        if (ctx.signal.aborted) return
        if (pane) pane.scrollBy({ top: pane.clientHeight * 0.9, behavior: 'smooth' })
        else window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'smooth' })
        await sleep(500, ctx.signal)
      }

      window.scrollTo({ top: 0, behavior: 'smooth' })
      await sleep(400, ctx.signal)
    } catch (err) {
      console.warn('[LosJobios] scrolling the Indeed results failed', err)
    }
  }

  // -------------------------------------------------------------------------
  // Opening a job
  // -------------------------------------------------------------------------

  /**
   * Click the card rather than navigating to the posting's URL. Indeed's
   * search page shows the posting in a pane beside the list, and keeping the
   * page alive keeps this script — and the run — alive with it.
   */
  async openJob(job: JobRef, ctx: ApplyContext): Promise<boolean> {
    const card = this.findCard(job.externalId)
    if (!card) return false

    const clickable =
      card.querySelector<HTMLElement>('a[data-jk], h2.jobTitle a, a.jcs-JobTitle') ?? card

    await humanClick(clickable, ctx.signal)

    // The pane is ready once the posting's own text renders. Keyed on the
    // description rather than the apply button, because a posting with no
    // Indeed Apply still has to open so `apply()` can say *why* it skipped.
    const ready = await waitFor(
      () => {
        const description = this.jobDescription()
        return description.length > 200 ? description : null
      },
      { timeoutMs: 10_000, intervalMs: 300, signal: ctx.signal },
    )

    await pause(ctx.settings.minActionDelayMs, ctx.settings.maxActionDelayMs, ctx.signal)
    return Boolean(ready)
  }

  private findCard(externalId: string): HTMLElement | null {
    if (!externalId) return null
    const escaped = CSS.escape(externalId)
    return pick([
      `[data-jk="${escaped}"]`,
      `a[href*="jk=${escaped}"]`,
    ])
  }

  /**
   * `isDisplayed` rather than `isVisible`, and `textContent` as the fallback
   * for `innerText` — both for the same reason as the LinkedIn adapter: a tab
   * opened in the background is never painted, so every real element reports a
   * zero-size box and `innerText` comes back empty.
   */
  jobDescription(): string {
    let best = ''

    for (const el of pickAll(DESCRIPTION_SELECTORS, document, isDisplayed)) {
      const value = normalizeText(el.innerText || el.textContent)
      if (value.length > best.length) best = value
    }

    return best.slice(0, 8000)
  }

  /**
   * `isDisplayed` for the same reason `jobDescription` uses it: the dashboard
   * fetches a posting by opening it in a *background* tab, which is never
   * painted, so requiring a non-zero box here returns an empty title for a
   * posting that is sitting right there in the DOM.
   */
  describeJob(): JobRef {
    const titleEl = pick(TITLE_SELECTORS, document, isDisplayed)
    const companyEl = pick(COMPANY_SELECTORS, document, isDisplayed)
    const whereEl = pick(
      [
        '[data-testid="inlineHeader-companyLocation"]',
        '[data-testid="job-location"]',
        '.jobsearch-JobInfoHeader-subtitle div:last-child',
      ],
      document,
      isDisplayed,
    )

    // Reads `vjk` as well as `jk`: on the search page, selecting a job puts
    // its id in `vjk` while `jk` still names whatever was opened first, so
    // reading only `jk` tags the posting with the wrong job.
    const key = jobIdFromUrl(location.href) ?? ''

    return {
      externalId: key,
      title: titleEl ? normalizeText(text(titleEl)).slice(0, 200) : '',
      company: companyEl ? normalizeText(text(companyEl)).slice(0, 200) : '',
      location: whereEl ? normalizeText(text(whereEl)).slice(0, 200) : '',
      url: location.href,
      description: '',
    }
  }

  // -------------------------------------------------------------------------
  // Applying — first half, on the listing
  // -------------------------------------------------------------------------

  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    // Already on the hosted form (a resumed run, or the user started here):
    // there is nothing to click through to.
    if (this.onApplyForm()) return this.continueApply(ctx, { questionsAnswered: 0, aiAnswersUsed: 0 })

    if (this.challengePresent()) {
      return {
        result: 'failed',
        error: 'Indeed is showing a human-verification check. Clear it yourself, then resume.',
      }
    }

    if (this.alreadyApplied()) {
      return { result: 'skipped', reason: 'Already applied.' }
    }

    const offsite = {
      result: 'skipped' as const,
      reason: 'Applies on the company’s own site — open it yourself and use Review & fill.',
    }

    const button = pick(APPLY_BUTTON_SELECTORS) ?? findByText(TEXT.apply)

    if (!button) {
      return this.externalApplyPresent() ? offsite : {
        result: 'skipped',
        reason: 'No Indeed Apply button on this posting.',
      }
    }

    /*
     * Check the label of the button we are about to click, rather than
     * searching the page for an off-site link separately. A posting can carry
     * both, and the one that matters is the one under the cursor — "Apply on
     * company site" matches `TEXT.apply` on its "apply" prefix, so without
     * this a run would follow it straight off Indeed and start filling an
     * unknown ATS unattended.
     */
    const label = (text(button) || button.getAttribute('aria-label') || '').toLowerCase()
    if (TEXT.external.some((phrase) => label.includes(phrase))) return offsite

    ctx.report('Opening Indeed Apply…')
    await humanClick(button, ctx.signal)

    /*
     * Two things can happen, and which one is a property of the posting rather
     * than anything we control: the form opens in place (in a modal or an
     * iframe) or the tab navigates to the hosted form.
     *
     * Wait briefly for the in-place case. If it doesn't appear, assume the
     * navigation and hand off — the background confirms it by looking at where
     * the tab actually ended up, so guessing wrong here costs a re-check
     * rather than a lost application.
     */
    const inPlace = await waitFor(() => (this.onApplyForm() ? true : null), {
      timeoutMs: 6000,
      intervalMs: 250,
      signal: ctx.signal,
    })

    if (inPlace) return this.driveWizard(ctx, { questionsAnswered: 0, aiAnswersUsed: 0 })

    return { result: 'handoff', questionsAnswered: 0, aiAnswersUsed: 0 }
  }

  // -------------------------------------------------------------------------
  // Applying — second half, on the hosted form
  // -------------------------------------------------------------------------

  async continueApply(ctx: ApplyContext, carried: ApplyCounts): Promise<ApplyOutcome> {
    const ready = await waitFor(() => (this.onApplyForm() ? true : null), {
      timeoutMs: 15_000,
      intervalMs: 300,
      signal: ctx.signal,
    })

    if (!ready) {
      // Landing somewhere that already says "submitted" happens when Indeed
      // has the answers on file and one click was the whole application.
      if (this.confirmationOnScreen()) {
        return { result: 'applied', ...carried }
      }
      return { result: 'failed', error: 'The Indeed Apply form never loaded.' }
    }

    return this.driveWizard(ctx, carried)
  }

  /**
   * The wizard loop. Each pass: fill what's on screen, decide which button
   * advances, click it, confirm the step actually changed.
   */
  private async driveWizard(ctx: ApplyContext, carried: ApplyCounts): Promise<ApplyOutcome> {
    let questionsAnswered = carried.questionsAnswered
    let aiAnswersUsed = carried.aiAnswersUsed
    let lastFingerprint = ''

    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (ctx.signal.aborted) return { result: 'skipped', reason: 'Run stopped.' }

      if (this.confirmationOnScreen()) {
        return { result: 'applied', questionsAnswered, aiAnswersUsed }
      }

      if (this.challengePresent()) {
        return {
          result: 'failed',
          error: 'Indeed asked for human verification mid-application. Finish this one yourself.',
        }
      }

      const root = this.formRoot()
      if (!root) {
        return { result: 'failed', error: `Lost the Indeed Apply form on step ${step + 1}.` }
      }

      ctx.report(`Indeed Apply — step ${step + 1}: ${this.stepTitle(root)}`)

      const fields = this.answerableFields(root)
      const summary = await fillFields(fields, ctx)

      questionsAnswered += summary.filled
      aiAnswersUsed += summary.results.filter((r) => r.source === 'ai').length

      if (ctx.settings.pauseOnUnknownRequired && summary.blocking.length > 0) {
        const blocker = summary.blocking[0]
        if (blocker) return { result: 'blocked', question: this.toPendingQuestion(blocker, ctx) }
      }

      const action = this.nextAction(root)

      if (action.kind === 'none') {
        return {
          result: 'failed',
          error: `Stuck on step ${step + 1} — no Continue, Review or Submit button found.`,
        }
      }

      if (action.kind === 'submit') {
        if (ctx.dryRun) {
          ctx.report('Dry run — reached Submit, stopping there.')
          return { result: 'applied', questionsAnswered, aiAnswersUsed }
        }

        ctx.report('Submitting application…')
        await humanClick(action.button, ctx.signal)

        const confirmed = await waitFor(
          () => (this.confirmationOnScreen() ? true : null),
          { timeoutMs: 20_000, intervalMs: 400, signal: ctx.signal },
        )

        if (!confirmed) return { result: 'failed', error: 'Submitted but saw no confirmation.' }
        return { result: 'applied', questionsAnswered, aiAnswersUsed }
      }

      // A step that didn't change is usually an inline validation error we
      // couldn't see. Bailing beats clicking Continue forever.
      const fingerprint = this.fingerprint(root)
      if (fingerprint === lastFingerprint) {
        const error = this.validationError(root)
        return { result: 'failed', error: error || `Step ${step + 1} would not advance.` }
      }
      lastFingerprint = fingerprint

      await humanClick(action.button, ctx.signal)
      await pause(ctx.settings.minActionDelayMs, ctx.settings.maxActionDelayMs, ctx.signal)

      // The hosted form re-renders per step rather than navigating, so give
      // the next step a beat to mount before reading it.
      await sleep(800, ctx.signal)
    }

    return { result: 'failed', error: `Gave up after ${MAX_STEPS} steps.` }
  }

  /** Are we looking at the hosted apply form, in any of the shapes it takes? */
  private onApplyForm(): boolean {
    // The URL test carries the `preloadresumeapply` exclusion: Indeed's search
    // page keeps a hidden smartapply iframe warmed up, and without that
    // exclusion an ordinary search reads as an application in progress.
    if (isApplyFlowUrl(location.href)) return true
    if (/preloadresumeapply/i.test(location.href)) return false
    return Boolean(this.formRoot())
  }

  /**
   * The element the wizard lives inside — the hosted page's own form, or the
   * modal it renders in when the flow stays on the listing page.
   */
  private formRoot(): HTMLElement | null {
    const container = pick(
      [
        '[data-testid="indeed-apply-form"]',
        '.ia-BasePage-content',
        '#ia-container',
        '.indeed-apply-bd',
        'div[role="dialog"] form',
        'main form',
        'form',
      ],
      document,
      isDisplayed,
    )
    if (!container) return null

    // Guard against claiming the search box, which is also a form.
    const hasQuestions = container.querySelector('input, select, textarea, button[type="submit"]')
    return hasQuestions ? container : null
  }

  /**
   * Which button moves us forward — and, far more importantly, which one ends
   * the application.
   *
   * On Indeed's wizard **both are `type="submit"`**: Continue submits the
   * step's own form, Submit sends the application. So the element's type says
   * nothing, and only the label tells them apart.
   *
   * Two rules make the failure modes asymmetric, deliberately:
   *
   *   1. Submit is decided by label, and a label containing "continue" or
   *      "next" is never a submit however it is marked up.
   *   2. A `type="submit"` is only accepted as *Continue* once its label has
   *      been read and confirmed to be a continue label and not a submit one.
   *      Anything unrecognised is reported as `none`, which stops the run.
   *
   * Stopping on an unknown button costs one abandoned application. Guessing
   * "continue" and clicking sends a real one — during a dry run, which is
   * supposed to be the setting that cannot do that.
   */
  private nextAction(root: HTMLElement): StepAction {
    /*
     * Scoped to the form first, then widened to the document.
     *
     * Indeed renders the step's buttons in a footer that is frequently a
     * *sibling* of the form rather than inside it, so a form-only search finds
     * no button at all and every application fails as "stuck". Searching the
     * form first still keeps its own buttons ahead of anything in the page
     * chrome.
     */
    const selectors = [
      'button',
      '[role="button"]',
      'input[type="submit"]',
      'input[type="button"]',
      'a[role="button"]',
    ]

    const seen = new Set<HTMLElement>()
    const controls = [...pickAll(selectors, root, isDisplayed), ...pickAll(selectors, document, isDisplayed)]
      .filter((el) => {
        if (seen.has(el)) return false
        seen.add(el)
        return !(el as HTMLButtonElement).disabled
      })

    // Submit first, and by label only.
    for (const control of controls) {
      if (isSubmitLabel(controlLabel(control))) return { kind: 'submit', button: control }
    }

    // Indeed's own marker, but still refused if it reads as a step button.
    const marked = controls.find((el) =>
      el.matches('[data-testid="submit-application-button"], [name="submit-application"]'),
    )
    if (marked && !isContinueLabel(controlLabel(marked))) {
      return { kind: 'submit', button: marked }
    }

    for (const testId of [
      'continue-button',
      'save-and-continue-button',
      'apply-button-continue',
      'application-module-continue-button',
    ]) {
      const button = controls.find((el) => el.matches(`[data-testid="${testId}"]`))
      if (button) return { kind: 'continue', button }
    }

    for (const control of controls) {
      const label = controlLabel(control)
      if (!label || isSubmitLabel(label)) continue
      if (isContinueLabel(label)) return { kind: 'continue', button: control }
    }

    return { kind: 'none' }
  }

  /**
   * Fields worth answering on this step. The marketing opt-in and the
   * "save my answers" box are the user's own standing choices, not questions
   * the employer asked, so they are left exactly as they were found.
   */
  private answerableFields(root: HTMLElement): DetectedField[] {
    return collectFields(root).filter((field) => {
      const label = field.label.toLowerCase()
      if (label.includes('job alert')) return false
      if (label.includes('marketing')) return false
      if (label.includes('newsletter')) return false
      if (label.includes('save my answers')) return false
      if (label.includes('remember')) return false
      return true
    })
  }

  private stepTitle(root: HTMLElement): string {
    const heading = pick(['h1', 'h2', '[data-testid="page-heading"]'], root, isDisplayed)
    return heading ? normalizeText(text(heading)).slice(0, 80) : 'form'
  }

  /**
   * A cheap signal of "which step am I on", used to notice when a click didn't
   * take. Indeed's wizard has no progress meter to read, so this leans on the
   * heading plus the visible field labels.
   */
  private fingerprint(root: HTMLElement): string {
    const labels = Array.from(root.querySelectorAll('label, legend'))
      .slice(0, 12)
      .map((l) => normalizeText(l.textContent).slice(0, 40))
      .join('|')

    return `${this.stepTitle(root)}::${labels}`
  }

  private validationError(root: HTMLElement): string {
    const errors = pickAll(
      ['[role="alert"]', '[data-testid*="error" i]', '.css-error', '[aria-invalid="true"] + *'],
      root,
      isDisplayed,
    )
    return errors
      .map((e) => normalizeText(text(e)))
      .filter(Boolean)
      .join('; ')
      .slice(0, 300)
  }

  private toPendingQuestion(field: DetectedField, ctx: ApplyContext): PendingQuestion {
    return {
      question: field.label,
      kind: field.kind,
      options: field.options,
      jobTitle: ctx.job?.title ?? '',
      company: ctx.job?.company ?? '',
    }
  }

  private confirmationOnScreen(): boolean {
    return confirmationPresent(document)
  }

  private alreadyApplied(): boolean {
    const marker = pick(
      [
        '[data-testid="applied-label"]',
        '.jobsearch-IndeedApplyButton-applied',
        '#indeedApplyButton[disabled]',
      ],
      document,
      isDisplayed,
    )
    if (marker) return true

    // Reading the button's own wording, not clicking it, so `isDisplayed`
    // again — and getting this wrong means re-applying to every job the user
    // has already applied to, which is worse than failing.
    const button = pick(APPLY_BUTTON_SELECTORS, document, isDisplayed)
    if (!button) return false
    return isAppliedLabel(text(button), button.getAttribute('aria-label') ?? '')
  }

  /**
   * Is there an off-site apply link on this posting? Only used to explain a
   * skip, so it reads rather than clicks — hence `isDisplayed`.
   */
  private externalApplyPresent(): boolean {
    return pickAll(['a', 'button', '[role="button"]'], document, isDisplayed).some((el) => {
      const label = (text(el) || el.getAttribute('aria-label') || '').toLowerCase()
      return TEXT.external.some((phrase) => label.includes(phrase))
    })
  }

  /**
   * A challenge, or a site-wide interstitial. Detection only — nothing here
   * attempts to answer one.
   */
  private challengePresent(): boolean {
    return challengePresent(document) || securityCheckpointPresent(document)
  }

  // -------------------------------------------------------------------------
  // Autofill (manual, single page)
  // -------------------------------------------------------------------------

  async autofill(ctx: ApplyContext): Promise<AutofillReport> {
    const root = this.formRoot()
    const fields = root ? this.answerableFields(root) : collectFields(document)

    ctx.report(`Filling ${fields.length} fields.`)
    const summary = await fillFields(fields, ctx)

    return {
      filled: summary.filled,
      skipped: summary.skipped,
      unfilled: summary.unanswered.map((f) => f.label).filter(Boolean),
    }
  }
}
