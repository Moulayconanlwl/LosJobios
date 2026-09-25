import { GeminiProvider, hasGeminiPermission } from './ai/gemini'
import { AIProviderError, type AIProvider } from './ai/provider'
import { CONFIDENCE_FLOOR, classifySignals, normalizeQuestion, valueForKey } from './fieldrules'
import type { AnswerRequest, AnswerResponse } from './messaging'
import { matchOption, sameSubject, similarity } from './optionmatch'
import type { AnswerEntry, FieldKind } from './schema'
import { getAnswers, getProfile, getSettings, patchSettings, putAnswer, touchAnswer } from './storage'

/**
 * Resolving a screening question into an answer, in three tiers.
 *
 *   1. Answer bank — something you (or a previous AI call you kept) already
 *      answered. Cheapest, most accurate, and it compounds: the longer you use
 *      the extension the less the other two tiers run.
 *   2. Heuristics — the question maps onto a known profile slot.
 *   3. AI — a genuinely novel question, answered from your profile.
 *
 * A required question that finishes below CONFIDENCE_FLOOR stops the run and
 * gets handed to you instead. Submitting a confident-sounding wrong answer to
 * "how many years of Kubernetes do you have" is worse than not applying.
 */

export { CONFIDENCE_FLOOR }

/** Below this, two questions are treated as different questions. */
const FUZZY_MATCH_FLOOR = 0.85

const NO_ANSWER: AnswerResponse = { answer: null, source: 'none', confidence: 0 }

/** Kinds that store interchangeably in the bank — text/textarea/email all hold strings. */
function kindGroup(kind: FieldKind): string {
  switch (kind) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'tel':
    case 'url':
      return 'text'
    case 'select':
    case 'radio':
      return 'choice'
    default:
      return kind
  }
}

function bankLookup(
  entries: AnswerEntry[],
  question: string,
  kind: FieldKind,
): { entry: AnswerEntry; confidence: number } | null {
  const normalized = normalizeQuestion(question)
  if (!normalized) return null

  const group = kindGroup(kind)
  const compatible = entries.filter((e) => kindGroup(e.kind) === group)

  const exact = compatible.find((e) => e.normalized === normalized)
  if (exact) return { entry: exact, confidence: 0.99 }

  let best: AnswerEntry | null = null
  let bestScore = 0
  for (const entry of compatible) {
    // Similarity alone would match "years of experience with Python" to the
    // Java answer — they differ by one word out of a dozen. The subject check
    // is what makes fuzzy matching safe to use on a real application.
    if (!sameSubject(entry.normalized, normalized)) continue

    const score = similarity(entry.normalized, normalized)
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }

  if (best && bestScore >= FUZZY_MATCH_FLOOR) {
    // A fuzzy hit is never as trustworthy as an exact one, so cap it below.
    return { entry: best, confidence: Math.min(bestScore, 0.95) }
  }

  return null
}

/**
 * Constrain a free-text answer to the options a control actually offers.
 * Returns null when the answer doesn't map onto any of them — which is a
 * signal that the answer is wrong, not that the options are.
 */
function snapToOption(answer: string, options: string[]): string | null {
  if (!options.length) return answer
  const idx = matchOption(options, answer)
  if (idx < 0) return null
  return options[idx] ?? null
}

// ---------------------------------------------------------------------------
// AI tier
// ---------------------------------------------------------------------------

/**
 * Build a provider from settings, resolving the model against what the key can
 * actually call. Returns null when AI is off, unconfigured, or unpermitted.
 */
