import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider, parseJsonObject } from '@/lib/ai/gemini'

/**
 * Two things are tested here, both against the reported "resume parsing
 * doesn't fill experience and education" bug:
 *
 *   1. `parseJsonObject` on its own — can it recover a valid result out of a
 *      response that generation cut off mid-array? This is the failure mode
 *      most likely to hit exactly experience/education: they're declared
 *      last in the schema and often the longest, multi-entry fields, so a
 *      token-budget cutoff lands on them first. The repair is field-grained,
 *      not entry-grained: whatever fields of the last, interrupted entry
 *      finished generating survive (real, complete data), and only the one
 *      field that was actually mid-generation is dropped — never kept
 *      half-written. `parseJsonObject` itself does no *semantic* filtering
 *      (an entry with literally nothing in it still comes back as `{}`);
 *      that's `parseExperience`/`parseEducation`'s job, one layer up.
 *   2. `GeminiProvider.parseResume` end-to-end against a mocked `fetch` — does
 *      it actually make two separate, differently-scoped requests, and does a
 *      failure on one side still let the other's data through?
 */

describe('parseJsonObject — truncation recovery', () => {
  it('parses a complete response normally', () => {
    const raw = '{"firstName": "Ada", "skills": ["Python", "Go"]}'
    expect(parseJsonObject(raw)).toEqual({ firstName: 'Ada', skills: ['Python', 'Go'] })
  })

  it('strips markdown fences before parsing', () => {
    const raw = '```json\n{"firstName": "Ada"}\n```'
    expect(parseJsonObject(raw)).toEqual({ firstName: 'Ada' })
  })

  it('recovers every fully-closed entry when the cutoff lands inside a later one', () => {
    // Exactly the shape a truncated `experience` array takes: two complete
    // roles, then a cutoff partway through typing the third one's title.
    const raw =
      '{"experience": [' +
      '{"company": "Acme", "title": "Engineer", "current": false},' +
      '{"company": "Widgets Inc", "title": "Senior Engineer", "current": true},' +
      '{"company": "Globex", "title": "Staff Eng'

    const result = parseJsonObject(raw)
    expect(result).not.toBeNull()
    const experience = result?.['experience'] as Array<{ company: string; title?: string }>

    expect(experience[0]?.company).toBe('Acme')
    expect(experience[1]?.company).toBe('Widgets Inc')

    // The third entry's own "company" field finished generating before the
    // cutoff hit "title" — that's real, complete data, not a guess, so it
    // survives too. Only the field that was actually mid-generation is gone.
    expect(experience).toHaveLength(3)
    expect(experience[2]?.company).toBe('Globex')
    expect(experience[2]?.title).toBeUndefined()
  })

  it('leaves an entry empty, rather than truncated, when the cutoff hits before any field completes', () => {
    const raw =
      '{"experience": [' +
      '{"company": "Acme", "title": "Engineer"},' +
      '{"company": "Cut off mid-fi'

    const result = parseJsonObject(raw)
    const experience = result?.['experience'] as Array<{ company?: string }>
    // parseJsonObject only repairs structure — it has no notion of "this
    // entry is useless", so the second, never-completed entry still appears
    // as an empty object rather than vanishing. Dropping entries with no
    // usable fields is parseExperience's job, one layer up, not this one's.
    expect(experience).toHaveLength(2)
    expect(experience[0]?.company).toBe('Acme')
    expect(experience[1]?.company).toBeUndefined()
  })

  it('drops the truncated field rather than keeping a mangled value', () => {
    const raw = '{"education": [{"school": "MIT", "degree": "BSc", "field": "Computer Sci'
    const result = parseJsonObject(raw)
    // The entry itself has real, complete data (school, degree) and survives
    // — only the field that was mid-generation at cutoff ("Computer Sci",
    // not "Computer Science") is dropped, rather than kept truncated.
    const education = result?.['education'] as Array<Record<string, unknown>>
    expect(education).toHaveLength(1)
    expect(education[0]?.['school']).toBe('MIT')
    expect(education[0]?.['degree']).toBe('BSc')
    expect(education[0]?.['field']).toBeUndefined()
  })

  it('recovers when the cutoff lands right after a complete top-level field', () => {
    const raw = '{"firstName": "Ada", "lastName": "Lovelace", "email": "ada@ex'
    const result = parseJsonObject(raw)
    expect(result).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
  })

  it('recovers a fully-populated array cut off after its last complete element', () => {
    const raw =
      '{"skills": ["Python", "TypeScript", "Kubernetes"], "languages": ["Engli'
    const result = parseJsonObject(raw)
    expect(result?.['skills']).toEqual(['Python', 'TypeScript', 'Kubernetes'])
  })

  it('returns null for input with no JSON object at all', () => {
    expect(parseJsonObject('Sorry, I cannot help with that.')).toBeNull()
  })

  it('does not hang on a large truncated payload', () => {
    const bigArray = Array.from({ length: 50 }, (_, i) => `{"company": "Co${i}", "title": "Role${i}"}`)
    const raw = `{"experience": [${bigArray.join(',')},{"company": "Cutoff`
    const start = performance.now()
    const result = parseJsonObject(raw)
    const experience = result?.['experience'] as Array<{ company?: string }>

    expect(performance.now() - start).toBeLessThan(500)
    // All 50 complete entries, plus the never-completed 51st as an empty
    // shell — see the note above on why parseJsonObject doesn't drop it.
    expect(experience).toHaveLength(51)
    expect(experience[49]?.company).toBe('Co49')
    expect(experience[50]?.company).toBeUndefined()
  })
})

