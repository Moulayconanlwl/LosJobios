import { z } from 'zod'
import {
  SCHEMA_VERSION,
  answerEntrySchema,
  applicationSchema,
  profileSchema,
  savedJobSchema,
  settingsSchema,
} from './schema'
import {
  getAnswers,
  getApplications,
  getProfile,
  getSavedJobs,
  getSettings,
  replaceAnswers,
  replaceApplications,
  replaceSavedJobs,
  setProfile,
  patchSettings,
} from './storage'

/**
 * Backup and restore, because uninstalling wipes everything.
 *
 * Chrome deletes an extension's entire storage when it's removed —
 * `chrome.storage`, IndexedDB, all of it. That's a platform guarantee, so no
 * database *inside* the extension can outlive an uninstall, however it's
 * built. A file on disk is the only thing that can, which is what this
 * writes: one JSON document holding everything the extension knows, and a
 * restore that validates every record on the way back in.
 *
 * Reloading or updating the extension does *not* lose anything — storage
 * survives both. This is for uninstalls, moving to another machine, and
 * being able to undo a bad run.
 */

export const BACKUP_FORMAT = 1

export const backupSchema = z.object({
  app: z.literal('losjobios'),
  /** This file's own format version, independent of the data schema. */
  format: z.number(),
  schemaVersion: z.number().default(0),
  exportedAt: z.number().default(0),
  profile: profileSchema.optional(),
  settings: settingsSchema.optional(),
  applications: z.array(applicationSchema).default([]),
  answers: z.array(answerEntrySchema).default([]),
  savedJobs: z.array(savedJobSchema).default([]),
})

export type Backup = z.infer<typeof backupSchema>

export type RestoreMode = 'merge' | 'replace'

export type RestoreReport = {
  applications: number
  savedJobs: number
  answers: number
  profile: boolean
  settings: boolean
}

export async function createBackup(): Promise<Backup> {
  const [profile, settings, applications, answers, savedJobs] = await Promise.all([
    getProfile(),
    getSettings(),
    getApplications(),
    getAnswers(),
    getSavedJobs(),
  ])

  return {
    app: 'losjobios',
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    profile,
    settings,
    applications,
    answers,
    savedJobs,
  }
}

export function backupFileName(at = new Date()): string {
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `losjobios-backup-${stamp}.json`
}

/**
 * Parse a backup file, rejecting anything that isn't one.
 *
 * Deliberately strict about `app` and `format`: importing arbitrary JSON
 * would overwrite a real profile with nonsense, and "it looked like an
 * object" is not good enough for something this destructive.
 */
export function parseBackup(raw: unknown): Backup {
  const result = backupSchema.safeParse(raw)

  if (!result.success) {
    throw new Error(
      'That file is not a LosJobios backup, or it is from a newer version of the extension.',
    )
  }
  if (result.data.format > BACKUP_FORMAT) {
    throw new Error(
      `That backup was written by a newer version (format ${result.data.format}). Update the extension first.`,
    )
  }

  return result.data
}

/** Union two lists on a key, keeping whichever entry is already stored. */
function mergeOn<T>(current: T[], incoming: T[], key: (item: T) => string): T[] {
  const seen = new Set(current.map(key))
  const added = incoming.filter((item) => {
    const id = key(item)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
  return [...current, ...added]
}

/**
 * Put a backup back.
 *
 * `merge` is the safe default: it adds records this machine doesn't have and
 * leaves the profile and settings alone, so importing an old file can't
 * quietly revert the profile you've since improved. `replace` is the "this
 * machine is the wrong one" option and overwrites all five.
 */
export async function restoreBackup(backup: Backup, mode: RestoreMode): Promise<RestoreReport> {
  const report: RestoreReport = {
    applications: 0,
    savedJobs: 0,
    answers: 0,
    profile: false,
    settings: false,
  }

  if (mode === 'replace') {
    if (backup.profile) {
      await setProfile(backup.profile)
      report.profile = true
    }
    if (backup.settings) {
      await patchSettings(backup.settings)
      report.settings = true
    }

    await replaceApplications(backup.applications)
    await replaceSavedJobs(backup.savedJobs)
    await replaceAnswers(backup.answers)

    report.applications = backup.applications.length
    report.savedJobs = backup.savedJobs.length
    report.answers = backup.answers.length
    return report
  }

  const [applications, savedJobs, answers] = await Promise.all([
    getApplications(),
    getSavedJobs(),
    getAnswers(),
  ])

  // An application is the same application when it's the same posting on the
  // same site; the id is per-machine and would never collide across two.
  const mergedApplications = mergeOn(
    applications,
    backup.applications,
    (app) => `${app.source}:${app.externalId || app.id}`,
  )
  const mergedJobs = mergeOn(
    savedJobs,
    backup.savedJobs,
    (job) => `${job.source}:${job.externalId || job.url || job.id}`,
  )
  const mergedAnswers = mergeOn(answers, backup.answers, (entry) => `${entry.kind}:${entry.normalized}`)

  await replaceApplications(mergedApplications)
  await replaceSavedJobs(mergedJobs)
  await replaceAnswers(mergedAnswers)

  report.applications = mergedApplications.length - applications.length
  report.savedJobs = mergedJobs.length - savedJobs.length
  report.answers = mergedAnswers.length - answers.length
  return report
}
