import { AIProviderError } from './provider'

/**
 * The one shape every model vendor is reduced to.
 *
 * Deliberately smaller than any vendor's API: a system prompt, a turn list,
 * and two knobs. Everything above this layer — answering a screening
 * question, writing a cover letter, scoring a CV — is written once against
 * `generate` and works on whichever provider the user configured.
 *
 * `AIProvider` in provider.ts stays as it is. That interface is task-shaped
 * and its Gemini implementation uses Gemini's native structured output, which
 * no other vendor has. This is the layer underneath it.
 */

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatRequest = {
  /** Instructions that are not part of the conversation. */
  system?: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /**
   * Ask for JSON back. Every adapter sets whatever its vendor calls this and
   * falls back to saying so in the prompt, because support is uneven.
   */
  json?: boolean
  signal?: AbortSignal
}

export type ProviderType = 'anthropic' | 'openai' | 'openai-compatible' | 'gemini'

export interface ChatProvider {
  readonly type: ProviderType
  /** Plain text out. Callers that want JSON parse it themselves. */
  generate(request: ChatRequest): Promise<string>
  /** Model ids this key can actually call. May be empty if the vendor has no list endpoint. */
  listModels(): Promise<Array<{ id: string; label: string }>>
}

/** Defaults applied when a provider config leaves them blank. */
export const CHAT_DEFAULTS = {
  temperature: 0.2,
  maxTokens: 2048,
} as const

/**
 * Turn a failed HTTP response into something a person can act on.
 *
 * The vendors all report the same handful of problems with different status
 * codes and body shapes, and "OpenAI 401: {}" tells the user nothing about
 * what to do next. Each branch names the fix rather than the symptom.
 */
export function describeHttpFailure(
  vendor: string,
  status: number,
  body: string,
  model: string,
): AIProviderError {
  const detail = extractMessage(body)

  if (status === 401 || status === 403) {
    return new AIProviderError(
      `${vendor} rejected the API key. Check it under Settings → AI, and that it has not been revoked.`,
      status,
    )
  }

  if (status === 404) {
    return new AIProviderError(
      `${vendor} has no model called "${model}". Check the model name — it must be the exact id the provider publishes.`,
      status,
    )
  }

  if (status === 429) {
    return new AIProviderError(
      `${vendor} is rate limiting this key${detail ? ` (${detail})` : ''}. Wait a moment, or lower the daily cap.`,
      status,
    )
  }

  if (status === 402 || /quota|billing|credit|insufficient/i.test(detail)) {
    return new AIProviderError(
      `${vendor} reports no remaining quota or credit on this key${detail ? `: ${detail}` : ''}.`,
      status,
    )
  }

  if (status >= 500) {
    return new AIProviderError(
      `${vendor} is having trouble (${status})${detail ? `: ${detail}` : ''}. This is their end, not yours — try again shortly.`,
      status,
    )
  }

  return new AIProviderError(`${vendor} ${status}${detail ? `: ${detail}` : ''}`, status)
}

/** A network-level failure, which on an extension is usually a missing permission. */
export function describeNetworkFailure(vendor: string, host: string, err: unknown): AIProviderError {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new AIProviderError(`${vendor} did not answer in time.`)
  }

  return new AIProviderError(
    `Could not reach ${vendor} at ${host}. Either the extension has no permission for that host — reopen Settings → AI and press Test connection to grant it — or the machine is offline. (${
      err instanceof Error ? err.message : String(err)
    })`,
  )
}

/** Pull a human-readable message out of whichever error envelope a vendor used. */
function extractMessage(body: string): string {
  if (!body) return ''

  try {
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object') return body.slice(0, 200)

    const record = parsed as Record<string, unknown>
    const error = record['error']

    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>)['message']
      if (typeof message === 'string') return message
    }

    const message = record['message']
    if (typeof message === 'string') return message

    return body.slice(0, 200)
  } catch {
    return body.slice(0, 200)
  }
}

/**
 * Strip the fencing models wrap JSON in even when told not to.
 *
 * Only the adapters that cannot enforce a JSON response format need this, but
 * it is harmless on the ones that can, and every caller of `generate` that
 * expects JSON goes through it.
 */
export function unwrapJson(text: string): string {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)
  return (fenced?.[1] ?? trimmed).trim()
}

/**
 * Parse a model's JSON reply, or say plainly that it did not return JSON.
 *
 * Worth its own helper because the failure is common enough that an
 * unexplained `SyntaxError` out of a run is actively confusing.
 */
export function parseJsonReply<T>(vendor: string, text: string): T {
  const body = unwrapJson(text)
  try {
    return JSON.parse(body) as T
  } catch {
    throw new AIProviderError(
      `${vendor} was asked for JSON and returned something else. The model may be too small for structured output — try a larger one.`,
    )
  }
}

/** The origin a base URL belongs to, for permission requests and messages. */
export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
