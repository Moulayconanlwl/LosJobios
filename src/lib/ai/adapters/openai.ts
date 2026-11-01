import { AIProviderError } from '../provider'
import {
  CHAT_DEFAULTS,
  describeHttpFailure,
  describeNetworkFailure,
  originOf,
  type ChatProvider,
  type ChatRequest,
  type ProviderType,
} from '../chat'

/**
 * OpenAI's Chat Completions API, and everything that imitates it.
 *
 * One adapter covers OpenAI, OpenRouter, Groq, Together, vLLM, LM Studio and
 * Ollama, because they all deliberately speak this shape. The only thing that
 * varies is the base URL, which is why "OpenAI-compatible" is a provider type
 * here rather than a separate adapter: a second copy of this file would drift
 * from the first and fix bugs in only one of them.
 */

const DEFAULT_BASE = 'https://api.openai.com/v1'

type CompletionResponse = {
  choices?: Array<{
    message?: { content?: string | null }
    finish_reason?: string
  }>
}

type ModelsResponse = {
  data?: Array<{ id?: string }>
}

export class OpenAiAdapter implements ChatProvider {
  constructor(
    readonly type: Extract<ProviderType, 'openai' | 'openai-compatible'>,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string = DEFAULT_BASE,
  ) {}

  private get root(): string {
    return (this.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  }

  private get vendor(): string {
    // Name the actual host for a custom endpoint: "OpenAI 401" is misleading
    // when the request went to OpenRouter.
    return this.type === 'openai' ? 'OpenAI' : originOf(this.root).replace(/^https?:\/\//, '')
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = { 'content-type': 'application/json' }

    /*
     * A key is optional for compatible endpoints. A local Ollama or LM Studio
     * has no auth at all, and sending `Authorization: Bearer ` (empty) makes
     * some of them reject the request outright.
     */
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`

    return headers
  }

  async generate(request: ChatRequest): Promise<string> {
    if (this.type === 'openai' && !this.apiKey) {
      throw new AIProviderError('No OpenAI API key configured.')
    }
    if (!this.model) throw new AIProviderError(`No model configured for ${this.vendor}.`)

    const messages: Array<{ role: string; content: string }> = []
    if (request.system) messages.push({ role: 'system', content: request.system })
    messages.push(...request.messages.map((m) => ({ role: m.role, content: m.content })))

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: request.temperature ?? CHAT_DEFAULTS.temperature,
      max_tokens: request.maxTokens ?? CHAT_DEFAULTS.maxTokens,
    }

    /*
     * `response_format` is honoured by OpenAI and by most compatible servers,
     * but not all of them — and an unknown field is a 400 on the strict ones.
     * Only sent for first-party OpenAI; everything else is asked in the prompt
     * and unwrapped afterwards.
     */
    if (request.json) {
      if (this.type === 'openai') {
        body['response_format'] = { type: 'json_object' }
      } else {
        messages.push({
          role: 'system',
          content: 'Reply with a single JSON object and nothing else. No prose, no markdown fence.',
        })
      }
    }

    const response = await this.send('/chat/completions', body, request.signal)
    const payload = (await response.json()) as CompletionResponse

    const choice = payload.choices?.[0]
    const text = (choice?.message?.content ?? '').trim()

    if (!text) {
      throw new AIProviderError(
        `${this.vendor} returned no text${
          choice?.finish_reason ? ` (stopped: ${choice.finish_reason})` : ''
        }.`,
      )
    }

    return text
  }

  async listModels(): Promise<Array<{ id: string; label: string }>> {
    const response = await this.send('/models', null)
    const payload = (await response.json()) as ModelsResponse

    return (payload.data ?? [])
      .filter((m): m is { id: string } => typeof m.id === 'string')
      .map((m) => ({ id: m.id, label: m.id }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  private async send(
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
      throw describeNetworkFailure(this.vendor, originOf(this.root), err)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw describeHttpFailure(this.vendor, response.status, detail, this.model)
    }

    return response
  }
}
