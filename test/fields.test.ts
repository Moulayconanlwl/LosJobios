import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { collectFields } from '@/content/fields'

/**
 * End-to-end field detection against the fixture page, which reproduces the
 * label-attachment patterns real career sites use. If this passes, the
 * classifier is reading a realistic form correctly rather than a tidy one.
 */

const FIXTURE = readFileSync(
  resolve(__dirname, 'fixtures', 'career-form.html'),
  'utf8',
)

beforeEach(() => {
  document.documentElement.innerHTML = FIXTURE
})

function find(label: string) {
  return collectFields(document).find((f) => f.label.toLowerCase().includes(label.toLowerCase()))
}

describe('collectFields', () => {
  it('finds every fillable control on the page', () => {
    const fields = collectFields(document)
    expect(fields.length).toBeGreaterThanOrEqual(10)
  })

  it('reads a label attached via for/id', () => {
    expect(find('first name')?.key).toBe('firstName')
  })

  it('reads a label that wraps its input', () => {
    expect(find('last name')?.key).toBe('lastName')
  })

  it('falls back to the autocomplete attribute when the label is missing', () => {
    const email = collectFields(document).find((f) => f.key === 'email')
    expect(email).toBeDefined()
    expect(email?.kind).toBe('email')
  })

  it('reads an aria-label', () => {
    expect(find('phone number')?.key).toBe('phone')
  })

  it('collapses a radio group into one field carrying the legend as its question', () => {
    const sponsorship = collectFields(document).find((f) => f.key === 'requiresSponsorship')

    expect(sponsorship).toBeDefined()
    expect(sponsorship?.kind).toBe('radio')
    expect(sponsorship?.label).toContain('sponsorship')
    // One entry for the group, not one per radio.
    expect(sponsorship?.group).toHaveLength(2)
    expect(sponsorship?.options).toEqual(['Yes', 'No'])
  })

  it('detects both radio groups separately', () => {
    const keys = collectFields(document).map((f) => f.key)
    expect(keys).toContain('requiresSponsorship')
    expect(keys).toContain('workAuthorized')
  })

  it('marks a field required when only an asterisk span says so', () => {
    expect(find('first name')?.required).toBe(true)
  })

  it('reads select options, skipping the placeholder', () => {
    const years = collectFields(document).find((f) => f.key === 'yearsExperience')
    expect(years?.kind).toBe('select')
    expect(years?.options).toEqual(['0-2', '3-5', '6-10', '10+'])
  })

  it('identifies the resume file input', () => {
    const resume = collectFields(document).find((f) => f.kind === 'file')
    expect(resume?.key).toBe('resume')
  })

  it('identifies the cover letter textarea', () => {
    expect(find('cover letter')?.kind).toBe('textarea')
  })

  it('treats an ARIA combobox as a select and reads its listbox options', () => {
    const country = collectFields(document).find((f) => f.key === 'country')
    expect(country?.kind).toBe('select')
    expect(country?.options).toEqual(['United States', 'United Kingdom', 'Germany'])
  })

  it('ignores the submit button', () => {
    const labels = collectFields(document).map((f) => f.label.toLowerCase())
    expect(labels).not.toContain('submit application')
  })
})
