import { beforeEach, describe, expect, it } from 'vitest'
import { collectFields } from '@/content/fields'
import { fillField } from '@/content/filler'
import type { ApplyContext } from '@/content/adapters/types'
import { defaultProfile, defaultSettings, type ResumeFile } from '@/lib/schema'

/**
 * Which file input gets the résumé.
 *
 * A form with separate "Résumé" and "Cover letter" uploads used to receive
 * the same PDF in both, because every file field was treated as the résumé
 * slot. Sending the wrong document to an employer is worse than sending
 * nothing and being asked about it, so an upload that named a different
 * document is now left alone.
 */

const RESUME: ResumeFile = {
  fileName: 'ada-lovelace.pdf',
  mimeType: 'application/pdf',
  // "hello" — real base64, so the attach path isn't skipped over.
  dataBase64: 'aGVsbG8=',
  text: 'Ada Lovelace, engineer.',
  sizeBytes: 5,
  updatedAt: 0,
}

function context(resume: ResumeFile | null = RESUME): ApplyContext {
  return {
    profile: { ...defaultProfile(), resume },
    settings: defaultSettings(),
    job: null,
    dryRun: true,
    signal: new AbortController().signal,
    jobDescription: '',
    report: () => {},
  }
}

/** The one detected field for a file input carrying `label`. */
function fileField(label: string) {
  document.body.innerHTML = `
    <label for="upload">${label}</label>
    <input id="upload" type="file" />
  `
  const field = collectFields(document).find((entry) => entry.kind === 'file')
  if (!field) throw new Error(`no file field detected for "${label}"`)
  return field
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('file uploads', () => {
  it('sends the résumé to a résumé field', async () => {
    const field = fileField('Resume / CV')
    expect(field.key).toBe('resume')

    const result = await fillField(field, context())
    expect(result.source).toBe('profile')
    expect(result.status).not.toBe('unanswered')
  })

  it('sends the résumé to an unlabelled attachment field', async () => {
    // Nothing says what this wants, and on an application form the résumé is
    // the only reasonable guess.
    const field = fileField('Attach a file')
    expect(field.key).toBeNull()

    const result = await fillField(field, context())
    expect(result.source).toBe('profile')
    expect(result.status).not.toBe('unanswered')
  })

  it('leaves a cover letter upload alone rather than attaching the résumé', async () => {
    const field = fileField('Cover letter')
    expect(field.key).toBe('coverLetter')

    const result = await fillField(field, context())
    expect(result.status).toBe('unanswered')
    expect(result.source).toBe('none')
  })

  it('leaves any other named document alone too', async () => {
    const field = fileField('Portfolio')

    const result = await fillField(field, context())
    expect(result.status).toBe('unanswered')
  })

  it('reports a résumé field as unanswered when no résumé is stored', async () => {
    const field = fileField('Resume')

    const result = await fillField(field, context(null))
    expect(result.status).toBe('unanswered')
  })
})
