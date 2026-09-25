# Top 10 capability gaps

Derived by comparing this extension against the behaviour of the AutoCVApply
reference. **No reference code was read for reuse or copied** — see
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the licence analysis that
forced independent implementation. Every item below is built from scratch against this
codebase's own conventions.

## What this list deliberately excludes

These were reviewed and **not** given a place, because LosJobios already does them at
least as well:

| Already covered | Where |
|---|---|
| CV import, parsing, structured extraction | `resumeExtract.ts`, `resume-heuristics.ts`, `GeminiProvider.parseResume` |
| Reusable answer library | Answer bank, with fuzzy + subject matching (`answers.ts`, `optionmatch.ts`) |
| Tailored cover letters | Per-posting generation, never cached, with LaTeX output |
| Tailored CV | `generateResume` with facts reattached from the profile |
| ATS scoring | `ats.ts` — offline, deterministic, no key required |
| Application tracker | Dashboard table, status pipeline, CSV export |
| Export / backup / restore / delete | `backup.ts`, Backup section |
| Job-description extraction | Adapter `jobDescription()` + background frame scrape |
| Blocked companies / keyword filters | `settings.blockedCompanies`, title include/exclude |
| Human-in-the-loop on unanswerable questions | Run pauses and asks rather than guessing |

Two reference capabilities were **rejected on safety grounds**: captcha auto-solving,
and end-to-end auto-apply that clicks the final Submit. Both are recorded with
reasoning in THIRD_PARTY_NOTICES.md.

## The ranking

| Rank | Feature | Current state here | Reference capability | Why it matters | Approach | Complexity | Files/modules | Privacy & safety | Acceptance criteria | Origin |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Review before fill** | None — `fillFields` writes every field immediately | Pending-fields review surface before autofill | The single largest safety gap. Today a misclassified field is written to a real employer's form with no chance to catch it | Split resolution from writing: produce a `FieldPlan` of proposals, render it for review, write only what the user keeps | High | `content/plan.ts`, `filler.ts`, `messaging.ts`, side panel | Nothing is written without explicit confirmation; uncertain mappings default to unselected | User sees every proposed value with source and confidence, can edit, skip, deselect; only selected fields are written | Independent |
| 2 | **Shadow DOM & nested form discovery** | `querySelectorAll` only — fields inside shadow roots are invisible | Content scripts traverse shadow DOM and embedded widgets | Workday, Ashby and many ATS widgets render into shadow roots. Today those forms silently detect zero fields and look broken | Recursive walker that descends open shadow roots and same-origin iframes, reused by every query helper | Medium | `content/dom/query.ts`, `fields.ts` | No new permissions; same-origin only, closed roots not forced | A form whose inputs live in an open shadow root is detected and fillable | Independent |
| 3 | **Side panel workspace** | Popup only — closes on any outside click | Side panel as the primary workspace | A review flow cannot live in a popup: clicking the page to check a field dismisses it. The panel stays open beside the form | Add `sidePanel` permission and a React panel reusing existing primitives; popup keeps run controls | Medium | `manifest.config.ts`, `ui/sidepanel/*`, `background/index.ts` | `sidePanel` is a UI-surface permission with no data access | Panel opens beside a form, survives page interaction, shows the review flow | Independent |
| 4 | **Profile completeness guidance** | None — an empty profile fails silently at fill time | Dashboard profile completeness prompts | Most bad fills trace back to a thin profile. Telling someone what is missing, ranked by how often forms ask for it, fixes the cause | Pure scoring module over the profile, surfaced as a meter plus ranked next actions | Low | `lib/profile-health.ts`, `ProfileSection` | Local computation only, no network | Meter reflects real gaps; each gap links to the field that fixes it | Independent |
| 5 | **Draft all open questions** | AI drafting only happens inside a LinkedIn run | Draft All — batch answers for unanswered fields | On a Greenhouse or Ashby form there is no way to get drafts at all today without running the engine | Collect unanswered free-text fields, draft each from profile + posting, return as reviewable proposals | Medium | `lib/answers.ts`, side panel, `messaging.ts` | Every draft labelled as a draft and editable; nothing auto-written | Free-text questions get drafts that land in the review list, not the page | Independent |
| 6 | **Supported-site detection** | Binary — either autofill runs or it errors | Supported-platform messaging | Users cannot tell what will happen before acting. A clear "this is a known ATS / this is a generic form / this page has no form" removes the guesswork | Classify the page from adapter + form signals, report capability to the panel | Low | `content/site-report.ts`, side panel | Read-only page inspection | Panel names the site type and what is supported before any action | Independent |
| 7 | **Validation error recovery** | LinkedIn-only, and only to abort the job | Form validation error surfacing | When a form rejects a value the run dies with "would not advance" and the user learns nothing | Read inline error text, attribute it to the field, surface it as a fixable item | Medium | `content/validation.ts`, `filler.ts`, panel | Read-only; no retry loops against a server | A rejected field is named with its message and offered for correction | Independent |
| 8 | **Notes, follow-ups & next actions** | `notes` exists in the schema but has no UI | Job notes, follow-up dates, reminders | An application tracker without follow-up dates is a list, not a pipeline | Extend the application schema with follow-up fields, surface a "needs attention" view | Low | `schema.ts`, `storage.ts`, `Dashboard` | Local only; no calendar or notification permissions | Notes persist, follow-up dates sort into an attention list | Independent |
| 9 | **Activity log** | None — actions leave no trace | Activity UI and outcome tracking | Nothing records what the extension did on the user's behalf. That is both a trust problem and the only way to debug a bad run | Append-only capped local log, written at each meaningful action, viewable and purgeable | Low | `lib/activity.ts`, panel/dashboard view | Stores field *labels*, never values; purge control; included in export | Actions appear in order with outcome; purge empties it | Independent |
| 10 | **French / English interface** | Hardcoded English throughout | — (reference is English-only) | The stated audience applies in France and the EU. A French candidate should not navigate an English tool to write a French letter | Lightweight typed dictionary + `useTranslation` hook, French strings for the primary surfaces, follows `chrome.i18n.getUILanguage` with a manual override | Medium | `lib/i18n/*`, all UI sections | No network; locale stored locally | UI switches language; no untranslated key renders raw | Independent |

