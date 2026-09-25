import { describe, expect, it } from 'vitest'
import {
  applyStepSlug,
  badgeRootOf,
  cardAlreadyApplied,
  cardApplyKind,
  challengePresent,
  controlLabel,
  hasIndeedApplyFilter,
  isApplyFlowUrl,
  isAppliedLabel,
  isContinueLabel,
  isSubmitLabel,
  isTrustworthyJobId,
  jobIdFromCard,
  jobIdFromUrl,
  securityCheckpointPresent,
  withIndeedApplyFilter,
} from '@/content/adapters/indeed-dom'

/**
 * Indeed's DOM, ported from the `autoapplycv` reference implementation.
 *
 * The file is mostly pure functions, and that is the point: the decisions
 * that can do real damage — is this Continue or Submit, is this Indeed Apply
 * or a link off the site, has the user already applied — are all decidable
 * from a string or a node, so they can be pinned down without a live run.
 */

function mount(html: string): Element {
  document.body.innerHTML = html
  return document.body.firstElementChild as Element
}

// ---------------------------------------------------------------------------
// The one that can send a real application
// ---------------------------------------------------------------------------

describe('telling Continue from Submit', () => {
  /*
   * On Indeed's wizard *both* buttons are `type="submit"` — Continue submits
   * the step's own form, Submit sends the application. The element's type
   * therefore says nothing at all, and the label is the only thing that
   * separates "go to step 3" from "apply for this job".
   *
   * The two mistakes are not equally bad. Reading Submit as Continue clicks
   * it, which sends a real application — including under dry run, the setting
   * whose entire promise is that it cannot. Reading Continue as Submit stops
   * a run early, and costs one abandoned application.
   */

  it('never reads a continue label as a submit', () => {
    for (const label of [
      'Continue',
      'Save and continue',
      'Next',
      'Continue to next step',
      'Save and Continue',
    ]) {
      expect(isSubmitLabel(label), label).toBe(false)
    }
  })

  it('refuses a step button whose label merely mentions submitting', () => {
    /*
     * This is the case the continue/next exclusion exists for, and the only
     * one where it changes the answer. A step button reading "Continue to
     * submit application" contains a submit phrase verbatim; without the
     * exclusion it is classified as the end of the flow, and under dry run
     * the run would stop one step early — or, with dry run off, click it
     * believing it had reached the end.
     */
    for (const label of [
      'Continue to submit application',
      'Next: submit application',
      'Save and continue to submit your application',
    ]) {
      expect(isSubmitLabel(label), label).toBe(false)
      expect(isContinueLabel(label), label).toBe(true)
    }
  })

  it('never reads a submit label as a continue', () => {
    for (const label of ['Submit application', 'Submit your application', 'Submit', 'Send']) {
      expect(isContinueLabel(label), label).toBe(false)
    }
  })

  it('recognises the submit wordings Indeed actually ships', () => {
    for (const label of [
      'Submit application',
      'Submit your application',
      'Submit my application',
      'Send application',
      'Submit',
    ]) {
      expect(isSubmitLabel(label), label).toBe(true)
    }
  })

  it('treats an unlabelled button as neither', () => {
    // Which means the adapter reports `none` and stops, rather than guessing
    // "continue" and clicking something it could not read.
    expect(isSubmitLabel('')).toBe(false)
    expect(isContinueLabel('')).toBe(false)
  })

  it('reads the label of an input[type=submit] out of its value', () => {
    // These have empty textContent, so reading only text classifies the one
    // button that must not be misjudged as unlabelled.
    const node = mount('<input type="submit" value="Submit application" />')
    expect(controlLabel(node)).toBe('Submit application')
    expect(isSubmitLabel(controlLabel(node))).toBe(true)
  })

  it('recognises the soft-gate CTA that replaces Continue', () => {
    // Indeed interrupts an application with a "you may not be qualified"
    // interstitial whose continue button says "Apply anyway". Miss it and the
    // run stalls on a step with no Continue button on it at all.
    for (const label of ['Apply anyway', 'Keep applying', 'Yes, I still want to apply']) {
      expect(isContinueLabel(label), label).toBe(true)
      expect(isSubmitLabel(label), label).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Job identity
// ---------------------------------------------------------------------------

describe('isTrustworthyJobId', () => {
  it('accepts a real 16-character hex key', () => {
    expect(isTrustworthyJobId('9f2c41ab7de05613')).toBe(true)
  })

  it('rejects anything that is not 16 hex characters', () => {
    for (const id of ['abc123', '', '9f2c41ab7de0561', '9f2c41ab7de056133', 'zzzzzzzzzzzzzzzz']) {
      expect(isTrustworthyJobId(id), id).toBe(false)
    }
  })

  it('rejects the placeholder ids Indeed puts in its own skeleton markup', () => {
    // Applying to one of these spends a slot off the daily cap on a job that
    // does not exist.
    for (const id of ['0123456789abcdef', 'a1b2c3d4e5f67890', 'abcdef0123456789']) {
      expect(isTrustworthyJobId(id), id).toBe(false)
    }
  })
})

describe('jobIdFromUrl', () => {
  it('reads jk', () => {
    expect(jobIdFromUrl('https://fr.indeed.com/viewjob?jk=9f2c41ab7de05613')).toBe(
      '9f2c41ab7de05613',
    )
  })

  it('reads vjk, which is what the search page uses for the selected job', () => {
    // Reading only `jk` on a search URL tags the posting with whichever job
    // was opened first, not the one actually on screen.
    expect(jobIdFromUrl('https://fr.indeed.com/jobs?q=dev&vjk=3d71b0c9e4a28f65')).toBe(
      '3d71b0c9e4a28f65',
    )
  })

  it('returns null when there is no key', () => {
    expect(jobIdFromUrl('https://fr.indeed.com/jobs?q=dev')).toBeNull()
  })
})

describe('jobIdFromCard', () => {
  it('reads the key off the card link', () => {
    const card = mount(
      '<div class="job_seen_beacon"><a data-jk="9f2c41ab7de05613" href="/rc/clk?jk=9f2c41ab7de05613">Dev</a></div>',
    )
    expect(jobIdFromCard(card)).toBe('9f2c41ab7de05613')
  })

  it('reads the key out of the class name when the link has none', () => {
    const card = mount('<div class="job_seen_beacon job_3d71b0c9e4a28f65"><a href="/x">Dev</a></div>')
    expect(jobIdFromCard(card)).toBe('3d71b0c9e4a28f65')
  })

  it('refuses a card whose href and attribute disagree', () => {
    // The markup has moved under us. Picking one risks applying to a job the
    // user never saw on screen.
    const card = mount(
      '<div class="job_seen_beacon"><a data-jk="9f2c41ab7de05613" href="/rc/clk?jk=3d71b0c9e4a28f65">Dev</a></div>',
    )
    expect(jobIdFromCard(card)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Card triage
// ---------------------------------------------------------------------------

describe('card triage', () => {
  it('finds the badge root on the outer cardOutline', () => {
    /*
     * "Easily apply" and "Applied" sit on the outer wrapper, outside the
     * inner node that carries the job id. Reading badges off the inner node
     * finds nothing, so every posting looks like it might be Indeed Apply and
     * the run opens off-site jobs one after another to find out.
     */
    mount(
      '<div class="cardOutline"><div class="job_seen_beacon" id="inner"></div><span>Easily apply</span></div>',
    )
    const inner = document.getElementById('inner') as Element

    expect(cardApplyKind(inner)).toBeNull()
    expect(cardApplyKind(badgeRootOf(inner))).toBe(true)
  })

  it('reads an off-site apply as false, not as unknown', () => {
    const card = mount('<div class="cardOutline"><a>Apply on company site</a></div>')
    expect(cardApplyKind(card)).toBe(false)
  })

  it('reads an unbadged card as unknown rather than as off-site', () => {
    // A search that was not filtered to Indeed Apply simply does not label
    // every card, and "unknown" is a different answer from "no".
    const card = mount('<div class="cardOutline"><h2>Developer</h2></div>')
    expect(cardApplyKind(card)).toBeNull()
  })

  it('prefers the off-site signal when a card carries both', () => {
    const card = mount(
      '<div class="cardOutline"><span>Easily apply</span><a>Apply on company site</a></div>',
    )
    expect(cardApplyKind(card)).toBe(false)
  })
})

describe('isAppliedLabel', () => {
  it('recognises the English wordings', () => {
    expect(isAppliedLabel('Applied')).toBe(true)
    expect(isAppliedLabel('', 'You applied on 5 March')).toBe(true)
  })

  it('recognises the French wording', () => {
    // The reference implementation this was ported from only ran against
    // English-language boards. On fr.indeed.com an English-only check matches
    // nothing, and the run re-applies to every job already done — which spams
    // the employer rather than merely failing.
    expect(isAppliedLabel('Candidature envoyée')).toBe(true)
    expect(isAppliedLabel('Déjà postulé')).toBe(true)
  })

  it('never reads an Easy Apply badge as already applied', () => {
    // The opposite mistake, and it skips the entire queue.
    expect(isAppliedLabel('Easily apply')).toBe(false)
    expect(isAppliedLabel('Candidature simplifiée')).toBe(false)
    expect(isAppliedLabel('Apply now')).toBe(false)
  })

  it('finds an applied badge anywhere on the card', () => {
    const card = mount('<div class="cardOutline"><span aria-label="You applied on 5 March"></span></div>')
    expect(cardAlreadyApplied(card)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Page identity
// ---------------------------------------------------------------------------

describe('isApplyFlowUrl', () => {
  it('recognises the hosted form', () => {
    expect(isApplyFlowUrl('https://smartapply.indeed.com/beta/indeedapply/form/resume')).toBe(true)
    expect(isApplyFlowUrl('https://apply.indeed.com/indeedapply/form')).toBe(true)
  })

  it('excludes the hidden preload iframe the search page keeps warm', () => {
    /*
     * The single most consequential line in the file. Indeed's *search* page
     * mounts a hidden smartapply iframe. Without this exclusion that frame
     * claims the page's content, so every command goes to an invisible iframe
     * with no job list in it, and an ordinary search reads as an application
     * already in progress.
     */
    expect(
      isApplyFlowUrl('https://smartapply.indeed.com/beta/indeedapply/preloadresumeapply'),
    ).toBe(false)
  })

  it('refuses an off-Indeed host dressed up to look like one', () => {
    expect(isApplyFlowUrl('https://careers.acme.test/indeedapply/form')).toBe(false)
    expect(isApplyFlowUrl('https://smartapply.indeed.com.evil.test/indeedapply')).toBe(false)
    expect(isApplyFlowUrl('http://smartapply.indeed.com/indeedapply/form')).toBe(false)
  })

  it('does not treat a search or a posting as the form', () => {
    expect(isApplyFlowUrl('https://fr.indeed.com/jobs?q=dev')).toBe(false)
    expect(isApplyFlowUrl('https://fr.indeed.com/viewjob?jk=9f2c41ab7de05613')).toBe(false)
  })
})

describe('applyStepSlug', () => {
  it('names the current wizard step', () => {
    expect(applyStepSlug('https://smartapply.indeed.com/beta/indeedapply/form/resume?x=1')).toBe(
      'resume',
    )
    expect(applyStepSlug('https://fr.indeed.com/jobs')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Blockers
// ---------------------------------------------------------------------------

describe('challengePresent', () => {
  it('detects a reCAPTCHA challenge frame', () => {
    mount('<iframe src="https://www.google.com/recaptcha/api2/bframe"></iframe>')
    expect(challengePresent(document)).toBe(true)
  })

  it('detects Turnstile and hCaptcha', () => {
    mount('<div class="cf-turnstile" data-sitekey="x"></div>')
    expect(challengePresent(document)).toBe(true)

    mount('<div class="h-captcha" data-sitekey="x"></div>')
    expect(challengePresent(document)).toBe(true)
  })

  it('ignores the invisible reCAPTCHA badge', () => {
    /*
     * The corner badge marks *invisible* reCAPTCHA and appears on pages that
     * never ask the user for anything. Calling it a challenge halts a run that
     * had nothing wrong with it and sends the user hunting for a captcha that
     * is not on screen.
     */
    mount('<iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor"></iframe>')
    expect(challengePresent(document)).toBe(false)
  })
})

describe('securityCheckpointPresent', () => {
  it('detects a Cloudflare-style interstitial', () => {
    mount('<div id="challenge-running"></div>')
    expect(securityCheckpointPresent(document)).toBe(true)
  })

  it('detects it by the body copy too', () => {
    mount('<div>Checking your browser before accessing indeed.com</div>')
    expect(securityCheckpointPresent(document)).toBe(true)
  })

  it('does not fire on an ordinary page', () => {
    mount('<div>Software Engineer at Acme</div>')
    expect(securityCheckpointPresent(document)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Search URLs
// ---------------------------------------------------------------------------

describe('the Indeed Apply search facet', () => {
  it('adds Indeed’s own filter to a search URL', () => {
    // Far better than filtering after the fact: the results come back
    // containing only postings the run can actually finish, so nothing is
    // opened just to discover it applies somewhere else.
    const filtered = withIndeedApplyFilter('https://fr.indeed.com/jobs?q=dev')

    expect(hasIndeedApplyFilter(filtered)).toBe(true)
    expect(new URL(filtered).searchParams.get('q')).toBe('dev')
  })

  it('leaves a malformed URL alone rather than throwing', () => {
    expect(withIndeedApplyFilter('not a url')).toBe('not a url')
  })
})
