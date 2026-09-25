import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPlan, draftOpenQuestions, planFields } from '@/content/plan'
import { collectFields } from '@/content/fields'
import type { ApplyContext } from '@/content/adapters/types'
import type { FieldProposal } from '@/lib/messaging'
import { defaultProfile, defaultSettings, type Profile } from '@/lib/schema'

/**
 * Proposing a fill, rather than performing one.
 *
 * The safety of this flow is carried almost entirely by its *defaults*: what
 * happens if the user glances at the list and presses the button without
 * reading it. Anything uncertain has to arrive unticked, so that the lazy
 * path is the safe path and writing a guess into a real employer's form
 * takes a deliberate act.
 *
 * The other half is that planning writes nothing at all. A review surface
 * that has already filled the form is not a review surface.
 */

function context(profile: Partial<Profile> = {}): ApplyContext {
  return {
    profile: { ...defaultProfile(), ...profile },
    settings: defaultSettings(),
    job: null,
    dryRun: true,
    signal: new AbortController().signal,
    jobDescription: '',
    report: () => {},
  }
}

/** Stub the background resolver, which is what `answers/resolve` would answer. */
function stubResolver(response: { answer: string | null; source: string; confidence: number }) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: vi.fn(async () => response),
    },
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('planFields', () => {
  it('writes nothing to the page', async () => {
    document.body.innerHTML = `
      <label for="email">Email</label><input id="email" type="email" />
    `
    stubResolver({ answer: 'ada@example.com', source: 'heuristic', confidence: 0.9 })

    await planFields(collectFields(document), context({ email: 'ada@example.com' }))

    // The whole promise of a review step.
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('')
  })

  it('proposes a value with its source and a reason', async () => {
    document.body.innerHTML = `<label for="email">Email</label><input id="email" type="email" />`
    stubResolver({ answer: null, source: 'none', confidence: 0 })

    const { proposals } = await planFields(
      collectFields(document),
      context({ email: 'ada@example.com' }),
    )

    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.value).toBe('ada@example.com')
    expect(proposals[0]?.source).toBe('profile')
    expect(proposals[0]?.reason).toBe('From your profile')
  })

  it('pre-selects a confident value taken from the profile', async () => {
    document.body.innerHTML = `<label for="email">Email</label><input id="email" type="email" />`
    stubResolver({ answer: null, source: 'none', confidence: 0 })

    const { proposals } = await planFields(
      collectFields(document),
      context({ email: 'ada@example.com' }),
    )
    expect(proposals[0]?.selected).toBe(true)
  })

  it('leaves an AI draft for a required field unticked', async () => {
    document.body.innerHTML = `
      <label for="q">Why do you want to work here? *</label>
      <textarea id="q" required></textarea>
    `
    stubResolver({ answer: 'Because I admire the company.', source: 'ai', confidence: 0.95 })

    const { proposals } = await planFields(collectFields(document), context())

    // However confident the model sounded, this is the field where a
    // plausible wrong answer does the most damage.
    expect(proposals[0]?.source).toBe('ai')
    expect(proposals[0]?.selected).toBe(false)
  })

  it('leaves a low-confidence value unticked', async () => {
    // Deliberately a label with no profile mapping, so resolution goes to the
    // answer bank rather than taking the local high-confidence shortcut.
    document.body.innerHTML = `<label for="q">Which squad would suit you?</label><input id="q" />`
    stubResolver({ answer: 'Platform', source: 'bank', confidence: 0.2 })

    const { proposals } = await planFields(collectFields(document), context())

    expect(proposals[0]?.source).toBe('bank')
    expect(proposals[0]?.selected).toBe(false)
  })

  it('still lists a field nothing could answer, so the gap is visible', async () => {
    document.body.innerHTML = `<label for="q">Your favourite colour</label><input id="q" />`
    stubResolver({ answer: null, source: 'none', confidence: 0 })

    const { proposals } = await planFields(collectFields(document), context())

    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.value).toBe('')
    expect(proposals[0]?.selected).toBe(false)
    expect(proposals[0]?.reason).toBe('Nothing could answer this')
  })

  it('reports a field that already has a value as skipped rather than proposing it', async () => {
    document.body.innerHTML = `
      <label for="email">Email</label><input id="email" type="email" value="already@there.com" />
    `
    stubResolver({ answer: null, source: 'none', confidence: 0 })

    const plan = await planFields(collectFields(document), context({ email: 'ada@example.com' }))

    expect(plan.proposals).toHaveLength(0)
    expect(plan.skipped).toBe(1)
  })

  it('offers the résumé as an attachment, not as text', async () => {
    document.body.innerHTML = `<label for="cv">Resume</label><input id="cv" type="file" />`
    stubResolver({ answer: null, source: 'none', confidence: 0 })

    const { proposals } = await planFields(
      collectFields(document),
      context({
        resume: {
          fileName: 'ada.pdf',
          mimeType: 'application/pdf',
          dataBase64: 'aGk=',
          text: '',
          sizeBytes: 2,
          updatedAt: 0,
        },
      }),
    )

    expect(proposals[0]?.attachment).toBe(true)
    expect(proposals[0]?.value).toBe('ada.pdf')
  })

  it('does not offer the résumé for a cover letter upload', async () => {
    document.body.innerHTML = `<label for="cl">Cover letter</label><input id="cl" type="file" />`
    stubResolver({ answer: null, source: 'none', confidence: 0 })

    const { proposals } = await planFields(
      collectFields(document),
      context({
        resume: {
          fileName: 'ada.pdf',
          mimeType: 'application/pdf',
          dataBase64: 'aGk=',
          text: '',
          sizeBytes: 2,
          updatedAt: 0,
        },
      }),
    )

    expect(proposals).toHaveLength(0)
  })
})

