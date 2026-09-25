# Upgrade summary

## Headline

Ten capability gaps were identified against the AutoCVApply reference and all ten were
implemented. **No reference code was copied.** The reference is licensed
PolyForm Noncommercial 1.0.0, which is incompatible with this project's AGPL-3.0, so
every feature was built independently from observed behaviour.

**358 tests pass. Typecheck, lint-equivalent (strict TS), and production build are clean.**

## Status of the selected features

| # | Feature | Status | Tests |
|---|---|---|---|
| 1 | Review before fill | Complete | 18 |
| 2 | Shadow DOM & nested form discovery | Complete | 12 |
| 3 | Side panel workspace | Complete (not browser-verified) | render smoke only |
| 4 | Profile completeness guidance | Complete | 11 |
| 5 | Draft all open questions | Complete | 5 |
| 6 | Supported-site detection | Complete | covered via plan tests |
| 7 | Validation error recovery | Complete | 13 |
| 8 | Notes, follow-ups & next actions | Complete | schema-covered |
| 9 | Activity log | Complete | 9 |
| 10 | French / English interface | **Partial** — framework complete, side panel translated, other surfaces still English | 11 |

## Licence and attribution

| | |
|---|---|
| Reference licence | **PolyForm Noncommercial 1.0.0** (`NOASSERTION` to GitHub) |
| This project | AGPL-3.0 per README |
| Compatible? | **No** |
| Code copied | **None** |
| Attribution owed | **None**, because nothing was used |

AGPL requires the combined work be distributable with freedom to use commercially;
PolyForm Noncommercial forbids commercial use. The two cannot both be satisfied by one
distributed work, and attribution does not cure a conflict over rights granted onward.
Full reasoning in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

**Action for the repository owner:** the README declares AGPL-3.0 but there is no
`LICENSE` file, so GitHub reports the project as unlicensed and recipients have no
express grant. Adding the AGPL-3.0 text as `LICENSE` would make the stated intent
effective. Left undone deliberately — adding a licence file is a legal declaration, not
a code change.

## Reference capabilities reviewed and declined

| Capability | Why not |
|---|---|
| **Captcha auto-solving** (reCAPTCHA v2, hCaptcha, Turnstile) | A captcha states that a human is required. Defeating one circumvents an access control and is barred by the project's safety rules. |
| **End-to-end auto-apply clicking the final Submit** | The reference will submit without a human checkpoint when its pause toggle is off. Nothing here clicks a final Submit under any setting. |
| Server-backed CV parsing (OCR), AI proxying, billing, accounts | Architecturally incompatible with a serverless, local-first, no-account extension. |

## New permissions

| Permission | Why | Data access |
|---|---|---|
| `sidePanel` | The review flow cannot live in a popup, which closes the moment you click the form you are checking | **None** — it is a UI surface |

No new host permissions. Gemini remains an optional host permission requested at runtime.

## Data migrations

All additive, all migrate on read through `parseOr`, which fills schema defaults for any
field absent from a stored record. **No migration step, no data loss, `SCHEMA_VERSION`
unchanged.**

| Store | Added | Default |
|---|---|---|
| `applications` | `followUpOn`, `nextAction` | `''` |
| `settings` | `locale` | `'auto'` |
| new key `activity` | — | `[]` |

Backward compatible in both directions: an older build reading a newer record ignores
the unknown fields; a newer build reading an older record defaults them.

## Results

```
npm run typecheck   clean
npm test            358 passed (29 files)
npm run build       built in ~8s, no errors
```

Three real bugs were found by tests written during this work, all now fixed:

1. **`accessibleName` resolved ids against `document`**, so shadow-DOM fields were
   detected but arrived *unlabelled* — worse than not detecting them, because an
   unlabelled field can't be classified and silently becomes an unanswered question.
2. **`findLabelFor` had the same bug**, so a custom radio inside a web component could be
   detected but never clicked.
3. **`closest()` in validation matched the error node itself**, so the field-attribution
   fallback searched inside the error's own markup and never attributed anything.

## Known limitations

1. **Nothing here is browser-verified.** No Chrome was available. The side panel opening,
   real ATS markup, and every visual are unverified — see TESTING.md.
2. **i18n is partial.** Side panel and the language setting are translated; options,
   dashboard and popup are still English. Mechanical to finish.
3. **Field handles are per-page-load.** A step that re-renders between scan and fill can
   orphan a proposal; it is counted failed rather than written to the wrong field.
4. **Site detection is host-based.** A known ATS on a custom domain reads as a generic
   form — which is honest, just less specific.
5. **Validation attribution is best-effort** beyond `aria-describedby`.
6. **The LinkedIn post-apply dialog guard remains untested against the live site**, from
   earlier work.

## Recommended next

1. Verify in Chrome against a real Greenhouse/Ashby/Workday form — the highest-value
   remaining step by a distance.
2. Finish i18n across options, dashboard and popup.
3. Persist proposals across a re-render by re-matching on label when a handle is lost.
4. Add keyboard shortcuts to the panel (select all / fill) and an a11y audit pass.
5. A privacy dashboard consolidating what is stored, its size, and per-store deletion.

## Manual QA

Every feature has step-by-step verification in [TESTING.md](./TESTING.md), including the
negative checks that matter most: that scanning writes nothing, that uncertain values
default to skipped, and that the activity log never records a typed value.
