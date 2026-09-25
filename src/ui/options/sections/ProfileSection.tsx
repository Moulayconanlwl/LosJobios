import { useRef, useState } from 'react'
import type { Profile } from '@/lib/schema'
import { GeminiProvider, hasGeminiPermission } from '@/lib/ai/gemini'
import type { ParsedResume } from '@/lib/ai/provider'
import { heuristicParseResume, mergeParsedResume, preferParsed } from '@/lib/resume-heuristics'
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  ListTextarea,
  Select,
  Textarea,
  Toggle,
} from '../../components/ui'
import type { Draft } from '../../hooks'
import { useSettings } from '../../hooks'
import { extractResumeText } from '../resumeExtract'

/** 2 MB — comfortably above any real resume, and well inside the storage quota. */
const MAX_RESUME_BYTES = 2 * 1024 * 1024

type ParseStatus = 'idle' | 'extracting' | 'parsing' | 'done' | 'error'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.onload = () => {
      const result = String(reader.result)
      // Strip the "data:<mime>;base64," prefix — storage holds raw base64.
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

export function ProfileSection({ draft }: { draft: Draft<Profile> }) {
  const profile = draft.value
  const { data: settings } = useSettings()
  const fileInput = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState('')
  const [extractWarning, setExtractWarning] = useState('')

  const [parseStatus, setParseStatus] = useState<ParseStatus>('idle')
  const [parseError, setParseError] = useState('')
  const [parseFilled, setParseFilled] = useState<string[]>([])
  const [parseSkipped, setParseSkipped] = useState<string[]>([])
  const [usedAi, setUsedAi] = useState(false)

  const [coverLetterPreview, setCoverLetterPreview] = useState('')
  const [coverLetterStatus, setCoverLetterStatus] = useState<'idle' | 'generating' | 'error'>('idle')
  const [coverLetterError, setCoverLetterError] = useState('')

  if (!profile) return null

  /**
   * Parse resume text into structured fields and apply whatever's still empty.
   *
   * Heuristics run unconditionally — they're free and instant. AI runs on top
   * when it's configured, and any field it finds overrides the heuristic guess
   * for that same field (`preferParsed`), since a model reading the whole
   * document is more reliable than a handful of regexes ever will be — the
   * regexes exist so contact info still gets filled for someone who hasn't
   * set up AI at all.
   */
  const parseAndFill = async (text: string) => {
    if (!text.trim()) return

    setParseStatus('parsing')
    setParseError('')
    setUsedAi(false)

    try {
      let parsed: ParsedResume = heuristicParseResume(text)

      if (settings?.ai.apiKey && settings.ai.model && (await hasGeminiPermission())) {
        try {
          const ai = await new GeminiProvider(settings.ai.apiKey, settings.ai.model).parseResume(
            text,
          )
          parsed = preferParsed(parsed, ai)
          setUsedAi(true)
        } catch (err) {
          // The heuristic result is still worth applying even if the AI call
          // failed (rate limit, bad key, offline) — don't throw it away.
          console.warn('[LosJobios] AI resume parse failed, using heuristics only', err)
        }
      }

      const current = draft.value
      if (!current) return

      const { profile: next, filled, skipped } = mergeParsedResume(current, parsed)
      draft.update(next)
      setParseFilled(filled)
      setParseSkipped(skipped)
      setParseStatus('done')
    } catch (err) {
      setParseStatus('error')
      setParseError(err instanceof Error ? err.message : 'Could not parse the resume.')
    }
  }

  const onResumePicked = async (file: File) => {
    setFileError('')
    setExtractWarning('')
    setParseStatus('idle')

    if (file.size > MAX_RESUME_BYTES) {
      setFileError('That file is over 2 MB. Please use a smaller file.')
      return
    }

    let extractedText = ''

    try {
      const dataBase64 = await fileToBase64(file)
      setParseStatus('extracting')

      const { text, warning } = await extractResumeText(file)
      if (warning) setExtractWarning(warning)
      extractedText = text

      draft.update({
        resume: {
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          dataBase64,
          text: text || (profile.resume?.text ?? ''),
          sizeBytes: file.size,
          updatedAt: Date.now(),
        },
      })
    } catch (err) {
      setParseStatus('idle')
      setFileError(err instanceof Error ? err.message : 'Could not read that file.')
      return
    }

    // This is the whole point: upload a CV, walk away with a filled profile.
    if (extractedText) await parseAndFill(extractedText)
    else setParseStatus('idle')
  }

  /**
   * A generic, no-job preview — the real thing is generated fresh per job
   * during a run (see resolveCoverLetter in lib/answers.ts). This just proves
   * the key and template actually produce something worth reading.
   */
  const previewCoverLetter = async () => {
    setCoverLetterStatus('generating')
    setCoverLetterError('')

    try {
      if (!settings?.ai.apiKey || !settings.ai.model || !(await hasGeminiPermission())) {
        throw new Error('Set up a Gemini key under Settings → AI first.')
      }
      const provider = new GeminiProvider(settings.ai.apiKey, settings.ai.model)
      const { text } = await provider.generateCoverLetter({ profile, job: null, jobDescription: '' })
      setCoverLetterPreview(text)
      setCoverLetterStatus('idle')
    } catch (err) {
      setCoverLetterStatus('error')
      setCoverLetterError(err instanceof Error ? err.message : 'Could not generate a preview.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card title="Identity" description="Used to fill the name and contact fields on every form.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            <Input
              value={profile.firstName}
              onChange={(e) => draft.update({ firstName: e.target.value })}
            />
          </Field>
          <Field label="Last name">
            <Input
              value={profile.lastName}
              onChange={(e) => draft.update({ lastName: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={profile.email}
              onChange={(e) => draft.update({ email: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <Field label="Code">
              <Input
                value={profile.phoneCountryCode}
                onChange={(e) => draft.update({ phoneCountryCode: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={profile.phone}
                onChange={(e) => draft.update({ phone: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card title="Location">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Street address" className="sm:col-span-2">
            <Input
              value={profile.addressLine1}
              onChange={(e) => draft.update({ addressLine1: e.target.value })}
            />
          </Field>
          <Field label="City">
            <Input value={profile.city} onChange={(e) => draft.update({ city: e.target.value })} />
          </Field>
          <Field label="State / province">
            <Input value={profile.state} onChange={(e) => draft.update({ state: e.target.value })} />
          </Field>
          <Field label="Postal code">
            <Input
              value={profile.postalCode}
              onChange={(e) => draft.update({ postalCode: e.target.value })}
            />
          </Field>
          <Field label="Country">
            <Input
              value={profile.country}
              onChange={(e) => draft.update({ country: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card title="Links">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="LinkedIn">
            <Input
              value={profile.linkedinUrl}
              placeholder="https://linkedin.com/in/…"
              onChange={(e) => draft.update({ linkedinUrl: e.target.value })}
            />
          </Field>
          <Field label="GitHub">
            <Input
              value={profile.githubUrl}
              onChange={(e) => draft.update({ githubUrl: e.target.value })}
            />
          </Field>
          <Field label="Portfolio">
            <Input
              value={profile.portfolioUrl}
              onChange={(e) => draft.update({ portfolioUrl: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Current role"
        description="Screening questions about seniority and experience are answered from these."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current title">
            <Input
              value={profile.currentTitle}
              onChange={(e) => draft.update({ currentTitle: e.target.value })}
            />
          </Field>
          <Field label="Current company">
            <Input
              value={profile.currentCompany}
              onChange={(e) => draft.update({ currentCompany: e.target.value })}
            />
          </Field>
          <Field label="Years of experience">
            <Input
              type="number"
              min={0}
              max={60}
              value={profile.yearsExperience}
              onChange={(e) => draft.update({ yearsExperience: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Notice period (weeks)" hint="0 means available immediately.">
            <Input
              type="number"
              min={0}
              max={52}
              value={profile.noticePeriodWeeks}
              onChange={(e) => draft.update({ noticePeriodWeeks: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Desired salary" hint="Whatever format you'd type into a form.">
            <Input
              value={profile.desiredSalary}
              placeholder="e.g. 120000"
              onChange={(e) => draft.update({ desiredSalary: e.target.value })}
            />
          </Field>
          <Field label="Currency">
            <Input
              value={profile.salaryCurrency}
              onChange={(e) => draft.update({ salaryCurrency: e.target.value })}
            />
          </Field>
          <Field label="Headline" className="sm:col-span-2">
            <Input
              value={profile.headline}
              placeholder="Senior Backend Engineer — distributed systems"
              onChange={(e) => draft.update({ headline: e.target.value })}
            />
          </Field>
          <Field
            label="Summary"
            className="sm:col-span-2"
            hint="Free-text questions are answered using this as context."
          >
            <Textarea
              rows={4}
              value={profile.summary}
              onChange={(e) => draft.update({ summary: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card title="Work preferences">
        <div className="flex flex-col gap-4">
          <Toggle
            checked={profile.workAuthorized}
            label="Authorized to work in your target country"
            onChange={(v) => draft.update({ workAuthorized: v })}
          />
          <Toggle
            checked={profile.requiresSponsorship}
            label="Will require visa sponsorship"
            onChange={(v) => draft.update({ requiresSponsorship: v })}
          />
          <Toggle
            checked={profile.willingToRelocate}
            label="Willing to relocate"
            onChange={(v) => draft.update({ willingToRelocate: v })}
          />
          <Field label="Remote preference" className="max-w-xs">
            <Select
              value={profile.remotePreference}
              onChange={(e) =>
                draft.update({ remotePreference: e.target.value as Profile['remotePreference'] })
              }
            >
              <option value="any">No preference</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card
        title="Skills &amp; languages"
        description="Comma separated. Used to answer questions about specific technologies."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Skills">
            <ListTextarea
              rows={3}
              separator=", "
              value={profile.skills}
              placeholder="Python, Kubernetes, PostgreSQL"
              onChange={(next) => draft.update({ skills: next })}
            />
          </Field>
          <Field label="Languages">
            <ListTextarea
              rows={3}
              separator=", "
              value={profile.languages}
              placeholder="English, Spanish"
              onChange={(next) => draft.update({ languages: next })}
            />
          </Field>
        </div>
      </Card>

      <Card
        title="Resume"
        description="Upload a PDF, DOCX or text CV and the rest of this page fills itself in."
      >
        <div className="flex flex-col gap-3">
          {profile.resume?.fileName ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{profile.resume.fileName}</p>
                <p className="text-xs text-zinc-500">
                  {(profile.resume.sizeBytes / 1024).toFixed(0)} KB
                </p>
              </div>
              <Button size="sm" variant="danger" onClick={() => draft.update({ resume: null })}>
                Remove
              </Button>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No resume uploaded yet.</p>
          )}

          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.doc,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onResumePicked(file)
              e.target.value = ''
            }}
          />
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            {profile.resume?.fileName ? 'Replace file' : 'Upload resume'}
          </Button>

          {fileError ? <Banner tone="error">{fileError}</Banner> : null}
          {extractWarning ? <Banner tone="warn">{extractWarning}</Banner> : null}

          {parseStatus === 'extracting' && (
            <Banner tone="info">Reading your resume…</Banner>
          )}
          {parseStatus === 'parsing' && (
            <Banner tone="info">
              {usedAi ? 'Extracting your details…' : 'Scanning for contact details…'}
            </Banner>
          )}
          {parseStatus === 'error' && <Banner tone="error">{parseError}</Banner>}
          {parseStatus === 'done' && (
            <Banner tone="success">
              {parseFilled.length ? (
                <>
                  Filled in: {parseFilled.join(', ')}.{' '}
                  {parseSkipped.length ? `Already set, left alone: ${parseSkipped.join(', ')}.` : null}
                </>
              ) : (
                'Nothing new to fill — every field this found was already set.'
              )}
              {!usedAi && (
                <>
                  {' '}
                  Set up a free key under <strong>Settings → AI</strong> to also pull out your work
                  history and education automatically.
                </>
              )}
            </Banner>
          )}

          <Field
            label="Resume text"
            hint="Filled in automatically from an upload, or paste your own. Used both as AI context and as the source for “Parse resume”."
          >
            <Textarea
              rows={6}
              value={profile.resume?.text ?? ''}
              placeholder="Paste the text of your resume here…"
              onChange={(e) => {
                const existing = profile.resume
                draft.update({
                  resume: existing
                    ? { ...existing, text: e.target.value }
                    : {
                        fileName: '',
                        mimeType: '',
                        dataBase64: '',
                        text: e.target.value,
                        sizeBytes: 0,
                        updatedAt: Date.now(),
                      },
                })
              }}
            />
          </Field>

          <Button
            variant="secondary"
            disabled={!profile.resume?.text || parseStatus === 'extracting' || parseStatus === 'parsing'}
            onClick={() => void parseAndFill(profile.resume?.text ?? '')}
          >
            Parse resume &amp; fill profile
          </Button>
        </div>
      </Card>

      <Card
        title="Cover letter"
        description="A fresh letter is written for each job from your profile and the posting — this isn't a script, it's optional guidance for that generator."
      >
        <div className="flex flex-col gap-3">
          <Field
            label="Style reference (optional)"
            hint="Paste a cover letter whose tone and structure you like. Used as a reference, not copied verbatim — and as the fallback answer if AI isn't configured."
          >
            <Textarea
              rows={6}
              value={profile.coverLetterTemplate}
              placeholder="Paste an example cover letter here…"
              onChange={(e) => draft.update({ coverLetterTemplate: e.target.value })}
            />
          </Field>

          <Button
            variant="secondary"
            disabled={coverLetterStatus === 'generating'}
            onClick={() => void previewCoverLetter()}
          >
            {coverLetterStatus === 'generating' ? 'Generating…' : 'Preview an AI-generated letter'}
          </Button>

          {coverLetterStatus === 'error' && <Banner tone="error">{coverLetterError}</Banner>}

          {coverLetterPreview ? (
            <div className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              {coverLetterPreview}
            </div>
          ) : null}
        </div>
      </Card>

      <Card
        title="Voluntary disclosures"
        description="US employers ask these for EEO reporting. They default to declining, and are only used if a form asks."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gender">
            <Input
              value={profile.voluntaryDisclosure.gender}
              onChange={(e) =>
                draft.update({
                  voluntaryDisclosure: {
                    ...profile.voluntaryDisclosure,
                    gender: e.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label="Ethnicity">
            <Input
              value={profile.voluntaryDisclosure.ethnicity}
              onChange={(e) =>
                draft.update({
                  voluntaryDisclosure: {
                    ...profile.voluntaryDisclosure,
                    ethnicity: e.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label="Veteran status">
            <Input
              value={profile.voluntaryDisclosure.veteranStatus}
              onChange={(e) =>
                draft.update({
                  voluntaryDisclosure: {
                    ...profile.voluntaryDisclosure,
                    veteranStatus: e.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label="Disability status">
            <Input
              value={profile.voluntaryDisclosure.disabilityStatus}
              onChange={(e) =>
                draft.update({
                  voluntaryDisclosure: {
                    ...profile.voluntaryDisclosure,
                    disabilityStatus: e.target.value,
                  },
                })
              }
            />
          </Field>
        </div>
      </Card>
    </div>
  )
}
