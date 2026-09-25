# Third-party notices

## autoapplycv

Parts of the Indeed automation in this project were **ported from**
[tmwclaxton/autoapplycv](https://github.com/tmwclaxton/autoapplycv).

That project is licensed **PolyForm Noncommercial 1.0.0** and ships this line,
which its licence requires be carried to anyone who receives any part of the
software:

> Required Notice: Copyright AutoCVApply (https://autocvapply.com)

Licence text: https://polyformproject.org/licenses/noncommercial/1.0.0

### What that means here

PolyForm Noncommercial permits use, modification and distribution **for any
noncommercial purpose**. Using this extension to find yourself a job is a
noncommercial purpose, so the port is within the grant.

Two obligations come with it and do not expire:

1. **The notice above travels with the code.** Anyone who receives any part of
   this — a friend, a colleague, a Chrome Web Store listing — must receive it
   too, along with the licence text or its URL.
2. **The noncommercial restriction follows the ported code.** It cannot be
   relicensed away. Whatever this project's own licence eventually says, the
   ported parts stay noncommercial-only.

The repository's README previously declared AGPL-3.0. It no longer does,
because AGPL and PolyForm Noncommercial cannot both govern one distributed
work — AGPL requires that recipients be free to use the work commercially,
which is exactly what PolyForm forbids. The project is currently unlicensed
and in development. **That has to be settled before distributing this to
anyone.**

### What was ported

| File | From |
|---|---|
| `src/content/adapters/indeed-dom.ts` | `extension/src/content/indeed-auto-apply.js`, `extension/src/shared/indeed-platform.js` |
| Parts of `src/content/adapters/indeed.ts` | the same |

Specifically: Indeed's job-key validation and placeholder blocklist, the card
and badge selectors, the Indeed-Apply-versus-external card triage, the
already-applied wording checks, the Continue/Submit label discipline, the
apply-flow URL test including its `preloadresumeapply` exclusion, the
challenge and security-checkpoint detection, and the `0kf:attr(DSQF7)` Indeed
Apply search facet.

The code was rewritten in this project's idiom — TypeScript, the existing
`dom/query` helpers, the `SiteAdapter` interface — rather than pasted. The
*logic* is theirs and the attribution above is what that requires.

### What was deliberately not ported

**Captcha solving.** The reference implementation extracts the sitekey from
reCAPTCHA v2, hCaptcha and Turnstile widgets
(`readRecaptchaV2Sitekey`, `readHcaptchaSitekey`, `readTurnstileSitekey`),
obtains a token, and injects it into the page's hidden field before invoking
the widget's own callback (`injectCaptchaToken`, `invokeDataCallback`).

That defeats an access control whose entire purpose is to establish that a
human is present. Its *detection* half was ported — knowing a challenge is on
screen is what lets a run stop safely instead of hammering a wall — but
nothing here attempts to answer one.

### What could not be ported

The reference extension is a **client for a server**. It authenticates against
`autocvapply.com` with a token and posts to:

- `/api/applications/assist/ats-score`
- `/api/applications/assist/cover-letter`
- `/api/applications/assist/chat`
- `/api/extension/auto-apply/sessions`
- `/api/extension/auto-apply/events`

The ATS scoring, cover-letter generation and answer drafting are implemented in
that project's Laravel backend (`app/Http/Controllers/Api/ApplicationAssistantController.php`,
`app/Services/ApplicationAssistantService.php`), not in the extension. Those
features have no client-side implementation to copy. This project's equivalents
(`src/lib/ats.ts`, `src/lib/ai/gemini.ts`) are its own work and are unaffected
by the notice above.
