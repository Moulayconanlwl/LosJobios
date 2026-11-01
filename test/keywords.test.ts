import { beforeEach, describe, expect, it } from 'vitest'
import {
  classifyButton,
  documentLanguage,
  isRtl,
  labelMeans,
  normalizeLabel,
  structuralHint,
} from '@/content/dom/keywords'

/**
 * Reading a button in any language.
 *
 * The asymmetry that shapes this file: mistaking Submit for Continue clicks
 * it and sends a real application under the user's name, while mistaking
 * Continue for Submit costs one abandoned application. So an unreadable
 * button is `unknown`, never a guess, and `type="submit"` on its own is
 * never enough — on a multi-step form the Continue button is also
 * `type="submit"`, because Continue submits the step.
 */

function button(html: string): Element {
  document.body.innerHTML = html
  return document.body.firstElementChild as Element
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('normalizeLabel', () => {
  it('folds accents so case and diacritics do not matter', () => {
    expect(normalizeLabel('Suivant')).toBe(normalizeLabel('SUIVANT'))
    expect(normalizeLabel('Vérifier')).toBe('verifier')
    expect(normalizeLabel('Prüfen')).toBe('prufen')
  })

  it('strips the invisible marks an RTL interface is full of', () => {
    // Present throughout Arabic and Hebrew UIs and identical to the eye, so a
    // mismatch they cause is impossible to spot in a bug report.
    expect(normalizeLabel('‏إرسال‎')).toBe(normalizeLabel('إرسال'))
    expect(normalizeLabel('‏إرسال‎')).not.toMatch(/[‎‏]/)
  })

  it('folds the alef spellings, which the same Arabic word is written with', () => {
    // "إرسال" and "ارسال" are the same word; requiring the hamza would
    // mean matching only whichever spelling the dictionary happened to use.
    expect(normalizeLabel('إرسال')).toBe(normalizeLabel('ارسال'))
    expect(normalizeLabel('أرسل')).toBe(normalizeLabel('ارسل'))
  })

  it('folds Arabic-Indic digits onto ASCII ones', () => {
    expect(normalizeLabel('٣')).toBe('3')
  })
})

describe('labelMeans', () => {
  it('reads submit in every supported language', () => {
    const submits = [
      'Submit application',
      'Envoyer ma candidature',
      'Enviar solicitud',
      'Bewerbung absenden',
      'Invia candidatura',
      'Sollicitatie versturen',
      'إرسال الطلب',
      'Başvuruyu gönder',
      '提交申请',
      '応募する',
      '지원하기',
      'Отправить заявку',
    ]

    for (const label of submits) {
      expect(labelMeans(label, 'submit'), label).toBe(true)
    }
  })

  it('reads continue in every supported language', () => {
    const next = ['Continue', 'Suivant', 'Siguiente', 'Weiter', 'Avanti', 'Volgende', 'التالي', 'Devam', '下一步', '次へ', '다음', 'Далее']

    for (const label of next) {
      expect(labelMeans(label, 'continue'), label).toBe(true)
    }
  })

  it('never reads a continue label as a submit, in any language', () => {
    // The expensive direction.
    for (const label of ['Continue', 'Suivant', 'Weiter', 'Siguiente', '次へ', 'Далее', 'التالي']) {
      expect(labelMeans(label, 'submit'), label).toBe(false)
    }
  })

  it('requires a whole word in space-separated scripts', () => {
    /*
     * "Apply on company site" must not read as an apply button — following
     * it takes a run off the job board and onto an unknown ATS. A substring
     * match would make it one.
     */
    expect(labelMeans('Apply on company site', 'apply')).toBe(true)
    expect(labelMeans('Reapplying later', 'apply')).toBe(false)
  })

  it('matches without word boundaries in CJK, which has none', () => {
    expect(labelMeans('今すぐ応募する', 'apply')).toBe(true)
    expect(labelMeans('立即申请职位', 'apply')).toBe(true)
  })

  it('keeps Hangul composed, or the spaceless-script path never runs', () => {
    /*
     * Korean has no word boundaries, so it depends on the substring path —
     * and that path is chosen by testing the dictionary word against the
     * composed Hangul range. Decomposing to NFD without recomposing splits
     * every syllable into Jamo, the range test then fails, and Korean falls
     * back to a word-boundary match that can never succeed.
     */
    expect(normalizeLabel('지원')).toMatch(/[가-힯]/)
    expect(labelMeans('지원하기', 'apply')).toBe(true)
  })
})

describe('classifyButton', () => {
  it('prefers the words over the markup when they disagree', () => {
    // Both buttons on a wizard are type=submit. Only the label separates them.
    expect(classifyButton(button('<button type="submit">Suivant</button>'))).toBe('continue')
    expect(classifyButton(button('<button type="submit">Envoyer ma candidature</button>'))).toBe(
      'submit',
    )
  })

  it('reports an unreadable type=submit as unknown rather than guessing', () => {
    /*
     * The load-bearing case. A button with no readable label might be
     * Submit; calling it Continue would click it. Callers treat `unknown` as
     * a reason to stop.
     */
    expect(classifyButton(button('<button type="submit"></button>'))).toBe('unknown')
  })

  it('falls back to structure when there are no words', () => {
    expect(classifyButton(button('<button data-testid="continue-button"></button>'))).toBe(
      'continue',
    )
  })

  it('reads an aria-label when there is no text', () => {
    expect(classifyButton(button('<button aria-label="Submit application"></button>'))).toBe(
      'submit',
    )
  })

  it('puts discard ahead of everything, because it is the costly confusion', () => {
    // "Supprimer" is in both the discard and dismiss vocabularies.
    expect(classifyButton(button('<button>Ne pas enregistrer</button>'))).toBe('discard')
  })
})

describe('structuralHint', () => {
  it('reads ids, names and data attributes, in any language', () => {
    expect(structuralHint(button('<button id="indeedApplyButton"></button>'))).toBe('apply')
    expect(structuralHint(button('<button data-testid="submit-application-button"></button>'))).toBe(
      'submit',
    )
    expect(structuralHint(button('<button class="modal-close"></button>'))).toBe('dismiss')
  })

  it('says unknown when the markup carries no hint', () => {
    expect(structuralHint(button('<button class="btn btn-primary"></button>'))).toBe('unknown')
  })
})

describe('isRtl', () => {
  it('recognises right-to-left scripts', () => {
    expect(isRtl('إرسال الطلب')).toBe(true)
    expect(isRtl('Submit')).toBe(false)
  })
})

describe('documentLanguage', () => {
  it('reads the declared language rather than guessing from the text', () => {
    /*
     * A page that declares `lang` is telling the truth about itself.
     * Inferring from a handful of button labels gets it wrong on exactly the
     * multilingual pages where it would matter.
     */
    document.documentElement.setAttribute('lang', 'fr-FR')
    expect(documentLanguage(document)).toBe('fr-FR')
  })

  it('comes back empty when the page says nothing', () => {
    document.documentElement.removeAttribute('lang')
    expect(documentLanguage(document)).toBe('')
  })
})
