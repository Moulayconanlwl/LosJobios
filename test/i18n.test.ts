import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOCALES, detectLocale, isLocale, translate } from '@/lib/i18n'

/**
 * The interface language is a *setting*, not a read of the browser's locale.
 *
 * That is the whole reason this doesn't use `chrome.i18n`: someone applying
 * in France from an English-language Chrome has to be able to work in French
 * without changing their browser, and the reverse has to work too. The
 * browser is only the opening guess.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubUiLanguage(language: string) {
  vi.stubGlobal('chrome', { i18n: { getUILanguage: () => language } })
}

describe('translate', () => {
  it('returns English copy', () => {
    expect(translate('en', 'panel.scan')).toBe('Scan this form')
  })

  it('returns French copy', () => {
    expect(translate('fr', 'panel.scan')).toBe('Analyser ce formulaire')
  })

  it('translates the safety line, which is the one that must never be missing', () => {
    // If any string has to survive translation intact, it is the promise that
    // the extension does not submit the form.
    expect(translate('fr', 'panel.neverSubmits')).toContain("n'envoie jamais")
    expect(translate('en', 'panel.neverSubmits')).toContain('never submits')
  })

  it('resolves auto from the browser', () => {
    stubUiLanguage('fr-FR')
    expect(translate('auto', 'panel.scan')).toBe('Analyser ce formulaire')
  })

  it('never renders a raw key', () => {
    for (const locale of LOCALES) {
      const value = translate(locale, 'panel.title')
      expect(value).not.toContain('.')
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('has a French string for every English one', () => {
    // The dictionaries are typed to make this a compile error too; this
    // catches a French entry that exists but was left as the English text.
    const untranslated = (
      [
        'panel.title',
        'panel.scan',
        'panel.subtitle',
        'panel.selectAll',
        'reason.none',
        'source.bank',
      ] as const
    ).filter((key) => translate('en', key) === translate('fr', key))

    expect(untranslated).toEqual([])
  })
})

describe('detectLocale', () => {
  it('reads the language subtag and ignores the region', () => {
    stubUiLanguage('fr-CA')
    expect(detectLocale()).toBe('fr')
  })

  it('falls back to English for a language it has no copy for', () => {
    stubUiLanguage('de-DE')
    expect(detectLocale()).toBe('en')
  })

  it('survives chrome.i18n being unavailable', () => {
    // Content scripts and tests both hit this.
    vi.stubGlobal('chrome', {})
    expect(detectLocale()).toBe('en')
  })
})

describe('isLocale', () => {
  it('accepts the supported locales and rejects anything else', () => {
    expect(isLocale('fr')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('es')).toBe(false)
    expect(isLocale('')).toBe(false)
  })
})
