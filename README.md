# LosJobios

A Chrome extension that applies to jobs for you. It fills LinkedIn Easy Apply forms end to end, autofills the application form on any career site, answers screening questions from your profile, writes a cover letter per posting, scores your CV against a job before you bother applying, and tracks every application in a dashboard you can filter and export.

Everything is stored locally in your browser. There is no server, no account, and nothing leaves your machine except the AI calls you explicitly enable.

---

## Before you start

**LinkedIn's User Agreement prohibits automated access, and they enforce it with account restrictions.** This is true of every tool of this kind, including the commercial ones. Nothing here is illegal, but the risk lands on whichever account runs it. Test on an account you can afford to lose, keep the daily cap low, and leave the pacing settings alone unless you're making them slower.

Dry run is on by default. It does everything except click the final Submit. Leave it on until you've watched a few applications go through and believe what it's doing.

---

## Install

Requires Node 20 or newer.

```bash
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` folder

For development with hot reload, use `npm run dev` instead of `npm run build` and load `dist/` the same way.

## Set up your profile

The extension opens its settings page on first install. Nothing works until you fill this in.

The fast way: upload your CV (PDF, DOCX or plain text) under **Profile → Resume**. It's parsed and the rest of the page fills itself in — name, contact details, links, current role, skills, and (with AI configured) your full work history and education. It only ever fills fields that are still empty, so it's safe to run again later or after you've edited things by hand. A scanned/image-only PDF with no text layer can't be read this way — paste the text into the box below it instead.

Without an AI key it still pulls out name, email, phone, links and skills via pattern matching — it just can't segment a wall of text into distinct roles and degrees, which genuinely needs a model. Set up the free key under **Settings → AI** first if you want the whole profile filled in one shot.

The more of the profile is filled in — parsed or by hand — the fewer questions get escalated back to you mid-run.

## Run it

1. Open a LinkedIn job search — `linkedin.com/jobs/search` or a `/jobs/collections/` page
2. Click the extension icon
3. Press **Start on this page**

It scrapes the visible job list, filters it against your keyword rules and anything you've already applied to, then works through the queue. A status panel appears in the corner of the page with Pause and Stop.

To fill in a form on any other site — Greenhouse, Lever, Workday, a company's own careers page — open the posting and click **Autofill this page**. It fills the form and stops. It never submits anything it doesn't understand.

---

## How questions get answered

Every screening question goes through three tiers, in order:

1. **Answer bank** — something you've already answered. Free, instant, and it compounds: the longer you use it, the less the other two tiers run.
2. **Your profile** — the question maps onto a known field (work authorization, years of experience, notice period, salary).
3. **AI** — a genuinely novel question, answered from your profile as context.

A cover letter field is the one exception — it skips all three and gets written fresh for that posting, because a letter served back out of the answer bank is the same letter thirty employers already read.

If all three come up short on a **required** field, the run stops and asks you. That's the rule that makes applying at volume safe — a confident wrong answer to "how many years of Kubernetes do you have" is worse than not applying at all. Your answer is saved, and the same job is retried immediately.

### Enabling AI (optional)

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — about a minute, no credit card. Paste it under **Settings → AI**, grant network access when prompted, and click **Test key & list models**.

The model isn't hardcoded. The extension asks your key which models it can call and picks the best available, so a retired model ID can't leave it broken. Answers the AI produces are saved to the answer bank marked *unreviewed*, so you can see exactly what was said on your behalf.

The extension has **no network permission at all** until you grant it here.

---

## Your data, and what survives

Everything lives in this browser's extension storage. **Reloading or updating the extension keeps all of it** — jobs, applications, answers, profile.

**Uninstalling does not.** Chrome erases an extension's entire storage when you remove it, and no database inside an extension can survive that; it isn't a design choice we made. So **Settings → Backup & LaTeX** exports the lot as one JSON file, and imports it back.

Restore defaults to **merge**: it adds records this machine doesn't have and leaves your profile and settings alone, so importing an old file can't revert work you've done since. Untick that to replace everything instead. Applications and jobs are matched on the posting rather than on their per-machine id, so restoring the same file twice doesn't duplicate anything.

Export before you uninstall, reinstall, or move machines.

## The jobs library

Every posting a run sees is saved, so you can come back to it. **Scan this page for jobs** in the popup does the same thing without applying to anything — point it at a LinkedIn search and the whole list lands in the dashboard.

Open **Jobs & materials** in the dashboard, pick a posting, and everything that needs a specific job to work is there: its description, a cover letter, a resume rewritten for it, and its ATS score.

A posting scraped from a *list* only carries a title — the description isn't in the card. **Fetch description** opens that posting in a background tab, reads it, and closes the tab again. Everything else on the panel switches on once it has one.

