import { beforeEach, describe, expect, it } from 'vitest'
import { extractDescription } from '@/lib/extract-description'

/**
 * Getting the posting, and nothing but the posting.
 *
 * The reported bug: "Fetch description" came back with LinkedIn's top card,
 * its Premium advert, its footer and its entire language picker — and none of
 * the actual job description. Everything downstream is built on this text, so
 * a cover letter was being written about LinkedIn's marketing copy.
 *
 * The cause was taking `main` whole and calling it the longest match. The
 * page furniture really is longer than most job descriptions, so "longest
 * wins" picks it every time.
 */

/** The chrome that swamped the real description in the reported failure. */
const PAGE_CHROME = `
  <header>
    HN Services Business Analyst Assurance vie (H/F) Paris, Île-de-France, France · 3 weeks ago
    · Over 100 applicants Promoted by hirer · On-site Full-time Easy Apply Save
  </header>
  <div class="premium-upsell-card">
    Use AI to assess how you fit. Get AI-powered advice on this job and more exclusive features
    with Premium. Reactivate Premium. See how you compare to 100 applicants. Unlock exclusive
    applicant insights on your saved jobs — and where you have the highest chance of hearing
    back. Job search smarter with Premium. See jobs where you'd be a top applicant. Message
    hiring managers with InMail. Get personalized cover letter and resume tips.
  </div>
  <footer class="global-footer">
    About Accessibility Talent Solutions Community Guidelines Careers Marketing Solutions
    Privacy &amp; Terms Ad Choices Advertising Sales Solutions Mobile Small Business Safety
    Center LinkedIn Corporation © 2026 Questions? Visit our Help Center.
    <div class="language-selector">
      العربية (Arabic) বাংলা (Bangla) Čeština (Czech) Dansk (Danish) Deutsch (German)
      Ελληνικά (Greek) English (English) Español (Spanish) فارسی (Persian) Suomi (Finnish)
      Français (French) हिंदी (Hindi) Magyar (Hungarian) Bahasa Indonesia Italiano (Italian)
      עברית (Hebrew) 日本語 (Japanese) 한국어 (Korean) मराठी (Marathi) Nederlands (Dutch)
    </div>
  </footer>
`

const REAL_DESCRIPTION = `
  Nous recherchons un Business Analyst Assurance vie pour accompagner notre client sur un
  programme de transformation. Vous interviendrez sur le recueil et la formalisation des
  besoins métier, la rédaction des spécifications fonctionnelles et le pilotage des recettes.
  Vous justifiez d'une expérience significative en assurance vie et d'une bonne maîtrise des
  outils de modélisation. La connaissance de SQL et des méthodes agiles est un plus.
`

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('when the posting has its own container', () => {
  it('returns the description and none of the page furniture', () => {
    document.body.innerHTML = `
      <main>
        ${PAGE_CHROME}
        <div id="job-details">${REAL_DESCRIPTION}</div>
      </main>
    `

    const text = extractDescription(true)

    expect(text).toContain('Business Analyst Assurance vie pour accompagner')
    // The three things that actually came back in the reported failure.
    expect(text).not.toContain('Reactivate Premium')
    expect(text).not.toContain('LinkedIn Corporation')
    expect(text).not.toMatch(/\(Arabic\)|\(Japanese\)/)
  })

  it('reads the signed-out guest layout too', () => {
    // A posting opened in a fresh background tab often gets served this one.
    document.body.innerHTML = `
      <main>${PAGE_CHROME}<div class="show-more-less-html__markup">${REAL_DESCRIPTION}</div></main>
    `

    expect(extractDescription(true)).toContain('spécifications fonctionnelles')
  })

  it('reads Indeed', () => {
    document.body.innerHTML = `<main>${PAGE_CHROME}<div id="jobDescriptionText">${REAL_DESCRIPTION}</div></main>`
    expect(extractDescription(true)).toContain('assurance vie')
  })
})

describe('when the description has not rendered yet', () => {
  it('returns nothing rather than the page furniture', () => {
    /*
     * The heart of the bug. The old code polled, and on the very first poll
     * `main` already matched the chrome and was over the length threshold —
     * so it returned that and never waited for the description at all.
     * Refusing to fall back early is what gives the posting time to arrive.
     */
    document.body.innerHTML = `<main>${PAGE_CHROME}</main>`

    expect(extractDescription(false)).toBe('')
  })
})

describe('the last-resort fallback', () => {
  it('finds the description block on a page with no known container', () => {
    document.body.innerHTML = `
      <main>
        ${PAGE_CHROME}
        <section><div class="posting-body">${REAL_DESCRIPTION}</div></section>
      </main>
    `

    const text = extractDescription(true)

    expect(text).toContain('Business Analyst Assurance vie')
    expect(text).not.toContain('LinkedIn Corporation')
  })

  it('still refuses to return the page furniture when there is no description', () => {
    // Better to come back empty and say so than to hand the cover-letter
    // writer LinkedIn's own advertising copy as the job description.
    document.body.innerHTML = `<main>${PAGE_CHROME}</main>`

    const text = extractDescription(true)

    expect(text).not.toContain('Reactivate Premium')
    expect(text).not.toContain('LinkedIn Corporation')
  })
})

describe('adjacent blocks keep a space between them', () => {
  it('does not weld two elements into one word', () => {
    /*
     * `textContent` concatenates with no separator, so "Easy Apply" followed
     * by "Business Analyst" came out as the single token
     * `easyapplybusiness` — which the ATS scorer then counted as a keyword.
     */
    document.body.innerHTML = `
      <main>
        <div id="job-details">
          <div>Easy Apply</div><div>Business Analyst</div>
          <p>${REAL_DESCRIPTION}</p>
        </div>
      </main>
    `

    const text = extractDescription(true)

    expect(text).not.toMatch(/applybusiness/i)
    expect(text).toContain('Easy Apply Business Analyst')
  })
})
