import { useEffect, useState } from 'react'
import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'

/**
 * The shared primitives every surface is built from. One file on purpose —
 * they're small, they change together, and three separate UIs importing from
 * one place keeps the popup, options page and dashboard looking like one
 * product.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  disabled?: boolean
  type?: 'button' | 'submit'
  className?: string
  title?: string
}

/*
 * One orange, and only for the primary action.
 *
 * DESIGN.md is explicit that the accent is the single chromatic decision in
 * the system, so secondary and ghost stay achromatic and `danger` borrows a
 * status colour rather than introducing a second brand one.
 */
const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-accent text-accent-ink shadow-[var(--shadow-control)] hover:brightness-90 disabled:hover:brightness-100',
  secondary: 'bg-surface text-ink border border-field hover:bg-raised',
  danger: 'bg-surface text-bad border border-bad/40 hover:bg-bad-wash',
  ghost: 'text-muted hover:bg-accent-wash/60 hover:text-ink',
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  disabled,
  type = 'button',
  className,
  title,
}: ButtonProps) {
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        // 16px radius is the system's tactile signature, per DESIGN.md.
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] font-semibold transition-all',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-5 py-2.5 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------

const CONTROL_CLASS =
  'w-full rounded-[var(--radius-control)] border border-field bg-surface px-4 py-2.5 text-sm text-ink ' +
  'placeholder:text-faint transition-colors focus:border-accent focus:outline-none ' +
  'focus:ring-2 focus:ring-accent/30'

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-semibold text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span> : null}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(CONTROL_CLASS, props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(CONTROL_CLASS, 'resize-y', props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(CONTROL_CLASS, props.className)} />
}

/** Split a typed list on commas or newlines. */
export function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/**
 * A textarea over a list of values — skills, keyword filters, blocked companies.
 *
 * It holds its own raw text on purpose. Rendering `value.join(separator)`
 * straight back into the box eats the separator as you type it: "Python,"
 * parses to `['Python']`, which renders as "Python" and deletes the comma
 * that was just pressed, so a second entry can never be typed (pasting one
 * worked, which is why this survived). Local text while the field has focus,
 * re-seeded from outside only when it doesn't.
 */
export function ListTextarea({
  value,
  onChange,
  separator = '\n',
  rows = 3,
  placeholder,
  className,
}: {
  value: string[]
  onChange: (next: string[]) => void
  /** How the list is rendered back out. Input is always split on commas or newlines. */
  separator?: string
  rows?: number
  placeholder?: string
  className?: string
}) {
  const [text, setText] = useState(() => value.join(separator))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setText(value.join(separator))
  }, [value, separator, editing])

  return (
    <Textarea
      rows={rows}
      value={text}
      placeholder={placeholder}
      className={className}
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        setText(e.target.value)
        onChange(parseList(e.target.value))
      }}
    />
  )
}

// ---------------------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 flex-none rounded-[var(--radius-pill)] transition-colors',
          checked ? 'bg-accent' : 'bg-field',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-relaxed text-muted">{hint}</span> : null}
      </span>
    </label>
  )
}

// ---------------------------------------------------------------------------

export function Card({
  title,
  description,
  children,
  actions,
}: {
  title?: string
  description?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-hair/60 bg-surface p-6 shadow-[var(--shadow-panel)]">
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-heading-sm font-semibold text-ink">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
            ) : null}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-hair/60 bg-surface px-5 py-4">
      <div
        className={cx(
          'text-heading font-semibold tabular-nums',
          tone === 'good' && 'text-good',
          tone === 'bad' && 'text-bad',
          !tone && 'text-ink',
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-caption text-muted">{label}</div>
    </div>
  )
}

export function Banner({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success'
  children: ReactNode
}) {
  // `info` uses the accent wash rather than a blue: a second hue would break
  // the one-colour discipline the system is built on.
  const tones = {
    info: 'border-accent/25 bg-accent-wash/50 text-ink',
    warn: 'border-warn/30 bg-warn-wash text-warn',
    error: 'border-bad/30 bg-bad-wash text-bad',
    success: 'border-good/30 bg-good-wash text-good',
  }
  return (
    <div className={cx('rounded-[var(--radius-control)] border px-4 py-3 text-xs leading-relaxed', tones[tone])}>
      {children}
    </div>
  )
}

export { cx }
