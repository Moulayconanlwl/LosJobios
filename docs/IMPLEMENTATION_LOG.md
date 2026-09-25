# Implementation log

All ten features were **implemented independently**. No code was copied or adapted from
the reference project — see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the
licence analysis that required this.

Running totals after the work: **358 tests, 29 files, typecheck clean, production build
clean.**

---

## 1. Review before fill

**Files:** `src/content/plan.ts` (new), `src/content/filler.ts`, `src/lib/messaging.ts`,
`src/content/index.ts`, `src/ui/sidepanel/SidePanel.tsx` (new)

Split resolution from writing. `planFields` produces `FieldProposal[]` — value, source,
confidence, reason, required, selected — while writing nothing to the page. `applyPlan`
writes back only entries the user left selected, using *their* value rather than
re-resolving.

**Decisions**
- `applyPlan` deliberately does not re-derive values. Re-resolving could substitute a
  different value for the one the user read and approved.
- Elements are tagged with a `data-losjobios-field` handle so a proposal survives the
  round trip to the panel and back without passing DOM references.
- Pre-selection rules: profile and answer-bank values above the confidence floor arrive
  ticked; **an AI draft in a required field never does**, however confident the model
  sounded. That is where a plausible wrong answer costs most.

**Tests:** `test/plan.test.ts` — 18 tests, including that planning writes nothing, that
an edited value is what gets written, and that deselecting everything writes nothing.

**Limitation:** handles are per-page-load. Re-rendering a step between scan and fill can
orphan a proposal; it is counted as failed rather than written to the wrong field.

---

## 2. Shadow DOM & nested form discovery

**Files:** `src/content/dom/query.ts`, `src/content/dom/fill.ts`

`deepQueryAll` walks open shadow roots and same-origin iframes iteratively; `pick` and
`pickAll` now route through it, so every existing caller gained the capability without
changing.

**Decisions**
- Closed shadow roots are left closed. Forcing them open is possible and was rejected.
- The walk is iterative, so a deep component tree widens a list rather than the stack.
- **Bug found while testing:** `accessibleName` resolved `label[for]` and
  `aria-labelledby` against `document`, but ids are scoped to their shadow root. Shadow
  fields were therefore detected *unlabelled*, which is worse than not detecting them —
  an unlabelled field can't be classified, so it silently becomes an unanswered
  question. Fixed with `getRootNode()`. `findLabelFor` in `fill.ts` had the same bug.

**Tests:** `test/deep-query.test.ts` — 12 tests, including the negative case that a
closed root stays closed.

---

## 3. Side panel workspace

**Files:** `manifest.config.ts`, `src/ui/sidepanel/*` (new), `src/background/index.ts`,
`src/ui/popup/Popup.tsx`

**New permission: `sidePanel`.** A UI-surface permission granting no data access. The
review flow cannot live in the popup, which closes the moment the user clicks the form
they are trying to check.

**Decisions**
- Popup kept as the run cockpit; the panel is the review workspace. Neither surface has
  to be both.
- `chrome.sidePanel.open` requires a user gesture, so it is called from the popup click
  rather than from the panel itself.
- `reachActiveTab` in the background centralises tab + injection + frame resolution, so
  each panel action reports the specific failure rather than a generic one.

**Limitation:** not verified in a real browser — see TESTING.md.

---

## 4. Profile completeness guidance

**Files:** `src/lib/profile-health.ts` (new), `src/ui/options/sections/ProfileSection.tsx`

Weighted scoring over twelve checks, surfaced as a meter plus the five costliest gaps.

**Decision:** weights reflect how often a real application asks for a field, not how
much effort it takes to supply. Email outranks a portfolio link, so the list sends
people to fix the thing that will actually block them.

**Tests:** `test/profile-health.test.ts` — 11 tests, including that gaps are ordered by
cost and that a CV with no extractable text does not count as a CV.

---

## 5. Draft all open questions

**Files:** `src/content/plan.ts`, `src/content/index.ts`, `src/lib/messaging.ts`

`draftOpenQuestions` collects unanswered free-text fields and resolves each through the
existing tiering, so the answer bank and profile are tried before any model call.

**Decisions**
- Restricted to textareas and long-labelled text inputs. A select has a right answer to
  *match*, not prose to write, and "First name" is not a question.
- **Drafts are never pre-selected**, at any confidence.

**Tests:** in `test/plan.test.ts` — 5 tests covering the restrictions.

---

## 6. Supported-site detection

**Files:** `src/content/site-report.ts` (new), side panel

Three honest states — known ATS, generic form, no form — each with what is actually
supported there. Fifteen recognised hosts including French platforms (APEC, France
Travail, HelloWork, Welcome to the Jungle).

