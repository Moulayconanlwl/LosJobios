import type { EducationEntry, ExperienceEntry, Profile } from '@/lib/schema'
import { Button, Card, Field, Input, Textarea, Toggle } from '../../components/ui'
import type { Draft } from '../../hooks'

/**
 * Work history and education. Both are lists of the same shape of thing, so
 * they share the add / update / remove plumbing.
 */

/** Plain helper, not a hook — safe to build after an early return. */
function listOps<T extends { id: string }>(
  items: T[],
  onChange: (next: T[]) => void,
  make: () => T,
) {
  return {
    add: () => onChange([...items, make()]),
    update: (id: string, patch: Partial<T>) =>
      onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item))),
    remove: (id: string) => onChange(items.filter((item) => item.id !== id)),
  }
}

const newExperience = (): ExperienceEntry => ({
  id: crypto.randomUUID(),
  company: '',
  title: '',
  location: '',
  startDate: '',
  endDate: '',
  current: false,
  description: '',
})

const newEducation = (): EducationEntry => ({
  id: crypto.randomUUID(),
  school: '',
  degree: '',
  field: '',
  startYear: '',
  endYear: '',
  grade: '',
})

export function HistorySection({ draft }: { draft: Draft<Profile> }) {
  const profile = draft.value
  if (!profile) return null

  const experience = listOps(
    profile.experience,
    (next) => draft.update({ experience: next }),
    newExperience,
  )
  const education = listOps(
    profile.education,
    (next) => draft.update({ education: next }),
    newEducation,
  )

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Work experience"
        description="Listed newest first is easiest to read. Used as AI context, not auto-filled field by field."
        actions={
          <Button size="sm" variant="secondary" onClick={experience.add}>
            Add role
          </Button>
        }
      >
        {profile.experience.length === 0 ? (
          <p className="text-xs text-zinc-500">No roles added yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {profile.experience.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Title">
                    <Input
                      value={entry.title}
                      onChange={(e) => experience.update(entry.id, { title: e.target.value })}
                    />
                  </Field>
                  <Field label="Company">
                    <Input
                      value={entry.company}
                      onChange={(e) => experience.update(entry.id, { company: e.target.value })}
                    />
                  </Field>
                  <Field label="Start">
                    <Input
                      placeholder="2021-03"
                      value={entry.startDate}
                      onChange={(e) => experience.update(entry.id, { startDate: e.target.value })}
                    />
                  </Field>
                  <Field label="End">
                    <Input
                      placeholder="2024-01"
                      disabled={entry.current}
                      value={entry.current ? 'Present' : entry.endDate}
                      onChange={(e) => experience.update(entry.id, { endDate: e.target.value })}
                    />
                  </Field>
                  <Field label="Description" className="sm:col-span-2">
                    <Textarea
                      rows={3}
                      value={entry.description}
                      onChange={(e) =>
                        experience.update(entry.id, { description: e.target.value })
                      }
                    />
                  </Field>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <Toggle
                    checked={entry.current}
                    label="I currently work here"
                    onChange={(v) => experience.update(entry.id, { current: v })}
                  />
                  <Button size="sm" variant="danger" onClick={() => experience.remove(entry.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="Education"
        description="The first entry answers &ldquo;school&rdquo; and &ldquo;degree&rdquo; fields on application forms."
        actions={
          <Button size="sm" variant="secondary" onClick={education.add}>
            Add education
          </Button>
        }
      >
        {profile.education.length === 0 ? (
          <p className="text-xs text-zinc-500">No education added yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {profile.education.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="School">
                    <Input
                      value={entry.school}
                      onChange={(e) => education.update(entry.id, { school: e.target.value })}
                    />
                  </Field>
                  <Field label="Degree">
                    <Input
                      placeholder="BSc"
                      value={entry.degree}
                      onChange={(e) => education.update(entry.id, { degree: e.target.value })}
                    />
                  </Field>
                  <Field label="Field of study">
                    <Input
                      value={entry.field}
                      onChange={(e) => education.update(entry.id, { field: e.target.value })}
                    />
                  </Field>
                  <Field label="Graduation year">
                    <Input
                      value={entry.endYear}
                      onChange={(e) => education.update(entry.id, { endYear: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="danger" onClick={() => education.remove(entry.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
