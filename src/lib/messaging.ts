import type { ValidationError } from '@/content/validation'
import type { CapturedJob, FieldKind, JobRef, PendingQuestion, RunState } from './schema'

/**
 * One typed map for every message that crosses a context boundary. Adding a
 * message means adding a line here; senders and handlers both derive their
 * types from it, so a typo or a shape drift is a compile error rather than an
 * undefined at runtime.
 */

export type Ack = { ok: true } | { ok: false; error: string }

export type AutofillReport = {
  filled: number
  skipped: number
  unfilled: string[]
}

export type ApplyOutcome =
  | { result: 'applied'; questionsAnswered: number; aiAnswersUsed: number }
  | { result: 'skipped'; reason: string }
  | { result: 'blocked'; question: PendingQuestion }
  | { result: 'failed'; error: string }
  /**
   * The application continues on a page this content script won't live to
   * see. Indeed does this: clicking Apply navigates the tab to a separate
   * hosted form, which tears down the script mid-call.
   *
   * The background answers this by waiting for the tab to settle, injecting a
   * fresh script and sending `cs/continue-apply`. Counts already earned on
   * the first page are carried across so the tracked application isn't
   * reported as having answered nothing.
   *
   * Because the navigation can outrun the reply, the background treats a
   * dropped connection *plus* a tab now sitting on a continuation URL as the
   * same thing — this variant is the tidy path, not the only one.
   */
  | { result: 'handoff'; questionsAnswered: number; aiAnswersUsed: number }

export type AnswerRequest = {
  question: string
  kind: FieldKind
  options: string[]
  required: boolean
  job: JobRef | null
  /** Job description text scraped from the page, used as AI context. */
  jobDescription: string
}

export type AnswerResponse = {
  /** Null means nothing could answer this with enough confidence. */
  answer: string | null
  source: 'bank' | 'heuristic' | 'ai' | 'none'
  /** 0..1 — the run pauses on a required field below the confidence floor. */
  confidence: number
}

/** Where a proposed value came from, which is what makes it reviewable. */
export type FieldSource = AnswerResponse['source'] | 'profile'

/**
 * One field the extension is offering to fill, before anything is written.
 *
 * `selected` is a proposal, not a decision — the user's edits come back in
 * the same shape, and only what they leave selected is ever written.
 */
export type FieldProposal = {
  /** Round-trip handle; the page element is found again by this. */
  handle: string
  label: string
  kind: FieldKind
  required: boolean
  /** Non-empty for selects and radio groups, so the review can constrain edits. */
  options: string[]
  value: string
  source: FieldSource
  confidence: number
  /** Plain-language justification shown beside the value. */
  reason: string
  selected: boolean
  /** A file attachment rather than a typed value. */
  attachment: boolean
}

export type FieldPlanReport = {
  proposals: FieldProposal[]
  /** Fields left alone because they already held a value. */
  skipped: number
  site: SiteReport
}

/** What the extension can actually do on the page in front of the user. */
export type SiteReport = {
  kind: 'known-ats' | 'generic-form' | 'no-form'
  /** Human-readable site name, e.g. "LinkedIn". */
  site: string
  fieldCount: number
  message: string
}

export type MessageMap = {
  // ---- UI → background -------------------------------------------------
  'run/start': { req: Record<string, never>; res: Ack }
  'run/pause': { req: Record<string, never>; res: Ack }
  'run/resume': { req: Record<string, never>; res: Ack }
  'run/stop': { req: Record<string, never>; res: Ack }
  'run/state': { req: Record<string, never>; res: RunState }
  /** Supply the answer to a question that blocked the run, then continue. */
  'run/answer': { req: { answer: string; remember: boolean }; res: Ack }
  'autofill/active-tab': { req: Record<string, never>; res: Ack & { report?: AutofillReport } }
  'dashboard/open': { req: Record<string, never>; res: Ack }
  /**
   * Scrape the posting off whatever page the user is looking at and stash it
   * for the ATS scorer. Runs off a popup click, which is the user gesture
   * `activeTab` needs on a site we hold no standing permission for.
   */
  'ats/capture-job': { req: Record<string, never>; res: Ack & { job?: CapturedJob } }
  /**
   * Side panel → background → content, for the review flow. Each one targets
   * whatever tab the panel is looking at, so the panel never needs to know
   * about tabs or frames.
   */
  /** Open the review panel beside the current tab. Needs a user gesture. */
  'panel/open': { req: Record<string, never>; res: Ack }
  'panel/site-report': { req: Record<string, never>; res: Ack & { site?: SiteReport } }
  'panel/plan-fields': { req: Record<string, never>; res: Ack & { plan?: FieldPlanReport } }
  'panel/draft-answers': { req: Record<string, never>; res: Ack & { proposals?: FieldProposal[] } }
  'panel/apply-plan': {
    req: { decisions: FieldProposal[] }
    res: Ack & {
      result?: { filled: number; failed: number; skipped: string[]; errors: ValidationError[] }
    }
  }
  /** Scrape the job list on the current page into the saved-jobs library. */
  'jobs/scan-active-tab': { req: Record<string, never>; res: Ack & { added?: number; found?: number } }
  /**
   * Open one saved posting in a background tab just long enough to read its
   * description, then close it. A search page's cards don't carry the text,
   * and tailoring anything to a job needs it.
   */
  'jobs/fetch-description': { req: { id: string }; res: Ack & { description?: string } }

  // ---- background → content --------------------------------------------
  'cs/ping': { req: Record<string, never>; res: { ready: true; site: string } }
  'cs/collect-jobs': {
    req: { limit: number }
    res: { jobs: JobRef[]; emptyReason?: string }
  }
  'cs/apply-job': { req: { job: JobRef; dryRun: boolean }; res: ApplyOutcome }
  /**
   * Pick up an application that carried on into a new page load. `carried`
   * are the field counts already earned before the navigation.
   */
  'cs/continue-apply': {
    req: { job: JobRef; dryRun: boolean; carried: { questionsAnswered: number; aiAnswersUsed: number } }
    res: ApplyOutcome
  }
  'cs/autofill-page': { req: Record<string, never>; res: AutofillReport }
  /**
   * Work out what *would* be filled, and report it for review. Writes
   * nothing — this is the read-only half of the fill flow.
   */
  'cs/plan-fields': { req: Record<string, never>; res: FieldPlanReport }
  /** Write back exactly the proposals the user left selected. */
  'cs/apply-plan': {
    req: { decisions: FieldProposal[] }
    res: { filled: number; failed: number; skipped: string[]; errors: ValidationError[] }
  }
  /** Draft answers for the free-text questions nothing else could answer. */
  'cs/draft-answers': { req: Record<string, never>; res: { proposals: FieldProposal[] } }
  /** What kind of page is this, and what is supported here? */
  'cs/site-report': { req: Record<string, never>; res: SiteReport }
  /** What job is this page about? Best-effort; every field may come back empty. */
  'cs/job-context': {
    req: Record<string, never>
    res: { title: string; company: string; description: string; url: string }
  }
  'cs/abort': { req: Record<string, never>; res: Ack }
  'cs/overlay': { req: { visible: boolean; status: string; detail: string }; res: Ack }

  // ---- content → background --------------------------------------------
  /** Content asks the background to resolve a screening question. */
  'answers/resolve': { req: AnswerRequest; res: AnswerResponse }
  /** Progress ticks so the popup and overlay can show what's happening. */
  'run/progress': { req: { message: string }; res: Ack }
  /**
   * "I'm the frame that actually has the page's real content." Some sites —
   * LinkedIn's authenticated job search among them — render everything inside
   * a same-origin iframe, leaving the top-level document an empty shell. The
   * background records `sender.frameId` from this so later messages go to
   * the frame that can actually act on them, not frame 0 by default.
   */
  'cs/claim-frame': { req: Record<string, never>; res: Ack }
}

