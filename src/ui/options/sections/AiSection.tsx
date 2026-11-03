import { useState } from 'react'
import { PROVIDER_TYPES, type AiProviderConfig, type Settings } from '@/lib/schema'
import {
  DEFAULT_BASE_URLS,
  PROVIDER_LABELS,
  effectiveBaseUrl,
  providerOrigin,
  testKey,
  testModel,
} from '@/lib/ai/registry'
import type { ProviderModel } from '@/lib/ai/provider'
import { Banner, Button, Card, Field, Input, Select, Toggle, cx } from '../../components/ui'
import type { Draft } from '../../hooks'

/**
 * Where model providers are configured.
 *
 * Deliberately a list rather than one key. People keep a cheap fast model for
 * screening questions and a stronger one for cover letters, or an OpenRouter
 * key alongside a local Ollama, and forcing a choice between them means the
 * expensive model gets used for everything or the cheap one writes the
 * letters.
 *
 * Keys live in `chrome.storage.local` — this machine only, never synced,
 * never written to the run log, and excluded from backup exports.
 */

const BLANK = (): AiProviderConfig => ({
  id: crypto.randomUUID(),
  name: '',
  type: 'openai',
  apiKey: '',
  model: '',
  baseUrl: '',
  temperature: 0.2,
  maxTokens: 2048,
})

/** What to type in the model box, per vendor. Examples, never a fixed list. */
const MODEL_HINTS: Record<AiProviderConfig['type'], string> = {
  anthropic: 'e.g. claude-sonnet-5',
  openai: 'e.g. gpt-4.1-mini',
  'openai-compatible': 'e.g. meta-llama/llama-3.3-70b-instruct',
  gemini: 'e.g. gemini-2.5-flash',
}

