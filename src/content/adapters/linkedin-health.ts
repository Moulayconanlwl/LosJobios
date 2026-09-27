import { normalizeText } from '../dom/query'

/**
 * Is LinkedIn itself in a state worth stopping for?
 *
 * Ported from `autoapplycv`'s `linkedin-page-health.js` (PolyForm
 * Noncommercial 1.0.0 — Required Notice: Copyright AutoCVApply,
 * https://autocvapply.com). See docs/THIRD_PARTY_NOTICES.md.
 *
 * The distinction this draws is the useful one. A single application failing
 * is normal and the run should carry on; being signed out, rate limited or
 * sitting on a security checkpoint is not, and carrying on then means
 * twenty more failures and a louder signal to LinkedIn that something
 * automated is driving the account.
 */

export type HealthCode =
  | 'session_expired'
  | 'checkpoint'
  | 'login_loop'
  | 'rate_limit'
  | 'something_went_wrong'
  | 'generic_error'

export type HealthIssue = {
  code: HealthCode
  message: string
  /** True when the run should stop rather than move to the next job. */
  blocking: boolean
}

/** Codes that mean the whole run should stop, not just this application. */
const BLOCKING = new Set<HealthCode>([
  'session_expired',
  'checkpoint',
  'login_loop',
  'rate_limit',
  'something_went_wrong',
])

const TEXT_PATTERNS: Array<{ code: HealthCode; pattern: RegExp }> = [
  { code: 'something_went_wrong', pattern: /something went wrong|une erreur s'est produite/i },
  {
    code: 'rate_limit',
    pattern: /rate limit|too many requests|try again later|slow down|trop de requ[êe]tes/i,
  },
  {
    code: 'session_expired',
    pattern: /session expired|sign in again|session has timed out|please sign in|session a expir/i,
  },
  { code: 'generic_error', pattern: /unable to load|could not load|an error occurred/i },
]

const MESSAGES: Record<HealthCode, string> = {
  session_expired: 'LinkedIn signed you out. Sign back in, then resume.',
  checkpoint: 'LinkedIn is showing a security checkpoint. Clear it yourself, then resume.',
  login_loop: 'LinkedIn redirected to its login page. Sign in, then resume.',
  rate_limit:
    'LinkedIn is rate limiting this account. Stop for a while — continuing now is what gets accounts restricted.',
  something_went_wrong: 'LinkedIn is reporting an error of its own.',
  generic_error: 'Part of the page would not load.',
}

/**
 * The worst thing wrong with the page right now, or null.
 *
 * URL checks come first and are the most reliable: a redirect to
 * `/checkpoint` or `/authwall` is unambiguous, whereas body text can match a
 * phrase inside a job description — someone's posting really can contain the
 * words "try again later".
 */
export function checkPageHealth(root: Document = document): HealthIssue | null {
  try {
    const url = new URL(root.location.href)

    if (/(^|\.)linkedin\.com$/.test(url.hostname)) {
      if (url.pathname.includes('/checkpoint') || url.pathname.includes('/challenge')) {
        return issue('checkpoint')
      }
      if (url.pathname.includes('/authwall') || url.pathname.startsWith('/login')) {
        return issue('login_loop')
      }
    }
  } catch {
    // A malformed location is not itself a health problem.
  }

  /*
   * Text is checked against the page's *chrome*, not its whole body.
   *
   * Scanning everything matches phrases inside the posting the user is
   * applying to — "unable to load" in a description of a debugging role would
   * stop the run — so this only reads the alert and toast surfaces LinkedIn
   * uses to talk about itself.
   */
  const surfaces = root.querySelectorAll(
    '[role="alert"], .artdeco-toast-item__message, .artdeco-inline-feedback--error, .error-container',
  )

  for (const surface of surfaces) {
    const text = normalizeText(surface.textContent)
    if (!text) continue

    for (const { code, pattern } of TEXT_PATTERNS) {
      if (pattern.test(text)) return issue(code, text.slice(0, 160))
    }
  }

  return null
}

function issue(code: HealthCode, detail?: string): HealthIssue {
  return {
    code,
    message: detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code],
    blocking: BLOCKING.has(code),
  }
}
