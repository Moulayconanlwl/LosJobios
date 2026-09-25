import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  armDialogGuard,
  disarmDialogGuard,
  isPostApplyDialog,
  suppressDialog,
} from '@/content/dialog-guard'

/**
 * The guard that keeps LinkedIn's post-apply dialog from stalling a run.
 *
 * An earlier attempt at this closed "any dialog that doesn't look like a
 * form" before every job and broke real applications, so the tests that
 * matter most here are the negative ones: a live Easy Apply step must never
 * be touched, and an unrecognised dialog must be left for the user. The
 * dialog it *does* act on pairs "Not now" with "Update profile", and
 * clicking the wrong one would rewrite the user's LinkedIn profile.
 */

const POST_APPLY = `
  <div role="dialog">
    <button aria-label="Dismiss">×</button>
    <h2>Your application was sent to Equasens!</h2>
    <section><h3>Turn your resume into a profile that recruiters notice</h3></section>
    <footer><button>Not now</button><button>Update profile</button></footer>
  </div>
`

const EASY_APPLY_STEP = `
  <div role="dialog" class="jobs-easy-apply-modal">
    <h3>Additional questions</h3>
    <label for="years">Years of experience</label>
    <input id="years" type="text" />
    <footer><button aria-label="Submit application">Submit application</button></footer>
  </div>
`

function dialog(): HTMLElement {
  return document.querySelector('[role="dialog"]') as HTMLElement
}

beforeEach(() => {
  document.body.innerHTML = ''
  disarmDialogGuard()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  disarmDialogGuard()
})

describe('isPostApplyDialog', () => {
  it('recognises the confirmation dialog', () => {
    document.body.innerHTML = POST_APPLY
    expect(isPostApplyDialog(dialog())).toBe(true)
  })

  it('never touches a dialog holding a form control', () => {
    // The hard guarantee: a live application step is off limits whatever it
    // says inside.
    document.body.innerHTML = EASY_APPLY_STEP
    expect(isPostApplyDialog(dialog())).toBe(false)
  })

  it('refuses even a form that happens to mention the confirmation wording', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <p>Your application was sent to other roles at this company.</p>
        <input type="text" />
      </div>
    `
    expect(isPostApplyDialog(dialog())).toBe(false)
  })

  it('leaves an unrecognised dialog alone', () => {
    document.body.innerHTML = '<div role="dialog"><h2>Cookie preferences</h2></div>'
    expect(isPostApplyDialog(dialog())).toBe(false)
  })

  it('reads the dialog in the language the account runs in', () => {
    document.body.innerHTML = '<div role="dialog"><h2>Votre candidature a été envoyée</h2></div>'
    expect(isPostApplyDialog(dialog())).toBe(true)
  })

  it('catches the upsell even without the confirmation wording', () => {
    document.body.innerHTML =
      '<div role="dialog"><h3>Turn your resume into a profile</h3><button>Not now</button></div>'
    expect(isPostApplyDialog(dialog())).toBe(true)
  })
})

describe('suppressDialog', () => {
  it('clicks the dismissal button, never the other one', () => {
    document.body.innerHTML = POST_APPLY
    const buttons = Array.from(document.querySelectorAll('button'))
    const clicked: string[] = []
    for (const button of buttons) {
      button.addEventListener('click', () => clicked.push(button.textContent ?? ''))
    }

    suppressDialog(dialog())

    // "Update profile" would rewrite the user's LinkedIn profile from their CV.
    expect(clicked).not.toContain('Update profile')
    expect(clicked.length).toBe(1)
  })

  it('hides the dialog when clicking did not close it', () => {
    document.body.innerHTML = POST_APPLY

    suppressDialog(dialog())
    vi.advanceTimersByTime(500)

    // Hidden rather than removed: ripping a node out from under React can
    // throw on its next render.
    expect(dialog().style.display).toBe('none')
    expect(dialog().isConnected).toBe(true)
  })

  it('hides the backdrop too, since that is what eats the clicks', () => {
    document.body.innerHTML = `<div class="artdeco-modal-overlay">${POST_APPLY}</div>`

    suppressDialog(dialog())
    vi.advanceTimersByTime(500)

    const overlay = document.querySelector('.artdeco-modal-overlay') as HTMLElement
    expect(overlay.style.display).toBe('none')
  })

  it('does nothing to a dialog that closed itself', () => {
    document.body.innerHTML = POST_APPLY
    const el = dialog()

    suppressDialog(el)
    el.remove()
    vi.advanceTimersByTime(500)

    expect(el.style.display).toBe('')
  })
})

describe('arming', () => {
  it('ignores the dialog entirely while disarmed', () => {
    document.body.innerHTML = POST_APPLY
    disarmDialogGuard()

    vi.advanceTimersByTime(1000)

    // Outside a submit this feature does not exist.
    expect(dialog().style.display).toBe('')
  })

  it('suppresses a dialog already on screen when it arms', () => {
    document.body.innerHTML = POST_APPLY

    armDialogGuard()
    vi.advanceTimersByTime(500)

    expect(dialog().style.display).toBe('none')
  })

  it('leaves an application step alone even while armed', () => {
    document.body.innerHTML = EASY_APPLY_STEP

    armDialogGuard()
    vi.advanceTimersByTime(500)

    expect(dialog().style.display).toBe('')
  })
})