**Decision:** the adapter's own opinion wins over the host list, since it is what will
actually drive the page.

---

## 7. Validation error recovery

**Files:** `src/content/validation.ts` (new), `src/content/index.ts`, side panel

Reads the form's own inline error text after a fill and attributes it to a field.

**Decisions**
- `aria-describedby` / `aria-errormessage` is the only authoritative link. Everything
  after it is proximity, so an unattributed error is reported with an empty label rather
  than pinned to whichever field happened to be nearest.
- **Never retries.** Resubmitting to see whether an error clears is how you get
  rate-limited.
- **Bug found while testing:** `closest()` matches the element it is called on, and an
  error node is usually itself a `div` — so the wrapper search searched inside the error
  and found nothing every time. Fixed by starting from `parentElement`.

**Tests:** `test/validation.test.ts` — 13 tests.

---

## 8. Notes, follow-ups & next actions

**Files:** `src/lib/schema.ts`, `src/ui/dashboard/Dashboard.tsx`

**Migration:** `applicationSchema` gains `followUpOn` and `nextAction`, both
`z.string().default('')`. Existing stored records migrate on read — `parseOr` fills the
defaults — so no migration step and no data loss. `SCHEMA_VERSION` unchanged because the
change is purely additive.

**Decisions**
- Follow-up is an ISO *day*, not a timestamp. "Chase them on the 5th" is a date, and a
  time would invent precision the user never gave.
- The editor opens per row rather than rendering on every row, and saves on blur for the
  same reason the answer bank does.

---

## 9. Activity log

**Files:** `src/lib/activity.ts` (new), `src/lib/storage.ts`,
`src/ui/dashboard/ActivitySection.tsx` (new), `src/background/session.ts`,
`src/background/index.ts`, `src/lib/backup.ts`

**Privacy decision, and the load-bearing one:** entries record *what happened*, never
*what was written*. "Filled 11 fields on greenhouse.io" — never the values. A log of
answers would be a second copy of the most sensitive data in the extension, sitting
somewhere the user does not think of as storage.

**Decisions**
- Capped at 300 entries; oldest fall off.
- `logActivity` swallows its own errors — logging is a side effect of doing something
  useful and must never be able to fail it.
- URLs are reduced to hostnames, since a full URL carries query parameters.
- Included in backups, and purgeable from the UI.

**Tests:** `test/activity.test.ts` — 9 tests, including that a storage failure cannot
propagate.

---

## 10. French / English interface

**Files:** `src/lib/i18n.ts` (new), `src/ui/hooks.ts`, `src/lib/schema.ts`,
`src/ui/sidepanel/SidePanel.tsx`, `src/ui/options/sections/AutomationSection.tsx`

**Migration:** `settings.locale` added as `z.enum(['auto','en','fr']).default('auto')` —
additive, migrates on read.

**Decisions**
- **Not `chrome.i18n`.** That API reads the browser's language and cannot be overridden
  at runtime, which is exactly wrong here: someone applying in France from an
  English-language Chrome must be able to work in French without changing their browser.
  So the locale is a setting and the browser is only the opening guess.
- The `Copy` type makes an English key with no French counterpart a compile error.
- English is the runtime fallback, so a gap degrades to readable English, never a raw
  key.

**Tests:** `test/i18n.test.ts` — 11 tests, including that the "never submits" safety
line is translated in both languages.

**Limitation — the significant one:** the dictionary covers the **side panel** and the
language setting. The options page, dashboard, and popup remain English. Translating
every existing surface is mechanical but large, and shipping it half-done across all
surfaces would read worse than shipping it complete on one. The framework is in place
for the rest.

---

## Safety rules observed throughout

| Rule | How |
|---|---|
| Never submit automatically | No code clicks a final Submit. The run engine stops at the submit step; dry run is on by default |
| Explicit confirmation before filling | The whole of feature 1 |
| Field-by-field preview with value, confidence, source, edit, skip | `FieldProposal` carries all of them |
| Uncertain mappings unresolved, not guessed | Below the confidence floor → unticked; unresolved → unticked and not writable until typed |
| AI text labelled as draft and editable | `source: 'ai'` badge, "AI draft — check it", editable field, never pre-selected |
| No invented experience | Unchanged from existing design — the resume writer receives roles *numbered* and facts are reattached from the profile |
| No data to external services without consent | Unchanged — Gemini host permission is optional and requested at runtime |
| Export and deletion controls | Backup section; activity purge added |
| Minimal permissions | One added (`sidePanel`), no new host permissions |
