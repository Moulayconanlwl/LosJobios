import type { SVGProps } from 'react'

/**
 * Inline icons, drawn rather than installed.
 *
 * An icon set would be a dependency and a few hundred KB in a bundle that
 * ships to every page; these are the nine shapes this UI actually uses.
 * All stroke-based on `currentColor`, so they take the colour of whatever
 * they sit in and work in both themes without a second copy.
 */

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export type IconComponent = (props: IconProps) => JSX.Element

export const BriefcaseIcon: IconComponent = (props) => (
  <Icon {...props}>
    <rect x="2.5" y="7" width="19" height="13" rx="2" />
    <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M2.5 12.5h19" />
  </Icon>
)

export const SparkIcon: IconComponent = (props) => (
  <Icon {...props}>
    <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6L4.5 10.8 10.2 9z" />
    <path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
  </Icon>
)

export const ListIcon: IconComponent = (props) => (
  <Icon {...props}>
    <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12" />
    <path d="M3.75 6.5h.01M3.75 12h.01M3.75 17.5h.01" />
  </Icon>
)

export const UserIcon: IconComponent = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Icon>
)

export const HistoryIcon: IconComponent = (props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.75" />
  </Icon>
)

export const GaugeIcon: IconComponent = (props) => (
  <Icon {...props}>
    <path d="M3.5 18a8.5 8.5 0 1 1 17 0" />
    <path d="M12 18l4-5.5" />
    <circle cx="12" cy="18" r="1.2" />
  </Icon>
)

export const SlidersIcon: IconComponent = (props) => (
  <Icon {...props}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2.2" />
    <circle cx="8" cy="17" r="2.2" />
  </Icon>
)

export const ChatIcon: IconComponent = (props) => (
  <Icon {...props}>
    <path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4.5 20.5l1.3-5a7.5 7.5 0 1 1 14.7-3z" />
  </Icon>
)

export const DocIcon: IconComponent = (props) => (
  <Icon {...props}>
    <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
    <path d="M14 3.5V8h4.5" />
    <path d="M9 13h6M9 16.5h4" />
  </Icon>
)

export const SearchIcon: IconComponent = (props) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
)

export const TrashIcon: IconComponent = (props) => (
  <Icon {...props}>
    <path d="M4.5 7h15M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
    <path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
  </Icon>
)

export const CheckIcon: IconComponent = (props) => (
  <Icon {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)

export const CopyIcon: IconComponent = (props) => (
  <Icon {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
  </Icon>
)

export const DownloadIcon: IconComponent = (props) => (
  <Icon {...props}>
    <path d="M12 4v10.5" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </Icon>
)
