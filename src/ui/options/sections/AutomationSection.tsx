import type { Settings } from '@/lib/schema'
import { Banner, Card, Field, Input, ListTextarea, Toggle } from '../../components/ui'
import type { Draft } from '../../hooks'

export function AutomationSection({ draft }: { draft: Draft<Settings> }) {
  const settings = draft.value
  if (!settings) return null

  return (
    <div className="flex flex-col gap-5">
      <Card title="Safety">
        <div className="flex flex-col gap-4">
          <Toggle
            checked={settings.dryRun}
            label="Dry run"
            hint="Fill every field and walk the whole Easy Apply modal, then discard instead of submitting. Leave this on until you've watched it work."
            onChange={(v) => draft.update({ dryRun: v })}
          />
          <Toggle
            checked={settings.pauseOnUnknownRequired}
            label="Pause on questions I haven't answered"
            hint="Stops the run and asks you, rather than submitting a guess. Turning this off lets unanswered required fields fail silently."
            onChange={(v) => draft.update({ pauseOnUnknownRequired: v })}
          />
          <Toggle
            checked={settings.skipAlreadyApplied}
            label="Skip jobs I've already applied to"
            onChange={(v) => draft.update({ skipAlreadyApplied: v })}
          />
          <Field
            label="Daily cap"
            hint="A hard stop on real applications per day. Dry runs don't count."
            className="max-w-[12rem]"
          >
            <Input
              type="number"
              min={1}
              max={200}
              value={settings.dailyCap}
              onChange={(e) => draft.update({ dailyCap: Number(e.target.value) || 1 })}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Pacing"
        description="Randomized delays between actions. Slower is both safer and more reliable — pages need time to render."
      >
        <Banner tone="warn">
          LinkedIn&rsquo;s terms prohibit automated access, and they do enforce it. Short delays and
          high volume are what get accounts flagged. The defaults here are deliberately unhurried.
        </Banner>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Min delay between actions (ms)">
            <Input
              type="number"
              min={150}
              value={settings.minActionDelayMs}
              onChange={(e) => draft.update({ minActionDelayMs: Number(e.target.value) || 150 })}
            />
          </Field>
          <Field label="Max delay between actions (ms)">
            <Input
              type="number"
              min={200}
              value={settings.maxActionDelayMs}
              onChange={(e) => draft.update({ maxActionDelayMs: Number(e.target.value) || 200 })}
            />
          </Field>
          <Field label="Min delay between jobs (ms)">
            <Input
              type="number"
              min={1000}
              value={settings.minJobDelayMs}
              onChange={(e) => draft.update({ minJobDelayMs: Number(e.target.value) || 1000 })}
            />
          </Field>
          <Field label="Max delay between jobs (ms)">
            <Input
              type="number"
              min={1000}
              value={settings.maxJobDelayMs}
              onChange={(e) => draft.update({ maxJobDelayMs: Number(e.target.value) || 1000 })}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Job filters"
        description="Applied to the titles scraped from the search page, before anything is opened."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Title must contain one of"
            hint="Leave empty to allow every title. One per line."
          >
            <ListTextarea
              rows={4}
              value={settings.titleIncludeKeywords}
              placeholder={'engineer\ndeveloper'}
              onChange={(next) => draft.update({ titleIncludeKeywords: next })}
            />
          </Field>
          <Field label="Skip titles containing" hint="One per line.">
            <ListTextarea
              rows={4}
              value={settings.titleExcludeKeywords}
              placeholder={'senior\nstaff\nintern'}
              onChange={(next) => draft.update({ titleExcludeKeywords: next })}
            />
          </Field>
          <Field label="Never apply to these companies" className="sm:col-span-2">
            <ListTextarea
              rows={3}
              value={settings.blockedCompanies}
              onChange={(next) => draft.update({ blockedCompanies: next })}
            />
          </Field>
        </div>
      </Card>
    </div>
  )
}