export type MessageType = keyof MessageMap
export type Req<K extends MessageType> = MessageMap[K]['req']
export type Res<K extends MessageType> = MessageMap[K]['res']

type Envelope<K extends MessageType = MessageType> = {
  __losjobios: true
  type: K
  payload: Req<K>
}

function envelope<K extends MessageType>(type: K, payload: Req<K>): Envelope<K> {
  return { __losjobios: true, type, payload }
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __losjobios?: unknown }).__losjobios === true
  )
}

/** Thrown when the other end isn't listening — a closed popup, an unloaded tab. */
export class NoReceiverError extends Error {
  constructor(type: string) {
    super(`No receiver for "${type}"`)
    this.name = 'NoReceiverError'
  }
}

function isNoReceiver(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('Could not establish connection') ||
    msg.includes('Receiving end does not exist') ||
    msg.includes('message port closed')
  )
}

/** Send to the service worker (or to any extension page listening). */
export async function sendToBackground<K extends MessageType>(
  type: K,
  payload: Req<K> = {} as Req<K>,
): Promise<Res<K>> {
  try {
    return (await chrome.runtime.sendMessage(envelope(type, payload))) as Res<K>
  } catch (err) {
    if (isNoReceiver(err)) throw new NoReceiverError(type)
    throw err
  }
}

/**
 * Send to a content script in a specific tab.
 *
 * Omitting `frameId` targets frame 0 (the top-level document) — Chrome's own
 * default, not a broadcast to every frame. Pass it explicitly whenever the
 * real content might live in a same-origin iframe instead; see
 * `background/frames.ts`.
 */
export async function sendToTab<K extends MessageType>(
  tabId: number,
  type: K,
  payload: Req<K> = {} as Req<K>,
  options?: { frameId?: number },
): Promise<Res<K>> {
  // TS's overload resolution for chrome.tabs.sendMessage can't disambiguate
  // the Promise-returning form from the callback form when the third
  // argument's type includes `undefined` — always pass a real (possibly
  // empty) MessageSendOptions object instead.
  const sendOptions: chrome.tabs.MessageSendOptions =
    options?.frameId !== undefined ? { frameId: options.frameId } : {}

  try {
    return (await chrome.tabs.sendMessage(tabId, envelope(type, payload), sendOptions)) as Res<K>
  } catch (err) {
    if (isNoReceiver(err)) throw new NoReceiverError(type)
    throw err
  }
}

export type Handlers = {
  [K in MessageType]?: (
    payload: Req<K>,
    sender: chrome.runtime.MessageSender,
  ) => Promise<Res<K>> | Res<K>
}

/**
 * Register message handlers. Returns an unsubscribe function.
 *
 * The listener returns `true` synchronously so Chrome keeps the response port
 * open for the async handler — without that, every awaited reply is dropped.
 */
export function registerHandlers(handlers: Handlers): () => void {
  const listener = (
    raw: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean | undefined => {
    if (!isEnvelope(raw)) return undefined

    const handler = handlers[raw.type] as
      | ((payload: unknown, sender: chrome.runtime.MessageSender) => unknown)
      | undefined
    if (!handler) return undefined

    void (async () => {
      try {
        sendResponse(await handler(raw.payload, sender))
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        console.error(`[LosJobios] handler "${raw.type}" threw:`, err)
        sendResponse({ ok: false, error })
      }
    })()

    return true
  }

  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}
