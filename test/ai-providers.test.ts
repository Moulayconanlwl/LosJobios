import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnthropicAdapter } from '@/lib/ai/adapters/anthropic'
import { OpenAiAdapter } from '@/lib/ai/adapters/openai'
import { GeminiChatAdapter } from '@/lib/ai/adapters/gemini-chat'
import { describeHttpFailure, parseJsonReply, unwrapJson } from '@/lib/ai/chat'
import { effectiveBaseUrl, migrateLegacyProvider, providerOrigin, selectProvider } from '@/lib/ai/registry'
import { aiProviderConfigSchema, defaultSettings, settingsSchema } from '@/lib/schema'

/**
 * Talking to several model vendors through one interface.
 *
 * The things worth pinning down are the ones that differ per vendor and are
 * invisible until a real call fails: which header carries the key, where the
 * system prompt goes, and whether an optional field is actually optional.
 */

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

/** The request the adapter actually sent. */
function sent(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return { url, init, body: JSON.parse((init.body as string) ?? '{}') }
}

describe('Anthropic', () => {
  it('sends the key in x-api-key, not Authorization', () => {
    // The single most common way an Anthropic integration fails.
    fetchMock.mockResolvedValueOnce(ok({ content: [{ type: 'text', text: 'hi' }] }))

    return new AnthropicAdapter('k-123', 'claude-sonnet-5')
      .generate({ messages: [{ role: 'user', content: 'hello' }] })
      .then(() => {
        const headers = sent().init.headers as Record<string, string>
        expect(headers['x-api-key']).toBe('k-123')
        expect(headers['authorization']).toBeUndefined()
        expect(headers['anthropic-version']).toBeTruthy()
      })
  })

  it('sends the browser-access header, without which a CORS error looks like a network fault', async () => {
    fetchMock.mockResolvedValueOnce(ok({ content: [{ type: 'text', text: 'hi' }] }))
    await new AnthropicAdapter('k', 'm').generate({ messages: [{ role: 'user', content: 'x' }] })

    const headers = sent().init.headers as Record<string, string>
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
  })

  it('puts the system prompt at the top level, where this API wants it', async () => {
    // A `role: "system"` message is rejected outright.
    fetchMock.mockResolvedValueOnce(ok({ content: [{ type: 'text', text: 'hi' }] }))
    await new AnthropicAdapter('k', 'm').generate({
      system: 'be brief',
      messages: [{ role: 'user', content: 'x' }],
    })

    const { body } = sent()
    expect(body['system']).toContain('be brief')
    expect((body['messages'] as Array<{ role: string }>).some((m) => m.role === 'system')).toBe(false)
  })

  it('always sends max_tokens, which is required here and optional elsewhere', async () => {
    fetchMock.mockResolvedValueOnce(ok({ content: [{ type: 'text', text: 'hi' }] }))
    await new AnthropicAdapter('k', 'm').generate({ messages: [{ role: 'user', content: 'x' }] })

    expect(sent().body['max_tokens']).toBeTypeOf('number')
  })

  it('joins multi-part text replies', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ content: [{ type: 'text', text: 'one ' }, { type: 'thinking' }, { type: 'text', text: 'two' }] }),
    )

    const text = await new AnthropicAdapter('k', 'm').generate({
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(text).toBe('one two')
  })
})

describe('OpenAI and compatible endpoints', () => {
  it('sends a bearer token and the system prompt as a message', async () => {
    fetchMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'hi' } }] }))
    await new OpenAiAdapter('openai', 'sk-1', 'gpt-4.1-mini').generate({
      system: 'be brief',
      messages: [{ role: 'user', content: 'x' }],
    })

    const { init, body } = sent()
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-1')
    expect((body['messages'] as Array<{ role: string }>)[0]?.role).toBe('system')
  })

  it('omits the auth header entirely when there is no key', async () => {
    /*
     * A local Ollama or LM Studio has no auth, and some of them reject a
     * request carrying an empty `Authorization: Bearer ` outright.
     */
    fetchMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'hi' } }] }))
    await new OpenAiAdapter('openai-compatible', '', 'llama3', 'http://localhost:11434/v1').generate({
      messages: [{ role: 'user', content: 'x' }],
    })

    expect((sent().init.headers as Record<string, string>)['authorization']).toBeUndefined()
  })

  it('uses the custom base URL verbatim', async () => {
    fetchMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'hi' } }] }))
    await new OpenAiAdapter('openai-compatible', 'k', 'm', 'https://openrouter.ai/api/v1').generate({
      messages: [{ role: 'user', content: 'x' }],
    })

    expect(sent().url).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('only sends response_format to first-party OpenAI', async () => {
    // An unknown field is a 400 on the stricter compatible servers.
    fetchMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: '{}' } }] }))
    await new OpenAiAdapter('openai-compatible', 'k', 'm', 'https://x.test/v1').generate({
      messages: [{ role: 'user', content: 'x' }],
      json: true,
    })

    expect(sent().body['response_format']).toBeUndefined()
  })
})

