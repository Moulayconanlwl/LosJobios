/**
 * A small, typed translation layer.
 *
 * Deliberately not `chrome.i18n`. That API reads its locale from the
 * *browser's* language and cannot be overridden at runtime, which is exactly
 * wrong for this audience: someone applying in France from an
 * English-language Chrome should be able to work in French without changing
 * their browser, and someone doing the reverse should too. So the locale is a
 * setting, and `chrome.i18n.getUILanguage()` is only the initial guess.
 *
 * English is the fallback for every key, so a missing French string degrades
 * to a readable English one rather than to a raw key on screen. The `Copy`
 * type makes a key that exists in English but not in French a *compile*
 * error, so that degradation should never actually be reachable.
 */

export const LOCALES = ['en', 'fr'] as const
export type Locale = (typeof LOCALES)[number]

const EN = {
  'panel.title': 'Review & fill',
  'panel.subtitle': 'Nothing is written until you say so.',
  'panel.scan': 'Scan this form',
  'panel.scanning': 'Reading the form…',
  'panel.draft': 'Draft open questions',
  'panel.drafting': 'Drafting…',
  'panel.empty.title': 'Open an application form',
  'panel.empty.body':
    'Press Scan this form and every field it can fill is listed here first, with where each value came from. You decide what gets written.',
  'panel.selectAll': 'Select all',
  'panel.selectNone': 'None',
  'panel.nothingSelected': 'Nothing selected',
  'panel.neverSubmits': 'This never submits the form. You submit it yourself.',
  'panel.nothingLeft': 'Nothing left to fill on this page.',
  'panel.profileThin': 'Your profile is nearly empty, so there is little to fill from.',
  'panel.fillItIn': 'Fill it in',
  'panel.rejected': 'The form rejected these fields',
  'panel.rejectedHint': "This is the page's own wording. Fix it here or on the form, then scan again.",

  'source.bank': 'saved answer',
  'source.profile': 'profile',
  'source.ai': 'AI draft',
  'source.none': 'unresolved',
  'field.required': 'required',

  'reason.bank': 'You answered this before',
  'reason.profile': 'From your profile',
  'reason.aiDraft': 'AI draft — check it',
  'reason.aiLow': 'AI draft, low confidence',
  'reason.none': 'Nothing could answer this',
  'reason.resume': 'Your stored CV',

  'settings.language': 'Language',
  'settings.languageHint': 'Changes the extension interface. Generated documents follow the posting.',
  'language.en': 'English',
  'language.fr': 'Français',
} as const

export type CopyKey = keyof typeof EN
type Copy = Record<CopyKey, string>

const FR: Copy = {
  'panel.title': 'Vérifier et remplir',
  'panel.subtitle': "Rien n'est écrit sans votre accord.",
  'panel.scan': 'Analyser ce formulaire',
  'panel.scanning': 'Lecture du formulaire…',
  'panel.draft': 'Rédiger les questions ouvertes',
  'panel.drafting': 'Rédaction…',
  'panel.empty.title': 'Ouvrez un formulaire de candidature',
  'panel.empty.body':
    "Lancez l'analyse : chaque champ remplissable est listé ici d'abord, avec l'origine de chaque valeur. Vous décidez de ce qui est écrit.",
  'panel.selectAll': 'Tout sélectionner',
  'panel.selectNone': 'Aucun',
  'panel.nothingSelected': 'Aucun champ sélectionné',
  'panel.neverSubmits': "Ceci n'envoie jamais le formulaire. C'est vous qui l'envoyez.",
  'panel.nothingLeft': 'Plus rien à remplir sur cette page.',
  'panel.profileThin': 'Votre profil est presque vide : il y a peu de données à utiliser.',
  'panel.fillItIn': 'Le compléter',
  'panel.rejected': 'Le formulaire a refusé ces champs',
  'panel.rejectedHint':
    "C'est le message du site lui-même. Corrigez ici ou sur le formulaire, puis relancez l'analyse.",

  'source.bank': 'réponse enregistrée',
  'source.profile': 'profil',
  'source.ai': 'brouillon IA',
  'source.none': 'non résolu',
  'field.required': 'obligatoire',

  'reason.bank': 'Vous avez déjà répondu à cette question',
  'reason.profile': 'Depuis votre profil',
  'reason.aiDraft': 'Brouillon IA — à vérifier',
  'reason.aiLow': 'Brouillon IA, faible confiance',
  'reason.none': 'Aucune réponse trouvée',
  'reason.resume': 'Votre CV enregistré',

  'settings.language': 'Langue',
  'settings.languageHint':
    "Change l'interface de l'extension. Les documents générés suivent l'annonce.",
  'language.en': 'English',
  'language.fr': 'Français',
}

const DICTIONARIES: Record<Locale, Copy> = { en: EN, fr: FR }

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * The locale to start from when the user hasn't chosen one.
 *
 * Only the language subtag matters — "fr-CA" and "fr-FR" both get French.
 */
export function detectLocale(): Locale {
  try {
    const ui = chrome.i18n?.getUILanguage?.() ?? 'en'
    const base = ui.split('-')[0] ?? 'en'
    return isLocale(base) ? base : 'en'
  } catch {
    return 'en'
  }
}

/**
 * Look up a string, falling back to English.
 *
 * `auto` resolves from the browser, which is what an untouched install does.
 */
export function translate(locale: Locale | 'auto', key: CopyKey): string {
  const resolved = locale === 'auto' ? detectLocale() : locale
  return DICTIONARIES[resolved]?.[key] ?? EN[key]
}
