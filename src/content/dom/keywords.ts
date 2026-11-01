/**
 * What a button means, in thirteen languages.
 *
 * Kept in its own file because it is data, not logic: adding a language is a
 * list edit, and nobody should have to read a driver to do it. The adapters
 * import `classifyButton`, never the lists.
 *
 * Three signals, in descending order of trust:
 *
 *   1. Structure — `type="submit"`, `aria-label`, `name`, `id`, `data-*`.
 *      Language-independent, but ambiguous: on nearly every multi-step form
 *      both "Continue" and "Submit" are `type="submit"`, because Continue
 *      submits the step.
 *   2. Wording — these lists. Unambiguous when it matches, useless when the
 *      site uses a word nobody listed.
 *   3. Nothing matched — which is reported as `unknown` rather than guessed,
 *      because the two mistakes here are not equal: reading Submit as
 *      Continue clicks it and sends a real application.
 */

export type ButtonIntent =
  | 'submit'
  | 'continue'
  | 'review'
  | 'apply'
  | 'dismiss'
  | 'discard'
  | 'back'
  | 'unknown'

/**
 * Fold a label to something comparable.
 *
 * Accents go because a form may write "Suivant" or "SUIVANT" or, through a
 * broken font stack, something in between. The RTL and zero-width marks go
 * because Arabic and Hebrew interfaces are full of them and they are
 * invisible — a label that looks identical to the eye fails an equality test
 * that nobody can see the reason for.
 */
