import { beforeEach, describe, expect, it } from 'vitest'
import { collectValidationErrors } from '@/content/validation'

/**
 * Reading a form's own complaints back to the user.
 *
 * The point is to replace "the page would not advance" — which blames the
 * extension for something the page already explained in plain words — with
 * the form's actual wording. Attribution is the delicate part: linking an
 * error to the wrong field is worse than leaving it unattributed, so
 * anything short of an explicit `aria-describedby` is treated as a guess.
 */

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('collectValidationErrors', () => {
  it('finds nothing on a clean form', () => {
    document.body.innerHTML = '<form><input id="a" /></form>'
    expect(collectValidationErrors()).toEqual([])
  })

  it('reads an error announced with role=alert', () => {
    document.body.innerHTML = '<div role="alert">Please enter a valid phone number.</div>'

    const [error] = collectValidationErrors()
    expect(error?.message).toBe('Please enter a valid phone number.')
  })

  it('attributes an error to the field that points at it', () => {
    document.body.innerHTML = `
      <label for="phone">Phone number</label>
      <input id="phone" aria-describedby="phone-err" aria-invalid="true" />
      <span id="phone-err" class="field-error">Enter digits only.</span>
    `

    const [error] = collectValidationErrors()
    expect(error?.fieldLabel).toBe('Phone number')
    expect(error?.message).toBe('Enter digits only.')
  })

  it('attributes via aria-errormessage too', () => {
    document.body.innerHTML = `
      <label for="email">Email</label>
      <input id="email" aria-errormessage="email-err" />
      <span id="email-err" role="alert">That address looks wrong.</span>
    `

    expect(collectValidationErrors()[0]?.fieldLabel).toBe('Email')
  })

  it('falls back to the invalid control inside the same wrapper', () => {
    document.body.innerHTML = `
      <div class="form-group">
        <label for="city">City</label>
        <input id="city" aria-invalid="true" />
        <div class="invalid-feedback">This field is required.</div>
      </div>
    `

    expect(collectValidationErrors()[0]?.fieldLabel).toBe('City')
  })

  it('leaves an error unattributed rather than guessing wildly', () => {
    // Nothing links this to a field, and pinning it to the wrong one would
    // send the user to edit something that was never the problem.
    document.body.innerHTML = '<main><div role="alert">Something went wrong.</div></main>'

    expect(collectValidationErrors()[0]?.fieldLabel).toBe('')
  })

  it('ignores an empty error container', () => {
    // Forms routinely render the error node up front and fill it later.
    document.body.innerHTML = '<span class="field-error"></span><span role="alert">   </span>'
    expect(collectValidationErrors()).toEqual([])
  })

  it('ignores a bare required asterisk', () => {
    document.body.innerHTML = '<span class="error">*</span>'
    expect(collectValidationErrors()).toEqual([])
  })

  it('skips a hidden error that is not currently shown', () => {
    document.body.innerHTML = '<div role="alert" style="display:none">Stale error.</div>'
    expect(collectValidationErrors()).toEqual([])
  })

  it('says one thing once, however many times the form repeats it', () => {
    document.body.innerHTML = `
      <div role="alert">This field is required.</div>
      <div role="alert">This field is required.</div>
      <div class="error">This field is required.</div>
    `

    expect(collectValidationErrors()).toHaveLength(1)
  })

  it('keeps the same message when it belongs to different fields', () => {
    document.body.innerHTML = `
      <div class="form-group">
        <label for="a">First name</label><input id="a" aria-invalid="true" />
        <div class="error">This field is required.</div>
      </div>
      <div class="form-group">
        <label for="b">Last name</label><input id="b" aria-invalid="true" />
        <div class="error">This field is required.</div>
      </div>
    `

    const errors = collectValidationErrors()
    expect(errors).toHaveLength(2)
    expect(errors.map((entry) => entry.fieldLabel).sort()).toEqual(['First name', 'Last name'])
  })

  it('finds an error rendered inside a shadow root', () => {
    const host = document.createElement('div')
    document.body.append(host)
    host.attachShadow({ mode: 'open' }).innerHTML =
      '<div role="alert">Select an option.</div>'

    expect(collectValidationErrors()[0]?.message).toBe('Select an option.')
  })

  it('truncates a runaway error rather than carrying a whole page', () => {
    document.body.innerHTML = `<div role="alert">${'x'.repeat(900)}</div>`
    expect(collectValidationErrors()[0]?.message.length).toBeLessThanOrEqual(300)
  })
})
