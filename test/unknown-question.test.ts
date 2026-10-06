import { describe, expect, it } from 'vitest'
import { defaultSettings, settingsSchema, jobRefSchema, runStateSchema } from '@/lib/schema'
import { profileContext } from '@/lib/ai/provider'
import { defaultProfile } from '@/lib/schema'

/**
 * What happens when nothing can answer a required question.
 *
 * The answer bank, the profile heuristics and the AI reading the CV have all
 * failed. There are exactly two honest responses — stop and ask, or give up
 * on that posting and say so — and the one thing that must never happen is a
 * guess, because a guess is sent to a real employer under the user's name.
 */

describe('the unknown-question policy', () => {
  it('defaults to asking rather than skipping', () => {
    // Skipping silently loses applications the user could have had. Asking is
    // the conservative default; skipping is opt-in.
    expect(defaultSettings().onUnknownQuestion).toBe('ask')
  })

  it('accepts only the two honest options', () => {
    expect(settingsSchema.parse({ onUnknownQuestion: 'skip' }).onUnknownQuestion).toBe('skip')
    // Anything else — including a "guess" mode — is not a thing that exists.
    expect(settingsSchema.safeParse({ onUnknownQuestion: 'guess' }).success).toBe(false)
  })

  it('fills the default in for settings saved before it existed', () => {
    // Additive migration: an older stored record must not become invalid.
    const migrated = settingsSchema.parse({ dailyCap: 10 })
    expect(migrated.onUnknownQuestion).toBe('ask')
    expect(migrated.dailyCap).toBe(10)
  })
})

describe('the AI answering from the CV', () => {
  it('puts the resume text in the prompt context', () => {
    /*
     * The structured profile is a summary someone typed once; the CV is where
     * the specifics live. A question like "describe your experience with
     * Splunk" is answerable from the document and not from `skills: [...]`,
     * so withholding it leaves the model either vague or inventive.
     */
    const context = profileContext({
      ...defaultProfile(),
      resume: {
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        dataBase64: '',
        text: 'Designed and led Signal Tower, centralising 52 KPIs across 7 domains.',
        sizeBytes: 1,
        updatedAt: 0,
      },
    })

    expect(context).toContain('Signal Tower')
    expect(context).toContain('52 KPIs')
  })

  it('says nothing about a resume when there is none', () => {
    expect(profileContext(defaultProfile())).not.toMatch(/Resume \(verbatim/)
  })

  it('tells the model not to contradict the document', () => {
    // The instruction that keeps "answer from the CV" from becoming
    // "embellish the CV".
    const context = profileContext({
      ...defaultProfile(),
      resume: {
        fileName: 'cv.pdf',
        mimeType: 'application/pdf',
        dataBase64: '',
        text: 'Five years of Python.',
        sizeBytes: 1,
        updatedAt: 0,
      },
    })

    expect(context).toMatch(/never state anything it contradicts/i)
  })
})

describe('run state carries how its queue was built', () => {
  it('defaults to a search run', () => {
    expect(runStateSchema.parse({}).mode).toBe('search')
  })

  it('remembers a selected run', () => {
    // `selected` is what tells the loop to navigate to each posting's own URL
    // rather than looking for a card that is not on the page.
    expect(runStateSchema.parse({ mode: 'selected' }).mode).toBe('selected')
  })
})

describe('a scraped job carries its description', () => {
  it('defaults to empty so older records still parse', () => {
    expect(jobRefSchema.parse({ externalId: 'a' }).description).toBe('')
  })

  it('keeps the text when the scrape captured it', () => {
    const job = jobRefSchema.parse({ externalId: 'a', description: 'Nous recherchons…' })
    expect(job.description).toBe('Nous recherchons…')
  })
})
