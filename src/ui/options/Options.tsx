import { useState } from 'react'
import { sendToBackground } from '@/lib/messaging'
import { patchSettings, setProfile } from '@/lib/storage'
import type { Profile, Settings } from '@/lib/schema'
import { AppShell, SidebarLink } from '../components/AppShell'
import {
  BriefcaseIcon,
  ChatIcon,
  GaugeIcon,
  HistoryIcon,
  SlidersIcon,
  SparkIcon,
  UserIcon,
} from '../components/icons'
import { cx } from '../components/ui'
import { useDraft, useProfile, useSettings } from '../hooks'
import { AiSection } from './sections/AiSection'
import { AnswersSection } from './sections/AnswersSection'
import { AtsSection } from './sections/AtsSection'
import { AutomationSection } from './sections/AutomationSection'
import { HistorySection } from './sections/HistorySection'
import { ProfileSection } from './sections/ProfileSection'

const TABS = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'history', label: 'Experience', icon: HistoryIcon },
  { id: 'ats', label: 'ATS score', icon: GaugeIcon },
  { id: 'automation', label: 'Automation', icon: SlidersIcon },
  { id: 'ai', label: 'AI', icon: SparkIcon },
  { id: 'answers', label: 'Answer bank', icon: ChatIcon },
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
    <AppShell
      title="LosJobios"
      subtitle="Profile & settings"
      items={[...TABS]}
      active={tab}
      onSelect={setTab}
      aside={
        <span
          className={cx(
            'text-xs transition-opacity',
            saving ? 'text-zinc-500 opacity-100' : 'text-emerald-600 opacity-70',
          )}
        >
          {saving ? 'Saving…' : 'Saved'}
        </span>
      }
      footer={
        <SidebarLink
          label="Open dashboard"
          icon={BriefcaseIcon}
          onClick={() => void sendToBackground('dashboard/open')}
        />
      }
    >
      {tab === 'profile' && <ProfileSection draft={profileDraft} />}
      {tab === 'history' && <HistorySection draft={profileDraft} />}
      {tab === 'ats' && <AtsSection />}
      {tab === 'automation' && <AutomationSection draft={settingsDraft} />}
      {tab === 'ai' && <AiSection draft={settingsDraft} />}
      {tab === 'answers' && <AnswersSection />}
    </AppShell>
  )
}
