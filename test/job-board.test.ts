import { describe, expect, it } from 'vitest'
import { detectJobBoard, isApplyContinuation } from '@/background/boards'

/**
 * Which pages a run may be started from, and which pages a run in flight is
 * allowed to follow an application onto.
 *
 * Both are security boundaries as much as routing. `detectJobBoard` decides
 * where the extension will scrape and click on its own initiative, and
 * `isApplyContinuation` decides where a *running* application is allowed to
 * carry on filling in the user's real details unattended. A lookalike domain
 * passing either of these would hand an attacker's page an automated form
 * filler primed with a complete profile.
 */

describe('detectJobBoard', () => {
  it('recognises a LinkedIn jobs page', () => {
    expect(detectJobBoard('https://www.linkedin.com/jobs/search/?keywords=dev')).toMatchObject({
      id: 'linkedin',
      navigatesToApply: false,
    })
  })

  it('recognises Indeed searches, postings and the SEO search URL', () => {
    for (const url of [
      'https://fr.indeed.com/jobs?q=developpeur',
      'https://www.indeed.com/viewjob?jk=abc123',
      'https://uk.indeed.com/q-software-engineer-jobs.html',
      'https://indeed.fr/jobs?q=dev',
    ]) {
      expect(detectJobBoard(url), url).toMatchObject({ id: 'indeed' })
    }
  })

  it('marks Indeed as a board that navigates away to apply', () => {
    // This flag is what makes the run engine store a URL to come back to.
    // Getting it wrong on Indeed means every job after the first is attempted
    // against a confirmation page.
    expect(detectJobBoard('https://fr.indeed.com/jobs?q=dev')?.navigatesToApply).toBe(true)
  })

  it('does not claim a LinkedIn page outside /jobs', () => {
    expect(detectJobBoard('https://www.linkedin.com/feed/')).toBeNull()
  })

  it('does not claim an Indeed page outside the job paths', () => {
    expect(detectJobBoard('https://www.indeed.com/career-advice/resumes')).toBeNull()
  })

  it('rejects lookalike domains', () => {
    for (const url of [
      'https://notindeed.com/jobs',
      'https://indeed.com.evil.test/jobs',
      'https://linkedin.com.evil.test/jobs/search',
      'https://mylinkedin.com/jobs/search',
    ]) {
      expect(detectJobBoard(url), url).toBeNull()
    }
  })

  it('returns null for nothing and for junk rather than throwing', () => {
    expect(detectJobBoard(undefined)).toBeNull()
    expect(detectJobBoard('')).toBeNull()
    expect(detectJobBoard('not a url')).toBeNull()
  })
})

describe('http is not enough', () => {
  it('refuses a plain-http page on either board', () => {
    // A run types a full profile into whatever it is pointed at. Doing that
    // over a channel anyone on the network can read or rewrite is not a
    // trade-off worth offering, and both real boards are https-only anyway.
    expect(detectJobBoard('http://www.linkedin.com/jobs/search/')).toBeNull()
    expect(detectJobBoard('http://fr.indeed.com/jobs?q=dev')).toBeNull()
    expect(isApplyContinuation('http://smartapply.indeed.com/indeedapply/form')).toBe(false)
  })
})

describe('isApplyContinuation', () => {
  it('recognises the hosted Indeed apply form', () => {
    for (const url of [
      'https://smartapply.indeed.com/beta/indeedapply/form/resume',
      'https://apply.indeed.com/indeedapply/form',
      'https://fr.indeed.com/applystart?jk=abc123',
    ]) {
      expect(isApplyContinuation(url), url).toBe(true)
    }
  })

  it('does not treat the search or a posting as a continuation', () => {
    // Otherwise a run that simply lost its content script would "continue"
    // against the listing page and drive it as if it were a form.
    expect(isApplyContinuation('https://fr.indeed.com/jobs?q=dev')).toBe(false)
    expect(isApplyContinuation('https://fr.indeed.com/viewjob?jk=abc')).toBe(false)
  })

  it('refuses an off-Indeed host however its path is dressed up', () => {
    /*
     * The load-bearing one. A posting whose apply button leads to a
     * third-party ATS must come back false, so the run stops and says so
     * instead of filling a form on a site nobody vetted — and a hostile page
     * must not be able to opt in by putting "indeedapply" in its path.
     */
    expect(isApplyContinuation('https://careers.acme.test/indeedapply/form')).toBe(false)
    expect(isApplyContinuation('https://evil.test/apply/')).toBe(false)
    expect(isApplyContinuation('https://indeed.com.evil.test/indeedapply')).toBe(false)
    expect(isApplyContinuation('https://smartapply.indeed.com.evil.test/indeedapply')).toBe(false)
  })

  it('returns false for nothing and for junk rather than throwing', () => {
    expect(isApplyContinuation(undefined)).toBe(false)
    expect(isApplyContinuation('not a url')).toBe(false)
  })
})
