import type { Profile } from './schema'

/**
 * How ready this profile is to fill a real application.
 *
 * Almost every disappointing autofill traces back to the same cause: the
 * profile didn't have the answer, so the field was left blank or handed to a
 * model that had nothing to work from. Telling someone *which* gap will cost
 * them, ranked by how often forms actually ask, fixes the cause instead of
 * the symptom.
 *
 * Weighting is by how frequently a field is asked for on a real application,
 * not by how much effort it takes to fill. A missing email is fatal on every
 * form; a missing portfolio link matters on few.
 */

export type ProfileGapId =
  | 'name'
  | 'email'
  | 'phone'
  | 'location'
  | 'resume'
  | 'experience'
  | 'education'
  | 'skills'
  | 'headline'
  | 'summary'
  | 'links'
  | 'workAuthorization'

export type ProfileGap = {
  id: ProfileGapId
  /** What's missing, in the user's terms. */
  label: string
  /** Why it costs them something, concretely. */
  impact: string
  /** Which settings tab fixes it. */
  section: 'profile' | 'history'
  weight: number
}

export type ProfileHealth = {
  /** 0..100. */
  score: number
  /** Enough to attempt an application at all. */
  ready: boolean
  gaps: ProfileGap[]
  /** Weighted points already earned, for the meter's detail line. */
  earned: number
  total: number
}

type Check = ProfileGap & { satisfied: (profile: Profile) => boolean }

/**
 * Deliberately ordered by weight, because this list is also the order the
 * gaps are shown in — the most costly thing to fix comes first.
 */
const CHECKS: Check[] = [
  {
    id: 'email',
    label: 'Email address',
    impact: 'Every application form asks for it. Without it almost nothing can be filled.',
    section: 'profile',
    weight: 14,
    satisfied: (p) => p.email.trim().length > 0,
  },
  {
    id: 'name',
    label: 'First and last name',
    impact: 'Asked on every form, usually as the first two fields.',
    section: 'profile',
    weight: 12,
    satisfied: (p) => p.firstName.trim().length > 0 && p.lastName.trim().length > 0,
  },
  {
    id: 'resume',
    label: 'CV upload',
    impact: 'Needed for file uploads, and it is what tailored CVs and ATS scoring read from.',
    section: 'profile',
    weight: 12,
    satisfied: (p) => Boolean(p.resume?.text.trim()),
  },
  {
    id: 'phone',
    label: 'Phone number',
    impact: 'Required on most applications, and one of the slowest to retype.',
    section: 'profile',
    weight: 10,
    satisfied: (p) => p.phone.trim().length > 0,
  },
  {
    id: 'experience',
    label: 'Work experience',
    impact: 'Without at least one role, a tailored CV has nothing to rewrite.',
    section: 'history',
    weight: 12,
    satisfied: (p) => p.experience.some((entry) => entry.title.trim() || entry.company.trim()),
  },
  {
    id: 'skills',
    label: 'Skills',
    impact: 'Skills are what the ATS score matches against a posting.',
    section: 'profile',
    weight: 10,
    satisfied: (p) => p.skills.length >= 3,
  },
  {
    id: 'location',
    label: 'City and country',
    impact: 'Asked for on most forms, and used on the header of generated documents.',
    section: 'profile',
    weight: 8,
    satisfied: (p) => p.city.trim().length > 0,
  },
  {
    id: 'education',
    label: 'Education',
    impact: 'Forms ask for a school and degree directly, and letters draw on it.',
    section: 'history',
    weight: 7,
    satisfied: (p) => p.education.some((entry) => entry.school.trim()),
  },
  {
    id: 'workAuthorization',
    label: 'Work authorisation answers',
    impact: 'Screening questions about the right to work block a submit when unanswered.',
    section: 'profile',
    weight: 5,
    // Both are booleans with defaults, so this checks the user has been past
    // the section rather than that a particular answer was given.
    satisfied: (p) => p.country.trim().length > 0,
  },
  {
    id: 'headline',
    label: 'Headline',
    impact: 'Used at the top of your generated CV and cover letter.',
    section: 'profile',
    weight: 4,
    satisfied: (p) => p.headline.trim().length > 0,
  },
  {
    id: 'summary',
    label: 'Profile summary',
    impact: 'Gives drafted answers something to draw on beyond job titles.',
    section: 'profile',
    weight: 4,
    satisfied: (p) => p.summary.trim().length > 0,
  },
  {
    id: 'links',
    label: 'LinkedIn or portfolio link',
    impact: 'Commonly asked for, and trivial to fill once stored.',
    section: 'profile',
    weight: 2,
    satisfied: (p) =>
      [p.linkedinUrl, p.githubUrl, p.portfolioUrl].some((url) => url.trim().length > 0),
  },
]

/** The minimum needed to attempt a form at all, rather than to do it well. */
function isReady(profile: Profile): boolean {
  return profile.firstName.trim().length > 0 && profile.email.trim().length > 0
}

export function assessProfile(profile: Profile): ProfileHealth {
  const gaps: ProfileGap[] = []
  let earned = 0
  let total = 0

  for (const check of CHECKS) {
    total += check.weight

    if (check.satisfied(profile)) {
      earned += check.weight
      continue
    }

    const { satisfied: _ignored, ...gap } = check
    gaps.push(gap)
  }

  return {
    score: total ? Math.round((earned / total) * 100) : 0,
    ready: isReady(profile),
    gaps,
    earned,
    total,
  }
}
