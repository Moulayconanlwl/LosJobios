import type { Application } from '@/lib/schema'

/**
 * CSV export.
 *
 * Quoting matters more than it looks: job titles routinely contain commas
 * ("Engineer, Platform") and company blurbs contain quotes. A field is wrapped
 * whenever it holds a comma, quote or newline, and inner quotes are doubled,
 * per RFC 4180 — that's what Excel and Sheets expect.
 */

const COLUMNS = [
  'Applied at',
  'Title',
  'Company',
  'Location',
  'Status',
  'Source',
  'Dry run',
  'Questions answered',
  'AI answers',
  'URL',
  'Notes',
] as const

function escapeCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

function row(app: Application): string {
  return [
    new Date(app.appliedAt).toISOString(),
    app.title,
    app.company,
    app.location,
    app.status,
    app.source,
    app.dryRun ? 'yes' : 'no',
    String(app.questionsAnswered),
    String(app.aiAnswersUsed),
    app.url,
    app.notes,
  ]
    .map(escapeCell)
    .join(',')
}

export function toCsv(applications: Application[]): string {
  return [COLUMNS.join(','), ...applications.map(row)].join('\r\n')
}

export function downloadCsv(applications: Application[]): void {
  // A leading BOM makes Excel read this as UTF-8 rather than mangling accents.
  const blob = new Blob(['﻿', toCsv(applications)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `losjobios-applications-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.append(link)
  link.click()
  link.remove()

  URL.revokeObjectURL(url)
}
