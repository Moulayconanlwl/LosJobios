import { beforeEach, describe, expect, it } from 'vitest'
import { deepQueryAll, isDisplayed, isVisible, pick, pickAll } from '@/content/dom/query'
import { collectFields } from '@/content/fields'

/**
 * Finding form fields that a plain `querySelectorAll` cannot see.
 *
 * `querySelectorAll` stops dead at a shadow boundary. Modern applicant
 * tracking systems build their inputs as web components, so to a naive
 * content script those forms look like a page with nothing on it — the
 * extension reports "0 fields" and appears broken on exactly the sites where
 * autofill is worth the most.
 *
 * The walk is deliberately conservative, and the negative tests matter as
 * much as the positive ones: a *closed* shadow root stays closed, and a
 * cross-origin frame is skipped rather than prised open.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

/** A web-component-style field, the way Workday and Ashby build them. */
function mountShadowForm(mode: 'open' | 'closed' = 'open') {
  const host = document.createElement('div')
  host.id = 'host'
  document.body.append(host)

  const shadow = host.attachShadow({ mode })
  shadow.innerHTML = `
    <label for="email">Email address</label>
    <input id="email" type="email" />
  `
  return shadow
}

describe('deepQueryAll', () => {
  it('finds what a plain query finds', () => {
    document.body.innerHTML = '<input id="a" /><input id="b" />'
    expect(deepQueryAll('input')).toHaveLength(2)
  })

  it('finds an input inside an open shadow root', () => {
    mountShadowForm('open')

    // The whole point: this is the query that used to come back empty.
    expect(document.querySelectorAll('input')).toHaveLength(0)
    expect(deepQueryAll('input')).toHaveLength(1)
  })

  it('leaves a closed shadow root closed', () => {
    mountShadowForm('closed')

    // Not reachable without forcing it, and forcing it is not this walker's
    // business — the page closed that root on purpose.
    expect(deepQueryAll('input')).toHaveLength(0)
  })

  it('descends nested shadow roots', () => {
    const outer = document.createElement('div')
    document.body.append(outer)
    const outerShadow = outer.attachShadow({ mode: 'open' })

    const inner = document.createElement('div')
    outerShadow.append(inner)
    const innerShadow = inner.attachShadow({ mode: 'open' })
    innerShadow.innerHTML = '<input id="deep" />'

    expect(deepQueryAll('input')).toHaveLength(1)
  })

  it('finds fields in both the light and shadow trees at once', () => {
    document.body.innerHTML = '<input id="light" />'
    mountShadowForm('open')

    expect(deepQueryAll('input')).toHaveLength(2)
  })

  it('never returns the same element twice', () => {
    document.body.innerHTML = '<input id="a" />'
    const found = deepQueryAll('input, #a')
    expect(found).toHaveLength(1)
  })

  it('survives a malformed selector instead of throwing', () => {
    document.body.innerHTML = '<input />'
    expect(() => deepQueryAll(':::nonsense')).not.toThrow()
  })

  it('returns nothing for a page with no match', () => {
    document.body.innerHTML = '<p>no form here</p>'
    expect(deepQueryAll('input')).toEqual([])
  })
})

describe('pick and pickAll see through shadow roots', () => {
  it('pickAll collects a shadow field', () => {
    mountShadowForm('open')
    expect(pickAll(['input'], document, isDisplayed)).toHaveLength(1)
  })

  it('pick returns a shadow field', () => {
    mountShadowForm('open')
    expect(pick(['input'], document, isDisplayed)).not.toBeNull()
  })
})

describe('collectFields', () => {
  it('detects a field rendered into a shadow root', () => {
    mountShadowForm('open')

    const fields = collectFields(document)
    expect(fields).toHaveLength(1)
    expect(fields[0]?.kind).toBe('email')
  })

  it('reads the label that lives inside the same shadow root', () => {
    mountShadowForm('open')

    // The label is in the shadow tree too, so an accessible-name lookup that
    // only consults the main document would come back blank.
    const [field] = collectFields(document)
    expect(field?.label).toContain('Email')
  })
})

describe('isVisible', () => {
  /**
   * `isVisible` guards every *click*, so getting it wrong in the strict
   * direction means nothing on the page is ever clickable — the apply button
   * is found, rejected as invisible, and the run reports "no apply button" on
   * a posting that plainly has one.
   */
  function box(el: HTMLElement, width: number, height: number): void {
    el.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect
  }

  it('treats an unresolved opacity as visible, not as transparent', () => {
    // `Number('')` is 0, so reading opacity with `Number` classifies an
    // engine that hasn't resolved it as fully transparent. "I don't know"
    // must never mean "hidden".
    document.body.innerHTML = '<button id="b">Apply now</button>'
    const button = document.getElementById('b') as HTMLElement
    box(button, 120, 32)

    expect(isVisible(button)).toBe(true)
  })

  it('still rejects something explicitly transparent', () => {
    document.body.innerHTML = '<button id="b" style="opacity:0">Apply now</button>'
    const button = document.getElementById('b') as HTMLElement
    box(button, 120, 32)

    expect(isVisible(button)).toBe(false)
  })

  it('still rejects a zero-size target, which a click would miss', () => {
    document.body.innerHTML = '<button id="b">Apply now</button>'
    const button = document.getElementById('b') as HTMLElement
    box(button, 0, 0)

    expect(isVisible(button)).toBe(false)
  })
})
