import type { ReactNode } from 'react'
import { cx } from './ui'
import type { IconComponent } from './icons'

/**
 * The frame both full pages sit in: a fixed sidebar of icon-and-label
 * bubbles, and a scrolling column beside it.
 *
 * The labels are always rendered — they collapse to icons only when the
 * window is too narrow to carry them, where each one keeps its `title` so
 * the name is still a hover away. That's deliberately not a toggle: a nav
 * that hides its own labels behind a click is a nav people stop reading.
 */

export type NavItem<Id extends string> = {
  id: Id
  label: string
  icon: IconComponent
  /** Small count shown on the bubble — applications, saved jobs, and so on. */
  badge?: number
}

export function AppShell<Id extends string>({
  title,
  subtitle,
  items,
  active,
  onSelect,
  aside,
  footer,
  children,
}: {
  title: string
  subtitle?: string
  items: Array<NavItem<Id>>
  active: Id
  onSelect: (id: Id) => void
  /** Status text or controls shown top-right, above the content. */
  aside?: ReactNode
  /** Sits at the bottom of the sidebar — the link across to the other page. */
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <nav
        aria-label="Sections"
        className="sticky top-0 flex h-screen w-16 flex-none flex-col gap-1 border-r border-zinc-200 bg-white p-3 lg:w-60 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mb-4 flex items-center gap-2.5 px-1.5 pt-1">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            LJ
          </span>
          <span className="hidden min-w-0 lg:block">
            <span className="block truncate text-sm font-semibold">{title}</span>
            {subtitle ? (
              <span className="block truncate text-xs text-zinc-500">{subtitle}</span>
            ) : null}
          </span>
        </div>

        {items.map((item) => {
          const Icon = item.icon
          const selected = item.id === active

          return (
            <button
              key={item.id}
              type="button"
              title={item.label}
              aria-current={selected ? 'page' : undefined}
              onClick={() => onSelect(item.id)}
              className={cx(
                'group flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors',
                'justify-center lg:justify-start',
                selected
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
              )}
            >
              <Icon className="h-5 w-5 flex-none" />
              <span className="hidden flex-1 truncate text-left lg:block">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 ? (
                <span
                  className={cx(
                    'hidden rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums lg:block',
                    selected
                      ? 'bg-white/20 text-white'
                      : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
            </button>
          )
        })}

        {footer ? <div className="mt-auto pt-3">{footer}</div> : null}
      </nav>

      <div className="min-w-0 flex-1">
        {aside ? (
          <header className="flex flex-wrap items-center justify-end gap-3 border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            {aside}
          </header>
        ) : null}
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </div>
    </div>
  )
}

/** The cross-link that lives at the bottom of each sidebar. */
export function SidebarLink({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon: IconComponent
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-200 px-2.5 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 lg:justify-start dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      <Icon className="h-5 w-5 flex-none" />
      <span className="hidden truncate lg:block">{label}</span>
    </button>
  )
}