## Per-feature detail

### 1. Review before fill

Today `fillFields` resolves and writes in one pass. The proposal splits that in two:
`planFields` returns proposals (`value`, `source`, `confidence`, `required`,
`alreadyFilled`), and `applyPlan` writes only entries the user kept. Anything below
the confidence floor, or resolved with no source, arrives **unselected** so the
default action is to skip it rather than to trust it.

The existing `CONFIDENCE_FLOOR` and answer-source model already carry the information
this surface needs; nothing about resolution changes.

### 2. Shadow DOM & nested form discovery

`pick`, `pickAll` and `collectFields` all bottom out in `root.querySelectorAll`, which
does not cross a shadow boundary. A `deepQueryAll` walker descends `element.shadowRoot`
where it is open, and same-origin iframe documents where reachable, collecting matches
as it goes. Closed roots stay closed — nothing is forced.

### 3. Side panel workspace

The popup is kept for run controls, which is what it is good at. The panel becomes the
workspace for anything requiring sustained attention beside the page: the review list,
drafts, site report. `chrome.sidePanel` is a UI surface; it grants no data access.

### 4. Profile completeness guidance

Weighted by how often a real application asks for each field, which the field-rules
table already encodes. Produces a score plus ranked, actionable gaps.

### 5. Draft all open questions

Reuses `resolveAnswer`'s tiering so the answer bank and profile heuristics are tried
before any model call, then drafts the remainder. Results are proposals, not writes.

### 6. Supported-site detection

Three honest states: a known adapter, a generic form, or no form found — each with what
the extension can actually do there.

### 7. Validation error recovery

Errors are matched to fields by `aria-describedby`, then by proximity. Surfaced rather
than retried.

### 8. Notes, follow-ups & next actions

Additive schema fields with defaults, so existing records migrate by being read.

### 9. Activity log

Capped ring buffer in local storage. Records what happened, never what was typed.

### 10. French / English interface

A typed dictionary keyed by string id, with English as the fallback so a missing French
string degrades to English rather than to a raw key.

## Implementation order

Ranked order is also dependency order: the review flow (1) needs deep field discovery
(2) to have anything to review on a modern ATS, and needs the side panel (3) to have
somewhere to live. 4–10 are independent of each other and can land in any order.
