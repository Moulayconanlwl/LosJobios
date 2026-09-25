import { useRef, useState } from 'react'
import {
  DEFAULT_COVER_LETTER_TEMPLATE,
  DEFAULT_RESUME_TEMPLATE,
} from '@/lib/latex'
import { backupFileName, createBackup, parseBackup, restoreBackup, type RestoreMode } from '@/lib/backup'
import type { Settings } from '@/lib/schema'
import { Banner, Button, Card, Field, Textarea } from '../../components/ui'
import { DownloadIcon } from '../../components/icons'
import type { Draft } from '../../hooks'
import { useApplications, useSavedJobs } from '../../hooks'

/**
 * Backup, restore, and the LaTeX documents materials are rendered into.
 *
 * These live together because they're the two ways your data leaves the
 * extension — one as a file you can put back, the other as a document you
 * can hand to an employer.
 */

function save(name: string, body: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([body], { type: `${type};charset=utf-8` }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function BackupSection({ draft }: { draft: Draft<Settings> }) {
  const settings = draft.value
  const { data: applications } = useApplications()
  const { data: jobs } = useSavedJobs()

  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<RestoreMode>('merge')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const exportAll = async () => {
    setNote('')
    setError('')
    try {
      const backup = await createBackup()
      save(backupFileName(), JSON.stringify(backup, null, 2))
      setNote(
        `Exported ${backup.applications.length} applications, ${backup.savedJobs.length} saved jobs and ${backup.answers.length} answers.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write the backup.')
    }
  }

  const importFile = async (file: File) => {
    setNote('')
    setError('')
    try {
      const backup = parseBackup(JSON.parse(await file.text()))
      const report = await restoreBackup(backup, mode)

      setNote(
        mode === 'replace'
          ? `Replaced everything: ${report.applications} applications, ${report.savedJobs} jobs, ${report.answers} answers.`
          : `Added ${report.applications} applications, ${report.savedJobs} jobs and ${report.answers} answers. Profile and settings left as they were.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.')
    }
  }

  if (!settings) return null

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Backup"
        description="Everything lives in this browser. A backup is the only copy that survives the extension being removed."
      >
        <Banner tone="warn">
          <strong>Reloading or updating the extension keeps your data</strong> — that much is safe.
          But Chrome erases everything an extension stored when you <em>remove</em> it, and no
          database inside the extension can survive that. Export before you uninstall, reinstall,
          or move to another machine.
        </Banner>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => void exportAll()}>
              <DownloadIcon className="h-4 w-4" />
              Export everything
            </Button>
            <span className="text-xs text-zinc-500">
              {applications.length} applications · {jobs.length} saved jobs
            </span>
          </div>

          <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <p className="mb-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Restore from a backup
            </p>

            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded"
                  checked={mode === 'merge'}
                  onChange={(e) => setMode(e.target.checked ? 'merge' : 'replace')}
                />
                <span>
                  <strong>Merge</strong> — add what this machine doesn&rsquo;t have and leave your
                  profile and settings alone. Untick to <strong>replace everything</strong>,
                  including your profile.
                </span>
              </label>

              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void importFile(file)
                  e.target.value = ''
                }}
              />
              <Button variant="secondary" className="self-start" onClick={() => fileInput.current?.click()}>
                Choose a backup file
              </Button>
            </div>
          </div>

          {note ? <Banner tone="success">{note}</Banner> : null}
          {error ? <Banner tone="error">{error}</Banner> : null}
        </div>
      </Card>

      <Card
        title="LaTeX templates"
        description="Your tailored CV and cover letters are rendered into these. Leave one empty to use the built-in default."
      >
        <Banner tone="info">
          Slots are written <code>{'{{NAME}}'}</code> and are filled in for you. The CV takes{' '}
          <code>{'{{NAME}}'}</code>, <code>{'{{CONTACT}}'}</code>, <code>{'{{SUMMARY}}'}</code>,{' '}
          <code>{'{{SKILLS}}'}</code>, <code>{'{{EXPERIENCE}}'}</code> and{' '}
          <code>{'{{EDUCATION}}'}</code>. The letter takes <code>{'{{NAME}}'}</code>,{' '}
          <code>{'{{CONTACT}}'}</code>, <code>{'{{COMPANY}}'}</code>, <code>{'{{ROLE}}'}</code>,{' '}
          <code>{'{{DATE}}'}</code> and <code>{'{{BODY}}'}</code>. Everything substituted in is
          LaTeX-escaped, so a company called &ldquo;Smith &amp; Co&rdquo; won&rsquo;t break the
          build.
        </Banner>

        <div className="mt-4 flex flex-col gap-4">
          <Field
            label="CV template (.tex)"
            hint="Paste your own document and mark where each part goes."
          >
            <Textarea
              rows={10}
              className="font-mono text-xs"
              placeholder={DEFAULT_RESUME_TEMPLATE}
              value={settings.latex.resume}
              onChange={(e) => draft.update({ latex: { ...settings.latex, resume: e.target.value } })}
            />
          </Field>

          <Field label="Cover letter template (.tex)">
            <Textarea
              rows={8}
              className="font-mono text-xs"
              placeholder={DEFAULT_COVER_LETTER_TEMPLATE}
              value={settings.latex.coverLetter}
              onChange={(e) =>
                draft.update({ latex: { ...settings.latex, coverLetter: e.target.value } })
              }
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => save('losjobios-cv-template.tex', DEFAULT_RESUME_TEMPLATE, 'text/plain')}
            >
              Download the default CV template
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                save('losjobios-letter-template.tex', DEFAULT_COVER_LETTER_TEMPLATE, 'text/plain')
              }
            >
              Download the default letter template
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
