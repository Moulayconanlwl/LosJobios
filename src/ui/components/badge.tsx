import type { ReactNode } from 'react'
import { cx } from './ui'

/*
 * `ai` and `info` use the accent wash rather than violet and sky.
 *
 * DESIGN.md allows exactly one chromatic decision, so a badge palette with
 * six hues would undo the discipline the rest of the system keeps. The status
 * three stay distinct because they mean pass, caution and failure; everything
 * else is warm neutral.
 */
const TONES = {
  neutral: 'bg-raised text-muted',
  ai: 'bg-accent-wash text-accent',
  warn: 'bg-warn-wash text-warn',
  good: 'bg-good-wash text-good',
  bad: 'bg-bad-wash text-bad',
  info: 'bg-accent-wash/60 text-ink',
} as const

export type BadgeTone = keyof typeof TONES

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-semibold capitalize',
        TONES[tone],
      )}
    >
      {children}
    </span>
  )
}
