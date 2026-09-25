import type { ApplyOutcome, AutofillReport } from '@/lib/messaging'
import type { JobRef, PendingQuestion } from '@/lib/schema'
import { collectFields, type DetectedField } from '../fields'
import { fillFields } from '../filler'
import { humanClick, pause, sleep } from '../dom/human'
import {
  findByText,
  isDisplayed,
  isVisible,
  normalizeText,
  pick,
  pickAll,
  text,
  waitFor,
  waitForGone,
} from '../dom/query'
import type { ApplyContext, SiteAdapter } from './types'

/**
 * LinkedIn Easy Apply.
 *
 * Easy Apply is a modal of variable length — one step for some roles, six for
 * others, with the set of questions decided by the employer. So this is written
 * as a loop that reads the current step and decides what to do, never as a
 * fixed script of clicks.
 *
 * Selectors are all multi-candidate and lean on ARIA. LinkedIn rewrites its
 * class names often; it changes its accessible labels far less, because
 * screen-reader support depends on them.
 */

/** A hard ceiling on modal steps, so a loop in the UI can't become a loop here. */
const MAX_STEPS = 10

/**
 * Two genuinely different pages both live at a `/jobs/search` URL: the
 * authenticated SPA (signed in) and a separate, SEO-oriented "guest" results
 * page LinkedIn serves when you're signed out — different markup entirely,
 * not just different styling. Verified live: a signed-out session returns
 * `div.job-search-card` cards and zero matches for every authenticated-page
 * selector. Both sets are listed so whichever one LinkedIn actually serves,
 * something matches.
 */
const JOB_CARD_SELECTORS = [
  // Current server-driven UI. Class names here are build-hashed and change
  // every deploy, so `componentkey` — which carries the job id directly — is
  // the only stable hook. Confirmed live against a signed-in session.
  '[componentkey^="job-card-component-ref-"]',
  // Older authenticated SPA.
  'li[data-occludable-job-id]',
  'div[data-job-id]',
  '.job-card-container',
  '.jobs-search-results__list-item',
  '.scaffold-layout__list-item',
  // Signed-out guest results page.
  'div.job-search-card',
  'li[data-entity-urn*="jobPosting"]',
]

/**
 * Button and status wording, per locale.
 *
 * LinkedIn renders its UI in the account's language, so matching only English
 * silently breaks the entire apply flow for everyone else — a French account
 * sees "Candidature simplifiée" and "Postuler", never "Easy Apply". Accents
 * are included both ways because `findByText` lowercases but doesn't fold
 * diacritics.
 */
const TEXT = {
  easyApply: ['easy apply', 'candidature simplifiée', 'candidature simplifiee', 'solicitud sencilla', 'einfache bewerbung'],
  apply: ['apply', 'postuler', 'solicitar', 'bewerben'],
  applied: ['applied', 'candidature envoyée', 'candidature envoyee', 'solicitado', 'beworben'],
  next: ['continue to next step', 'next', 'continue', 'suivant', 'continuer', 'siguiente', 'weiter'],
  review: ['review your application', 'review', 'vérifier', 'verifier', 'revoir', 'revisar', 'prüfen'],
  submit: ['submit application', 'submit', 'envoyer la candidature', 'envoyer', 'enviar solicitud', 'enviar', 'senden'],
  dismiss: ['dismiss', 'close', 'fermer', 'ignorer', 'cerrar', 'schließen'],
  discard: ['discard', "don't save", 'do not save', 'abandonner', 'supprimer', 'ne pas enregistrer', 'descartar', 'verwerfen'],
  done: ['done', 'not now', 'no thanks', 'close', 'terminé', 'termine', 'pas maintenant', 'fermer', 'listo', 'fertig'],
  sent: ['application sent', 'your application was sent', 'candidature envoyée', 'candidature envoyee', 'solicitud enviada'],
}

