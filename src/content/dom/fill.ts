import type { ResumeFile } from '@/lib/schema'
import { matchOption } from '@/lib/optionmatch'
import { humanClick, pause, sleep } from './human'
import { accessibleName, isInteractable, isVisible, normalizeText, text } from './query'

export { matchOption }

/**
 * Writing values into form controls that frameworks own.
 *
 * The central problem: React (and Vue, and Angular) track input state in their
 * own internal store, not in the DOM. Assigning `el.value = x` updates the DOM
 * node, but React's `onChange` never fires, its state never updates, and the
 * next render overwrites your value with the stale one. The field looks filled,
 * then empties itself on submit.
 *
 * The fix is to call the *native* value setter from the prototype — which
 * bypasses the property React has redefined on the instance — and then dispatch
 * the events React's synthetic system is actually listening for.
 */

type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

function nativeSetter(el: ValueElement): ((value: string) => void) | null {
  const prototype =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
  if (!descriptor?.set) return null
  return descriptor.set.bind(el)
}

/** Assign a value in a way frameworks actually observe. */
export function setNativeValue(el: ValueElement, value: string): void {
  const setter = nativeSetter(el)
  if (setter) setter(value)
  else el.value = value

  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

/**
 * Fill a text-like control, typing character-by-character when the field is
 * short enough to matter. Some autocomplete widgets (LinkedIn's location
 * picker, Workday's typeaheads) only open their dropdown on keystrokes.
 */
export async function fillText(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  options: { type?: boolean; signal?: AbortSignal } = {},
): Promise<void> {
  const { type = false, signal } = options

  el.focus()
  setNativeValue(el, '')

  if (type && value.length <= 80) {
    for (const char of value) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }))
      setNativeValue(el, el.value + char)
      el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }))
      await sleep(18 + Math.random() * 45, signal)
    }
  } else {
    setNativeValue(el, value)
  }

  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

/**
 * A prompt rather than a choice — "Please select", "— Choose —", or the empty
 * first entry. Picking one of these is the same as leaving the field blank.
 */
export function isPlaceholderOption(option: HTMLOptionElement): boolean {
  if (option.disabled) return true
  if (option.value === '') return true

  const label = normalizeText(option.textContent)
  if (!label) return true
  return /^[-–—\s]*$/.test(label) || /^(please\s+)?(select|choose|pick)\b/i.test(label)
}

/** Readable labels of a native <select>, skipping any placeholder entry. */
export function selectOptions(el: HTMLSelectElement): string[] {
  return Array.from(el.options)
    .filter((o) => !isPlaceholderOption(o))
    .map((o) => normalizeText(o.textContent) || o.value)
}

export function fillSelect(el: HTMLSelectElement, wanted: string): boolean {
  const all = Array.from(el.options)

  // Blank out placeholders so they can't be matched, while keeping the array
  // aligned with `el.options` so the winning index still addresses the right
  // option.
  const labels = all.map((o) =>
    isPlaceholderOption(o) ? '' : normalizeText(o.textContent) || o.value,
  )

  const idx = matchOption(labels, wanted)
  if (idx < 0) return false

  const option = all[idx]
  if (!option) return false

  setNativeValue(el, option.value)
  // Some listeners key off selectedIndex rather than value.
  el.selectedIndex = idx
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

// ---------------------------------------------------------------------------
// Radios and checkboxes
// ---------------------------------------------------------------------------

/** Every radio sharing this control's name, within the nearest form or document. */
export function radioGroup(el: HTMLInputElement): HTMLInputElement[] {
  const scope = el.form ?? el.closest('fieldset, [role="radiogroup"]') ?? document
  if (!el.name) return [el]
  return Array.from(
    scope.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(el.name)}"]`,
    ),
  )
}

/** The label a user would read for one radio or checkbox. */
export function optionLabel(el: HTMLInputElement): string {
  const own = accessibleName(el)
  if (own) return own
  const sibling = el.parentElement ? text(el.parentElement) : ''
  return sibling || el.value
}

export async function fillRadio(
  el: HTMLInputElement,
  wanted: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const group = radioGroup(el)
  const labels = group.map(optionLabel)

  const idx = matchOption(labels, wanted)
  if (idx < 0) return false

  const target = group[idx]
  if (!target) return false

  // Click the label when the input itself is visually hidden, which is how most
  // custom-styled radio groups are built.
  const clickable = isVisible(target) ? target : findLabelFor(target)
  if (clickable) await humanClick(clickable, signal)
  else target.checked = true

  target.dispatchEvent(new Event('input', { bubbles: true }))
  target.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

export async function fillCheckbox(
  el: HTMLInputElement,
  checked: boolean,
  signal?: AbortSignal,
): Promise<boolean> {
  if (el.checked === checked) return true

  const clickable = isVisible(el) ? el : findLabelFor(el)
  if (clickable) await humanClick(clickable, signal)
  else {
    el.checked = checked
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return el.checked === checked
}

function findLabelFor(el: HTMLInputElement): HTMLElement | null {
  if (el.id) {
    const byFor = document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`)
    if (byFor && isVisible(byFor)) return byFor
  }
  const wrapping = el.closest('label')
  return wrapping && isVisible(wrapping) ? wrapping : null
}

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Attach a stored resume to a file input.
 *
 * `input.files` is read-only, but it accepts a FileList built from a
 * DataTransfer — the same mechanism a real drag-and-drop uses, which is why
 * pages accept it without complaint.
 */
export function attachFile(el: HTMLInputElement, resume: ResumeFile): boolean {
  try {
    const bytes = base64ToBytes(resume.dataBase64)
    const file = new File([bytes.buffer as ArrayBuffer], resume.fileName, {
      type: resume.mimeType || 'application/pdf',
      lastModified: resume.updatedAt || Date.now(),
    })

    const transfer = new DataTransfer()
    transfer.items.add(file)
    el.files = transfer.files

    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  } catch (err) {
    console.warn('[LosJobios] file attach failed', err)
    return false
  }
}

// ---------------------------------------------------------------------------
// Custom (non-native) dropdowns
// ---------------------------------------------------------------------------

/**
 * Drive an ARIA combobox / listbox that isn't a real <select>. Opens the
 * control, reads the rendered options, and clicks the best match.
 */
export async function fillAriaCombobox(
  trigger: HTMLElement,
  wanted: string,
  signal?: AbortSignal,
): Promise<boolean> {
  await humanClick(trigger, signal)
  await pause(200, 500, signal)

  const listboxId = trigger.getAttribute('aria-controls') ?? trigger.getAttribute('aria-owns')
  const listbox =
    (listboxId ? document.getElementById(listboxId) : null) ??
    document.querySelector<HTMLElement>('[role="listbox"]')

  if (!listbox || !isVisible(listbox)) return false

  const items = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')).filter(
    (o) => isVisible(o) && isInteractable(o),
  )
  if (!items.length) return false

  const idx = matchOption(items.map(text), wanted)
  if (idx < 0) {
    // Leave the control as we found it rather than picking something arbitrary.
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return false
  }

  const choice = items[idx]
  if (!choice) return false

  await humanClick(choice, signal)
  return true
}
