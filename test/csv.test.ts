import { describe, expect, it } from 'vitest'
import { toCsv } from '@/ui/dashboard/csv'
import type { Application } from '@/lib/schema'

function app(patch: Partial<Application> = {}): Application {
  return {
    id: 'a1',
    externalId: '123',
    title: 'Platform Engineer',
    company: 'Acme',
    location: 'Remote',
    url: 'https://example.com/job/123',
    source: 'linkedin',
    status: 'applied',
    appliedAt: Date.UTC(2026, 0, 15, 12, 0, 0),
    updatedAt: Date.UTC(2026, 0, 15, 12, 0, 0),
    dryRun: false,
    questionsAnswered: 3,
    aiAnswersUsed: 1,
    notes: '',
    ...patch,
  }
}

describe('toCsv', () => {
  it('emits a header row plus one row per application', () => {
    const lines = toCsv([app(), app({ id: 'a2' })]).split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Title')
  })

  it('quotes fields containing a comma', () => {
    // Real titles do this constantly: "Engineer, Platform".
    const csv = toCsv([app({ title: 'Engineer, Platform' })])
    expect(csv).toContain('"Engineer, Platform"')
  })

  it('doubles embedded quotes', () => {
    const csv = toCsv([app({ company: 'The "Best" Co' })])
    expect(csv).toContain('"The ""Best"" Co"')
  })

  it('quotes fields containing newlines so the row stays intact', () => {
    const csv = toCsv([app({ notes: 'line one\nline two' })])
    expect(csv).toContain('"line one\nline two"')
    // Header + one record — the embedded newline must not split the row.
    expect(csv.split('\r\n')).toHaveLength(2)
  })

  it('leaves ordinary fields unquoted', () => {
    expect(toCsv([app()])).toContain('Platform Engineer')
    expect(toCsv([app()])).not.toContain('"Platform Engineer"')
  })

  it('renders the dry-run flag as a readable yes/no', () => {
    expect(toCsv([app({ dryRun: true })])).toContain(',yes,')
    expect(toCsv([app({ dryRun: false })])).toContain(',no,')
  })

  it('handles an empty list by emitting just the header', () => {
    expect(toCsv([]).split('\r\n')).toHaveLength(1)
  })
})
