# Testing

## Automated

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run — 358 tests across 29 files
npm run build       # tsc --noEmit && vite build
```

All three are clean as of this work.

### What the suite covers

| Area | File |
|---|---|
| Shadow DOM / nested form discovery | `deep-query.test.ts` |
| Review-before-fill proposals and defaults | `plan.test.ts` |
| Validation error extraction and attribution | `validation.test.ts` |
| Profile readiness scoring | `profile-health.test.ts` |
| Activity log, including its privacy guarantee | `activity.test.ts` |
| Interface translation | `i18n.test.ts` |
| Field classification, option matching | `fieldrules.test.ts`, `optionmatch.test.ts` |
| React-safe writes, form detection | `fill.test.ts`, `fields.test.ts` |
| Which file input gets the résumé | `filler-files.test.ts` |
| ATS scoring | `ats.test.ts` |
| CV/letter generation and LaTeX escaping | `gemini-*.test.ts`, `latex.test.ts`, `tailored-resume.test.ts` |
| Backup / restore | `backup.test.ts`, `saved-jobs.test.ts` |
| Frame resolution | `frames.test.ts` |
| List-editing inputs | `list-textarea.test.ts` |
| Page render smoke tests | `ui-render.test.tsx` |

### What it cannot cover

Anything requiring a real browser with the extension loaded: the side panel actually
opening, `chrome.sidePanel` behaviour, real ATS markup, and how any of it looks. The
manual steps below exist for exactly that.

---

## Manual QA

Load the extension first: `npm run build`, then `chrome://extensions` → Developer mode →
**Load unpacked** → select `dist/`.

### 1. Review before fill — the critical one

1. Open any application form (Greenhouse, Lever, or `test/fixtures/career-form.html`).
2. Click the extension icon → **Review & fill this form**. The side panel opens beside the page.
3. Press **Scan this form**.
4. **Verify the form is still empty.** Scanning must write nothing.
5. Check each row shows: label, a source badge, a plain-language reason, and an editable value.
6. Edit one value, untick another, and note the button count changes.
7. Press **Fill N selected fields**.
8. **Verify:** only ticked fields were written; the edited field got *your* text, not the original proposal; the unticked field is still empty.
9. **Verify nothing was submitted.**

### 2. Uncertain values default to skipped

1. On a form with an unusual question, scan.
2. **Verify:** any AI-drafted value on a *required* field is unticked by default.
3. **Verify:** a field nothing could answer appears with an empty box and cannot be ticked until you type something.

### 3. Shadow DOM discovery

1. Open a Workday or Ashby application (both render inputs into shadow roots).
2. Scan.
3. **Verify:** fields are found. Before this change the panel would report none.

### 4. Site report

1. Open a LinkedIn job → panel should say LinkedIn is recognised.
2. Open a random page with no form → should say no form found.
3. Open an unknown careers page with a form → should say generic form.

### 5. Draft open questions

1. On a form with a "Why do you want this role?" textarea, scan, then **Draft open questions**.
2. **Verify:** a draft appears, is labelled as a draft, is editable, and is **not** pre-selected.
3. **Verify:** no draft is offered for select/radio questions or for short fields like "First name".

### 6. Validation errors

1. Fill a form leaving a required field empty, and let the site validate (submit it yourself, or trigger blur).
2. Scan and fill again.
3. **Verify:** the panel lists the form's own error text, attributed to a field where the page links them.

### 7. Profile readiness

1. Open settings → **Profile**.
2. **Verify:** the meter reflects reality and the listed gaps match what is actually missing.
3. Fill in an email; **verify** the score rises and that gap disappears.

### 8. Follow-ups

1. Dashboard → Applications → **Notes** on any row.
2. Set a follow-up date in the past and a next action; click away to save.
3. **Verify:** the row shows "follow up now" in amber; reload and confirm it persisted.

### 9. Activity log

1. Dashboard → **Activity**.
2. **Verify:** recent actions are listed, newest first.
3. **Verify the privacy property:** entries show counts and labels, never a value you typed.
4. Press **Clear**; verify it empties.

### 10. Language

1. Settings → Automation → **Interface language** → Français.
2. Open the side panel.
3. **Verify:** panel text is French, including the "n'envoie jamais le formulaire" safety line.
4. **Known limitation:** the options page, dashboard and popup remain English.

### 11. Regression check on existing features

- Start a LinkedIn run with **dry run on**; confirm it still walks the modal and submits nothing.
- Fetch a job description from the dashboard; confirm it still works.
- Export a backup, then re-import it with **merge**; confirm nothing duplicates.
- Generate a cover letter and a tailored CV; confirm `.tex` downloads still compile.

### 12. Permissions

1. `chrome://extensions` → **Details** for LosJobios.
2. **Verify:** permissions are storage, tabs, scripting, alarms, activeTab, sidePanel, plus linkedin.com. The only addition is `sidePanel`.
3. **Verify:** no network permission is granted until AI is enabled.