describe('applyPlan', () => {
  it('writes only what stayed selected', async () => {
    document.body.innerHTML = `
      <label for="a">Email</label><input id="a" type="email" />
      <label for="b">Phone</label><input id="b" type="tel" />
    `
    stubResolver({ answer: null, source: 'none', confidence: 0 })

    const ctx = context({ email: 'ada@example.com', phone: '0700900123' })
    const { proposals } = await planFields(collectFields(document), ctx)

    const decisions = proposals.map((proposal) =>
      proposal.label.toLowerCase().includes('phone')
        ? { ...proposal, selected: false }
        : proposal,
    )

    const result = await applyPlan(decisions, collectFields(document), ctx)

    expect((document.getElementById('a') as HTMLInputElement).value).toBe('ada@example.com')
    expect((document.getElementById('b') as HTMLInputElement).value).toBe('')
    expect(result.filled).toBe(1)
    expect(result.skipped).toEqual(['Phone'])
  })

  it('writes the edited value, not the one originally proposed', async () => {
    document.body.innerHTML = `<label for="a">Email</label><input id="a" type="email" />`
    stubResolver({ answer: null, source: 'none', confidence: 0 })

    const ctx = context({ email: 'stale@example.com' })
    const { proposals } = await planFields(collectFields(document), ctx)

    const edited = proposals.map((p) => ({ ...p, value: 'corrected@example.com' }))
    await applyPlan(edited, collectFields(document), ctx)

    // What the user read and approved is what gets written.
    expect((document.getElementById('a') as HTMLInputElement).value).toBe('corrected@example.com')
  })

  it('writes nothing at all when the user deselected everything', async () => {
    document.body.innerHTML = `<label for="a">Email</label><input id="a" type="email" />`
    stubResolver({ answer: null, source: 'none', confidence: 0 })

    const ctx = context({ email: 'ada@example.com' })
    const { proposals } = await planFields(collectFields(document), ctx)

    const result = await applyPlan(
      proposals.map((p) => ({ ...p, selected: false })),
      collectFields(document),
      ctx,
    )

    expect((document.getElementById('a') as HTMLInputElement).value).toBe('')
    expect(result.filled).toBe(0)
  })

  it('counts a proposal whose field has gone as failed rather than throwing', async () => {
    const ctx = context()
    const orphan: FieldProposal = {
      handle: 'nope',
      label: 'Vanished',
      kind: 'text',
      required: false,
      options: [],
      value: 'x',
      source: 'profile',
      confidence: 1,
      reason: '',
      selected: true,
      attachment: false,
    }

    const result = await applyPlan([orphan], [], ctx)
    expect(result.failed).toBe(1)
  })
})

describe('draftOpenQuestions', () => {
  it('drafts a textarea question', async () => {
    document.body.innerHTML = `
      <label for="q">Why do you want this role?</label><textarea id="q"></textarea>
    `
    stubResolver({ answer: 'Because the work matches mine.', source: 'ai', confidence: 0.9 })

    const proposals = await draftOpenQuestions(collectFields(document), context())

    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.reason).toContain('draft')
  })

  it('never pre-selects a draft', async () => {
    document.body.innerHTML = `<label for="q">Tell us about yourself</label><textarea id="q"></textarea>`
    stubResolver({ answer: 'A paragraph.', source: 'ai', confidence: 0.99 })

    const proposals = await draftOpenQuestions(collectFields(document), context())
    expect(proposals[0]?.selected).toBe(false)
  })

  it('leaves short single-line fields alone', async () => {
    // "First name" is a form field, not a question to write prose into.
    document.body.innerHTML = `<label for="n">First name</label><input id="n" />`
    stubResolver({ answer: 'Ada', source: 'profile', confidence: 1 })

    expect(await draftOpenQuestions(collectFields(document), context())).toEqual([])
  })

  it('leaves a field with fixed options alone', async () => {
    document.body.innerHTML = `
      <label for="s">Are you authorised to work in the EU?</label>
      <select id="s"><option>Yes</option><option>No</option></select>
    `
    stubResolver({ answer: 'Yes', source: 'profile', confidence: 1 })

    // A select has a right answer to match, not prose to write.
    expect(await draftOpenQuestions(collectFields(document), context())).toEqual([])
  })

  it('skips a question that is already answered', async () => {
    document.body.innerHTML = `
      <label for="q">Why do you want this role?</label><textarea id="q">Already written.</textarea>
    `
    stubResolver({ answer: 'New draft.', source: 'ai', confidence: 0.9 })

    expect(await draftOpenQuestions(collectFields(document), context())).toEqual([])
  })
})