## Cover letters

When a form asks for one, a cover letter is written for that specific posting — from your profile and the job description on the page — rather than pasted from a saved block of text. It's deliberately generated fresh each time and never cached in the answer bank: a letter reused verbatim across thirty applications is the thing a cover letter is supposed to not be.

The optional template under **Profile → Cover letter** is a style reference, not a script. Paste a letter whose tone you like and the generator matches its voice while writing new content for each role. With no AI key configured, that template is used verbatim as the fallback, and if it's empty the field is left for you.

## Resumes, rewritten per job

**Tailor my resume** on a saved job rewrites your existing experience to lead with what that posting asks for.

It only ever writes *wording*. Companies, titles and dates are reattached from your profile after the model has had its say, so it has no way to put an employer you never worked for on the page — a role number it invents is dropped, and a "skill" that isn't already on your profile is ignored. A role it skipped keeps whatever you wrote yourself rather than disappearing.

What it can't claim, it tells you instead: every rewrite comes with a short list of what changed and what the posting wants that your history doesn't support. That list is the point.

Both the CV and the cover letter download as **`.tex`** as well as plain text, and the two are built to look like one set: a centred name, a `fontawesome` contact row, dark blue section rules, and a four-argument `\entry` command putting dates on the right of each heading.

The cover letter is a proper letter — your details as the sender block, the company and a dated place line opposite it, an `Objet :` line naming the role, then the body. The salutation and closing are chosen from the language the letter came out in, so a French posting doesn't get a letter opening "Dear Hiring Team".

Templates are yours to replace: paste your own document under **Settings → Backup & LaTeX** and mark the slots — `{{NAME}}`, `{{HEADLINE}}`, `{{CONTACT}}`, `{{SUMMARY}}`, `{{SKILLS}}`, `{{EXPERIENCE}}`, `{{EDUCATION}}`, `{{LANGUAGES}}` for the CV; `{{SENDER}}`, `{{COMPANY}}`, `{{SUBJECT}}`, `{{GREETING}}`, `{{BODY}}`, `{{CLOSING}}`, `{{DATE}}` for the letter. Everything substituted in is LaTeX-escaped in a single pass, so a company called "Smith & Co", a bullet about "99.9% uptime" or a skill called "C#" can't break the build.

## Will this CV get through?

The **ATS score** tab in settings scores your CV against one posting, the way an applicant tracking system would: it pulls the terms the posting leans on, checks which ones appear anywhere in your CV or profile, compares your titles and years against what's asked, and checks that the document is machine-readable at all.

The score is computed on this machine. No key, no network, same answer every time — an ATS is a keyword matcher, and that's a mechanical thing to model rather than something to ask a model about. You get the number, the terms you matched, the terms you didn't, and what to do about it.

The fastest way in: open a posting in a tab and press **Score this job against my CV** in the popup. It scrapes the description off the page and opens the scorer with it filled in.

With an AI key configured, **Ask AI what to change** adds a second opinion on the same posting — what's strong, what's genuinely missing, which line to rewrite. It deliberately produces no score of its own: the number above it is already honest, and two numbers that disagree would be worse than one.

---

## Development

```bash
npm run dev        # Vite dev server with HMR
npm run build      # production build into dist/
npm run typecheck  # tsc --noEmit
npm test           # unit tests
npm run icons      # regenerate the PNG icons
```

### Testing autofill without hitting a real job site

`test/fixtures/career-form.html` reproduces the patterns that actually break autofill: labels attached four different ways, a radio group whose question lives in a legend, a select with a placeholder option, a required field marked only with an asterisk span, and a custom ARIA combobox. Open it directly in the browser and click **Autofill this page**.

### Layout

```
src/
├── background/     service worker — run engine, message routing, tab orchestration
├── content/        injected into pages
│   ├── adapters/   linkedin (Easy Apply driver) + universal (any form)
│   ├── dom/        query, fill and pacing primitives
│   ├── fields.ts   turns a live form into a list of answerable questions
│   └── filler.ts   decides what goes in a field and writes it there
├── lib/            schema, storage, messaging, field rules, answer resolution, AI,
│                   resume-heuristics.ts (regex parsing + profile merge),
│                   ats.ts (offline keyword scoring — no model, no network),
│                   tailored-resume.ts (reattaches real facts to generated wording)
└── ui/
    ├── components/ AppShell (the sidebar both pages share), icons, primitives
    ├── options/    profile editor, ATS scorer — resumeExtract.ts (pdf.js/mammoth,
    │               lazy-loaded, isolated to this page only) does the file → text step
    ├── popup/      run controls
    └── dashboard/  applications + the jobs library and its materials (React)
```

