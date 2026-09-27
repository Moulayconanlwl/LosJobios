# Testing

## Automated

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run — 498 tests across 37 files
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
| Indeed adapter decisions | `indeed.test.ts` |
| Which URLs a run may act on | `job-board.test.ts` |
| ATS matching, requirements and advice | `ats-review.test.ts` |
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

1. Open a LinkedIn job → panel should say LinkedIn is recognised. Same on an Indeed posting.
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

### 11. Indeed — the whole run, with dry run ON

Dry run stays on for all of this. It walks the entire flow and stops at Submit.

1. Click the toolbar icon. **The side panel opens** — there is no popup any more.
2. **Auto apply** tab: Platform **Indeed**, Market **Auto**, Role `product owner AI`,
   Location `Paris`. Check the `Opens:` line underneath reads `fr.indeed.com` and not
   `uk.indeed.com`.
3. Press **Start**. **Verify it navigates the tab to the search by itself** — you should
   not have to be on Indeed beforehand. This is the step that was broken.
3. **Verify** it queues jobs. If it says zero, the message should name *why* — signed
   out, no cards found at all, or everything filtered — not a generic failure.
4. Watch one job go through and check each of these in order:
   - the posting opens in the pane beside the list;
   - the run clicks **Apply now** and the tab navigates to `smartapply.indeed.com`;
   - the run picks up there rather than reporting a lost page;
   - it walks the wizard steps, filling what it can;
   - **it stops at Submit and does not click it.**
5. **Verify it comes back to the search page** before the next job starts. This is the
   step most likely to be wrong, and the symptom is job 2 failing with something about
   not finding the card.
6. Dashboard → **Applications**: the row should be tagged `indeed`, not `linkedin`.

### 12. Indeed — the things it must refuse

Each of these is a decision, not a click, and each is worth checking by hand because
getting one wrong is how a run wanders somewhere it shouldn't.

1. Find a posting whose button says **Apply on company site**.
   **Verify:** skipped, with a reason naming the company's own site. It must **not**
   follow the link.
2. Find a posting you have already applied to.
   **Verify:** skipped as already applied. On a French site the button says
   *Candidature envoyée* — check that one specifically, since an English-only match
   would silently re-apply to every job you have already done.
3. If Indeed shows a verification challenge at any point:
   **Verify:** the run stops and says so. Nothing should attempt to solve or click
   through it.

### 13. ATS — matching, not literal matching

1. Settings → **ATS score**. Paste a posting that says "Kubernetes" and make sure your
   CV text says **K8s** and not "Kubernetes".
   **Verify:** it counts as matched. Before this change it was reported missing, and the
   advice was to add something already there.
2. **Verify** the result now has three separated groups, and that they say different
   things: *Would filter you out*, *Your profile says these; the document doesn't*, and
   *In the posting, nowhere in your application*.
3. Put a skill in **Profile → Skills** that your uploaded CV never mentions, and score
   against a posting that wants it.
   **Verify:** it appears under *your profile says these*, **not** under missing.
4. Score with a posting that says "Fluent French is required" while your profile lists
   no French.
   **Verify:** a *Would filter you out* entry naming French, and a **Stated requirements**
   bar in the breakdown.
5. Add French to **Profile → Languages** and re-score.
   **Verify:** that entry disappears and the requirements bar reads 100%.

### 13b. A blocking question — the one that matters most

1. Turn **Settings → Automation → Pause on questions I haven't answered** ON.
2. Start a LinkedIn run with dry run ON, against a search whose postings ask
   screening questions.
3. When the run hits one it cannot answer:
   - **Verify a chime plays** and a Chrome notification appears, even if you are
     on another tab.
   - **Verify the question is shown at the top of the side panel**, above the tabs,
     with the job title and company.
   - **Verify the run has stopped and stays stopped.** It must wait indefinitely.
4. Type an answer, leave **Remember this answer** ticked, press **Save & continue**.
   - **Verify the run resumes on the same job** rather than skipping it.
5. Settings → **Answer bank**: **verify your answer is saved there**.
6. Start another run that hits the same question.
   - **Verify it does not stop this time** — the bank answers it.

### 13c. KPIs and the worker log

1. While a run is going, look at the side panel header.
   **Verify** Applied / Skipped / Failed / Left update as it works.
2. Open the **Logs** tab during the run.
   **Verify** you can see each step: the job being opened, the modal opening, each
   step's field count, each field's outcome, and which button it pressed.
3. **Verify the privacy property:** the log shows field *labels* and outcomes, never
   a value you or the AI typed into a box.

### 14. Regression check on existing features

- Start a LinkedIn run with **dry run on**; confirm it still walks the modal and submits nothing.
- Fetch a job description from the dashboard; confirm it still works.
- Export a backup, then re-import it with **merge**; confirm nothing duplicates.
- Generate a cover letter and a tailored CV; confirm `.tex` downloads still compile.

### 15. Permissions

1. `chrome://extensions` → **Details** for LosJobios.
2. **Verify:** permissions are storage, tabs, scripting, alarms, activeTab, sidePanel, plus linkedin.com and `*.indeed.com`. Indeed needs the wildcard because its hosted apply form is on `smartapply.indeed.com` — a run cannot finish an Indeed application without it.
3. **Verify:** no network permission is granted until AI is enabled.
