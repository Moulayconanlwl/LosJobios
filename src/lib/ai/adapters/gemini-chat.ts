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
 * Gemini, reduced to the same `generate` shape as the others.
 *
 * `GeminiProvider` in gemini.ts is untouched and still used for everything it
 * already does — it leans on Gemini's native `responseSchema`, which is
 * stricter than anything the other vendors offer and there is no reason to
 * give that up. This adapter exists so Gemini is selectable in the same
 * provider list as the rest, and so the generic task layer has one code path.
 *
 * The wire format is the odd one out: turns are `contents` with `parts`, the
 * assistant role is called `model`, and the key goes in a query string rather
 * than a header.
 */

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta'

type GenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

type ListModelsResponse = {
  models?: Array<{
    name?: string
    displayName?: string
    supportedGenerationMethods?: string[]
  }>
}

export class GeminiChatAdapter implements ChatProvider {
  readonly type = 'gemini' as const

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string = DEFAULT_BASE,
  ) {}

  private get root(): string {
    return (this.baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  }

  async generate(request: ChatRequest): Promise<string> {
    if (!this.apiKey) throw new AIProviderError('No Gemini API key configured.')
    if (!this.model) throw new AIProviderError('No Gemini model configured.')

    const body: Record<string, unknown> = {
      contents: request.messages.map((m) => ({
        // Gemini calls the assistant "model"; "assistant" is rejected.
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: request.temperature ?? CHAT_DEFAULTS.temperature,
        maxOutputTokens: request.maxTokens ?? CHAT_DEFAULTS.maxTokens,
        ...(request.json ? { responseMimeType: 'application/json' } : {}),
      },
    }

    if (request.system) {
      body['systemInstruction'] = { parts: [{ text: request.system }] }
    }

    const response = await this.send(
      `/models/${encodeURIComponent(this.model)}:generateContent`,
      body,
      request.signal,
    )
    const payload = (await response.json()) as GenerateResponse

    if (payload.promptFeedback?.blockReason) {
      throw new AIProviderError(`Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`)
    }

    const candidate = payload.candidates?.[0]
    const text = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim()

    if (!text) {
      throw new AIProviderError(
        `Gemini returned no text${candidate?.finishReason ? ` (stopped: ${candidate.finishReason})` : ''}.`,
      )
    }

    return text
  }

  async listModels(): Promise<Array<{ id: string; label: string }>> {
    const response = await this.send('/models', null)
    const payload = (await response.json()) as ListModelsResponse

    return (payload.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => {
        const id = (m.name ?? '').replace(/^models\//, '')
        return { id, label: m.displayName ?? id }
      })
      .filter((m) => m.id)
  }

  private async send(
    path: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<Response> {
    // The key is a query parameter here, not a header.
    const url = `${this.root}${path}?key=${encodeURIComponent(this.apiKey)}`

    let response: Response
    try {
      response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      throw describeNetworkFailure('Gemini', originOf(this.root), err)
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw describeHttpFailure('Gemini', response.status, detail, this.model)
    }

    return response
  }
}