export async function getProvider(): Promise<AIProvider | null> {
  const settings = await getSettings()
  const { provider, apiKey, answerQuestions } = settings.ai

  if (provider !== 'gemini' || !apiKey || !answerQuestions) return null
  if (!(await hasGeminiPermission())) return null

  let model = settings.ai.model
  if (!model) {
    // Never hardcode a model id — Gemini's lineup turns over and a stale id is
    // a 404. Ask the key what it can call, take the best, and remember it.
    try {
      const models = await new GeminiProvider(apiKey, '').listModels()
      model = models[0]?.id ?? ''
      if (model) await patchSettings({ ai: { ...settings.ai, model } })
    } catch (err) {
      console.warn('[LosJobios] could not list Gemini models', err)
      return null
    }
  }

  return model ? new GeminiProvider(apiKey, model) : null
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * A cover letter field is never a fact lookup — it's the one field where the
 * whole point is content tailored to *this* job. Routing it through the
 * three-tier resolver would mean the answer bank's exact-match tier serves
 * back whatever letter happened to be generated for the first job that asked,
 * verbatim, on every application after it. So it gets its own path: a fresh
 * AI generation per job when AI is configured, falling back to the static
 * template (or nothing) when it isn't.
 */
async function resolveCoverLetter(request: AnswerRequest): Promise<AnswerResponse> {
  const profile = await getProfile()

  const provider = await getProvider()
  if (provider) {
    try {
      const result = await provider.generateCoverLetter({
        profile,
        job: request.job,
        jobDescription: request.jobDescription,
      })
      const text = result.text.trim()
      if (text) return { answer: text, source: 'ai', confidence: 0.85 }
    } catch (err) {
      if (err instanceof AIProviderError && err.isRateLimit) {
        console.warn('[LosJobios] Gemini rate limited; falling back to the cover letter template.')
      } else {
        console.warn('[LosJobios] AI cover letter generation failed', err)
      }
    }
  }

  const template = profile.coverLetterTemplate.trim()
  return template ? { answer: template, source: 'heuristic', confidence: 0.9 } : NO_ANSWER
}

export async function resolveAnswer(request: AnswerRequest): Promise<AnswerResponse> {
  const question = request.question.trim()
  if (!question) return NO_ANSWER

  const preview = classifySignals({ label: question, kind: request.kind })
  if (preview.key === 'coverLetter') return resolveCoverLetter(request)

  // --- Tier 1: answer bank ------------------------------------------------
  const entries = await getAnswers()
  const hit = bankLookup(entries, question, request.kind)
  if (hit) {
    const snapped = snapToOption(hit.entry.answer, request.options)
    if (snapped !== null) {
      void touchAnswer(hit.entry.id)
      return { answer: snapped, source: 'bank', confidence: hit.confidence }
    }
  }

  // --- Tier 2: profile heuristics -----------------------------------------
  const profile = await getProfile()
  const { key, confidence } = preview

  if (key) {
    const value = valueForKey(key, profile)
    if (value !== null) {
      const snapped = snapToOption(value, request.options)
      if (snapped !== null) {
        return { answer: snapped, source: 'heuristic', confidence }
      }
    }
  }

  // --- Tier 3: AI ----------------------------------------------------------
  const provider = await getProvider()
  if (!provider) return NO_ANSWER

  try {
    const result = await provider.answerQuestion({
      question,
      kind: request.kind,
      options: request.options,
      profile,
      job: request.job,
      jobDescription: request.jobDescription,
    })

    const snapped = snapToOption(result.answer, request.options)
    if (snapped === null) {
      // The model answered outside the allowed set — treat that as a miss
      // rather than forcing a value the form would reject anyway.
      return NO_ANSWER
    }

    // Remember it, unconfirmed, so the same question is free next time and you
    // can review what the model decided on your behalf.
    await putAnswer({
      id: crypto.randomUUID(),
      question,
      normalized: normalizeQuestion(question),
      kind: request.kind,
      answer: snapped,
      options: request.options,
      source: 'ai',
      confirmed: false,
      useCount: 1,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    })

    return { answer: snapped, source: 'ai', confidence: result.confidence }
  } catch (err) {
    if (err instanceof AIProviderError && err.isRateLimit) {
      console.warn('[LosJobios] Gemini rate limited; falling back to asking you.')
    } else {
      console.warn('[LosJobios] AI answer failed', err)
    }
    return NO_ANSWER
  }
}

/** Persist an answer you supplied yourself, as a confirmed bank entry. */
export async function rememberUserAnswer(
  question: string,
  kind: FieldKind,
  answer: string,
  options: string[] = [],
): Promise<void> {
  await putAnswer({
    id: crypto.randomUUID(),
    question,
    normalized: normalizeQuestion(question),
    kind,
    answer,
    options,
    source: 'user',
    confirmed: true,
    useCount: 1,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  })
}
