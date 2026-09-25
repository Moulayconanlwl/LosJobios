import { beforeEach, describe, expect, it } from 'vitest'
import { LinkedInAdapter } from '@/content/adapters/linkedin'

/**
 * Reading a posting's text out of a tab that was opened in the background.
 *
 * Reported live: "Fetch description" came back with nothing every time. The
 * cause was that the lookup used `isVisible`, which requires a non-zero
 * bounding box — and a background tab that has never been painted reports
 * zero-size boxes for perfectly real elements. happy-dom reproduces that
 * condition exactly, because it gives everything a 0×0 rect by default, so
 * these tests fail against the old implementation and pass against the new
 * one without any special setup.
 */

const adapter = new LinkedInAdapter()

const POSTING = `
  About the job
  We are looking for a Project Manager to join our media technology team in Paris.
  You will coordinate delivery across engineering and design, own the roadmap, and
  report to the Head of Delivery. Requirements: five years of project management,
  fluent French and English, and experience with agile delivery at scale.
`

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('LinkedInAdapter.jobDescription', () => {
  it('reads the authenticated job view', () => {
    document.body.innerHTML = `<div id="job-details"><p>${POSTING}</p></div>`
    expect(adapter.jobDescription()).toContain('Project Manager to join our media technology')
  })

  it('reads the signed-out guest posting', () => {
    // A freshly opened tab can land on this layout instead.
    document.body.innerHTML = `<div class="show-more-less-html__markup">${POSTING}</div>`
    expect(adapter.jobDescription()).toContain('agile delivery at scale')
  })

  it('reads a layout whose class names have drifted', () => {
    document.body.innerHTML = `<div class="jobs-description__container--new">${POSTING}</div>`
    expect(adapter.jobDescription()).toContain('Head of Delivery')
  })

  it('takes the longest candidate when a container and its child both match', () => {
    document.body.innerHTML = `
      <div class="jobs-description__content">
        <span id="job-details">About the job</span>
        <div class="jobs-description-content__text">${POSTING}</div>
      </div>
    `
    const result = adapter.jobDescription()
    expect(result).toContain('fluent French and English')
    expect(result.length).toBeGreaterThan(100)
  })

  it('falls back to textContent when innerText is empty', () => {
    // innerText is layout-dependent and comes back empty in a tab that was
    // never rendered — which is the whole point of opening one in the
    // background.
    document.body.innerHTML = `<div id="job-details">${POSTING}</div>`
    const el = document.getElementById('job-details') as HTMLElement
    Object.defineProperty(el, 'innerText', { get: () => '', configurable: true })

    expect(adapter.jobDescription()).toContain('media technology team in Paris')
  })

  it('collapses whitespace so the stored text is comparable', () => {
    document.body.innerHTML = `<div id="job-details">Line one\n\n   Line two</div>`
    expect(adapter.jobDescription()).toBe('Line one Line two')
  })

  it('ignores a description that is hidden outright', () => {
    document.body.innerHTML = `<div id="job-details" style="display:none">${POSTING}</div>`
    expect(adapter.jobDescription()).toBe('')
  })

  it('returns nothing on a page that has no posting on it', () => {
    document.body.innerHTML = '<main><h1>Jobs</h1><p>Search results</p></main>'
    expect(adapter.jobDescription()).toBe('')
  })

  it('caps very long postings', () => {
    document.body.innerHTML = `<div id="job-details">${'word '.repeat(4000)}</div>`
    expect(adapter.jobDescription().length).toBeLessThanOrEqual(8000)
  })
})
