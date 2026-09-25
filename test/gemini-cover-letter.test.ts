import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '@/lib/ai/gemini'
import { AIProviderError } from '@/lib/ai/provider'
import { defaultProfile } from '@/lib/schema'

/**
 * `generateCoverLetter` is the one AI call that returns prose rather than
 * JSON, and the one whose prompt is built from optional, job-specific
 * context (a `JobRef`, scraped description text, a user-supplied style
 * template) that's frequently absent. These tests check the prompt actually
 * carries whatever context is available and omits what isn't, and that a
 * response that isn't usable — blocked or empty — surfaces as an error
 * rather than silently handing back nothing.
 */

function textResponse(text: string) {
  return {
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  }
}

describe('GeminiProvider.generateCoverLetter', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the generated text, trimmed', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('  Dear team, I would love to join.  '))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    const result = await provider.generateCoverLetter({
      profile: defaultProfile(),
      job: null,
      jobDescription: '',
    })

    expect(result.text).toBe('Dear team, I would love to join.')
  })

  it('sends the job title, company and description when a job is given', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('Letter text.'))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await provider.generateCoverLetter({
      profile: defaultProfile(),
      job: { externalId: '1', title: 'Staff Engineer', company: 'Acme', location: '', url: '' },
      jobDescription: 'We need someone who loves distributed systems.',
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    const prompt = body.contents[0].parts[0].text as string

    expect(prompt).toContain('Staff Engineer at Acme')
    expect(prompt).toContain('We need someone who loves distributed systems.')
  })

  it('omits the style reference section when no template is set', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('Letter text.'))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await provider.generateCoverLetter({ profile: defaultProfile(), job: null, jobDescription: '' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const prompt = JSON.parse(init.body as string).contents[0].parts[0].text as string
    expect(prompt).not.toContain('Style reference')
  })

  it('includes the style reference when a cover letter template is set', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('Letter text.'))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    const profile = { ...defaultProfile(), coverLetterTemplate: 'Dear Hiring Team, warmly, Ada' }
    await provider.generateCoverLetter({ profile, job: null, jobDescription: '' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const prompt = JSON.parse(init.body as string).contents[0].parts[0].text as string
    expect(prompt).toContain('Style reference')
    expect(prompt).toContain('Dear Hiring Team, warmly, Ada')
  })

  it('does not constrain the response to a JSON schema', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('Letter text.'))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await provider.generateCoverLetter({ profile: defaultProfile(), job: null, jobDescription: '' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const config = JSON.parse(init.body as string).generationConfig
    expect(config.responseMimeType).toBeUndefined()
    expect(config.responseSchema).toBeUndefined()
  })

  it('throws when the prompt is blocked', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    })

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await expect(
      provider.generateCoverLetter({ profile: defaultProfile(), job: null, jobDescription: '' }),
    ).rejects.toThrow(AIProviderError)
  })

  it('throws rather than returning an empty letter', async () => {
    fetchMock.mockResolvedValueOnce(textResponse(''))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await expect(
      provider.generateCoverLetter({ profile: defaultProfile(), job: null, jobDescription: '' }),
    ).rejects.toThrow(AIProviderError)
  })

  it('throws when no model is configured', async () => {
    const provider = new GeminiProvider('key', '')
    await expect(
      provider.generateCoverLetter({ profile: defaultProfile(), job: null, jobDescription: '' }),
    ).rejects.toThrow('No Gemini model selected.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
