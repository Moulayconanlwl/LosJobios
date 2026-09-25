import { deepQueryAll, isDisplayed, normalizeText } from './dom/query'
import { accessibleName } from './dom/query'

/**
 * Reading a form's own complaints back to the user.
 *
 * When an application form rejects something, the extension currently learns
 * only that the page "would not advance" — so the run dies with a message
 * that blames itself for a problem the page already explained in plain words
 * a few pixels away. Surfacing the form's own error text turns an
 * unactionable failure into a fixable one.
 *
 * Read-only, and it never retries anything. Repeatedly resubmitting a form to
 * see whether the error clears is how you get rate-limited, and it isn't this
 * module's decision to make.
 */

export type ValidationError = {
  /** The form's own wording, not ours. */
  message: string
  /** The field it belongs to, when it could be attributed to one. */
  fieldLabel: string
}

/** Where ATS platforms put inline error text. */
const ERROR_SELECTORS = [
  '[role="alert"]',
  '[aria-live="assertive"]',
  '.error',
  '.field-error',
  '.invalid-feedback',
  '[class*="error-message"]',
  '[class*="errorMessage"]',
  '[class*="field--error"]',
  '.artdeco-inline-feedback--error',
  '.fb-form-element__error-text',
]

/** Noise that shows up in error containers but isn't an error. */
const NOT_AN_ERROR = /^(\*|required|\s*)$/i

/**
 * Find the control an error belongs to.
 *
 * `aria-describedby` is the only authoritative link — a form that sets it has
 * told us exactly which field it means. Everything after that is proximity,
 * which is a guess, so an unattributed error is reported with an empty label
 * rather than pinned to whichever field happened to be nearest.
 */
function attributeTo(error: Element): string {
  const root = error.getRootNode()
  const scope: Document | ShadowRoot =
    root instanceof ShadowRoot || root instanceof Document ? root : document

  if (error.id) {
    const described = scope.querySelector(
      `[aria-describedby~="${CSS.escape(error.id)}"], [aria-errormessage="${CSS.escape(error.id)}"]`,
    )
    if (described) return accessibleName(described)
  }

  // A field flagged invalid inside the same wrapper is a strong second guess.
  //
  // Starting from the *parent*, not the error node: `closest` matches the
  // element it is called on, and an error is very often itself a `div`, so
  // searching from the node would search inside the error's own markup and
  // find nothing every time.
  const wrapper = error.parentElement?.closest(
    'label, fieldset, [class*="field"], [class*="form-group"], div',
  )
  if (wrapper) {
    const invalid = wrapper.querySelector('[aria-invalid="true"]')
    if (invalid) return accessibleName(invalid)

    const control = wrapper.querySelector('input, select, textarea')
    if (control) return accessibleName(control)
  }

  return ''
}

/**
 * Every visible validation message on the page, de-duplicated.
 *
 * Deduplicated on the message *and* the field, because a form that renders
 * the same "This field is required" beside eight empty inputs is telling the
 * user one thing eight times.
 */
export function collectValidationErrors(root: Document | ShadowRoot = document): ValidationError[] {
  const out: ValidationError[] = []
  const seen = new Set<string>()

  for (const selector of ERROR_SELECTORS) {
    for (const el of deepQueryAll(selector, root)) {
      if (!isDisplayed(el)) continue

      const message = normalizeText((el as HTMLElement).innerText || el.textContent).slice(0, 300)
      if (!message || NOT_AN_ERROR.test(message)) continue

      const fieldLabel = attributeTo(el)
      const key = `${fieldLabel}::${message}`
      if (seen.has(key)) continue

      seen.add(key)
      out.push({ message, fieldLabel })
    }
  }

  return out
}
