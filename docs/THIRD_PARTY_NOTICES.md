# Third-party notices

## Summary

**No code from the reference project was copied, ported, or adapted into LosJobios.**

Every feature described in [TOP_10_FEATURES.md](./TOP_10_FEATURES.md) was implemented
independently against this codebase's own architecture. There is consequently no
third-party attribution obligation arising from the reference project, and no files in
this repository derive from it.

This document records *why* that decision was made, so the reasoning survives.

## The reference project

| | |
|---|---|
| Repository | `github.com/tmwclaxton/autoapplycv` |
| Product | AutoCVApply |
| Licence | **PolyForm Noncommercial License 1.0.0** |
| Licence URL | https://polyformproject.org/licenses/noncommercial/1.0.0 |
| Required Notice in LICENSE | `Copyright AutoCVApply (https://autocvapply.com)` |
| Inspected at | 2026-09-25, default branch, via the GitHub contents API |
| GitHub's own detection | `NOASSERTION` — not recognised as a standard open-source licence |

## Why nothing was copied

### 1. PolyForm Noncommercial is not an open-source licence

It grants copyright, distribution, and modification licences **only for a "permitted
purpose"**, and defines permitted purposes as noncommercial ones: personal study,
hobby projects, research, charitable and educational organisations. Any commercial
purpose falls outside the grant entirely.

### 2. It is incompatible with this project's licence

| | LosJobios | AutoCVApply |
|---|---|---|
| Licence | AGPL-3.0 (declared in README) | PolyForm Noncommercial 1.0.0 |
| Commercial use | Permitted — AGPL §2 grants use for any purpose | **Forbidden** |
| Repository | Public | Public |

The AGPL requires that the entire combined work be distributable under AGPL terms,
which necessarily grant every recipient the freedom to use it commercially. PolyForm
Noncommercial forbids precisely that freedom. **The two cannot both be satisfied by a
single distributed work.** Merging PolyForm-NC code into this AGPL-3.0 repository and
publishing the result would breach one licence or the other regardless of attribution.

Attribution does not cure this. The conflict is over the *rights granted onward to
recipients*, not over credit.

### 3. This repository is distributed publicly

LosJobios is a public GitHub repository with tagged releases. This is distribution, so
the "personal use / hobby project" permitted purpose does not shield the combined work
from the incompatibility above.

### 4. The architectures do not correspond anyway

The reference is a Laravel/PHP server application (`app/`, `artisan`, `composer.json`,
`database/`, `phpunit.xml`) with a thin extension client that authenticates to it with
an API token and delegates CV parsing, AI drafting, and captcha solving to the server.
LosJobios is deliberately serverless and local-first: there is no account, no backend,
and the only outbound request is the Gemini call the user explicitly enables. Even
where a licence permitted it, porting server-backed code into a local-first extension
would mean rewriting it.

## What was done instead

The reference was read **as documentation** — its README, feature tables, and module
layout — to derive high-level functional requirements. Reading a public repository to
understand what a product does is not a use of its copyright licence; no expression
was reproduced.

Each selected capability was then specified from behaviour and implemented from
scratch using this codebase's existing conventions: its Zod schemas, its
`chrome.storage` wrapper, its typed messaging map, its React primitives, and its
Vitest suite. Naming, data model, UI, copy, and algorithms are original.

Where the reference and this project inevitably converge — both fill web forms, both
detect fields — that convergence is functional, not expressive. Ideas, functional
behaviour, and facts are not protected by copyright; only expression is.

## Deliberately not reproduced

Taken from the reference: nothing. Specifically **not** reproduced:

- Its product name, branding, logo, colours, marketing copy, or README text
- Its UI layout, component structure, or user-facing strings
- Its platform automation modules (`linkedin-auto-apply.js`, `indeed-auto-apply.js`,
  `glassdoor-auto-apply.js`, `reed-auto-apply.js`, `totaljobs-auto-apply.js`,
  `simplyhired-auto-apply.js`) or any code within them
- Its form corpus, test fixtures, or heuristics tables
- Its server API surface, database schema, or prompt text

## Capabilities deliberately declined

Two reference capabilities were reviewed and **rejected on safety grounds**,
independent of licensing. They are recorded here so the omission reads as a decision
rather than an oversight.

| Reference capability | Why it is not implemented here |
|---|---|
| **Captcha auto-solving** (reCAPTCHA v2, hCaptcha, Turnstile via AntiCaptcha/2Captcha) | A captcha is an explicit statement that a human is required. Defeating one is circumventing an access control, and it is barred by this project's own safety rules. LosJobios detects nothing of the sort and never will. |
| **End-to-end Auto Apply that clicks the final Submit** | The reference will submit applications without a human checkpoint when "Pauses before Submit" is switched off. LosJobios never clicks a final Submit, Send, Apply or Confirm control under any setting. Dry run is on by default and the run engine stops at the submit step. |

## This project's own dependencies

Runtime dependencies, all permissively licensed and installed via npm rather than
vendored:

| Package | Licence | Use |
|---|---|---|
| `react`, `react-dom` | MIT | Options, dashboard, and side panel UI |
| `zod` | MIT | Schema validation for everything read from storage |
| `pdfjs-dist` | Apache-2.0 | PDF text extraction, lazily loaded on the options page only |
| `mammoth` | BSD-2-Clause | DOCX text extraction |
| `tailwindcss` | MIT | Styling |
| `vite`, `@crxjs/vite-plugin`, `vitest`, `typescript` | MIT | Build and test tooling |
| `@testing-library/react`, `@testing-library/user-event` | MIT | UI tests |

## Housekeeping note

The README declares **AGPL-3.0**, but the repository contains no `LICENSE` file, so
GitHub reports the project as unlicensed. Until that file exists, recipients have no
express grant at all and default copyright applies. Adding the AGPL-3.0 text as
`LICENSE` would make the declared intent effective. This has been left for the
repository owner to decide, since adding a licence file is a legal declaration rather
than a code change.
