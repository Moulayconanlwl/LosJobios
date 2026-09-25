import type { Profile, SavedJob } from './schema'
import type { RenderedResume } from './tailored-resume'

/**
 * Rendering a CV and a cover letter as LaTeX.
 *
 * Templates are plain `.tex` with `{{PLACEHOLDER}}` slots, kept in settings
 * so your own document can be pasted in and used verbatim — the defaults
 * below are only a starting point.
 *
 * Everything substituted into a slot is escaped first. That isn't
 * decoration: a company called "Smith & Co" or a bullet mentioning "100%
 * uptime" silently breaks a LaTeX build, and the error it produces points at
 * the template rather than the data, which is a miserable thing to debug.
 */

const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  // Accents, which would otherwise absorb the character after them.
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
}

/**
 * Escape text for LaTeX, in a single pass.
 *
 * Single pass is the whole point, not an optimisation. Chained `.replace`
 * calls re-scan what the previous ones wrote: escaping `\` produces
 * `\textbackslash{}`, and a later pass over `{` and `}` then escapes the
 * braces that escaping just introduced, yielding
 * `\textbackslash\{\}` — which renders as literal text instead of a
 * backslash. One regex, one lookup, nothing re-read.
 */
export function escapeLatex(value: string): string {
  return value.replace(/[\\&%$#_{}~^]/g, (char) => LATEX_ESCAPES[char] ?? char)
}

/** Escape, then turn blank lines into paragraph breaks. */
export function escapeParagraphs(value: string): string {
  return value
    .split(/\n\s*\n/)
    .map((paragraph) => escapeLatex(paragraph.trim()).replace(/\n/g, ' '))
    .filter(Boolean)
    .join('\n\n')
}

/** Fill `{{SLOT}}` placeholders. Unknown slots are left alone, not blanked. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) =>
    key in values ? (values[key] ?? '') : match,
  )
}

export const DEFAULT_RESUME_TEMPLATE = String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[margin=1.9cm]{geometry}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{titlesec}

\titleformat{\section}{\large\bfseries}{}{0pt}{}[\vspace{-0.6em}\rule{\linewidth}{0.4pt}]
\titlespacing{\section}{0pt}{1.1em}{0.6em}
\setlist[itemize]{leftmargin=1.2em,itemsep=0.15em,topsep=0.2em}
\pagestyle{empty}

\begin{document}

\begin{center}
  {\LARGE\bfseries {{NAME}}}\\[0.35em]
  {\small {{CONTACT}}}
\end{center}

\section{Summary}
{{SUMMARY}}

\section{Skills}
{{SKILLS}}

\section{Experience}
{{EXPERIENCE}}

\section{Education}
{{EDUCATION}}

\end{document}
`

export const DEFAULT_COVER_LETTER_TEMPLATE = String.raw`\documentclass[11pt,a4paper]{letter}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[margin=2.2cm]{geometry}
\usepackage[hidelinks]{hyperref}

\signature{ {{NAME}} }
\address{ {{NAME}} \\ {{CONTACT}} }
\pagestyle{empty}

\begin{document}
\begin{letter}{ {{COMPANY}} }

\opening{Dear Hiring Team,}

{{BODY}}

\closing{Sincerely,}

\end{letter}
\end{document}
`

function itemize(lines: string[]): string {
  if (!lines.length) return ''
  const items = lines.map((line) => `  \\item ${escapeLatex(line)}`).join('\n')
  return `\\begin{itemize}\n${items}\n\\end{itemize}`
}

/** The experience block: one subsection-ish heading per role, then bullets. */
function experienceBlock(resume: RenderedResume): string {
  return resume.roles
    .map((role) => {
      const heading = [role.title, role.company].filter(Boolean).map(escapeLatex).join(' --- ')
      const meta = [role.location, role.dates].filter(Boolean).map(escapeLatex).join(' \\textbar{} ')

      return [
        `\\textbf{${heading}}${meta ? ` \\hfill {\\small ${meta}}` : ''}`,
        '',
        itemize(role.bullets),
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n\\vspace{0.6em}\n\n')
}

export function resumeToLatex(resume: RenderedResume, template = DEFAULT_RESUME_TEMPLATE): string {
  return fillTemplate(template, {
    NAME: escapeLatex(resume.name || 'Your Name'),
    CONTACT: resume.contact.map(escapeLatex).join(' \\textbar{} '),
    SUMMARY: escapeParagraphs(resume.summary),
    SKILLS: resume.skills.map(escapeLatex).join(', '),
    EXPERIENCE: experienceBlock(resume),
    EDUCATION: itemize(resume.education),
  })
}

export function coverLetterToLatex(
  profile: Profile,
  job: Pick<SavedJob, 'title' | 'company'>,
  body: string,
  template = DEFAULT_COVER_LETTER_TEMPLATE,
): string {
  const name = `${profile.firstName} ${profile.lastName}`.trim()
  const contact = [profile.email, profile.phone, profile.city].filter(Boolean)

  return fillTemplate(template, {
    NAME: escapeLatex(name || 'Your Name'),
    CONTACT: contact.map(escapeLatex).join(' \\textbar{} '),
    COMPANY: escapeLatex(job.company || 'Hiring Team'),
    ROLE: escapeLatex(job.title || ''),
    DATE: escapeLatex(new Date().toLocaleDateString('en-GB', { dateStyle: 'long' })),
    BODY: escapeParagraphs(body),
  })
}

/** A filename-safe slug, for naming the downloaded .tex. */
export function slug(value: string, fallback = 'role'): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || fallback
}
