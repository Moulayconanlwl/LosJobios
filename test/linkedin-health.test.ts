import { beforeEach, describe, expect, it } from 'vitest'
import { checkPageHealth } from '@/content/adapters/linkedin-health'

/**
 * Telling "this application failed" apart from "LinkedIn is not usable".
 *
 * The distinction is what stops a run turning one problem into twenty. If the
 * account is signed out, rate limited, or sitting on a security checkpoint,
 * every remaining job in the queue will fail the same way — and grinding
 * through them is exactly the pattern that gets an account restricted.
 */

type HappyDomWindow = Window & { happyDOM?: { setURL?: (href: string) => void } }

function setLocation(href: string): void {
  ;(window as HappyDomWindow).happyDOM?.setURL?.(href)
}

beforeEach(() => {
  document.body.innerHTML = ''
  setLocation('https://www.linkedin.com/jobs/search/')
})

describe('URL checks', () => {
  it('treats a security checkpoint as blocking', () => {
    setLocation('https://www.linkedin.com/checkpoint/challenge/verify')
    expect(checkPageHealth(document)).toMatchObject({ code: 'checkpoint', blocking: true })
  })

  it('treats the auth wall as blocking', () => {
    setLocation('https://www.linkedin.com/authwall?trk=x')
    expect(checkPageHealth(document)).toMatchObject({ code: 'login_loop', blocking: true })
  })

  it('says nothing about an ordinary jobs page', () => {
    expect(checkPageHealth(document)).toBeNull()
  })
})

describe('page text', () => {
  it('detects rate limiting from an alert', () => {
    document.body.innerHTML = '<div role="alert">Too many requests, please try again later</div>'
    expect(checkPageHealth(document)).toMatchObject({ code: 'rate_limit', blocking: true })
  })

  it('detects being signed out from a toast', () => {
    document.body.innerHTML =
      '<div class="artdeco-toast-item__message">Your session expired, please sign in</div>'
    expect(checkPageHealth(document)).toMatchObject({ code: 'session_expired', blocking: true })
  })

  it('does NOT scan the job description for those phrases', () => {
    /*
     * The bug this prevents: a posting for a reliability role whose text
     * contains "unable to load" or "try again later" would stop the run
     * against a perfectly healthy page. Only LinkedIn's own alert and toast
     * surfaces are read, never the posting.
     */
    document.body.innerHTML = `
      <div id="job-details">
        You will debug systems that are unable to load, and handle rate limit errors.
        Users see "something went wrong" and you find out why.
      </div>
    `
    expect(checkPageHealth(document)).toBeNull()
  })

  it('marks a non-blocking error as not blocking', () => {
    // One widget failing to load is not a reason to abandon the queue.
    document.body.innerHTML = '<div role="alert">Unable to load recommendations</div>'
    expect(checkPageHealth(document)).toMatchObject({ code: 'generic_error', blocking: false })
  })
})