export function normalizeLabel(value: string | null | undefined): string {
  return (
    String(value ?? '')
      .normalize('NFD')
      // Latin combining marks: é → e, ü → u.
      .replace(/[̀-ͯ]/g, '')
      /*
       * Put everything else back together.
       *
       * NFD decomposes Arabic too — "إ" becomes alef plus a combining hamza
       * that is *not* in the Latin range above, so it survives the strip and
       * the result no longer equals the composed letter it came from. Without
       * this recomposition every Arabic label failed to match a visually
       * identical one.
       */
      .normalize('NFC')
      // Directional and zero-width formatting: RLM, LRM, RLE/LRE/PDF, ZWJ, BOM.
      .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
      // Arabic diacritics are optional in writing, so they cannot be required
      // for a match: the same word appears with and without them.
      .replace(/[ً-ٰٟ]/g, '')
      // Alef, ya and ta-marbuta are written several ways for the same word.
      // Folding them is standard practice for Arabic text matching.
      .replace(/[آأإٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .toLowerCase()
      // Arabic-Indic digits, so "٣" compares equal to "3".
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Wording per intent, already folded by `normalizeLabel` at match time.
 *
 * Languages: English, French, Spanish, German, Italian, Portuguese, Dutch,
 * Arabic, Turkish, Chinese, Japanese, Korean, Russian.
 *
 * Accented forms are written unaccented here because every comparison runs
 * through the fold above; writing both would be two chances to disagree.
 */
export const BUTTON_WORDS: Record<Exclude<ButtonIntent, 'unknown'>, string[]> = {
  submit: [
    'submit application', 'submit your application', 'submit my application', 'submit', 'send application', 'send',
    'envoyer ma candidature', 'envoyer la candidature', 'soumettre ma candidature', 'soumettre', 'envoyer',
    'enviar solicitud', 'enviar candidatura', 'enviar',
    'bewerbung absenden', 'absenden', 'senden', 'abschicken',
    'invia candidatura', 'invia',
    'enviar candidatura', 'submeter',
    'sollicitatie versturen', 'versturen', 'verzenden',
    'ارسال الطلب', 'ارسال', 'تقديم الطلب', 'تقديم',
    'basvuruyu gonder', 'gonder', 'basvur',
    '提交申请', '提交', '发送',
    '応募する', '送信する', '送信',
    '지원하기', '제출하기', '제출',
    'otpravit zayavku', 'otpravit', 'отправить заявку', 'отправить',
  ],
  continue: [
    'continue', 'continue to next step', 'next', 'next step', 'save and continue', 'proceed',
    'continuer', 'suivant', 'etape suivante', 'enregistrer et continuer', 'poursuivre',
    'continuar', 'siguiente', 'guardar y continuar',
    'weiter', 'naechster schritt', 'nachster schritt', 'speichern und weiter', 'fortfahren',
    'avanti', 'continua', 'prossimo', 'salva e continua',
    'proximo', 'continuar', 'seguinte',
    'volgende', 'doorgaan', 'verder',
    'التالي', 'متابعة', 'استمرار',
    'devam', 'ileri', 'sonraki',
    '下一步', '继续',
    '次へ', '続ける', '次',
    '다음', '계속',
    'dalee', 'prodolzhit', 'далее', 'продолжить',
  ],
  review: [
    'review', 'review your application', 'review application', 'preview',
    'verifier', 'verifier votre candidature', 'relire', 'apercu',
    'revisar', 'revisar solicitud', 'vista previa',
    'prufen', 'uberprufen', 'vorschau',
    'rivedi', 'verifica', 'anteprima',
    'revisar candidatura', 'pre-visualizar',
    'controleren', 'bekijken',
    'مراجعة', 'معاينة',
    'incele', 'gozden gecir', 'onizleme',
    '查看', '预览', '檢查',
    '確認', 'プレビュー',
    '검토', '미리보기',
    'proverit', 'prosmotr', 'проверить', 'просмотр',
  ],
  apply: [
    'apply', 'apply now', 'easy apply', 'quick apply', 'apply with indeed', 'easily apply',
    'postuler', 'postuler maintenant', 'candidature simplifiee', 'je postule',
    'solicitar', 'inscribirse', 'solicitud sencilla', 'postularse',
    'bewerben', 'jetzt bewerben', 'einfache bewerbung',
    'candidati', 'candidatura semplice', 'invia candidatura ora',
    'candidatar-se', 'candidatar',
    'solliciteren', 'nu solliciteren',
    'تقدم الان', 'قدم الان', 'التقديم',
    'basvur', 'hemen basvur', 'kolay basvuru',
    '立即申请', '申请', '快速申请',
    '応募', '簡単応募', '今すぐ応募',
    '지원', '간편지원', '바로지원',
    'otklinutsya', 'podat zayavku', 'откликнуться', 'подать заявку',
  ],
  dismiss: [
    'dismiss', 'close', 'cancel', 'not now', 'no thanks', 'done', 'skip',
    'fermer', 'annuler', 'ignorer', 'pas maintenant', 'non merci', 'termine',
    'cerrar', 'cancelar', 'ahora no', 'no gracias', 'listo', 'omitir',
    'schliessen', 'schliesen', 'abbrechen', 'nicht jetzt', 'nein danke', 'fertig', 'uberspringen',
    'chiudi', 'annulla', 'non ora', 'no grazie', 'fatto', 'salta',
    'fechar', 'cancelar', 'agora nao', 'nao obrigado', 'concluido', 'pular',
    'sluiten', 'annuleren', 'niet nu', 'nee bedankt', 'klaar', 'overslaan',
    'اغلاق', 'الغاء', 'ليس الان', 'لا شكرا', 'تم', 'تخطي',
    'kapat', 'iptal', 'simdi degil', 'hayir tesekkurler', 'tamam', 'atla',
    '关闭', '取消', '暂不', '完成', '跳过',
    '閉じる', 'キャンセル', '今はしない', '完了', 'スキップ',
    '닫기', '취소', '나중에', '완료', '건너뛰기',
    'zakryt', 'otmena', 'ne seychas', 'gotovo', 'закрыть', 'отмена', 'готово',
  ],
  discard: [
    'discard', "don't save", 'do not save', 'delete draft', 'discard changes',
    'abandonner', 'supprimer', 'ne pas enregistrer', 'supprimer le brouillon',
    'descartar', 'no guardar', 'eliminar borrador',
    'verwerfen', 'nicht speichern', 'entwurf loschen',
    'elimina', 'non salvare', 'scarta',
    'descartar', 'nao guardar', 'eliminar rascunho',
    'verwijderen', 'niet opslaan',
    'تجاهل', 'عدم الحفظ', 'حذف',
    'vazgec', 'kaydetme', 'sil',
    '放弃', '不保存', '删除草稿',
    '破棄', '保存しない',
    '삭제', '저장 안 함',
    'otbrosit', 'ne sohranyat', 'отбросить', 'не сохранять',
  ],
  back: [
    'back', 'previous', 'go back', 'return',
    'retour', 'precedent', 'revenir',
    'atras', 'anterior', 'volver',
    'zuruck', 'vorheriger',
    'indietro', 'precedente',
    'voltar', 'anterior',
    'terug', 'vorige',
    'رجوع', 'السابق',
    'geri', 'onceki',
    '返回', '上一步',
    '戻る', '前へ',
    '뒤로', '이전',
    'nazad', 'назад',
  ],
}

/** Pre-folded, so a match is a set lookup rather than a scan of the lists. */
const FOLDED: Array<{ intent: Exclude<ButtonIntent, 'unknown'>; words: string[] }> = (
  Object.entries(BUTTON_WORDS) as Array<[Exclude<ButtonIntent, 'unknown'>, string[]]>
).map(([intent, words]) => ({ intent, words: words.map(normalizeLabel).filter(Boolean) }))

/**
 * Intent order when a label matches more than one list.
 *
 * `discard` and `back` outrank `submit` deliberately. "Supprimer" appears in
 * both discard and dismiss vocabularies, and a mistake that abandons a draft
 * costs one application, while a mistake that submits one cannot be undone.
 */
const PRECEDENCE: Array<Exclude<ButtonIntent, 'unknown'>> = [
  'discard',
  'back',
  'review',
  'continue',
  'submit',
  'apply',
  'dismiss',
]

/** Does this label say this intent, in any supported language? */
export function labelMeans(label: string, intent: Exclude<ButtonIntent, 'unknown'>): boolean {
  const folded = normalizeLabel(label)
  if (!folded) return false

  const words = FOLDED.find((entry) => entry.intent === intent)?.words ?? []

  return words.some((word) => {
    if (folded === word) return true

    /*
     * Substring matching only for scripts without spaces.
     *
     * Chinese, Japanese and Korean buttons read "今すぐ応募する" with no word
     * boundary to anchor on. For space-separated scripts a substring test
     * would make "Apply on company site" an `apply` button, so those require
     * a whole-word match.
     */
    if (/[぀-ヿ㐀-鿿가-힯]/.test(word)) return folded.includes(word)

    return new RegExp(`(^|\\s)${escapeRegExp(word)}($|\\s)`).test(folded)
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The element's own words, from wherever it keeps them. */
export function readLabel(element: Element): string {
  const input = element as HTMLInputElement
  return (
    element.getAttribute('aria-label') ||
    (typeof input.value === 'string' && input.type !== 'text' ? input.value : '') ||
    element.textContent ||
    element.getAttribute('title') ||
    ''
  )
}

/**
 * Structural hints, read from attributes rather than words.
 *
 * Works in any language, which is the point — but it is only ever a hint.
 * `type="submit"` is the clearest example: on a multi-step form it is on the
 * Continue button too, because Continue submits the current step.
 */
export function structuralHint(element: Element): ButtonIntent {
  const hay = normalizeLabel(
    [
      element.getAttribute('id'),
      element.getAttribute('name'),
      element.getAttribute('class'),
      element.getAttribute('data-testid'),
      element.getAttribute('data-test'),
      element.getAttribute('data-tn-element'),
      element.getAttribute('data-automation-id'),
    ]
      .filter(Boolean)
      .join(' '),
  )

  // Ordered to match PRECEDENCE: the costly mistakes are checked first.
  if (/discard|dont-?save|delete-?draft/.test(hay)) return 'discard'
  if (/\bback\b|previous|prev-?step/.test(hay)) return 'back'
  if (/review/.test(hay)) return 'review'
  if (/continue|next-?step|nextstep|save-?and-?continue/.test(hay)) return 'continue'
  if (/submit-?application|submit-?button|\bsubmit\b/.test(hay)) return 'submit'
  if (/easy-?apply|apply-?button|indeedapply|\bapply\b/.test(hay)) return 'apply'
  if (/dismiss|close|cancel|modal-?close/.test(hay)) return 'dismiss'

  return 'unknown'
}

/**
 * What this button is for.
 *
 * Wording wins over structure when the two disagree, because structure cannot
 * tell Continue from Submit and wording can. `type="submit"` alone is never
 * enough to call something a submit — that is the whole trap this exists to
 * avoid.
 */
export function classifyButton(element: Element): ButtonIntent {
  const label = readLabel(element)

  for (const intent of PRECEDENCE) {
    if (labelMeans(label, intent)) return intent
  }

  const structural = structuralHint(element)

  /*
   * A bare `type="submit"` with an unreadable label is reported as unknown,
   * not as a submit. The caller decides what to do with that, and every
   * caller here chooses to stop rather than click.
   */
  if (structural === 'submit' && !label.trim()) return 'unknown'

  return structural
}

/** Is this label in a right-to-left script? Used to lay out what we echo back. */
export function isRtl(value: string): boolean {
  return /[֐-׿؀-ۿ܀-ݏހ-޿ࢠ-ࣿיִ-﷿ﹰ-﻿]/.test(
    value,
  )
}

/**
 * The language the form is written in, as a BCP-47 tag, or ''.
 *
 * Read from the document rather than guessed from the text: a page that
 * declares `lang` is telling the truth about itself, and inferring a language
 * from a few button labels gets it wrong on exactly the multilingual pages
 * where it would matter.
 */
export function documentLanguage(root: Document = document): string {
  const declared =
    root.documentElement?.getAttribute('lang') ||
    root.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content') ||
    ''

  return declared.trim().split(',')[0]?.trim() ?? ''
}
