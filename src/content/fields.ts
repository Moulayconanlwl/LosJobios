import type { FieldKind } from '@/lib/schema'
import { classifySignals, type Classification, type ProfileKey } from '@/lib/fieldrules'
import { accessibleName, isDisplayed, isInteractable, normalizeText, pickAll, text } from './dom/query'
import { optionLabel, radioGroup, selectOptions } from './dom/fill'

/**
 * Turning a live form into a list of answerable questions.
 *
 * The semantics live in `@/lib/fieldrules`; this module's job is purely to
 * inspect the DOM — what kind of control is it, what is it actually asking,
 * is it required, what choices does it offer.
 */

export type { ProfileKey }

export type DetectedField = {
  el: HTMLElement
  kind: FieldKind
  /** The question as a human reads it. */
  label: string
  required: boolean
  options: string[]
  /** Populated for radio groups, so the whole group is handled as one field. */
  group: HTMLInputElement[]
  key: ProfileKey | null
  confidence: number
}

const CONTROL_SELECTORS = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
  'textarea',
  'select',
  '[role="combobox"]',
  '[contenteditable="true"]',
]

/** Map a DOM control onto one of our field kinds. */
export function kindOf(el: HTMLElement): FieldKind {
  if (el instanceof HTMLTextAreaElement) return 'textarea'
  if (el instanceof HTMLSelectElement) return 'select'

  if (el instanceof HTMLInputElement) {
    switch (el.type) {
      case 'email':
        return 'email'
      case 'tel':
        return 'tel'
      case 'url':
        return 'url'
      case 'number':
      case 'range':
        return 'number'
      case 'radio':
        return 'radio'
      case 'checkbox':
        return 'checkbox'
      case 'date':
      case 'month':
      case 'datetime-local':
        return 'date'
      case 'file':
        return 'file'
      default:
        return 'text'
    }
  }

  if (el.getAttribute('role') === 'combobox') return 'select'
  if (el.getAttribute('contenteditable') === 'true') return 'textarea'
  return 'unknown'
}

/** Required per the DOM, per ARIA, or per a visible asterisk near the label. */
export function isRequired(el: HTMLElement, label: string): boolean {
  const input = el as HTMLInputElement
  if (input.required) return true
  if (el.getAttribute('aria-required') === 'true') return true
  if (label.includes('*')) return true
  if (el.closest('[data-required="true"]')) return true

  // Greenhouse and Lever both render the asterisk as a sibling span rather than
  // setting the attribute, so fall back to reading the field's own wrapper.
  const wrapper = el.closest('label, .field, [class*="field"], [class*="form-group"]')
  if (wrapper && /\*/.test(text(wrapper).slice(0, 200))) return true

  return false
}

/** The choices a control offers, for selects, radio groups and ARIA listboxes. */
export function optionsOf(el: HTMLElement): string[] {
  if (el instanceof HTMLSelectElement) return selectOptions(el)

  if (el instanceof HTMLInputElement && el.type === 'radio') {
    return radioGroup(el).map(optionLabel).filter(Boolean)
  }

  if (el.getAttribute('role') === 'combobox') {
    const listboxId = el.getAttribute('aria-controls') ?? el.getAttribute('aria-owns')
    const listbox = listboxId ? document.getElementById(listboxId) : null
    if (listbox) {
      return Array.from(listbox.querySelectorAll('[role="option"]')).map(text).filter(Boolean)
    }
  }

  return []
}

/** Every attribute that might hint at a field's purpose, as one string. */
function attributeHay(el: HTMLElement): string {
  const input = el as HTMLInputElement
  return [
    input.name ?? '',
    el.id ?? '',
    el.getAttribute('data-test') ?? '',
    el.getAttribute('data-testid') ?? '',
    el.getAttribute('data-automation-id') ?? '',
    el.getAttribute('placeholder') ?? '',
  ].join(' ')
}

export function classifyElement(el: HTMLElement, label: string, kind: FieldKind): Classification {
  return classifySignals({
    label,
    attributes: attributeHay(el),
    autocomplete: el.getAttribute('autocomplete') ?? '',
    kind,
  })
}

/**
 * Enumerate every fillable control under `root`, collapsing radio groups into a
 * single entry so one yes/no question isn't answered twice.
 */
export function collectFields(root: ParentNode = document): DetectedField[] {
  // `isDisplayed` rather than `isVisible`: a custom-styled radio is often a
  // transparent 1×1 box behind a styled label, and it's still a real question.
  const controls = pickAll(CONTROL_SELECTORS, root as Document, isDisplayed).filter(isInteractable)

  const fields: DetectedField[] = []
  const seenRadioGroups = new Set<string>()

  for (const el of controls) {
    const kind = kindOf(el)
    if (kind === 'unknown') continue

    const isRadio = el instanceof HTMLInputElement && el.type === 'radio'

    if (isRadio) {
      const groupKey = (el as HTMLInputElement).name || el.id
      if (groupKey) {
        if (seenRadioGroups.has(groupKey)) continue
        seenRadioGroups.add(groupKey)
      }
    }

    const group = isRadio ? radioGroup(el as HTMLInputElement) : ([] as HTMLInputElement[])

    // A radio's own accessible name is its option text ("Yes"), not the
    // question — walk up to the group for the actual prompt.
    const label = isRadio ? groupQuestion(el) : accessibleName(el)

    const { key, confidence } = classifyElement(el, label, kind)

    fields.push({
      el,
      kind,
      label: normalizeText(label),
      required: isRequired(el, label),
      options: optionsOf(el),
      group,
      key,
      confidence,
    })
  }

  return fields
}

/** The prompt above a radio group, as opposed to any single option's label. */
function groupQuestion(el: HTMLElement): string {
  const container = el.closest('fieldset, [role="radiogroup"], [role="group"]')

  if (container) {
    const legend = container.querySelector('legend')
    const legendText = legend ? text(legend) : ''
    if (legendText) return legendText

    const aria = normalizeText(container.getAttribute('aria-label'))
    if (aria) return aria

    const labelledBy = container.getAttribute('aria-labelledby')
    if (labelledBy) {
      const node = document.getElementById(labelledBy)
      const nodeText = node ? text(node) : ''
      if (nodeText) return nodeText
    }
  }

  // Fall back to the nearest ancestor that contributes prompt-like text once
  // the controls and option labels are stripped out.
  let cursor: Element | null = el.parentElement
  for (let depth = 0; cursor && depth < 4; depth += 1) {
    const clone = cursor.cloneNode(true) as HTMLElement
    clone.querySelectorAll('input, select, textarea, label').forEach((n) => n.remove())
    const candidate = normalizeText(clone.textContent)
    if (candidate.length > 3) return candidate
    cursor = cursor.parentElement
  }

  return accessibleName(el)
}
