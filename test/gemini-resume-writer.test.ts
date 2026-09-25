import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '@/lib/ai/gemini'
import { AIProviderError } from '@/lib/ai/provider'
import { defaultProfile, type Profile } from '@/lib/schema'

/**
 * `generateResume` is the one call whose output goes onto a document an
 * employer reads, so the guards against it inventing things are the point:
 * a role number that isn't one of the candidate's is dropped rather than
 * rendered, and a "skill" that isn't already on their profile can't be
 * smuggled in by the reordering.
 */

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  }
}

function profileWith(): Profile {
  return {
    ...defaultProfile(),
    skills: ['Python', 'Kubernetes'],
    experience: [
      {
        id: 'a',
        company: 'Acme',
        title: 'Senior Engineer',
        location: '',
        startDate: '2019',
        endDate: '',
        current: true,
        description: 'Built services.',
      },
      {
        id: 'b',
        company: 'Widgets Inc',
        title: 'Engineer',
        location: '',
        startDate: '2016',
        endDate: '2019',
        current: false,
        description: 'Built other services.',
      },
    ],
  }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    profile: profileWith(),
    resumeText: 'Ada Lovelace, engineer.',
    jobTitle: 'Staff Backend Engineer',
    jobDescription: 'We need Python and Kubernetes.',
    missingKeywords: [] as string[],
    ...overrides,
  }
}

describe('GeminiProvider.generateResume', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the rewritten bullets keyed to the real roles', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        summary: 'Backend engineer.',
        skills: ['Kubernetes', 'Python'],
        roles: [
          { index: 0, bullets: ['Ran Kubernetes in production.'] },
          { index: 1, bullets: ['Shipped Python services.'] },
        ],
        notes: ['Nothing invented.'],
      }),
    )

    const result = await new GeminiProvider('key', 'gemini-2.5-flash-lite').generateResume(input())

    expect(result.summary).toBe('Backend engineer.')
    expect(result.roles).toHaveLength(2)
    expect(result.roles[0]).toEqual({ index: 0, bullets: ['Ran Kubernetes in production.'] })
    expect(result.notes).toEqual(['Nothing invented.'])
  })

  it('drops bullets written for a role the candidate does not have', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        summary: 'Backend engineer.',
        roles: [
          { index: 0, bullets: ['Real work.'] },
          // There is no role 7. This is the shape an invented employer takes.
          { index: 7, bullets: ['Led the Mars mission at SpaceX.'] },
        ],
      }),
    )

    const result = await new GeminiProvider('key', 'gemini-2.5-flash-lite').generateResume(input())

    expect(result.roles).toHaveLength(1)
    expect(result.roles[0]?.index).toBe(0)
    expect(JSON.stringify(result)).not.toContain('SpaceX')
  })

  it('ignores a skill that is not already on the profile', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        summary: 'Backend engineer.',
        // Rust is not theirs to claim.
        skills: ['Rust', 'Kubernetes', 'Python'],
        roles: [{ index: 0, bullets: ['Real work.'] }],
      }),
    )

    const result = await new GeminiProvider('key', 'gemini-2.5-flash-lite').generateResume(input())

    expect(result.skills).not.toContain('Rust')
    expect(result.skills).toEqual(['Kubernetes', 'Python'])
  })

  it('keeps a profile skill the rewrite forgot to mention', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ summary: 'x', skills: ['Kubernetes'], roles: [{ index: 0, bullets: ['y'] }] }),
    )

    const result = await new GeminiProvider('key', 'gemini-2.5-flash-lite').generateResume(input())

    // Reordering must not silently delete a skill from their own profile.
    expect(result.skills).toEqual(['Kubernetes', 'Python'])
  })

  it('matches a profile skill regardless of how the reply cased it', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ summary: 'x', skills: ['kubernetes', 'PYTHON'], roles: [] }),
    )

    const result = await new GeminiProvider('key', 'gemini-2.5-flash-lite').generateResume(input())

    // The profile's own spelling wins, so the resume reads consistently.
    expect(result.skills).toEqual(['Kubernetes', 'Python'])
  })

  it('sends the roles numbered, which is what the reply refers back to', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ summary: 'x', roles: [{ index: 0, bullets: ['y'] }] }))

    await new GeminiProvider('key', 'gemini-2.5-flash-lite').generateResume(
      input({ missingKeywords: ['terraform'] }),
    )

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const prompt = JSON.parse(init.body as string).contents[0].parts[0].text as string

    expect(prompt).toContain('### Role 0')
    expect(prompt).toContain('### Role 1')
    expect(prompt).toContain('Acme')
    expect(prompt).toContain('terraform')
  })

  it('refuses when there is no work history to rewrite', async () => {
    const provider = new GeminiProvider('key', 'gemini-2.5-flash-lite')

    await expect(
      provider.generateResume(input({ profile: defaultProfile() })),
    ).rejects.toThrow(/No work history/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when the reply has neither a summary nor any bullets', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ summary: '', roles: [] }))

    await expect(
      new GeminiProvider('key', 'gemini-2.5-flash-lite').generateResume(input()),
    ).rejects.toThrow(AIProviderError)
  })

  it('throws when the prompt is blocked', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    })

    await expect(
      new GeminiProvider('key', 'gemini-2.5-flash-lite').generateResume(input()),
    ).rejects.toThrow(AIProviderError)
  })
})
