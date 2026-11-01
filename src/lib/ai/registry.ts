import type { AiProviderConfig, Settings } from '../schema'
import { AIProviderError } from './provider'
import { originOf, type ChatProvider, type ChatRequest } from './chat'
import { AnthropicAdapter } from './adapters/anthropic'
import { GeminiChatAdapter } from './adapters/gemini-chat'
import { OpenAiAdapter } from './adapters/openai'

/**
 * Turning stored configuration into something that can be called.
 *
 * Also the one place that knows which origin a provider talks to, which
 * matters because an extension cannot reach a host it has no permission for
 * and the failure looks exactly like being offline.
 */

/** The default endpoint for each vendor, used when `baseUrl` is blank. */
export const DEFAULT_BASE_URLS: Record<AiProviderConfig['type'], string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  // No default: a compatible endpoint is only meaningful with its own URL.
  'openai-compatible': '',
}

export const PROVIDER_LABELS: Record<AiProviderConfig['type'], string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI-compatible (custom URL)',
  gemini: 'Google Gemini',
}

export function effectiveBaseUrl(config: AiProviderConfig): string {
  return (config.baseUrl || DEFAULT_BASE_URLS[config.type]).replace(/\/+$/, '')
}

/** The origin this provider will contact, for a permission request. */
export function providerOrigin(config: AiProviderConfig): string {
  const base = effectiveBaseUrl(config)
  return base ? originOf(base) : ''
}

export function buildChatProvider(config: AiProviderConfig): ChatProvider {
  const base = effectiveBaseUrl(config)

  switch (config.type) {
    case 'anthropic':
      return new AnthropicAdapter(config.apiKey, config.model, base)
    case 'gemini':
      return new GeminiChatAdapter(config.apiKey, config.model, base)
    case 'openai':
    case 'openai-compatible':
      return new OpenAiAdapter(config.type, config.apiKey, config.model, base)
  }
}

/**
 * Does the extension hold permission to call this provider?
 *
 * Separate from requesting it because a request needs a user gesture, and
 * most callers are a background run that has none.
 */
export async function hasProviderPermission(config: AiProviderConfig): Promise<boolean> {
  const origin = providerOrigin(config)
  if (!origin) return false

  try {
    return await chrome.permissions.contains({ origins: [`${origin}/*`] })
  } catch {
    return false
  }
}

/** Ask for permission to call this provider. Must run inside a user gesture. */
export async function requestProviderPermission(config: AiProviderConfig): Promise<boolean> {
  const origin = providerOrigin(config)
  if (!origin) return false

  try {
    return await chrome.permissions.request({ origins: [`${origin}/*`] })
  } catch {
    return false
  }
}

/** The provider the rest of the extension should use, or null if none is usable. */
export function selectProvider(settings: Settings): AiProviderConfig | null {
  const { providers, defaultProviderId } = settings.ai
  if (!providers.length) return null

  const chosen = providers.find((p) => p.id === defaultProviderId)
  return chosen ?? providers[0] ?? null
}

/**
 * Carry a pre-2.x single-key configuration into the providers list.
 *
 * Returns null when there is nothing to migrate. Additive and idempotent: it
 * only fires when `providers` is empty and a legacy key exists, so a user who
 * deletes every provider on purpose does not get the old one resurrected on
 * the next read — the legacy fields are cleared at the same time.
 */
export function migrateLegacyProvider(settings: Settings): Settings | null {
  const { ai } = settings
  if (ai.providers.length > 0) return null
  if (ai.provider !== 'gemini' || !ai.apiKey) return null

  const migrated: AiProviderConfig = {
    id: crypto.randomUUID(),
    name: 'Gemini',
    type: 'gemini',
    apiKey: ai.apiKey,
    model: ai.model,
    baseUrl: '',
    temperature: 0.2,
    maxTokens: 2048,
  }

  return {
    ...settings,
    ai: {
      ...ai,
      providers: [migrated],
      defaultProviderId: migrated.id,
      // Cleared so this never runs twice.
      apiKey: '',
      model: '',
    },
  }
}

/**
 * Prove a provider works, and say precisely what is wrong when it does not.
 *
 * Deliberately a real generation rather than a models listing: a key can list
 * models and still fail to call one, and the model name is the field people
 * get wrong most often.
 */
export async function testProvider(
  config: AiProviderConfig,
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  if (!config.model.trim()) {
    return { ok: false, error: 'Enter a model name first — it is the exact id the provider publishes.' }
  }
  if (config.type === 'openai-compatible' && !config.baseUrl.trim()) {
    return { ok: false, error: 'A compatible endpoint needs its base URL, e.g. https://openrouter.ai/api/v1' }
  }

  if (!(await hasProviderPermission(config))) {
    const granted = await requestProviderPermission(config)
    if (!granted) {
      return {
        ok: false,
        error: `Permission to contact ${providerOrigin(config)} was declined, so the extension cannot call it.`,
      }
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20_000)

  try {
    const reply = await buildChatProvider(config).generate({
      system: 'You are a connection test. Reply with the single word OK and nothing else.',
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      temperature: 0,
      maxTokens: 16,
      signal: controller.signal,
    })
    return { ok: true, reply: reply.slice(0, 80) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof AIProviderError ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Call a provider with a timeout and a bounded retry.
 *
 * Retried only where retrying can help. A bad key or an unknown model fails
 * the same way every time, and burning three attempts on it just makes the
 * user wait longer for the same message.
 */
export async function generateWithRetry(
  config: AiProviderConfig,
  request: Omit<ChatRequest, 'signal'>,
  options: { timeoutMs: number; retries: number },
): Promise<string> {
  const provider = buildChatProvider(config)
  let lastError: unknown

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)

    try {
      return await provider.generate({ ...request, signal: controller.signal })
    } catch (err) {
      lastError = err

      const status = err instanceof AIProviderError ? err.status : undefined
      const permanent = status === 401 || status === 403 || status === 404 || status === 400
      if (permanent || attempt === options.retries) break

      // Back off a little; an immediate retry into a rate limit just fails again.
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError instanceof Error ? lastError : new AIProviderError(String(lastError))
}
