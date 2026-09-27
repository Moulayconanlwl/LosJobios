import { sendToBackground } from '@/lib/messaging'
import type { LogLevel } from '@/lib/debug-log'

/**
 * Logging from inside the page.
 *
 * A content script cannot write `chrome.storage.session` itself — its default
 * access level is trusted contexts only — so every line goes through the
 * background. Fire-and-forget on purpose: the worker narrating what it is
 * doing must never be able to fail the thing it was describing, and the
 * background being asleep is not an error worth surfacing mid-application.
 */
function send(level: LogLevel, scope: string, message: string, detail?: string): void {
  void sendToBackground('cs/log', { level, scope, message, ...(detail ? { detail } : {}) }).catch(
    () => {},
  )
}

export const csDebug = (scope: string, message: string, detail?: string) =>
  send('debug', scope, message, detail)
export const csInfo = (scope: string, message: string, detail?: string) =>
  send('info', scope, message, detail)
export const csWarn = (scope: string, message: string, detail?: string) =>
  send('warn', scope, message, detail)
export const csError = (scope: string, message: string, detail?: string) =>
  send('error', scope, message, detail)