describe('Gemini', () => {
  it('puts the key in the query string and renames the assistant role', async () => {
    fetchMock.mockResolvedValueOnce(ok({ candidates: [{ content: { parts: [{ text: 'hi' }] } }] }))
    await new GeminiChatAdapter('k-9', 'gemini-2.5-flash').generate({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    })

    const { url, body } = sent()
    expect(url).toContain('key=k-9')
    // "assistant" is rejected; this API calls it "model".
    const roles = (body['contents'] as Array<{ role: string }>).map((c) => c.role)
    expect(roles).toEqual(['user', 'model'])
  })
})

describe('error messages name the fix, not the symptom', () => {
  it('explains a bad key', () => {
    expect(describeHttpFailure('OpenAI', 401, '{}', 'm').message).toMatch(/API key/i)
  })

  it('names the model when it does not exist', () => {
    expect(describeHttpFailure('OpenAI', 404, '{}', 'gpt-nope').message).toContain('gpt-nope')
  })

  it('says rate limited rather than quoting a status code', () => {
    expect(describeHttpFailure('Groq', 429, '{}', 'm').message).toMatch(/rate limit/i)
  })

  it('points at the vendor for a 5xx, so the user does not hunt their own setup', () => {
    expect(describeHttpFailure('Anthropic', 503, '{}', 'm').message).toMatch(/their end/i)
  })

  it('surfaces the vendor’s own message when it has one', () => {
    const message = describeHttpFailure('OpenAI', 400, '{"error":{"message":"bad temperature"}}', 'm').message
    expect(message).toContain('bad temperature')
  })
})

describe('JSON replies', () => {
  it('unwraps a markdown fence the model added anyway', () => {
    expect(unwrapJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('says plainly when a model returned prose instead of JSON', () => {
    // Otherwise this surfaces as an unexplained SyntaxError mid-run.
    expect(() => parseJsonReply('Groq', 'Sure! Here you go.')).toThrow(/asked for JSON/i)
  })
})

describe('provider configuration', () => {
  it('fills defaults for a partially written config', () => {
    const config = aiProviderConfigSchema.parse({ id: 'a' })
    expect(config.temperature).toBe(0.2)
    expect(config.maxTokens).toBeGreaterThan(0)
  })

  it('falls back to the vendor default base URL when none is given', () => {
    const config = aiProviderConfigSchema.parse({ id: 'a', type: 'anthropic' })
    expect(effectiveBaseUrl(config)).toBe('https://api.anthropic.com')
    expect(providerOrigin(config)).toBe('https://api.anthropic.com')
  })

  it('uses the first provider when no default is set', () => {
    const settings = settingsSchema.parse({
      ai: { providers: [{ id: 'one' }, { id: 'two' }], defaultProviderId: '' },
    })
    expect(selectProvider(settings)?.id).toBe('one')
  })

  it('returns null when nothing is configured', () => {
    expect(selectProvider(defaultSettings())).toBeNull()
  })
})

describe('migrating a single-key configuration', () => {
  it('carries an existing Gemini key into the providers list', () => {
    // So an upgrade does not silently turn off everything AI-powered.
    const legacy = settingsSchema.parse({ ai: { provider: 'gemini', apiKey: 'k', model: 'm' } })
    const migrated = migrateLegacyProvider(legacy)

    expect(migrated?.ai.providers).toHaveLength(1)
    expect(migrated?.ai.providers[0]).toMatchObject({ type: 'gemini', apiKey: 'k', model: 'm' })
    expect(migrated?.ai.defaultProviderId).toBe(migrated?.ai.providers[0]?.id)
  })

  it('clears the legacy fields so it cannot run twice', () => {
    /*
     * Without this, deleting the migrated provider would resurrect it from
     * the old fields on the next read — the user could never get rid of it.
     */
    const legacy = settingsSchema.parse({ ai: { provider: 'gemini', apiKey: 'k', model: 'm' } })
    const migrated = migrateLegacyProvider(legacy)

    expect(migrated?.ai.apiKey).toBe('')
    expect(migrateLegacyProvider(migrated!)).toBeNull()
  })

  it('does nothing when providers already exist', () => {
    const settings = settingsSchema.parse({
      ai: { provider: 'gemini', apiKey: 'k', model: 'm', providers: [{ id: 'x' }] },
    })
    expect(migrateLegacyProvider(settings)).toBeNull()
  })
})