describe('GeminiProvider.parseResume — split calls', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function jsonResponse(payload: unknown) {
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } } as const],
      }),
    }
  }

  it('makes two separate requests, one scoped to history', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ firstName: 'Ada' }))
      .mockResolvedValueOnce(jsonResponse({ experience: [], education: [] }))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await provider.parseResume('Ada Lovelace, Engineer.')

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
    const schemas = bodies.map((b) => b.generationConfig.responseSchema.properties)

    // One request's schema knows about experience/education, the other doesn't.
    expect(schemas.some((p) => 'experience' in p && 'education' in p)).toBe(true)
    expect(schemas.some((p) => 'firstName' in p && !('experience' in p))).toBe(true)
  })

  it('gives the history call a materially larger token budget than the summary call', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ firstName: 'Ada' }))
      .mockResolvedValueOnce(jsonResponse({ experience: [] }))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await provider.parseResume('resume text')

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
    const budgets = bodies.map((b) => b.generationConfig.maxOutputTokens as number)
    expect(Math.max(...budgets)).toBeGreaterThan(Math.min(...budgets) + 1000)
  })

  it('still returns the summary fields when the history call fails outright', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ firstName: 'Ada', lastName: 'Lovelace' }))
      .mockRejectedValueOnce(new TypeError('network error'))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    const result = await provider.parseResume('resume text')

    expect(result.firstName).toBe('Ada')
    expect(result.experience).toBeUndefined()
  })

  it('still returns experience/education when the summary call fails outright', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network error'))
      .mockResolvedValueOnce(
        jsonResponse({
          experience: [
            {
              company: 'Acme',
              title: 'Engineer',
              location: '',
              startDate: '2020',
              endDate: '',
              current: true,
              description: '',
            },
          ],
          education: [],
        }),
      )

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    const result = await provider.parseResume('resume text')

    expect(result.firstName).toBeUndefined()
    expect(result.experience).toHaveLength(1)
    expect(result.experience?.[0]?.company).toBe('Acme')
  })

  it('recovers a truncated history response instead of dropping it entirely', async () => {
    const truncatedText =
      '{"experience": [' +
      '{"company": "Acme", "title": "Engineer", "location": "", "startDate": "2020", "endDate": "2022", "current": false, "description": ""},' +
      '{"company": "Widgets Inc", "title": "Senior Eng'

    fetchMock.mockResolvedValueOnce(jsonResponse({ firstName: 'Ada' })).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: truncatedText }] } }],
      }),
    })

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    const result = await provider.parseResume('resume text')

    // Both roles come through: the first entirely, and the second's company
    // — which finished generating before the cutoff hit its title — as well.
    expect(result.experience).toHaveLength(2)
    expect(result.experience?.[0]?.company).toBe('Acme')
    expect(result.experience?.[1]?.company).toBe('Widgets Inc')
    expect(result.experience?.[1]?.title).toBe('')
  })

  it('throws only when both calls fail', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await expect(provider.parseResume('resume text')).rejects.toThrow()
  })
})