### Things worth knowing before you change anything

**Writing `element.value = x` does not work on these sites.** LinkedIn is React, and React tracks input state internally. A direct assignment updates the DOM but never reaches React's state, so the field silently reverts on submit. `dom/fill.ts` calls the native prototype setter and dispatches the events React actually listens for. This is the difference between working and mysteriously-empty forms.

**The service worker gets killed constantly.** Chrome tears it down after ~30 seconds idle; a 25-application run takes many minutes. So run state lives in `chrome.storage.session`, written after every job, and the loop is restartable from the stored cursor. A one-minute alarm restarts it if the worker died mid-run.

**Selectors are always multi-candidate and lean on ARIA.** LinkedIn rewrites its class names often. It changes accessible labels and button names far less, because screen reader support depends on them. When something breaks, fix it by adding a candidate, not by replacing one.

**LinkedIn signed in and LinkedIn signed out are two different pages, and only one of them lives in the top frame.** Signed out, you get a server-rendered guest page (`div.job-search-card`, ids in `data-entity-urn`) directly in the top-level document. Signed in, the entire app — nav, job list, everything — renders inside a *same-origin iframe* (`linkedin.com/preload/?_bprMode=vanilla`), and the top-level document is an empty shell containing none of it. This is why the content script needs `all_frames: true` and why the background can't just `chrome.tabs.sendMessage(tabId, …)`: that targets frame 0, which on a signed-in session has nothing in it. Each frame's content script checks `SiteAdapter.hasAppContent()` and claims itself via `cs/claim-frame`; `background/frames.ts` records which frame won. Verified live — every selector, `#global-nav` included, returns 0 against the top document while returning real matches inside the iframe.

**Every background → content command resolves the frame first.** `resolveContentFrame` in `background/frames.ts` is the one way to address a tab: it verifies a claim with a ping before trusting it and falls back to frame 0 when there isn't one. Starting a run waits up to 8s for a claim, because a run against the wrong frame is worthless; one-shot commands off a popup click pass no wait, because a page that splits its content claimed on load long before the user reached the popup, and waiting would stall every ordinary page for nothing. An earlier version of "Autofill this page" skipped this and sent to frame 0 — on a signed-in LinkedIn job that's the empty shell, so it reported "filled 0 fields" forever.

**Frame claims go in `chrome.storage.session`, not a module-level Map.** Same reason run state does: the worker dies between the content script's one-time claim and the run that needs it, and an in-memory claim is silently lost in that window — which then falls back to frame 0 and looks *exactly* like the original bug. Don't "simplify" this back into a Map. Equally, don't add a `tabs.onUpdated` listener that clears claims on `status === 'loading'`: LinkedIn fires that for its own URL normalization and on every job click, so it wipes valid claims mid-run. Staleness self-heals instead — each page load re-announces, and `resolveContentFrame` pings a claimed frame before trusting it.

**Resume parsing only ever fills empty fields, never overwrites.** `mergeParsedResume` checks each profile field before writing to it — heuristic and AI results alike. This is what makes it safe to upload a CV, edit a few fields by hand, and click "Parse resume" again later without losing the edits. `pdfjs-dist` and `mammoth` are dynamically imported from `resumeExtract.ts`, which only the options page reaches — check a build's chunk sizes if you touch this, since pulling either library into the content script or background bundle by accident would bloat both by several hundred KB for no benefit.

**pdf.js's `getTextContent()` has no notion of a line — joining fragments with a bare space collapses a whole page into one string.** That silently breaks every line-oriented heuristic (the candidate's name is the first line; a Skills section reads until the next blank line) while regex-based email/phone/link extraction keeps working, since it scans anywhere in the text — which is exactly why partial, seemingly-arbitrary extraction failures are the symptom, not a crash. `lib/pdf-text.ts`'s `reconstructLines` rebuilds real lines from each fragment's position (`transform`, `width`, `hasEOL`) before anything downstream sees the text. Never go back to a plain `.join(' ')` here.

**The post-apply dialog guard is armed only during a submit, and identifies its target by wording.** LinkedIn's "your application was sent" modal blocks every click behind it, which stalls the rest of a run. An earlier attempt closed "any dialog that doesn't look like a form" before every job and broke real applications — so this one does nothing at all unless an application is mid-submit, never touches a dialog containing a form control, and leaves unrecognised dialogs alone. It hides rather than removes, because ripping a node out from under React can throw on its next render. And it only ever clicks an *exact* label match: that dialog pairs "Not now" with **"Update profile"**, which would rewrite the user's LinkedIn profile from their CV.

