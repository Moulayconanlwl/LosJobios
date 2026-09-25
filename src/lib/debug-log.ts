/**
 * A visible log of what a run is doing.
 *
 * A run drives a page you are watching, and when it stalls the only question
 * that matters is *where*. Without this the answer lives in a service-worker
 * console most people never open — and an MV3 worker is torn down constantly,
 * taking its console history with it.
 *
 * Stored in `chrome.storage.session`, so it survives the worker dying but is
 * gone when the browser closes. That is the right lifetime for a diagnostic:
 * long enough to read after a failure, short enough that it never becomes a
 * second, forgotten copy of what a run saw.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export type LogEntry = {
  at: number
  level: LogLevel
  /** Which part of the run wrote this — `run`, `indeed`, `fill`, … */
  scope: string
  message: string
  /** Optional structured extras. Never a field value; see below. */
  detail?: string
}

const KEY = 'debugLog'

/**
 * Enough to cover a full run, capped so a long session cannot grow without
 * bound. Oldest entries fall off first.
 */
const MAX_ENTRIES = 500

/**
 * What must never reach here.
 *
 * Log lines say *what happened*, never *what was typed*. "Filled 11 fields"
 * is a diagnostic; the eleven values are the most sensitive data the
 * extension holds, and a log is exactly the place people forget to look when
 * they think about where their data lives. `redact` is the backstop for a
 * caller that passes something careless.
 */
const SENSITIVE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b|\b(?:\+?\d[\d\s().-]{7,}\d)\b/g

export function redact(value: string): string {
  return value.replace(SENSITIVE, '[redacted]')
}

function session(): chrome.storage.SessionStorageArea | null {
  try {
    return chrome?.storage?.session ?? null
  } catch {
    return null
  }
}

export async function readLog(): Promise<LogEntry[]> {
  const area = session()
  if (!area) return []
  try {
    const stored = await area.get(KEY)
    const entries = stored[KEY]
    return Array.isArray(entries) ? (entries as LogEntry[]) : []
  } catch {
    return []
  }
}

/**
 * Append one line.
 *
 * Swallows its own errors for the same reason the activity log does: logging
 * is a side effect of doing something useful, and must never be able to fail
 * the thing it was describing.
 */
export async function log(
  level: LogLevel,
  scope: string,
  message: string,
  detail?: string,
): Promise<void> {
  const area = session()
  if (!area) return

  const entry: LogEntry = {
    at: Date.now(),
    level,
    scope,
    message: redact(String(message).slice(0, 400)),
    ...(detail ? { detail: redact(String(detail).slice(0, 800)) } : {}),
  }

  try {
    const existing = await readLog()
    const next = [...existing, entry].slice(-MAX_ENTRIES)
    await area.set({ [KEY]: next })
  } catch {
    // A full or unavailable session store is not worth failing a run over.
  }
}

export const logDebug = (scope: string, message: string, detail?: string) =>
  log('debug', scope, message, detail)
export const logInfo = (scope: string, message: string, detail?: string) =>
  log('info', scope, message, detail)
export const logWarn = (scope: string, message: string, detail?: string) =>
  log('warn', scope, message, detail)
export const logError = (scope: string, message: string, detail?: string) =>
  log('error', scope, message, detail)

export async function clearLog(): Promise<void> {
  try {
    await session()?.remove(KEY)
  } catch {
    // Nothing to do; the log is diagnostic.
  }
}

/** The log as plain text, for pasting into a bug report. */
export function formatLog(entries: LogEntry[]): string {
  return entries
    .map((entry) => {
      const time = new Date(entry.at).toISOString().slice(11, 23)
      const detail = entry.detail ? ` — ${entry.detail}` : ''
      return `${time} ${entry.level.toUpperCase().padEnd(5)} [${entry.scope}] ${entry.message}${detail}`
    })
    .join('\n')
}
