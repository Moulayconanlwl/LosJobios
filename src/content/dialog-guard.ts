/**
 * Keeping LinkedIn's post-apply dialog from stalling a run.
 *
 * After a submitted application LinkedIn raises a modal — "Your application
 * was sent", usually with a profile upsell attached. It's modal, so while
 * it's up every click meant for the next job lands on its backdrop instead,
 * and the run grinds to a halt behind it.
 *
 * An earlier attempt at this closed "any dialog that doesn't look like a
 * form" before every job, and broke real applications. This is the narrow
 * version, and the narrowness is the point:
 *
 *   - It is armed only while an application is actually being submitted,
 *     and disarmed the moment that finishes. Outside that window it does
 *     nothing at all.
 *   - A dialog has to be positively identified by its *wording* — the
 *     confirmation phrases, in the languages LinkedIn ships — before it is
 *     touched. Unrecognized dialogs are left alone.
 *   - Anything holding a form control is never touched, whatever it says.
 *     That is the hard guarantee: a real Easy Apply step can't be hidden.
 *   - It hides rather than removes. Ripping a node out from under React
 *     can throw on its next render; an inline `display:none` cannot.
 */

/** Wording that identifies the post-apply dialog, per locale. */
const CONFIRMATION_PHRASES = [
  'application was sent',
  'application sent',
  'candidature a été envoyée',
  'candidature a ete envoyee',
  'candidature envoyée',
  'candidature envoyee',
  'solicitud enviada',
  'bewerbung gesendet',
  'candidatura inviata',
  'sollicitatie verzonden',
]

/** The upsell that rides along with it. */
const UPSELL_PHRASES = [
  'turn your resume into a profile',
  'premium',
  'job alert created',
  'be the first to apply',
]

const DIALOG_SELECTORS = ['div[role="dialog"]', '.artdeco-modal']

let observer: MutationObserver | null = null
let armed = false

function normalized(el: HTMLElement): string {
  return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Is this the dialog we mean?
 *
 * Both halves matter. A form control anywhere inside is an absolute veto —
 * that's an application step, not an announcement. And the text has to
 * actually match something we recognise, so an unfamiliar dialog is left for
 * the user rather than silently hidden.
 */
export function isPostApplyDialog(dialog: HTMLElement): boolean {
  if (dialog.querySelector('input:not([type="hidden"]), select, textarea')) return false

  const text = normalized(dialog)
  if (!text) return false

  const confirms = CONFIRMATION_PHRASES.some((phrase) => text.includes(phrase))
  const upsells = UPSELL_PHRASES.some((phrase) => text.includes(phrase))
  return confirms || upsells
}

/** The button that closes it, if it has one we recognise. */
function dismissButton(dialog: HTMLElement): HTMLElement | null {
  const byLabel = dialog.querySelector<HTMLElement>(
    'button[aria-label*="Dismiss" i], button[aria-label*="Close" i], button[aria-label*="Fermer" i]',
  )
  if (byLabel) return byLabel

  const words = ['not now', 'no thanks', 'done', 'close', 'pas maintenant', 'fermer', 'terminé']
  for (const button of Array.from(dialog.querySelectorAll<HTMLElement>('button'))) {
    const label = (button.getAttribute('aria-label') || button.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    // Exact match only. This dialog pairs "Not now" with "Update profile",
    // and a loose match that hit the second one would rewrite the user's
    // LinkedIn profile from their CV.
    if (words.includes(label)) return button
  }

  return null
}

/** The greyed-out layer behind a modal, which is what actually eats clicks. */
function hideBackdrop(dialog: HTMLElement): void {
  const backdrop =
    dialog.closest<HTMLElement>('.artdeco-modal-overlay') ??
    document.querySelector<HTMLElement>('.artdeco-modal-overlay')

  if (backdrop && backdrop !== dialog) backdrop.style.display = 'none'
}

/**
 * Close one dialog: its own button first, so LinkedIn's own state stays
 * consistent, then hiding as the fallback that always works.
 */
export function suppressDialog(dialog: HTMLElement): void {
  const button = dismissButton(dialog)
  if (button) button.click()

  // Whether or not the click landed, take it out of the way. A dialog that
  // closed itself is already gone and this is a no-op on a detached node.
  window.setTimeout(() => {
    if (!dialog.isConnected) return
    dialog.style.display = 'none'
    hideBackdrop(dialog)
  }, 400)
}

function sweep(): void {
  if (!armed) return

  for (const selector of DIALOG_SELECTORS) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (el.style.display === 'none') continue
      if (isPostApplyDialog(el)) suppressDialog(el)
    }
  }
}

/**
 * Watch for the dialog while an application is being submitted.
 *
 * The observer is created once and left in place; arming is what decides
 * whether it acts. Attaching and detaching a MutationObserver per
 * application would race the dialog it's meant to catch.
 */
export function armDialogGuard(): void {
  armed = true

  if (!observer) {
    observer = new MutationObserver(() => sweep())
    observer.observe(document.body, { childList: true, subtree: true })
  }

  sweep()
}

export function disarmDialogGuard(): void {
  armed = false
}

/** Test seam — there is no other way to observe the armed flag. */
export function isDialogGuardArmed(): boolean {
  return armed
}
