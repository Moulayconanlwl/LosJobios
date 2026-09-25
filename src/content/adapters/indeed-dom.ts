import { normalizeText } from '../dom/query'

/**
 * Indeed's DOM, read the way Indeed actually renders it.
 *
 * Ported from the reference implementation in `autoapplycv`
 * (PolyForm Noncommercial 1.0.0 — Required Notice: Copyright AutoCVApply,
 * https://autocvapply.com). See docs/THIRD_PARTY_NOTICES.md.
 *
 * Kept apart from the adapter because almost all of it is pure: given a node
 * or a string, decide what Indeed means by it. That makes the decisions that
 * matter — is this Indeed Apply or an off-site link, is this Continue or
 * Submit — testable without a run.
 */

/** Indeed job keys are exactly 16 hex characters. Nothing else is one. */
const JOB_ID_RE = /^[a-f0-9]{16}$/i

/**
 * Placeholder ids that appear in Indeed's own skeleton and demo markup.
 *
 * Scraping one and "applying" to it wastes a slot off the daily cap against a
 * job that does not exist. They are all obviously synthetic — ascending or
 * repeating nibble runs — which is also how the structural checks below catch
 * ones not on this list.
 */
const PLACEHOLDER_IDS = new Set([
  '890abcdef0123456',
  '456789abcdef0123',
  'cdef0123456789ab',
  '0123456789abcdef',
  'abcdef0123456789',
  '0f1e2d3c4b5a6978',
  'f1e2d3c4b5a67890',
  'f1e2d3c4b5a69780',
  'a1b2c3d4e5f67890',
  'a1b2c3d4e5f60789',
  '123456789abcdef0',
])

/** Is this a real job key rather than a placeholder scraped off a skeleton? */
export function isTrustworthyJobId(value: string | null | undefined): boolean {
  const id = String(value ?? '').toLowerCase()
  if (!JOB_ID_RE.test(id)) return false
  if (PLACEHOLDER_IDS.has(id)) return false
  if (/^(?:0123456789abcdef|fedcba9876543210)$/.test(id)) return false
  if (/^(?:f1e2d3c4b5a6|a1b2c3d4e5f6)[0-9a-f]{4}$/.test(id)) return false

  // Ascending byte runs (1a2b3c…) are generated, not assigned.
  const pairs = id.match(/[0-9a-f]{2}/g) ?? []
  let ascending = 0
  for (let i = 1; i < pairs.length; i += 1) {
    const current = Number.parseInt(pairs[i] ?? '', 16)
    const previous = Number.parseInt(pairs[i - 1] ?? '', 16)
    if (current === previous + 1) ascending += 1
  }
  return ascending < 5
}

/**
 * The job key in a URL.
 *
 * `vjk` matters as much as `jk`: on the search page, selecting a job puts its
 * id in `vjk` while `jk` keeps pointing at whatever was opened first.
 */
export function jobIdFromUrl(href: string): string | null {
  for (const key of ['jk', 'vjk']) {
    const match = new RegExp(`[?&]${key}=([a-f0-9]{16})`, 'i').exec(href)
    const id = match?.[1]?.toLowerCase()
    if (id && isTrustworthyJobId(id)) return id
  }
  return null
}

/**
 * Is this URL the hosted apply form?
 *
 * The `preloadresumeapply` exclusion is load-bearing and non-obvious: Indeed's
 * *search* page keeps a hidden smartapply iframe warmed up. Without this, a
 * search page looks like an apply form — the content script's frame claim goes
 * to an invisible iframe, and the run engine reads an ordinary navigation as a
 * mid-application handoff.
 */
export function isApplyFlowUrl(href: string): boolean {
  if (/preloadresumeapply/i.test(href)) return false

  try {
    const url = new URL(href)
    if (url.protocol !== 'https:') return false
    if (/^(smartapply|apply)\.indeed\.com$/i.test(url.hostname)) return true
    if (!/(^|\.)indeed\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(url.hostname)) return false
    return /indeedapply/i.test(url.pathname) || /indeedapply/i.test(url.search)
  } catch {
    return false
  }
}

