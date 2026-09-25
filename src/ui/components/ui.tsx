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

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:hover:bg-indigo-600',
  secondary:
    'bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-700',
  danger:
    'bg-white text-red-600 border border-red-300 hover:bg-red-50 dark:bg-zinc-800 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-950',
  ghost: 'text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-300 dark:hover:bg-zinc-800',
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
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
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
  'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 ' +
  'placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 ' +
  'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500'

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
      <span className="mb-1.5 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-zinc-500">{hint}</span> : null}
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
          'relative mt-0.5 h-5 w-9 flex-none rounded-full transition-colors',
          checked ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-700',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4.5' : 'translate-x-0.5',
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
        {hint ? <span className="block text-xs text-zinc-500">{hint}</span> : null}
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
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
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
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div
        className={cx(
          'text-2xl font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'bad' && 'text-red-600 dark:text-red-400',
          !tone && 'text-zinc-900 dark:text-zinc-100',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-zinc-500">{label}</div>
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
  const tones = {
    info: 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-200',
    warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
    error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    success:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  }
  return (
    <div className={cx('rounded-lg border px-3 py-2 text-xs leading-relaxed', tones[tone])}>
      {children}
    </div>
  )
}

export { cx }