const EASY_APPLY_BUTTON_SELECTORS = [
  '.jobs-apply-button',
  'button[aria-label*="Easy Apply" i]',
  '.jobs-s-apply button',
]

const MODAL_SELECTORS = [
  '.jobs-easy-apply-modal',
  'div[role="dialog"][aria-labelledby*="easy-apply" i]',
  'div[data-test-modal]',
  'div[role="dialog"]',
]

/**
 * Where a posting's text lives, across the layouts LinkedIn serves.
 *
 * The first four are the authenticated job view and the details pane beside
 * a search. The next are the signed-out guest posting, which is what a
 * freshly opened tab can land on. The wildcards are the safety net for the
 * next time the build-hashed class names move.
 */
const DESCRIPTION_SELECTORS = [
  '#job-details',
  '.jobs-description__content',
  '.jobs-description-content__text',
  '.jobs-box__html-content',
  '.show-more-less-html__markup',
  '.description__text',
  '[class*="jobs-description"]',
  '[class*="description__text"]',
]

type StepAction =
  | { kind: 'next'; button: HTMLElement }
  | { kind: 'review'; button: HTMLElement }
  | { kind: 'submit'; button: HTMLElement }
  | { kind: 'none' }


export class LinkedInAdapter implements SiteAdapter {
  readonly id = 'linkedin'

  matches(url: string): boolean {
    return /(^|\.)linkedin\.com$/.test(new URL(url).hostname)
  }

  // -------------------------------------------------------------------------
  // Job list
  // -------------------------------------------------------------------------

  async collectJobs(limit: number, ctx: ApplyContext): Promise<JobRef[]> {
    // The list virtualizes, so scroll it to materialize more cards than the
    // handful that are initially rendered.
    await this.scrollJobList(ctx)

    const cards = pickAll(JOB_CARD_SELECTORS)
    const jobs: JobRef[] = []
    const seen = new Set<string>()

    for (const card of cards) {
      const externalId = this.jobIdFrom(card)
      if (!externalId || seen.has(externalId)) continue
      seen.add(externalId)

      const job = this.readCard(card, externalId)
      if (!this.passesFilters(job, ctx)) continue

      jobs.push(job)
      if (jobs.length >= limit) break
    }

    return jobs
  }

  /**
   * Diagnose why `collectJobs` came back empty, so the run engine can say
   * something more useful than "no jobs matched your filters" — which is
   * actively misleading when the real cause is "you're signed out" or
   * "LinkedIn's markup moved again and nothing matched at all".
   */
  diagnoseEmptyCollection(): string {
    if (!this.isSignedIn()) {
      return "You don't appear to be signed in to LinkedIn. Sign in, then try again."
    }
    if (pickAll(JOB_CARD_SELECTORS).length === 0) {
      return 'No job cards were found on this page at all — try a LinkedIn jobs search or collections URL, or reload the page.'
    }
    return 'Jobs were found on the page, but all of them were filtered out by your settings or already applied to.'
  }

  /**
   * Signed-in markers that live in the *content* document.
   *
   * Deliberately not `#global-nav`: LinkedIn loads the global nav in a
   * separate same-origin iframe (`/preload/`), so checking for it in the
   * frame that holds the jobs always fails, and checking for it in the nav
   * frame always succeeds regardless of what the job list is doing. Both
   * mistakes were live bugs — "not signed in" while signed in, then "no job
   * cards" because commands were routed to the nav frame.
   */
  private isSignedIn(): boolean {
    return Boolean(
      document.querySelector('[data-testid="primary-nav"]') ||
        document.querySelector('[data-testid="lazy-column"]') ||
        document.getElementById('global-nav'),
    )
  }

