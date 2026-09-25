import type { ReactNode } from 'react'
import { cx } from './ui'

const TONES = {
  neutral: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  ai: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  good: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  bad: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
} as const

export type BadgeTone = keyof typeof TONES

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize',
        TONES[tone],
      )}
    >
      {children}
    </span>
  )
}
