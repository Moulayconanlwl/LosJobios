import { describe, expect, it } from 'vitest'
import { extractJobKeywords, scoreResumeAgainstJob } from '@/lib/ats'
import { defaultProfile, type Profile } from '@/lib/schema'

/**
 * Scoring a French posting.
 *
 * The reported failure, from a real French posting, was a keyword list reading
 * `syst mes`, `exp rience`, `comp tences`, `et la`, `de projet`,
 * `easy applybusiness`, `hours ago`. Three separate bugs produced it:
 *
 *   1. The tokenizer deleted every accented letter and split the word around
 *      the hole, so "systèmes" became the two "terms" `syst` and `mes`.
 *   2. The stopword list was English-only, so a French posting's heaviest
 *      terms were its grammar — `et`, `la`, `de`.
 *   3. The job board's own chrome ("Easy Apply", "3 hours ago") was being
 *      scored as if it were part of the job description.
 */

const FRENCH_JOB = `Business Analyst — Systèmes de Trading Électronique

Nous recherchons un Business Analyst pour accompagner la refonte de nos
systèmes de trading électronique.

Compétences requises :
- Expérience confirmée en gestion de projet et en analyse fonctionnelle
- Maîtrise de SQL et des outils de reporting
- Connaissance des marchés financiers et des systèmes d'exécution
- Expérience avec Python est un plus

Le poste est basé à Paris, en hybride.`

function profileWith(patch: Partial<Profile> = {}): Profile {
  return { ...defaultProfile(), ...patch }
}

const terms = (text: string) => extractJobKeywords(text).map((k) => k.term)

describe('accented words survive tokenizing', () => {
  it('never splits a word around its accent', () => {
    const found = terms(FRENCH_JOB)

    // The exact fragments from the screenshot.
    for (const fragment of ['syst', 'mes', 'exp', 'rience', 'comp', 'tences']) {
      expect(found, `"${fragment}" is a fragment, not a term`).not.toContain(fragment)
    }
  })

  it('keeps the real French terms', () => {
    const found = terms(FRENCH_JOB)

    expect(found).toContain('systemes')
    // "trading" is kept inside the phrase "trading electronique", which is how
    // a recurring two-word term is meant to survive — see extractJobKeywords.
    expect(found.some((term) => term.split(' ').includes('trading'))).toBe(true)
  })

  it('matches an accented posting against an unaccented CV', () => {
    /*
     * The common case, not an edge one: CVs are routinely typed without
     * accents, and a posting written "expérience" must match a resume
     * written "experience". Folding both to the same form is what does it.
     */
    const result = scoreResumeAgainstJob({
      resumeText:
        'Analyste. Dix ans experience sur les systemes de trading electronique. Python, SQL.\nEmail: a@b.fr\nTel: 0612345678\nExperience\nFormation\nCompetences\n2019 - 2025',
      profile: profileWith(),
      jobTitle: '',
      jobDescription: FRENCH_JOB,
    })

    expect(result.matched).toContain('systemes')
    expect(result.matched.some((term) => term.split(' ').includes('trading'))).toBe(true)
  })
})

describe('French grammar is not a keyword', () => {
  it('drops the articles and conjunctions', () => {
    const found = terms(FRENCH_JOB)

    for (const word of ['et', 'la', 'de', 'des', 'en', 'un', 'le', 'les', 'est', 'pour']) {
      expect(found, `"${word}" is grammar, not a skill`).not.toContain(word)
    }
  })

  it('never builds a phrase out of a grammar word', () => {
    // "de projet" was in the reported list; the term is "projet".
    const found = terms(FRENCH_JOB)
    expect(found.filter((t) => t.split(' ').includes('de'))).toEqual([])
    expect(found.filter((t) => t.split(' ').includes('et'))).toEqual([])
  })

  it('drops French job-ad boilerplate the way it drops the English kind', () => {
    const found = terms(FRENCH_JOB)

    for (const word of ['competences', 'experience', 'poste', 'recherchons', 'connaissance']) {
      expect(found, `"${word}" appears in every posting`).not.toContain(word)
    }
  })
})

describe('the job board’s own chrome is not a keyword', () => {
  it('ignores the page furniture that leaks into a scraped posting', () => {
    /*
     * These come from the site's UI rather than the employer's text. Matching
     * on them scores every resume against every posting on that board
     * identically, which is worse than not matching at all.
     */
    const scraped = `${FRENCH_JOB}

Easy Apply · Reposted 3 hours ago · Over 100 applicants · Promoted by hirer
Actively reviewing applicants · Reactivate Premium to unlock exclusive insights`

    const found = terms(scraped)

    for (const word of [
      'easy',
      'applicants',
      'reposted',
      'hours',
      'ago',
      'promoted',
      'hirer',
      'actively',
      'reviewing',
      'premium',
      'insights',
    ]) {
      expect(found, `"${word}" is board furniture`).not.toContain(word)
    }
  })

  it('still finds the employer’s own terms in the same text', () => {
    // The chrome is dropped without taking the posting with it.
    const scraped = `${FRENCH_JOB}\n\nEasy Apply · Reposted 3 hours ago · Over 100 applicants`
    expect(terms(scraped).some((term) => term.split(' ').includes('trading'))).toBe(true)
  })
})
