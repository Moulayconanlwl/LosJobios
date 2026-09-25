import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '@/lib/ai/gemini'
import { AIProviderError } from '@/lib/ai/provider'
import { defaultProfile } from '@/lib/schema'

/**
 * `reviewResume` is the judgement half of ATS scoring, and the half that can
 * fail quietly: a reply that parses but says nothing is worse than an error,
 * because the UI would render an empty card as if it were advice. These check
 * that the prompt carries the gaps the deterministic scorer already found,
 * and that an unusable reply raises rather than returns.
 */

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  }
}

const REVIEW = {
  verdict: 'Strong match on the backend stack, thin on the data pipeline work.',
  strengths: ['Kubernetes and Kafka both appear in a production context.'],
  gaps: ['No mention of Redis anywhere in the resume.'],
  suggestions: ['Move the Kafka pipeline line up into the first bullet of the Acme role.'],
}

function input(overrides: Partial<Parameters<GeminiProvider['reviewResume']>[0]> = {}) {
  return {
    resumeText: 'Ada Lovelace — Senior Backend Engineer at Acme. Python, Kubernetes, Kafka.',
    profile: defaultProfile(),
    jobTitle: 'Senior Backend Engineer',
    jobDescription: 'We need Python, Kubernetes and Redis experience.',
    missingKeywords: [] as string[],
    ...overrides,
  }
}

describe('GeminiProvider.reviewResume', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the verdict and every list', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(REVIEW))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    const result = await provider.reviewResume(input())

    expect(result.verdict).toBe(REVIEW.verdict)
    expect(result.gaps).toEqual(REVIEW.gaps)
    expect(result.suggestions).toEqual(REVIEW.suggestions)
  })

  it('tells the model which terms the scorer already found missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(REVIEW))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await provider.reviewResume(input({ missingKeywords: ['redis', 'terraform'] }))

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const prompt = JSON.parse(init.body as string).contents[0].parts[0].text as string

    // Both halves of the feature have to be talking about the same gaps.
    expect(prompt).toContain('redis, terraform')
    expect(prompt).toContain('Senior Backend Engineer')
  })

  it('accepts a review that is only a verdict', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ verdict: 'Close, but light on evidence.' }))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    const result = await provider.reviewResume(input())

    expect(result.verdict).toBe('Close, but light on evidence.')
    expect(result.strengths).toEqual([])
  })

  it('throws rather than returning a review with nothing in it', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ verdict: '', strengths: [], gaps: [] }))

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await expect(provider.reviewResume(input())).rejects.toThrow(AIProviderError)
  })

  it('throws when the prompt is blocked', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    })

    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')
    await expect(provider.reviewResume(input())).rejects.toThrow(AIProviderError)
  })

  it('does not call the API at all when there is no resume to review', async () => {
    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')

    await expect(provider.reviewResume(input({ resumeText: '   ' }))).rejects.toThrow(
      'No resume text to review.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when no model is configured', async () => {
    const provider = new GeminiProvider('key', '')

    await expect(provider.reviewResume(input())).rejects.toThrow('No Gemini model selected.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
