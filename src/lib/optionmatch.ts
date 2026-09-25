/**
 * Matching a desired answer against the choices a control actually offers.
 *
 * Pure string logic, deliberately kept out of the DOM layer so the background
 * can validate an answer against a set of options before ever sending it to a
 * page — and so it can be unit-tested without a browser.
 */

export function canonical(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, '')
}

/** Yes/no phrasing varies wildly across boards; normalize to a common token. */
export function booleanish(value: string): 'yes' | 'no' | null {
  const c = canonical(value)
  if (['yes', 'y', 'true', '1', 'ido', 'iam', 'iagree', 'agree', 'iwill'].includes(c)) return 'yes'
  if (['no', 'n', 'false', '0', 'idonot', 'idont', 'iamnot', 'disagree', 'iwillnot'].includes(c)) {
    return 'no'
  }
  return null
}

/** Does this option read as a negation? "I am **not** authorized", "I do**n't**". */
export function isNegated(value: string): boolean {
  return /\b(not|never|neither|no)\b|n['’]t\b/i.test(value)
}

/**
 * Index of the option that best matches `wanted`, or -1 when nothing is a
 * defensible match.
 *
 * Tiers, strongest first: exact → yes/no equivalence → negation polarity on a
 * binary pair → prefix in either direction → substring in either direction.
 * Returning -1 rather than a weak guess is deliberate: a wrong answer on a
 * screening question is worse than pausing to ask.
 */
export function matchOption(options: string[], wanted: string): number {
  if (!options.length) return -1

  const target = canonical(wanted)
  if (!target) return -1

  const canon = options.map(canonical)

  const exact = canon.indexOf(target)
  if (exact >= 0) return exact

  const wantedBool = booleanish(wanted)

  if (wantedBool) {
    const boolIdx = options.findIndex((o) => booleanish(o) === wantedBool)
    if (boolIdx >= 0) return boolIdx

    /*
     * US application forms almost never say plain "Yes"/"No". They say
     * "I am authorized to work" / "I am not authorized to work". On a two-option
     * group where exactly one side is negated, the polarity is unambiguous.
     * Substring matching can't do this — "no" appears inside "not", "none" and
     * "technology" alike.
     */
    if (options.length === 2) {
      const negated = options.map(isNegated)
      if (negated[0] !== negated[1]) {
        const negatedIdx = negated[0] ? 0 : 1
        return wantedBool === 'no' ? negatedIdx : 1 - negatedIdx
      }
    }
  }

  const prefix = canon.findIndex((o) => o && (o.startsWith(target) || target.startsWith(o)))
  if (prefix >= 0) return prefix

  const substring = canon.findIndex(
    (o) => o.length > 2 && target.length > 2 && (o.includes(target) || target.includes(o)),
  )
  return substring
}

/**
 * Sørensen–Dice similarity over character bigrams, 0..1.
 *
 * Used to decide whether a stored answer-bank question is "the same question"
 * as one on screen. Bigrams handle the way boards reword the same prompt
 * ("How many years of experience do you have with React?" vs "Years of React
 * experience") far better than exact matching or raw edit distance.
 */
export function similarity(a: string, b: string): number {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()

  if (!left || !right) return 0
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0

  const bigrams = new Map<string, number>()
  for (let i = 0; i < left.length - 1; i += 1) {
    const gram = left.slice(i, i + 2)
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1)
  }

  let hits = 0
  for (let i = 0; i < right.length - 1; i += 1) {
    const gram = right.slice(i, i + 2)
    const count = bigrams.get(gram) ?? 0
    if (count > 0) {
      bigrams.set(gram, count - 1)
      hits += 1
    }
  }

  return (2 * hits) / (left.length - 1 + (right.length - 1))
}

/**
 * Words carrying no subject meaning. Kept deliberately broad — anything left
 * after this filter is treated as identifying *what* is being asked about.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does',
  'did', 'have', 'has', 'had', 'you', 'your', 'yours', 'we', 'our', 'i', 'me', 'my',
  'it', 'its', 'this', 'that', 'these', 'those', 'how', 'what', 'when', 'where', 'why',
  'which', 'who', 'whom', 'will', 'would', 'can', 'could', 'should', 'shall', 'may',
  'might', 'must', 'many', 'much', 'any', 'all', 'some', 'please', 'select', 'enter',
  'provide', 'describe', 'tell', 'us', 'about', 'years', 'year', 'experience', 'level',
  'total', 'number', 'amount', 'currently', 'current', 'now', 'future', 'require',
])

/** The words in a question that say what it's actually about. */
export function contentTokens(value: string): Set<string> {
  const tokens = value
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token))

  return new Set(tokens)
}

/**
 * Whether two questions are asking about the same subject.
 *
 * Bigram similarity alone is not enough to key the answer bank. "How many years
 * of experience do you have with Python?" and "…with Java?" score above 0.9 —
 * near-identical as strings, completely different as questions. Reusing one
 * answer for the other puts a false claim on a real application.
 *
 * The distinguishing rule is substitution versus extension. If each question
 * contains a meaningful word the other lacks, one subject was swapped for
 * another and they are different questions. If only one side has extra words,
 * it's the same question phrased more fully ("React" vs "React JS"), and the
 * stored answer still applies.
 */
export function sameSubject(a: string, b: string): boolean {
  const left = contentTokens(a)
  const right = contentTokens(b)

  const onlyLeft = [...left].filter((token) => !right.has(token))
  const onlyRight = [...right].filter((token) => !left.has(token))

  return onlyLeft.length === 0 || onlyRight.length === 0
}