export function AiSection({ draft }: { draft: Draft<Settings> }) {
  const settings = draft.value
  const [testing, setTesting] = useState<string>('')
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  /*
   * Models the key turned out to be entitled to, per provider.
   *
   * Held in component state rather than saved: it is a fact about the key
   * right now, it goes stale as vendors retire models, and persisting it
   * would mean showing a list that no longer matches what the key can call.
   */
  const [models, setModels] = useState<Record<string, ProviderModel[]>>({})

  if (!settings) return null
  const { ai } = settings

  const update = (patch: Partial<Settings['ai']>) => draft.update({ ai: { ...ai, ...patch } })

  const upsert = (config: AiProviderConfig) =>
    update({
      providers: ai.providers.some((p) => p.id === config.id)
        ? ai.providers.map((p) => (p.id === config.id ? config : p))
        : [...ai.providers, config],
    })

  const remove = (id: string) =>
    update({
      providers: ai.providers.filter((p) => p.id !== id),
      // Don't leave the default pointing at something that no longer exists.
      defaultProviderId: ai.defaultProviderId === id ? '' : ai.defaultProviderId,
    })

  /**
   * Check the key, then show what it can call.
   *
   * Asking someone to type a model id correctly from memory is the single
   * biggest source of "it doesn't work": no two vendors name them alike and
   * the lineups turn over constantly. So the key is verified first and the
   * list comes back from the vendor itself.
   */
  const runTest = async (config: AiProviderConfig) => {
    setTesting(config.id)
    setResults((current) => ({ ...current, [config.id]: { ok: false, message: 'Checking key…' } }))

    // Inside the click handler: a permission request Chrome raises here is
    // rejected outright unless it is tied to a user gesture.
    const keyResult = await testKey(config)

    if (!keyResult.ok) {
      setResults((current) => ({ ...current, [config.id]: { ok: false, message: keyResult.error } }))
      setTesting('')
      return
    }

    setModels((current) => ({ ...current, [config.id]: keyResult.models }))

    // Pick the first model for them when none is set, so the common case is
    // key-paste-test-done rather than key-paste-test-then-choose.
    const chosen =
      config.model || (keyResult.models.length === 1 ? (keyResult.models[0]?.id ?? '') : '')
    if (chosen && chosen !== config.model) upsert({ ...config, model: chosen })

    if (!chosen) {
      setResults((current) => ({
        ...current,
        [config.id]: {
          ok: true,
          message:
            keyResult.note ??
            `Key works — ${keyResult.models.length} model${keyResult.models.length === 1 ? '' : 's'} available. Choose one below.`,
        },
      }))
      setTesting('')
      return
    }

    // A key can list models perfectly and still 404 on the chosen one, so
    // the model gets its own check.
    const modelResult = await testModel({ ...config, model: chosen })

    setResults((current) => ({
      ...current,
      [config.id]: modelResult.ok
        ? { ok: true, message: `Connected. ${chosen} replied "${modelResult.reply}".` }
        : { ok: false, message: modelResult.error },
    }))
    setTesting('')
  }

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="AI providers"
        description="Add one or more model endpoints. Keys are stored on this machine only, never synced, and never written to the run log."
        actions={
          <Button size="sm" variant="secondary" onClick={() => upsert(BLANK())}>
            Add provider
          </Button>
        }
      >
        {ai.providers.length === 0 ? (
          <Banner tone="info">
            No provider configured, so AI features are off. Everything else &mdash; the answer
            bank, profile matching, the ATS score &mdash; works without one.
          </Banner>
        ) : (
          <div className="flex flex-col gap-4">
            {ai.providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                isDefault={
                  ai.defaultProviderId === provider.id ||
                  (!ai.defaultProviderId && ai.providers[0]?.id === provider.id)
                }
                testing={testing === provider.id}
                result={results[provider.id]}
                models={models[provider.id]}
                onChange={upsert}
                onRemove={() => remove(provider.id)}
                onMakeDefault={() => update({ defaultProviderId: provider.id })}
                onTest={() => void runTest(provider)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="How answers are resolved">
        <div className="flex flex-col gap-4">
          <Toggle
            checked={ai.answerQuestions}
            label="Let AI answer questions nothing else can"
            hint="The answer bank and your profile are always tried first. This only covers what they can't."
            onChange={(v) => update({ answerQuestions: v })}
          />

          <Field
            label={`Reuse a stored answer above ${Math.round(ai.fuzzyThreshold * 100)}% similarity`}
            hint="How close a new question has to be to one you've answered before. Lower reuses more and asks the model less; higher is pickier. Below this, the model is asked instead."
          >
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.01}
              value={ai.fuzzyThreshold}
              className="w-full"
              onChange={(e) => update({ fuzzyThreshold: Number(e.target.value) })}
            />
          </Field>

          <Toggle
            checked={ai.autoSaveAiAnswers}
            label="Save AI answers to the answer bank automatically"
            hint="Off by default. The bank is what gets reused without asking next time, so an unreviewed guess in it becomes every future wrong answer. Answers are still cached for the session either way."
            onChange={(v) => update({ autoSaveAiAnswers: v })}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timeout (seconds)" hint="Give up on one model call after this.">
              <Input
                type="number"
                min={2}
                max={120}
                value={Math.round(ai.timeoutMs / 1000)}
                onChange={(e) => update({ timeoutMs: (Number(e.target.value) || 30) * 1000 })}
              />
            </Field>
            <Field
              label="Retries"
              hint="After a timeout or a server error. A bad key or unknown model is never retried — it fails the same way every time."
            >
              <Input
                type="number"
                min={0}
                max={3}
                value={ai.retries}
                onChange={(e) => update({ retries: Number(e.target.value) || 0 })}
              />
            </Field>
          </div>
        </div>
      </Card>
    </div>
  )
}

function ProviderCard({
  provider,
  isDefault,
  testing,
  result,
  models,
  onChange,
  onRemove,
  onMakeDefault,
  onTest,
}: {
  provider: AiProviderConfig
  isDefault: boolean
  testing: boolean
  result?: { ok: boolean; message: string }
  /** Set once the key has been checked; undefined before that. */
  models?: ProviderModel[]
  onChange: (config: AiProviderConfig) => void
  onRemove: () => void
  onMakeDefault: () => void
  onTest: () => void
}) {
  const set = (patch: Partial<AiProviderConfig>) => onChange({ ...provider, ...patch })
  const needsBaseUrl = provider.type === 'openai-compatible'

  return (
    <div
      className={cx(
        'rounded-[var(--radius-card)] border p-3',
        isDefault
          ? 'border-accent'
          : 'border-hair',
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={provider.name}
          placeholder={PROVIDER_LABELS[provider.type]}
          className="max-w-[12rem]"
          onChange={(e) => set({ name: e.target.value })}
        />
        {isDefault ? (
          <span className="rounded-[var(--radius-pill)] bg-accent-wash px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            Default
          </span>
        ) : (
          <Button size="sm" variant="secondary" onClick={onMakeDefault}>
            Make default
          </Button>
        )}
        <Button size="sm" variant="secondary" className="ml-auto" disabled={testing} onClick={onTest}>
          {testing ? 'Checking…' : 'Test key'}
        </Button>
        <Button size="sm" variant="danger" onClick={onRemove}>
          Delete
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <Select
            value={provider.type}
            onChange={(e) =>
              set({
                type: e.target.value as AiProviderConfig['type'],
                // Clear a base URL that belonged to the previous vendor.
                baseUrl: '',
              })
            }
          >
            {PROVIDER_TYPES.map((type) => (
              <option key={type} value={type}>
                {PROVIDER_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Model"
          hint={
            models === undefined
              ? 'Paste the key and press Test key — the list comes from the provider.'
              : models.length
                ? `${models.length} available to this key.`
                : 'This endpoint publishes no model list, so type the name yourself.'
          }
        >
          {models && models.length ? (
            <Select value={provider.model} onChange={(e) => set({ model: e.target.value })}>
              <option value="">Choose a model…</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </Select>
          ) : (
            /*
             * Before the key is checked, and for endpoints with no /models,
             * the box stays free text. Removing it entirely would strand
             * anyone on a self-hosted server that does not publish a list.
             */
            <Input
              value={provider.model}
              placeholder={
                models === undefined ? 'Test the key to load models' : MODEL_HINTS[provider.type]
              }
              spellCheck={false}
              onChange={(e) => set({ model: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="API key"
          hint={
            needsBaseUrl
              ? 'Optional — a local Ollama or LM Studio needs none.'
              : 'Stored on this machine only.'
          }
          className="sm:col-span-2"
        >
          <Input
            type="password"
            value={provider.apiKey}
            placeholder={needsBaseUrl ? 'Optional' : 'sk-…'}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => set({ apiKey: e.target.value })}
          />
        </Field>

        <Field
          label={needsBaseUrl ? 'Base URL (required)' : 'Base URL (optional)'}
          hint={
            needsBaseUrl
              ? 'e.g. https://openrouter.ai/api/v1, https://api.groq.com/openai/v1, http://localhost:11434/v1'
              : `Leave blank for ${DEFAULT_BASE_URLS[provider.type]}`
          }
          className="sm:col-span-2"
        >
          <Input
            value={provider.baseUrl}
            placeholder={DEFAULT_BASE_URLS[provider.type] || 'https://…/v1'}
            spellCheck={false}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
        </Field>

        <Field label="Temperature" hint="0 is repeatable; higher is more varied.">
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={provider.temperature}
            onChange={(e) => set({ temperature: Number(e.target.value) })}
          />
        </Field>

        <Field label="Max tokens" hint="Cap on one reply.">
          <Input
            type="number"
            min={1}
            max={32000}
            value={provider.maxTokens}
            onChange={(e) => set({ maxTokens: Number(e.target.value) || 1 })}
          />
        </Field>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        Calls go to <code>{effectiveBaseUrl(provider) || '—'}</code>. Pressing Test key asks Chrome
        for permission to reach {providerOrigin(provider) || 'that host'}; nothing is sent until you
        grant it.
      </p>

      {result ? (
        <p
          className={cx(
            'mt-2 text-xs',
            result.ok ? 'text-good ' : 'text-bad',
          )}
        >
          {result.message}
        </p>
      ) : null}
    </div>
  )
}