**LaTeX escaping is one pass, and has to be.** Chained `.replace` calls re-scan what the previous ones wrote: escaping `\` emits `\textbackslash{}`, and a later pass over braces then escapes the braces that escaping just introduced. The result renders as literal text instead of a backslash. One regex, one lookup table, nothing re-read.

**A generated resume never carries a generated fact.** The model is given the candidate's roles *numbered*, and returns bullets under those numbers — it never sees a slot for a company name or a date. `renderResume` reattaches those from the stored profile, `generateResume` drops any role number that isn't one of theirs, and skills are intersected with what the profile already claims. So the failure mode of a model inventing an employer is a dropped bullet, not a lie on a document an employer reads. Don't "simplify" this by letting the model return company names directly.

**A two-word phrase has to recur before the ATS scorer treats it as a term.** A sliding window over "Build machine learning models" produces "build machine" as readily as "machine learning", and a kept phrase *suppresses the words inside it* — so keeping one-off pairings doesn't just add noise, it deletes the actual skills ("deep java" surviving instead of "java" was the live bug). Requiring a second mention throws away the window artefacts and keeps the terms of art, since a posting that really trades in a phrase says it more than once. Phrases also never form across punctuation: "Python, Go" is two skills, not the phrase "python go".

**The ATS score is computed locally and the model is never asked for one.** `lib/ats.ts` produces the number; `AIProvider.reviewResume` produces prose and is explicitly instructed to give no score, rating or percentage. A model asked to rate something out of 100 will happily invent a figure, and a screen showing two numbers that disagree is worse than one honest number. If you add a model-scored path, you own reconciling them.

**A cover letter is never written to the answer bank.** Everything else an answer resolves to gets cached there and replayed on the next form that asks the same question — which is the whole point, and exactly wrong for a letter that's supposed to be about *this* job. `resolveCoverLetter` in `lib/answers.ts` sits in front of the three-tier resolver for that reason; don't "simplify" it back into the normal path.

**The résumé only goes in a résumé slot, or an unlabelled one.** Every file input used to receive it, so a form with separate Résumé and Cover letter uploads got the same PDF twice. A file field classified as anything other than `resume` is now left unanswered — which blocks the run if it was required, and that's the intended outcome: being asked is better than sending an employer the wrong document.

**A DOCX resume's LinkedIn/GitHub link is often invisible to plain-text extraction.** `mammoth.extractRawText` throws hyperlink targets away — a "LinkedIn" icon or the candidate's name linking to a profile shows up as just that word, with the URL gone. `resumeExtract.ts` uses `convertToHtml` instead, and `ui/options/htmlText.ts` renders each `<a href>` as `visible text (https://target)`, which both the regex heuristics and the AI prompt know how to read. (PDF link *annotations* have the same failure mode but aren't recovered yet — most resumes render the literal URL as visible PDF text rather than hiding it behind a styled label, which is why this matters far more for DOCX.)

---

## Permissions, and why each is needed

| Permission | Why |
|---|---|
| `storage` | Your profile, settings, applications and answer bank |
| `tabs`, `scripting` | Driving the job tab and injecting the autofill script |
| `alarms` | Restarting a run after the service worker is killed |
| `activeTab` | Universal autofill, granted per click — not standing access to every site |
| `linkedin.com` | The only site with a standing host permission |
| `generativelanguage.googleapis.com` | **Optional.** Requested only when you turn on AI |

Universal autofill deliberately uses `activeTab` plus a user gesture rather than `<all_urls>`. Same capability, far smaller blast radius.

---

## Status

Both milestones are built.

Milestone 1 — profile, CV parsing, autofill, the Easy Apply engine and application tracking. Milestone 2 — the cover letter generator and the standalone ATS scorer, neither of which touches the run engine.

`npm test` covers field classification, option and subject matching, React-safe value writes, form detection against the fixture, resume-parsing heuristics and merge logic, which file input gets the résumé, ATS keyword extraction and scoring, the cover-letter and review prompts, frame resolution, the list-editing inputs, and CSV escaping.

What automated tests can't reach: the LinkedIn adapter's selectors, PDF/DOCX extraction, and the assembled pages (popup, options, dashboard) all need a real browser with the extension loaded — see the checklist below.

### First-run checklist

1. Upload a real PDF or DOCX CV under **Profile → Resume**, confirm the rest of the profile fills itself in
2. Open `test/fixtures/career-form.html`, click **Autofill this page**, confirm fields populate *and still hold their values after clicking elsewhere*
3. Open a real job posting, press **Score this job against my CV**, confirm the scorer opens with the description filled in and the missing terms look right
4. With dry run **on**, run against a LinkedIn search and watch it walk the full modal
5. Turn dry run off, set the daily cap to 1, and send one real application
6. Raise the cap and check the dashboard rows and CSV export

## License

AGPL-3.0