  /**
   * Confirmed live: LinkedIn's authenticated job search renders entirely
   * inside a same-origin iframe (linkedin.com/preload/?_bprMode=vanilla) —
   * the top-level document has none of this, not even `#global-nav`. The
   * signed-out guest page has no such split; its content sits directly in
   * the top frame. Either way, "does this frame have the nav or any job
   * cards" is the right test for "is this the frame worth talking to".
   */
  hasAppContent(): boolean {
    // Must key on *job* content, never the nav. The nav lives in its own
    // iframe, so including it here made that frame win the claim and every
    // command got routed to a document with no job list in it.
    return (
      pickAll(JOB_CARD_SELECTORS).length > 0 ||
      Boolean(document.querySelector('[data-testid="lazy-column"]')) ||
      Boolean(document.querySelector('[data-testid="primary-nav"]'))
    )
  }

  private jobIdFrom(card: HTMLElement): string {
    // Current server-driven UI: "job-card-component-ref-4421154534".
    const componentKey =
      card.getAttribute('componentkey') ??
      card.closest('[componentkey]')?.getAttribute('componentkey') ??
      ''
    const keyMatch = /job-card-component-ref-(\d+)/.exec(componentKey)
    if (keyMatch?.[1]) return keyMatch[1]

    // Authenticated SPA markup carries the id directly as a data attribute.
    const direct =
      card.getAttribute('data-occludable-job-id') ??
      card.getAttribute('data-job-id') ??
      card.querySelector('[data-job-id]')?.getAttribute('data-job-id')
    if (direct && direct !== '0') return direct

    // The signed-out guest results page carries it in an entity URN instead.
    const urn =
      card.getAttribute('data-entity-urn') ??
      card.querySelector('[data-entity-urn]')?.getAttribute('data-entity-urn') ??
      ''
    const urnMatch = /urn:li:jobPosting:(\d+)/.exec(urn)
    if (urnMatch?.[1]) return urnMatch[1]

    // Last resort: the trailing id on the card's own link. Both page shapes
    // carry one — a bare "/jobs/view/4419969671/" on the authenticated SPA,
    // or a slugged "/jobs/view/senior-…-4419969671?…" on the guest page.
    const href = card.querySelector('a[href*="/jobs/view/"]')?.getAttribute('href') ?? ''
    const segment = /\/jobs\/view\/([^/?#]+)/.exec(href)?.[1] ?? ''
    return /(\d{6,})$/.exec(segment)?.[1] ?? ''
  }

  private readCard(card: HTMLElement, externalId: string): JobRef {
    // Server-driven UI: every class is build-hashed, so there's nothing
    // meaningful to select on inside the card. What is stable is the order —
    // title, company, location as the first three paragraphs.
    if (card.getAttribute('componentkey')?.startsWith('job-card-component-ref-')) {
      const paragraphs = Array.from(card.querySelectorAll('p'))
        .map(visibleText)
        .filter(Boolean)

      if (paragraphs.length) {
        return {
          externalId,
          title: paragraphs[0] ?? '',
          company: paragraphs[1] ?? '',
          location: paragraphs[2] ?? '',
          url: `https://www.linkedin.com/jobs/view/${externalId}/`,
        }
      }
    }

    const titleEl = pick(
      [
        '.job-card-list__title--link',
        '.job-card-list__title',
        'a.job-card-container__link',
        '.base-search-card__title', // guest page — clean text, no dedupe needed
        'a[href*="/jobs/view/"]',
      ],
      card,
    )

    const companyEl = pick(
      [
        '.artdeco-entity-lockup__subtitle',
        '.job-card-container__primary-description',
        '.job-card-container__company-name',
        '.base-search-card__subtitle', // guest page
      ],
      card,
    )

    const locationEl = pick(
      [
        '.job-card-container__metadata-item',
        '.artdeco-entity-lockup__caption',
        '.job-search-card__location', // guest page
        'li',
      ],
      card,
    )

    // LinkedIn duplicates the title into a visually-hidden span for screen
    // readers on some layouts, which makes a naive innerText read say
    // everything twice — harmless to run on layouts that don't do this.
    const title = dedupe(titleEl ? text(titleEl) : '')

    return {
      externalId,
      title,
      company: companyEl ? dedupe(text(companyEl)) : '',
      location: locationEl ? dedupe(text(locationEl)) : '',
      url: `https://www.linkedin.com/jobs/view/${externalId}/`,
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

  /** Scroll the results pane to force the virtualized list to render more rows. */
  private async scrollJobList(ctx: ApplyContext): Promise<void> {
    const pane = pick([
      // Server-driven UI virtualizes the list, so scrolling this is what
      // renders more cards.
      '[data-testid="lazy-column"][componentkey="SearchResultsMainContent"]',
      '[data-testid="lazy-column"]',
      '.jobs-search-results-list',
      '.scaffold-layout__list > div',
      '.jobs-search__results-list', // also matches the signed-out guest page
    ])

    // The guest results page renders every card up front rather than
    // virtualizing, so a missing pane isn't necessarily a dead end — fall
    // back to scrolling the window itself rather than silently doing nothing.
    const target: { scrollBy: typeof window.scrollBy; scrollTo: typeof window.scrollTo; clientHeight: number } =
      pane ?? { scrollBy: window.scrollBy.bind(window), scrollTo: window.scrollTo.bind(window), clientHeight: window.innerHeight }

    for (let i = 0; i < 6; i += 1) {
      if (ctx.signal.aborted) return
      target.scrollBy({ top: target.clientHeight * 0.9, behavior: 'smooth' })
      await sleep(600, ctx.signal)
    }
    target.scrollTo({ top: 0, behavior: 'smooth' })
    await sleep(500, ctx.signal)
  }

  // -------------------------------------------------------------------------
  // Opening a job
  // -------------------------------------------------------------------------

  /**
   * Select a job in the list rather than navigating to its URL. A full
   * navigation tears down this content script mid-run; clicking the card keeps
   * the SPA — and us — alive.
   */
  async openJob(job: JobRef, ctx: ApplyContext): Promise<boolean> {
    const card = this.findCard(job.externalId)
    if (!card) return false

    const clickable =
      card.querySelector<HTMLElement>('a[href*="/jobs/view/"]') ??
      card.querySelector<HTMLElement>('.job-card-list__title') ??
      card

    await humanClick(clickable, ctx.signal)

    // The details pane is ready once an apply button for this job renders.
    const ready = await waitFor(() => this.findApplyButton(), {
      timeoutMs: 8000,
      signal: ctx.signal,
    })

    await pause(ctx.settings.minActionDelayMs, ctx.settings.maxActionDelayMs, ctx.signal)
    return Boolean(ready)
  }

  private findCard(externalId: string): HTMLElement | null {
    if (!externalId) return null
    const escaped = CSS.escape(externalId)
    return pick([
      `li[data-occludable-job-id="${escaped}"]`,
      `div[data-job-id="${escaped}"]`,
      `a[href*="/jobs/view/${escaped}"]`,
    ])
  }

  private findApplyButton(): HTMLElement | null {
    const button = pick(EASY_APPLY_BUTTON_SELECTORS)
    if (button) return button
    return findByText(TEXT.easyApply) ?? findByText(TEXT.apply)
  }

  /**
   * The posting's text, from whichever candidate holds the most of it.
   *
   * Two deliberate choices, both of which were bugs before. `isDisplayed`
   * rather than `isVisible`, because this reads text instead of clicking it
   * and a background tab that was never painted reports zero-size boxes for
   * real elements — the whole point of opening a posting in the background
   * is to read it without stealing focus. And `textContent` as a fallback
   * for `innerText`, which is layout-dependent and comes back empty in a tab
   * that has never been rendered.
   */
  jobDescription(): string {
    let best = ''

    for (const el of pickAll(DESCRIPTION_SELECTORS, document, isDisplayed)) {
      const value = normalizeText(el.innerText || el.textContent)
      // Longest wins: a container and the node inside it both match, and
      // which one is the outer varies by layout.
      if (value.length > best.length) best = value
    }

    return best.slice(0, 8000)
  }

  /**
   * The job currently open in the details pane. Multi-candidate and
   * ARIA-leaning like everything else here, and empty-tolerant: an empty
   * title only means the ATS scorer skips its title component, never that
   * anything failed.
   */
  describeJob(): JobRef {
    const titleEl = pick([
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      '.top-card-layout__title',
      '.jobs-details-top-card__job-title',
      'h1',
    ])

    const companyEl = pick([
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      '.top-card-layout__second-subline a',
    ])

    const id = /\/jobs\/view\/(?:[^/?#]*?)(\d{6,})/.exec(location.href)?.[1] ?? ''

    return {
      externalId: id,
      title: titleEl ? dedupe(text(titleEl)).slice(0, 200) : '',
      company: companyEl ? dedupe(text(companyEl)).slice(0, 200) : '',
      location: '',
      url: location.href,
    }
  }

  // -------------------------------------------------------------------------
  // Applying
  // -------------------------------------------------------------------------

  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    const applyButton = this.findApplyButton()
    if (!applyButton) {
      return { result: 'skipped', reason: 'No Easy Apply button — external application.' }
    }

    // "Applied" replaces the button text once you've already applied.
    const label = (text(applyButton) || applyButton.getAttribute('aria-label') || '').toLowerCase()
    if (TEXT.applied.some((word) => label.includes(word))) {
      return { result: 'skipped', reason: 'Already applied.' }
    }

    ctx.report('Opening Easy Apply…')
    await humanClick(applyButton, ctx.signal)

    const modal = await waitFor(() => this.findModal(), { timeoutMs: 10_000, signal: ctx.signal })
    if (!modal) {
      return { result: 'skipped', reason: 'Easy Apply modal never opened.' }
    }

    return this.driveModal(modal, ctx)
  }

  private findModal(): HTMLElement | null {
    const modal = pick(MODAL_SELECTORS)
    // Guard against matching some unrelated dialog (cookie banner, toast).
    if (!modal) return null
    const hasForm = modal.querySelector('form, input, select, textarea, button')
    return hasForm ? modal : null
  }

  /**
   * The core loop. Each pass: fill what's on screen, decide which footer button
   * advances us, click it, confirm the step actually changed.
   */
  private async driveModal(modal: HTMLElement, ctx: ApplyContext): Promise<ApplyOutcome> {
    let questionsAnswered = 0
    let aiAnswersUsed = 0
    let lastFingerprint = ''

    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (ctx.signal.aborted) {
        await this.dismissModal(ctx)
        return { result: 'skipped', reason: 'Run stopped.' }
      }

      const current = this.findModal()
      if (!current) {
        // The modal closing on its own means the application went through.
        return { result: 'applied', questionsAnswered, aiAnswersUsed }
      }
      modal = current

      ctx.report(`Easy Apply — step ${step + 1}: ${this.stepTitle(modal)}`)

      const fields = this.answerableFields(modal)
      const summary = await fillFields(fields, ctx)

      questionsAnswered += summary.filled
      aiAnswersUsed += summary.results.filter((r) => r.source === 'ai').length

      if (ctx.settings.pauseOnUnknownRequired && summary.blocking.length > 0) {
        const blocker = summary.blocking[0]
        if (blocker) {
          await this.dismissModal(ctx)
          return { result: 'blocked', question: this.toPendingQuestion(blocker, ctx) }
        }
      }

      const action = this.nextAction(modal)

      if (action.kind === 'none') {
        await this.dismissModal(ctx)
        return {
          result: 'failed',
          error: `Stuck on step ${step + 1} — no Next, Review or Submit button found.`,
        }
      }

      if (action.kind === 'submit') {
        if (ctx.dryRun) {
          ctx.report('Dry run — reached Submit, discarding instead.')
          await this.dismissModal(ctx)
          return { result: 'applied', questionsAnswered, aiAnswersUsed }
        }

        ctx.report('Submitting application…')
        await humanClick(action.button, ctx.signal)

        const confirmed = await this.confirmSubmitted(ctx)
        if (!confirmed) {
          return { result: 'failed', error: 'Submitted but saw no confirmation.' }
        }

        await this.dismissPostSubmitModal(ctx)
        return { result: 'applied', questionsAnswered, aiAnswersUsed }
      }

      // Detect a step that didn't advance — usually an inline validation error
      // we can't see. Bailing beats clicking Next forever.
      const fingerprint = this.fingerprint(modal)
      if (fingerprint === lastFingerprint) {
        const error = this.validationError(modal)
        await this.dismissModal(ctx)
        return {
          result: 'failed',
          error: error || `Step ${step + 1} would not advance.`,
        }
      }
      lastFingerprint = fingerprint

      await humanClick(action.button, ctx.signal)
      await pause(ctx.settings.minActionDelayMs, ctx.settings.maxActionDelayMs, ctx.signal)
    }

    await this.dismissModal(ctx)
    return { result: 'failed', error: `Gave up after ${MAX_STEPS} steps.` }
  }

  /** Which footer button moves us forward. Submit wins, then Review, then Next. */
  private nextAction(modal: HTMLElement): StepAction {
    const footer =
      modal.querySelector<HTMLElement>('footer') ??
      modal.querySelector<HTMLElement>('.artdeco-modal__actionbar') ??
      modal

    const submit =
      pick(['button[aria-label*="Submit application" i]'], footer) ??
      findByText(TEXT.submit, ['button'], footer)
    if (submit) return { kind: 'submit', button: submit }

    const review =
      pick(['button[aria-label*="Review" i]'], footer) ??
      findByText(['review your application', 'review'], ['button'], footer)
    if (review) return { kind: 'review', button: review }

    const next =
      pick(['button[aria-label*="Continue to next step" i]', 'button[aria-label*="Next" i]'], footer) ??
      findByText(['continue to next step', 'next', 'continue'], ['button'], footer)
    if (next) return { kind: 'next', button: next }

    return { kind: 'none' }
  }

  /**
   * Fields worth answering on this step. LinkedIn's modal carries a few
   * controls that aren't questions — the "follow this company" toggle and the
   * saved-answers checkbox — which we deliberately leave as the user set them.
   */
  private answerableFields(modal: HTMLElement): DetectedField[] {
    return collectFields(modal).filter((field) => {
      const label = field.label.toLowerCase()
      if (label.includes('follow') && label.includes('company')) return false
      if (label.includes('save this application')) return false
      if (label.includes('save my answers')) return false
      return true
    })
  }

  private stepTitle(modal: HTMLElement): string {
    const heading = pick(['h3', 'h2', '.jobs-easy-apply-content h3'], modal)
    return heading ? dedupe(text(heading)).slice(0, 80) : 'form'
  }


  /**
   * A cheap signal of "which step am I on", used to notice when a click didn't
   * take. Combines the progress meter with the set of visible field labels.
   */
  private fingerprint(modal: HTMLElement): string {
    const progress = modal
      .querySelector('[role="progressbar"], .artdeco-completeness-meter-linear__progress-element')
      ?.getAttribute('aria-valuenow')

    const labels = Array.from(modal.querySelectorAll('label'))
      .slice(0, 12)
      .map((l) => normalizeText(l.textContent).slice(0, 40))
      .join('|')

    return `${progress ?? '?'}::${labels}`
  }

  /** Any inline error LinkedIn rendered, so a failure says something useful. */
  private validationError(modal: HTMLElement): string {
    const errors = pickAll(
      ['.artdeco-inline-feedback--error', '[role="alert"]', '.fb-form-element__error-text'],
      modal,
    )
    return errors.map((e) => normalizeText(text(e))).filter(Boolean).join('; ').slice(0, 300)
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

  /** Wait for the "application sent" confirmation, or for the modal to close. */
  private async confirmSubmitted(ctx: ApplyContext): Promise<boolean> {
    const confirmation = await waitFor(
      () => {
        const banner = findByText(
          ['application sent', 'your application was sent', 'applied'],
          ['h2', 'h3', 'p', 'div[role="alert"]', '.artdeco-toast-item__message'],
        )
        if (banner) return banner
        // Modal gone with no error showing also counts as sent.
        return this.findModal() ? null : document.body
      },
      { timeoutMs: 15_000, signal: ctx.signal },
    )

    return Boolean(confirmation)
  }

  /** The post-submit "application sent" dialog, which has its own Done button. */
  private async dismissPostSubmitModal(ctx: ApplyContext): Promise<void> {
    const done = findByText(['done', 'not now', 'no thanks', 'close'], [
      'button',
      '[role="button"]',
    ])
    if (done) {
      await humanClick(done, ctx.signal)
      await sleep(500, ctx.signal)
    }
  }

  /**
   * Close the modal without applying, handling the "Discard / Save" prompt
   * LinkedIn raises when there's unsaved input. We always discard: a half-built
   * draft sitting in your account is worse than nothing.
   */
  private async dismissModal(ctx: ApplyContext): Promise<void> {
    try {
      const closeButton =
        pick(['button[aria-label*="Dismiss" i]', 'button[aria-label*="Close" i]']) ??
        findByText(['dismiss', 'close'], ['button'])

      if (closeButton) {
        await humanClick(closeButton, ctx.signal)
        await sleep(600)
      }

      const discard = findByText(['discard', "don't save", 'do not save'], [
        'button',
        '[role="button"]',
      ])
      if (discard && isVisible(discard)) {
        await humanClick(discard, ctx.signal)
      }

      await waitForGone(() => this.findModal(), { timeoutMs: 4000 })
    } catch (err) {
      // Never let cleanup failure mask the real outcome of the application.
      console.warn('[LosJobios] modal dismiss failed', err)
    }
  }

  // -------------------------------------------------------------------------
  // Autofill (manual, single page)
  // -------------------------------------------------------------------------

  async autofill(ctx: ApplyContext): Promise<AutofillReport> {
    const modal = this.findModal()
    const fields = modal ? this.answerableFields(modal) : collectFields(document)

    ctx.report(`Filling ${fields.length} fields.`)
    const summary = await fillFields(fields, ctx)

    return {
      filled: summary.filled,
      skipped: summary.skipped,
      unfilled: summary.unanswered.map((f) => f.label).filter(Boolean),
    }
  }
}

/**
 * Collapse LinkedIn's duplicated screen-reader text ("Senior EngineerSenior
 * Engineer" → "Senior Engineer").
 */
function dedupe(value: string): string {
  const clean = normalizeText(value)
  if (!clean) return clean

  // "TitleTitle" — repeated with no separator at all.
  const half = clean.length / 2
  if (clean.length % 2 === 0 && clean.slice(0, half) === clean.slice(half)) {
    return clean.slice(0, half).trim()
  }

  // "Title Title" — repeated with a separator, which is what the two spans
  // collapse to once innerText joins them.
  const mid = Math.floor(clean.length / 2)
  const left = clean.slice(0, mid).trim()
  const right = clean.slice(mid).trim()
  if (left && left === right) return left

  const parts = clean.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean)
  if (parts.length === 2 && parts[0] === parts[1]) return parts[0] ?? clean

  return clean
}

/**
 * Text with the screen-reader duplicate stripped.
 *
 * This UI renders the same string twice throughout — once visible, once in an
 * `aria-hidden` twin — so a naive innerText read says everything twice
 * ("Product OwnerProduct Owner"). Removing the hidden copy is more reliable
 * than trying to detect the repetition after the fact, with `dedupe` left as
 * a fallback for the layouts that duplicate some other way.
 */
function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
  return dedupe(normalizeText(clone.textContent))
}
