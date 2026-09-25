import { useEffect, useState } from 'react'
import type { Settings } from '@/lib/schema'
import {
  GeminiProvider,
  hasGeminiPermission,
  requestGeminiPermission,
} from '@/lib/ai/gemini'
import type { ProviderModel } from '@/lib/ai/provider'
import { Banner, Button, Card, Field, Input, Select, Toggle } from '../../components/ui'
import type { Draft } from '../../hooks'

/**
 * The AI tier is optional and entirely bring-your-own-key. Two things have to
 * be true before it does anything: a key is stored, and you've granted the
 * optional host permission that lets the extension reach Google at all.
 */
export function AiSection({ draft }: { draft: Draft<Settings> }) {
  const settings = draft.value

  const [granted, setGranted] = useState<boolean | null>(null)
  const [models, setModels] = useState<ProviderModel[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void hasGeminiPermission().then(setGranted)
  }, [])

  if (!settings) return null

  const { ai } = settings

  const grantAccess = async () => {
    // Must be inside the click handler — Chrome rejects permission requests
    // that aren't tied to a user gesture.
    const ok = await requestGeminiPermission()
    setGranted(ok)
    if (!ok) setStatus('Permission declined — AI answers stay off.')
  }

  const loadModels = async () => {
    setBusy(true)
    setStatus('')
    try {
      const available = await new GeminiProvider(ai.apiKey, '').listModels()
      setModels(available)

      if (available.length === 0) {
        setStatus('That key works, but it can’t call any text models.')
      } else {
        const best = available[0]
        // Adopt the best available model unless a deliberate choice is stored.
        if (!ai.model && best) draft.update({ ai: { ...ai, model: best.id } })
        setStatus(`Found ${available.length} models. Using ${ai.model || best?.id}.`)
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Could not reach Gemini.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="AI answers"
        description="Only used for questions the answer bank and your profile can't cover."
      >
        <Banner tone="info">
          Get a free key at{' '}
          <a
            className="font-semibold underline"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            aistudio.google.com/apikey
          </a>
          . It takes about a minute and doesn&rsquo;t need a credit card. The key is stored on this
          machine only and is sent to Google, never to us.
        </Banner>

        <div className="mt-4 flex flex-col gap-4">
          <Toggle
            checked={ai.answerQuestions}
            label="Let AI answer unknown questions"
            hint="With this off, any question your profile can't answer pauses the run instead."
            onChange={(v) => draft.update({ ai: { ...ai, answerQuestions: v } })}
          />

          <Field label="Gemini API key">
            <Input
              type="password"
              autoComplete="off"
              placeholder="AIza…"
              value={ai.apiKey}
              onChange={(e) => draft.update({ ai: { ...ai, apiKey: e.target.value } })}
            />
          </Field>

          {granted === false && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm" onClick={() => void grantAccess()}>
                Grant network access to Gemini
              </Button>
              <span className="text-xs text-zinc-500">
                Required before any request can be made.
              </span>
            </div>
          )}

          {granted === true && (
            <Banner tone="success">Network access to the Gemini API is granted.</Banner>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <Field label="Model" className="min-w-[16rem] flex-1">
              {models.length ? (
                <Select
                  value={ai.model}
                  onChange={(e) => draft.update({ ai: { ...ai, model: e.target.value } })}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={ai.model}
                  placeholder="Left empty, the best available is chosen automatically"
                  onChange={(e) => draft.update({ ai: { ...ai, model: e.target.value } })}
                />
              )}
            </Field>
            <Button
              variant="secondary"
              disabled={busy || !ai.apiKey || granted !== true}
              onClick={() => void loadModels()}
            >
              {busy ? 'Checking…' : 'Test key & list models'}
            </Button>
          </div>

          {status ? <Banner tone="info">{status}</Banner> : null}

          <p className="text-xs text-zinc-500">
            Model IDs aren&rsquo;t hardcoded — the list is fetched from your key, so a retired model
            can&rsquo;t leave the extension broken.
          </p>
        </div>
      </Card>
    </div>
  )
}
