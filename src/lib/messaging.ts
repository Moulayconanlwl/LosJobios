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
  'cs/autofill-page': { req: Record<string, never>; res: AutofillReport }
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
