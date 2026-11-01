import { getSettings, patchSettings } from '../storage'
import { GeminiProvider } from './gemini'
import { GenericChatProvider } from './generic'
import type { AIProvider } from './provider'
import { hasProviderPermission, migrateLegacyProvider, selectProvider } from './registry'

/**
 * The provider the rest of the extension should use, whoever it is.
 *
 * One place that knows how stored configuration becomes a callable provider,
 * because there used to be five — the run engine, the cover-letter button,
 * the CV parser, the ATS reviewer and the resume writer each constructed
 * Gemini from `settings.ai.apiKey` by hand. Adding a second vendor to five
 * copies means four of them keep working and one quietly does not.
 *
 * `requireAnswerQuestions` is the one real distinction. That toggle governs
 * whether a *run* may put model-written text into an employer's form; it has
 * no bearing on whether the user may press "Write a cover letter" themselves.
 */
export async function getAiProvider(
  options: { requireAnswerQuestions?: boolean } = {},
): Promise<AIProvider | null> {
  const settings = await getSettings()

  if (options.requireAnswerQuestions && !settings.ai.answerQuestions) return null

  /*
   * Carry a pre-multi-provider configuration forward on first use, so an
   * existing key keeps working without the user touching anything. Writes
   * once and clears the legacy fields, so it cannot resurrect a provider the
   * user has deliberately deleted.
   */
  const migrated = migrateLegacyProvider(settings)
  if (migrated) await patchSettings({ ai: migrated.ai })

  const current = migrated ?? settings
  const config = selectProvider(current)
  if (!config || !config.model) return null

  /*
   * Without host permission the call fails as a network error, which reads
   * like being offline and sends people to check their wifi. Returning null
   * here means the feature reports itself as unconfigured instead, which is
   * what it actually is.
   */
  if (!(await hasProviderPermission(config))) return null

  // Gemini keeps its own implementation: it constrains replies with the API's
  // own `responseSchema`, which no other vendor offers.
  if (config.type === 'gemini') return new GeminiProvider(config.apiKey, config.model)

  return new GenericChatProvider(config, {
    timeoutMs: current.ai.timeoutMs,
    retries: current.ai.retries,
  })
}

/** Is any provider configured and reachable? For enabling buttons. */
export async function isAiConfigured(): Promise<boolean> {
  return (await getAiProvider()) !== null
}
