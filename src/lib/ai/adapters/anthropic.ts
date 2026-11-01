import { AIProviderError } from '../provider'
import {
  CHAT_DEFAULTS,
  describeHttpFailure,
  describeNetworkFailure,
  originOf,
  type ChatProvider,
  type ChatRequest,
} from '../chat'

/**
 * Anthropic's Messages API.
 *
 * Three things differ from the OpenAI shape and all three are easy to get
 * wrong: the key goes in `x-api-key` rather than `Authorization`, the system
 * prompt is a top-level field rather than a message with `role: "system"`,
 * and `max_tokens` is required rather than optional.
 */

const DEFAULT_BASE = 'https://api.anthropic.com'
const API_VERSION = '2023-06-01'

type MessagesResponse = {
  content?: Array<{ type?: string; text?: string }>
  stop_reason?: string
}

type ModelsResponse = {
  data?: Array<{ id?: string; display_name?: string }>
}

export class AnthropicAdapter implements ChatProvider {
  readonly type = 'anthropic' as const

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string = DEFAULT_BASE,
  ) {}

  private get root(): string {
    return (this.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  }

  private headers(): HeadersInit {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': API_VERSION,
      /*
       * Without this header Anthropic refuses browser-origin requests with a
       * CORS error that reads like a network fault. This extension is a
       * client-side tool by design — the key is the user's own and never
       * leaves their machine except to Anthropic — so the warning the header
       * name carries is understood and accepted.
       */
      'anthropic-dangerous-direct-browser-access': 'true',
    }
  }

  async generate(request: ChatRequest): Promise<string> {
    if (!this.apiKey) throw new AIProviderError('No Anthropic API key configured.')
    if (!this.model) throw new AIProviderError('No Anthropic model configured.')

    const body: Record<string, unknown> = {
      model: this.model,
      // Required by this API, unlike the others, so it always gets a value.
      max_tokens: request.maxTokens ?? CHAT_DEFAULTS.maxTokens,
      temperature: request.temperature ?? CHAT_DEFAULTS.temperature,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    }

    // Top-level, not a message. A `role: "system"` entry is rejected outright.
    const system = request.json
      ? `${request.system ?? ''}\n\nReply with a single JSON object and nothing else. No prose, no markdown fence.`.trim()
      : request.system
    if (system) body['system'] = system

    const response = await this.post('/v1/messages', body, request.signal)
    const payload = (await response.json()) as MessagesResponse

    const text = (payload.content ?? [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('')
      .trim()

    if (!text) {
      throw new AIProviderError(
        `Anthropic returned no text${payload.stop_reason ? ` (stopped: ${payload.stop_reason})` : ''}.`,
      )
    }

    return text
  }

  async listModels(): Promise<Array<{ id: string; label: string }>> {
    const response = await this.post('/v1/models', null)
    const payload = (await response.json()) as ModelsResponse

    return (payload.data ?? [])
      .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
      .map((m) => ({ id: m.id, label: m.display_name ?? m.id }))
  }

  private async post(
    path: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<Response> {
    let response: Response
    try {
      response = await fetch(`${this.root}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: this.headers(),
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      throw describeNetworkFailure('Anthropic', originOf(this.root), err)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw describeHttpFailure('Anthropic', response.status, detail, this.model)
    }

    return response
  }
}
