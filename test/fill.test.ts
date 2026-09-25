import { beforeEach, describe, expect, it } from 'vitest'
import { fillSelect, selectOptions, setNativeValue } from '@/content/dom/fill'

/**
 * The regression guard for the bug that silently breaks autofill on every
 * React-based job board: a value assigned directly to the DOM node updates the
 * element but never reaches the framework's state, so the field empties itself
 * on submit. These tests assert the events frameworks listen for are dispatched.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('setNativeValue', () => {
  it('writes the value and fires both input and change', () => {
    const input = document.createElement('input')
    document.body.append(input)

    const seen: string[] = []
    input.addEventListener('input', () => seen.push('input'))
    input.addEventListener('change', () => seen.push('change'))

    setNativeValue(input, 'ada@example.com')

    expect(input.value).toBe('ada@example.com')
    expect(seen).toEqual(['input', 'change'])
  })

  it('fires events that bubble, so delegated listeners hear them', () => {
    const form = document.createElement('form')
    const input = document.createElement('input')
    form.append(input)
    document.body.append(form)

    let bubbled = false
    form.addEventListener('input', () => {
      bubbled = true
    })

    setNativeValue(input, 'x')
    expect(bubbled).toBe(true)
  })

  it('bypasses a value setter that a framework redefined on the instance', () => {
    const input = document.createElement('input')
    document.body.append(input)

    // Stand in for React's instance-level property override, which swallows
    // plain assignment.
    let swallowed = false
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => '',
      set: () => {
        swallowed = true
      },
    })

    setNativeValue(input, 'real value')

    expect(swallowed).toBe(false)
    // Reading through the prototype descriptor shows the value landed.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    expect(descriptor?.get?.call(input)).toBe('real value')
  })

  it('works on textareas as well as inputs', () => {
    const textarea = document.createElement('textarea')
    document.body.append(textarea)

    let fired = false
    textarea.addEventListener('input', () => {
      fired = true
    })

    setNativeValue(textarea, 'a cover letter')
    expect(textarea.value).toBe('a cover letter')
    expect(fired).toBe(true)
  })
})

describe('select handling', () => {
  function makeSelect(options: string[], withPlaceholder = true): HTMLSelectElement {
    const select = document.createElement('select')
    if (withPlaceholder) {
      const placeholder = document.createElement('option')
      placeholder.value = ''
      placeholder.textContent = 'Please select'
      select.append(placeholder)
    }
    for (const label of options) {
      const option = document.createElement('option')
      option.value = label.toLowerCase().replace(/\s+/g, '-')
      option.textContent = label
      select.append(option)
    }
    document.body.append(select)
    return select
  }

  it('lists option labels', () => {
    const select = makeSelect(['0-2', '3-5'], false)
    expect(selectOptions(select)).toEqual(['0-2', '3-5'])
  })

  it('selects by visible label, not by value', () => {
    const select = makeSelect(['United States', 'Germany'])

    expect(fillSelect(select, 'Germany')).toBe(true)
    expect(select.selectedIndex).toBe(2)
    expect(select.value).toBe('germany')
  })

  it('fires change so listeners react to the new selection', () => {
    const select = makeSelect(['Yes', 'No'])
    let fired = false
    select.addEventListener('change', () => {
      fired = true
    })

    fillSelect(select, 'Yes')
    expect(fired).toBe(true)
  })

  it('leaves the select untouched when nothing matches', () => {
    const select = makeSelect(['Red', 'Blue'])
    const before = select.selectedIndex

    expect(fillSelect(select, 'Kubernetes')).toBe(false)
    expect(select.selectedIndex).toBe(before)
  })
})
