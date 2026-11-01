import { getAiProvider } from './ai/select'
import { AIProviderError, type AIProvider } from './ai/provider'
import { CONFIDENCE_FLOOR, classifySignals, normalizeQuestion, valueForKey } from './fieldrules'
import type { AnswerRequest, AnswerResponse } from './messaging'
import { matchOption, sameSubject, similarity } from './optionmatch'
import type { AnswerEntry, FieldKind } from './schema'
import { getAnswers, getProfile, getSettings, putAnswer, touchAnswer } from './storage'

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

/**
 * Below this, two questions are treated as different questions.
 *
 * Only the fallback: the real value comes from settings, so it can be raised
 * when the bank starts reusing answers too eagerly or lowered when it keeps
 * asking the model things it already knows.
 */
const FUZZY_MATCH_FLOOR = 0.85

/**
 * Near-misses worth showing the model.
 *
 * Far enough below the reuse threshold not to be served directly, close
 * enough to be about the same subject. These go into the AI prompt so a novel
 * question is answered consistently with what the candidate has already told
 * other employers.
 */
const RELATED_FLOOR = 0.45
const MAX_RELATED = 5

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
  threshold: number = FUZZY_MATCH_FLOOR,
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

  if (best && bestScore >= threshold) {
    // A fuzzy hit is never as trustworthy as an exact one, so cap it below.
    return { entry: best, confidence: Math.min(bestScore, 0.95) }
  }

  return null
}

/**
 * Bank entries that are about this question without being it.
 *
 * Subject-matched like the reuse path, so "years of Python" never pulls in
 * the Java answer as context — the point is consistency, and inconsistent
 * context is worse than none.
 */
function relatedAnswers(
  entries: AnswerEntry[],
  question: string,
  kind: FieldKind,
): Array<{ question: string; answer: string }> {
  const normalized = normalizeQuestion(question)
  if (!normalized) return []

  const group = kindGroup(kind)

  return entries
    .filter((entry) => kindGroup(entry.kind) === group)
    .map((entry) => ({ entry, score: sameSubject(entry.normalized, normalized) ? similarity(entry.normalized, normalized) : 0 }))
    .filter((scored) => scored.score >= RELATED_FLOOR)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELATED)
    .map(({ entry }) => ({ question: entry.question, answer: entry.answer }))
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
  // A run putting model-written text into an employer's form is what the
  // answerQuestions toggle governs, so this path respects it.
  return getAiProvider({ requireAnswerQuestions: true })
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

  const settings = await getSettings()

  // --- Tier 1: answer bank ------------------------------------------------
  const entries = await getAnswers()
  const hit = bankLookup(entries, question, request.kind, settings.ai.fuzzyThreshold)
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

  /*
   * A run asks the same question many times over — every posting wants the
   * notice period — and each one is a paid round trip. The cache is scoped to
   * the browser session, and keyed on everything that could change the right
   * answer, so a different set of options or a different job is a different
   * question.
   */
  const cacheKey = answerCacheKey(request)
  const cached = await readCachedAnswer(cacheKey)
  if (cached) return cached

  try {
    const result = await provider.answerQuestion({
      question,
      kind: request.kind,
      options: request.options,
      profile,
      job: request.job,
      jobDescription: request.jobDescription,
      relatedAnswers: relatedAnswers(entries, question, request.kind),
      ...(request.language ? { language: request.language } : {}),
    })

    const snapped = snapToOption(result.answer, request.options)
    if (snapped === null || !snapped.trim()) {
      /*
       * Either the model answered outside the allowed set, or it declined
       * because the information was not there. Both are a miss: the field is
       * left for review rather than filled with something the form would
       * reject or the candidate would have to disown.
       */
      return NO_ANSWER
    }

    const answer: AnswerResponse = { answer: snapped, source: 'ai', confidence: result.confidence }
    await writeCachedAnswer(cacheKey, answer)

    /*
     * Writing into the bank is opt-in, and off by default.
     *
     * The bank is what the extension reuses *without asking* next time, so
     * promoting an unreviewed guess into it turns one wrong answer into every
     * future wrong answer. Caching above gets the cost saving within a
     * session without that risk.
     */
    if (settings.ai.autoSaveAiAnswers) {
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
    }

    return answer
  } catch (err) {
    // Every failure ends the same way: the field is handed back to the user.
    // Saying which failure it was is the only thing that varies.
    if (err instanceof AIProviderError && err.isRateLimit) {
      console.warn('[LosJobios] model rate limited; leaving this field for review.')
    } else {
      console.warn('[LosJobios] AI answer failed', err)
    }
    return NO_ANSWER
  }
}

// ---------------------------------------------------------------------------
// Session cache
// ---------------------------------------------------------------------------

const CACHE_KEY = 'answerCache'
const MAX_CACHED = 300

/** Everything that could change the right answer goes into the key. */
function answerCacheKey(request: AnswerRequest): string {
  return [
    normalizeQuestion(request.question),
    request.kind,
    request.options.join(''),
    request.job?.externalId ?? '',
    request.language ?? '',
  ].join(' ')
}

async function readCachedAnswer(key: string): Promise<AnswerResponse | null> {
  try {
    const store = await chrome.storage.session.get(CACHE_KEY)
    const map = store[CACHE_KEY] as Record<string, AnswerResponse> | undefined
    return map?.[key] ?? null
  } catch {
    // No session storage is not a reason to fail a fill.
    return null
  }
}

async function writeCachedAnswer(key: string, value: AnswerResponse): Promise<void> {
  try {
    const store = await chrome.storage.session.get(CACHE_KEY)
    const map = (store[CACHE_KEY] as Record<string, AnswerResponse> | undefined) ?? {}

    map[key] = value

    // Bounded: a long run against a verbose board would otherwise grow this
    // without limit. Oldest insertions fall off first.
    const keys = Object.keys(map)
    if (keys.length > MAX_CACHED) {
      for (const stale of keys.slice(0, keys.length - MAX_CACHED)) delete map[stale]
    }

    await chrome.storage.session.set({ [CACHE_KEY]: map })
  } catch {
    // Caching is an optimisation; never let it fail the answer.
  }
}

/** Drop the cached answers, e.g. after editing the profile. */
export async function clearAnswerCache(): Promise<void> {
  try {
    await chrome.storage.session.remove(CACHE_KEY)
  } catch {
    // Nothing to do.
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