/** Which step of the hosted wizard, from its URL. */
export function applyStepSlug(href: string): string | null {
  const marker = '/indeedapply/form/'
  if (!href.includes(marker)) return null
  return href.split(marker)[1]?.split('?')[0]?.split('#')[0] || null
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const CARD_SELECTORS = [
  'div.job_seen_beacon',
  'div.slider_item',
  'div[data-testid="slider_item"]',
  'li[data-testid="job-card"]',
]

/**
 * The element carrying the card's *badges*.
 *
 * "Easily apply" and "Applied" sit on the outer `cardOutline`, which wraps the
 * inner `job_seen_beacon` that carries the job id. Reading badges off the
 * inner node finds nothing, so every posting looks like it might be Indeed
 * Apply — and the run opens dozens of off-site jobs to discover otherwise.
 */
export function badgeRootOf(card: Element): Element {
  return (
    card.closest('div.cardOutline') ??
    card.closest('div.slider_item, div[data-testid="slider_item"], li[data-testid="job-card"]') ??
    card
  )
}

export function jobIdFromCard(card: Element): string | null {
  const link = card.querySelector('a[href*="viewjob"], a[jk], a[data-jk]')
  const href = link?.getAttribute('href') ?? ''
  const fromHref = /jk=([a-f0-9]{16})/i.exec(href)?.[1]?.toLowerCase()
  const fromAttr = /^([a-f0-9]{16})$/i
    .exec(String(link?.getAttribute('data-jk') ?? link?.getAttribute('jk') ?? '').toLowerCase())?.[1]

  // Two different ids on one card means the markup moved under us. Guessing
  // which is right risks applying to a job the user never saw.
  if (fromHref && fromAttr && fromHref !== fromAttr) return null

  const candidate = fromHref ?? fromAttr
  if (candidate && isTrustworthyJobId(candidate)) return candidate

  // Indeed also stamps the id into a class name: `job_<id>`.
  const fromClass = /(?:^|\s)job_([a-f0-9]{16})(?:\s|$)/i
    .exec(`${card.className || ''} ${card.id || ''}`)?.[1]
    ?.toLowerCase()

  return fromClass && isTrustworthyJobId(fromClass) ? fromClass : null
}

/**
 * "This job is applyable in place", in the languages Indeed ships.
 *
 * Kept separate from the applied-check because these two must never be
 * confused: `candidature simplifiée` (Easy Apply) and `candidature envoyée`
 * (already applied) differ by one word and mean opposite things.
 */
const EASY_APPLY_TEXT =
  /\b(?:easily apply|apply with indeed|einfache bewerbung|solicitud sencilla)\b|candidature simplifi[ée]e/i

/**
 * "You have already applied", in the languages Indeed ships.
 *
 * The reference implementation this was ported from only ever ran against
 * English-language boards, so it tests `\bapplied\b` and nothing else. On
 * fr.indeed.com that matches nothing, and the run re-applies to every job the
 * user has already done — which spams the employer rather than merely failing.
 *
 * `\b` is not usable around the accented phrases: JavaScript's word boundary is
 * defined over `[A-Za-z0-9_]`, so the `é` ending "déjà postulé" counts as a
 * non-word character and the trailing boundary never matches at end of string.
 * Those phrases are distinctive enough to need no boundary.
 */
const APPLIED_TEXT =
  /\b(?:applied|application sent|beworben|solicitado)\b|candidature envoy[ée]e|d[ée]j[àa] postul[ée]|candidatura inviata/i

/**
 * Does this card apply on the employer's own site?
 *
 * Checked at *collection* time rather than after opening the posting. A run
 * that only discovers this after navigating has already spent the time, and
 * an off-site apply is one the extension must never drive unattended.
 */
export function cardIsExternalApply(card: Element): boolean {
  for (const element of card.querySelectorAll('a, button, span')) {
    const text = normalizeText(element.textContent)
    const label = normalizeText(element.getAttribute('aria-label') ?? '')
    if (
      /^apply on company site$/i.test(text) ||
      /^apply externally$/i.test(text) ||
      /apply on employer site/i.test(text) ||
      /apply on company site/i.test(label)
    ) {
      return true
    }
  }

  const cardText = normalizeText(card.textContent)
  return /\bapply on company site\b/i.test(cardText) || /\bapply externally\b/i.test(cardText)
}

/** Does this card carry the Indeed Apply badge? */
export function cardHasIndeedApply(card: Element): boolean {
  if (
    card.querySelector(
      '[data-testid="indeedApply"], [data-testid="indeedApplyButton-test"], #indeedApplyButton, [data-indeed-apply]',
    )
  ) {
    return true
  }

  if (
    card.querySelector(
      '[class*="iaLabel"], [class*="IndeedApply"], [aria-label*="Apply with Indeed"], [aria-label*="Easily apply"]',
    )
  ) {
    return true
  }

  for (const element of card.querySelectorAll('div, span')) {
    if (/^easily apply$/i.test(normalizeText(element.textContent))) return true
  }

  const cardText = normalizeText(card.textContent)
  return /\beasily apply\b/i.test(cardText) || /\bapply with indeed\b/i.test(cardText)
}

/**
 * Whether this card is applyable in-place.
 *
 * Three-valued on purpose: `null` means the card said nothing either way, and
 * that is different from "no". A card with no badge on a search that was not
 * filtered to Indeed Apply is simply unlabelled, and the posting itself is
 * the place to find out.
 */
export function cardApplyKind(card: Element): boolean | null {
  if (cardIsExternalApply(card)) return false
  if (cardHasIndeedApply(card)) return true
  return null
}

/**
 * Does this text say the user already applied?
 *
 * The "easily apply" exclusion is what stops every applyable job reading as
 * already-applied. Getting it wrong in that direction skips the whole queue;
 * getting it wrong the other way re-applies to jobs the user already did,
 * which spams the employer.
 */
export function isAppliedLabel(text: string, ariaLabel = ''): boolean {
  const value = normalizeText(text)
  const label = normalizeText(ariaLabel)

  if (!APPLIED_TEXT.test(`${value} ${label}`)) return false

  // Checked after, and decisive: "Easily apply" is a badge on a job you can
  // still apply to, and reading it as "applied" skips the entire queue.
  if (EASY_APPLY_TEXT.test(value) || EASY_APPLY_TEXT.test(label)) return false

  if (/\byou(?:'ve)? applied\b/i.test(label) || /\byou applied on\b/i.test(label)) return true
  if (/^applied$/i.test(value)) return true
  if (/\balready applied\b/i.test(label)) return true
  if (/\bapplication sent\b/i.test(label)) return true

  // The non-English wordings are unambiguous on their own — none of them is a
  // substring of a call to action the way bare "applied" can be.
  return /candidature envoy[ée]e|d[ée]j[àa] postul[ée]|candidatura inviata|\b(?:beworben|solicitado)\b/i.test(
    `${value} ${label}`,
  )
}

export function cardAlreadyApplied(card: Element): boolean {
  for (const element of card.querySelectorAll(
    'button, a, span, [data-testid*="applied"], [class*="applied"]',
  )) {
    if (isAppliedLabel(element.textContent ?? '', element.getAttribute('aria-label') ?? '')) {
      return true
    }
  }
  return isAppliedLabel(card.textContent ?? '')
}

// ---------------------------------------------------------------------------
// The wizard's buttons — the part that must never be got wrong
// ---------------------------------------------------------------------------

/**
 * The visible label of a control.
 *
 * `input[type=submit]` carries its label in `value` and has empty text
 * content, so reading only `textContent` classifies it as unlabelled — and an
 * unlabelled button is exactly the one this must not misjudge.
 */
export function controlLabel(control: Element): string {
  return normalizeText(
    control.getAttribute('aria-label') ||
      control.getAttribute('value') ||
      control.textContent ||
      '',
  )
}

/**
 * Does this label mean "send the application"?
 *
 * The continue/next exclusion comes *first* and is absolute. On Indeed's
 * wizard both buttons are `type="submit"` — Continue submits the step's form,
 * Submit sends the application — so the label is the only thing telling them
 * apart, and a "Save and continue" that fell through to here would be clicked
 * as if it ended the flow.
 */
export function isSubmitLabel(label: string): boolean {
  if (!label) return false
  if (/\b(continue|next|save and continue)\b/i.test(label)) return false

  return (
    /\b(submit application|submit your application|submit my application|send application|send your application)\b/i.test(
      label,
    ) ||
    /^submit$/i.test(label) ||
    /^send$/i.test(label)
  )
}

/**
 * Does this label mean "go to the next step"?
 *
 * The soft-gate CTAs are checked before the broad `continue` matcher. Indeed
 * interrupts an application with a "you may not be qualified" interstitial
 * whose real continue button says *"Apply anyway"* — miss it and the run
 * stalls on a step that has no Continue button at all.
 */
export function isContinueLabel(label: string): boolean {
  if (!label) return false

  if (
    /\b(apply anyway|keep applying|still want to apply)\b/i.test(label) ||
    /^(continue applying|continue to apply)$/i.test(label) ||
    /^yes[,.]?\s*(i\s+)?(still\s+)?(want to\s+)?(continue|apply)\b/i.test(label)
  ) {
    return true
  }

  return (
    /^(continue|save and continue|next|review)$/i.test(label) ||
    /\b(continue|next)\b/i.test(label) ||
    /\breview (your |my )?application\b/i.test(label)
  )
}

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

/**
 * The small reCAPTCHA v3 badge that sits in a page corner.
 *
 * It is not a challenge — it is the marker for *invisible* reCAPTCHA, and it
 * is present on pages that never ask the user for anything. Treating it as a
 * challenge halts a run that had nothing wrong with it.
 */
function isRecaptchaBadge(node: Element): boolean {
  const title = (node.getAttribute('title') ?? '').toLowerCase()
  const src = (node.getAttribute('src') ?? '').toLowerCase()
  if (title.includes('recaptcha') && !title.includes('challenge')) {
    return !src.includes('/bframe')
  }
  return src.includes('/anchor') && !src.includes('/bframe')
}

/**
 * A human-verification challenge that is actually asking for something.
 *
 * Nothing here attempts to answer one. A captcha states that a human is
 * required, and the only correct response is to stop and hand the tab back —
 * which also stops a run burning the rest of its queue against a wall.
 */
export function challengePresent(root: Document = document): boolean {
  for (const selector of ['[data-testid="captcha"]', '#captcha-wrapper']) {
    const element = root.querySelector(selector)
    if (!(element instanceof HTMLElement)) continue
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    if (style?.display === 'none' || style?.visibility === 'hidden') continue
    return true
  }

  if (root.querySelector('.cf-turnstile[data-sitekey], iframe[src*="challenges.cloudflare.com"]')) {
    return true
  }

  if (root.querySelector('iframe[src*="hcaptcha.com"], .h-captcha[data-sitekey]')) return true

  for (const iframe of root.querySelectorAll(
    'iframe[src*="google.com/recaptcha"], iframe[src*="recaptcha/api2"], iframe[title*="reCAPTCHA"]',
  )) {
    if (isRecaptchaBadge(iframe)) continue

    const title = (iframe.getAttribute('title') ?? '').toLowerCase()
    const src = (iframe.getAttribute('src') ?? '').toLowerCase()
    // The challenge and bframe widgets are what block a submit. A bare anchor
    // badge does not.
    if (title.includes('challenge') || src.includes('/bframe')) return true
    if (iframe.closest('#captcha-wrapper, [data-testid="captcha"]')) return true
  }

  return false
}

/**
 * A Cloudflare-style interstitial in front of the whole site.
 *
 * Deliberately distinct from a captcha *inside* an application: this one means
 * no page will load at all until the user clears it, so the run stops rather
 * than retrying. An ordinary reCAPTCHA checkbox is not one of these.
 */
export function securityCheckpointPresent(root: Document = document): boolean {
  const title = normalizeText(root.title)
  if (/security check|just a moment|attention required|cf-browser-verification/i.test(title)) {
    return true
  }

  if (
    root.querySelector(
      '#challenge-running, #challenge-stage, #cf-challenge-running, .cf-browser-verification, #challenge-form',
    )
  ) {
    return true
  }

  const body = normalizeText(root.body?.textContent)
  return /humans only|mistakenly blocked|verify you are human|unusual traffic|checking your browser|enable javascript and cookies/i.test(
    body,
  )
}

/** Has the application gone through? */
export function confirmationPresent(root: Document = document): boolean {
  if (
    root.querySelector(
      '[data-testid="application-submitted"], [data-testid="post-apply"], #mosaic-provider-module-post-apply',
    )
  ) {
    return true
  }

  if (/post-apply|application-submitted/i.test(root.location?.pathname ?? '')) return true

  return /application submitted|application has been submitted|thanks for applying|you applied|application was sent|votre candidature a [ée]t[ée] envoy[ée]e/i.test(
    normalizeText(root.body?.textContent),
  )
}

// ---------------------------------------------------------------------------
// Search URLs
// ---------------------------------------------------------------------------

/**
 * Indeed's own "Indeed Apply only" search facet.
 *
 * Far better than filtering after the fact: the search page comes back
 * containing only postings the run can actually complete, so nothing is
 * opened just to discover it applies somewhere else.
 */
export const INDEED_APPLY_FILTER = '0kf:attr(DSQF7)'

/** Add the Indeed Apply facet to a search URL the user is already on. */
export function withIndeedApplyFilter(href: string): string {
  try {
    const url = new URL(href)
    url.searchParams.set('sc', INDEED_APPLY_FILTER)
    return url.toString()
  } catch {
    return href
  }
}

export function hasIndeedApplyFilter(href: string): boolean {
  try {
    return new URL(href).searchParams.get('sc') === INDEED_APPLY_FILTER
  } catch {
    return false
  }
}
