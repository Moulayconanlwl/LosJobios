import { useState } from 'react'
import { sendToBackground } from '@/lib/messaging'
import { patchSettings, setProfile } from '@/lib/storage'
import type { Profile, Settings } from '@/lib/schema'
import { Button, cx } from '../components/ui'
import { useDraft, useProfile, useSettings } from '../hooks'
import { AiSection } from './sections/AiSection'
import { AnswersSection } from './sections/AnswersSection'
import { AtsSection } from './sections/AtsSection'
import { AutomationSection } from './sections/AutomationSection'
import { HistorySection } from './sections/HistorySection'
import { ProfileSection } from './sections/ProfileSection'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'history', label: 'Experience' },
  { id: 'ats', label: 'ATS score' },
  { id: 'automation', label: 'Automation' },
  { id: 'ai', label: 'AI' },
  { id: 'answers', label: 'Answer bank' },
] as const

type TabId = (typeof TABS)[number]['id']

function isTabId(value: string): value is TabId {
  return TABS.some((item) => item.id === value)
}

/** The page is opened fresh each time, so the hash only needs reading once. */
function initialTab(): TabId {
  const hash = location.hash.replace(/^#/, '')
  return isTabId(hash) ? hash : 'profile'
}

export function Options() {
  const [tab, setTab] = useState<TabId>(initialTab)

  const { data: profile } = useProfile()
  const { data: settings } = useSettings()

  const profileDraft = useDraft<Profile>(profile, (next) => setProfile(next))
  const settingsDraft = useDraft<Settings>(settings, (next) => patchSettings(next))

  const saving = profileDraft.saving || settingsDraft.saving

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">LosJobios</h1>
          <p className="text-sm text-zinc-500">
            Everything the autopilot knows about you lives here, on this machine.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cx(
              'text-xs transition-opacity',
              saving ? 'text-zinc-500 opacity-100' : 'text-emerald-600 opacity-70',
            )}
          >
            {saving ? 'Saving…' : 'Saved'}
          </span>
          <Button variant="secondary" onClick={() => void sendToBackground('dashboard/open')}>
            Open dashboard
          </Button>
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === item.id
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200',
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'profile' && <ProfileSection draft={profileDraft} />}
        {tab === 'history' && <HistorySection draft={profileDraft} />}
        {tab === 'ats' && <AtsSection />}
        {tab === 'automation' && <AutomationSection draft={settingsDraft} />}
        {tab === 'ai' && <AiSection draft={settingsDraft} />}
        {tab === 'answers' && <AnswersSection />}
      </main>
    </div>
  )
}
