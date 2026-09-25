import type { Profile, SavedJob } from './schema'
import type { RenderedResume } from './tailored-resume'

/**
 * Rendering a CV and a cover letter as LaTeX.
 *
 * The defaults below deliberately mirror one real document — dark blue rules
 * under each section, a fontawesome contact line, and the four-argument
 * `\entry` command for a heading with its dates on the right — so the two
 * generated documents look like they came from the same hand as the CV they
 * sit beside. Both are overridable: templates live in settings, and anything
 * substituted into a `{{SLOT}}` is escaped first.
 *
 * Escaping isn't decoration. A company called "Smith & Co", a bullet about
 * "99.9% uptime" or a skill called "C#" each break a LaTeX build, and the
 * error points at the template rather than the data that caused it.
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
 * braces that escaping just introduced, yielding `\textbackslash\{\}` —
 * which renders as literal text instead of a backslash.
 */
export function escapeLatex(value: string): string {
  return value.replace(/[\\&%$#_{}~^]/g, (char) => LATEX_ESCAPES[char] ?? char)
}

/**
 * Escape a URL for the first argument of `\href`.
 *
 * Deliberately lighter than `escapeLatex`: hyperref takes that argument
 * almost verbatim, and escaping an underscore there would corrupt the link.
 * Only `%` and `#` genuinely have to go, since TeX would read them as a
 * comment and a parameter marker before hyperref ever saw them.
 */
export function escapeLatexUrl(value: string): string {
  return value.replace(/[%#]/g, (char) => `\\${char}`)
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

function link(url: string, label: string): string {
  return `\\href{${escapeLatexUrl(url)}}{${escapeLatex(label)}}`
}

/** Strip the scheme so a printed link reads as a handle, not a URL. */
function tidyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

/** The single-line, icon-prefixed contact row the CV header uses. */
export function contactLine(profile: Profile): string {
  const parts: string[] = []
  const where = [profile.city, profile.country].map((s) => s.trim()).filter(Boolean).join(', ')

  if (where) parts.push(escapeLatex(where))
  if (profile.phone.trim()) {
    parts.push(`\\faPhone\\ ${escapeLatex(`${profile.phoneCountryCode} ${profile.phone}`.trim())}`)
  }
  if (profile.email.trim()) {
    parts.push(`\\faEnvelope\\ ${link(`mailto:${profile.email.trim()}`, profile.email.trim())}`)
  }
  if (profile.linkedinUrl.trim()) {
    parts.push(`\\faLinkedin\\ ${link(profile.linkedinUrl.trim(), tidyUrl(profile.linkedinUrl.trim()))}`)
  }
  if (profile.githubUrl.trim()) {
    parts.push(`\\faGithub\\ ${link(profile.githubUrl.trim(), tidyUrl(profile.githubUrl.trim()))}`)
  }

  return parts.join(' \\quad $|$ \\quad ')
}

/** The same details stacked, which is how a letter carries its sender. */
export function senderBlock(profile: Profile): string {
  const lines: string[] = []
  const where = [profile.addressLine1, profile.postalCode, profile.city, profile.country]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')

  if (where) lines.push(escapeLatex(where))
  if (profile.phone.trim()) {
    lines.push(`\\faPhone\\ ${escapeLatex(`${profile.phoneCountryCode} ${profile.phone}`.trim())}`)
  }
  if (profile.email.trim()) {
    lines.push(`\\faEnvelope\\ ${link(`mailto:${profile.email.trim()}`, profile.email.trim())}`)
  }
  if (profile.linkedinUrl.trim()) {
    lines.push(`\\faLinkedin\\ ${link(profile.linkedinUrl.trim(), tidyUrl(profile.linkedinUrl.trim()))}`)
  }

  return lines.join(' \\\\\n')
}

// ---------------------------------------------------------------------------
// Letter language
// ---------------------------------------------------------------------------

/**
 * Which language the generated letter came out in.
 *
 * The body is written by a model reading the posting, so it follows the
 * posting's language — and a French letter opening with "Dear Hiring Team"
 * is exactly the kind of seam that makes a document look generated. Counts
 * short, unambiguous function words rather than trying to be clever.
 */
export function detectLetterLanguage(body: string): 'fr' | 'en' {
  const words = body.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœ]+/g) ?? []
  if (!words.length) return 'fr'

  const french = new Set(['je', 'vous', 'votre', 'nous', 'que', 'des', 'les', 'une', 'dans', 'pour', 'au', 'du', 'est', 'mes', 'mon', 'ma', 'avec', 'chez', 'poste'])
  const english = new Set(['the', 'and', 'your', 'with', 'this', 'that', 'for', 'have', 'would', 'my', 'role', 'team', 'to'])

  let fr = 0
  let en = 0
  for (const word of words) {
    if (french.has(word)) fr += 1
    if (english.has(word)) en += 1
  }

  return fr >= en ? 'fr' : 'en'
}

const LETTER_STRINGS = {
  fr: {
    subject: (role: string) => (role ? `Candidature au poste de ${role}` : 'Candidature spontanée'),
    greeting: 'Madame, Monsieur,',
    closing:
      'Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.',
  },
  en: {
    subject: (role: string) => (role ? `Application for ${role}` : 'Application'),
    greeting: 'Dear Hiring Team,',
    closing: 'Kind regards,',
  },
} as const

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const DEFAULT_RESUME_TEMPLATE = String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[margin=1.6cm]{geometry}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[french]{babel}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage{xcolor}
\usepackage{hyperref}
\usepackage{fontawesome5}
\usepackage{parskip}

\definecolor{darkblue}{RGB}{20,50,90}

\hypersetup{colorlinks=true, urlcolor=darkblue, linkcolor=darkblue}

\titleformat{\section}{\large\bfseries\color{darkblue}}{}{0em}{}[\titlerule]
\titlespacing{\section}{0pt}{8pt}{4pt}

\setlength{\parindent}{0pt}
\pagestyle{empty}

\newcommand{\entry}[4]{
  \textbf{#1} \hfill #2 \\
  \textit{#3} \hfill \textit{#4} \\
}

\begin{document}

\begin{center}
{\Huge \textbf{{{NAME}}}}\\[2pt]
{\large {{HEADLINE}}}\\[4pt]
{{CONTACT}}
\end{center}

\vspace{2pt}

\section*{Résumé}
{{SUMMARY}}

\section*{Expériences professionnelles}
{{EXPERIENCE}}

\section*{Formation}
{{EDUCATION}}

\section*{Compétences}
{{SKILLS}}

\section*{Langues}
{{LANGUAGES}}

\end{document}
`

export const DEFAULT_COVER_LETTER_TEMPLATE = String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[margin=1.9cm]{geometry}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[french]{babel}
\usepackage{titlesec}
\usepackage{xcolor}
\usepackage{hyperref}
\usepackage{fontawesome5}
\usepackage{parskip}

\definecolor{darkblue}{RGB}{20,50,90}

\hypersetup{colorlinks=true, urlcolor=darkblue, linkcolor=darkblue}

\setlength{\parindent}{0pt}
\pagestyle{empty}

\begin{document}

% --- Expéditeur ---
{\LARGE \textbf{{{NAME}}}}\\[2pt]
{\color{darkblue} {{HEADLINE}}}\\[8pt]
{{SENDER}}

\vspace{1.6em}

% --- Destinataire ---
\begin{flushright}
\textbf{{{COMPANY}}}\\[6pt]
{{DATE}}
\end{flushright}

\vspace{1.2em}

\textbf{\color{darkblue} Objet : {{SUBJECT}}}

\vspace{1.4em}

{{GREETING}}

\vspace{0.8em}

{{BODY}}

\vspace{1.2em}

{{CLOSING}}

\vspace{2em}

\hfill \textbf{{{NAME}}}

\end{document}
`

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function itemize(lines: string[]): string {
  if (!lines.length) return ''
  const items = lines.map((line) => `  \\item ${escapeLatex(line)}`).join('\n')
  return `\\begin{itemize}[leftmargin=14pt, itemsep=1pt, topsep=2pt]\n${items}\n\\end{itemize}`
}

/** One `\entry` per role, then its bullets — the shape the template defines. */
function experienceBlock(resume: RenderedResume): string {
  return resume.roles
    .map((role) => {
      const entry = [
        `\\entry{${escapeLatex(role.title || 'Poste')}}`,
        `{${escapeLatex(role.dates)}}`,
        `{${escapeLatex(role.company)}}`,
        `{${escapeLatex(role.location)}}`,
      ].join('')

      return [entry, itemize(role.bullets)].filter(Boolean).join('\n')
    })
    .join('\n\n')
}

function educationBlock(resume: RenderedResume): string {
  return resume.education
    .map((entry) =>
      [
        `\\entry{${escapeLatex(entry.degree)}}`,
        `{${escapeLatex(entry.dates)}}`,
        `{${escapeLatex(entry.school)}}`,
        `{${escapeLatex(entry.location)}}`,
      ].join(''),
    )
    .join('\n')
}

/**
 * The profile is passed alongside the rendered resume so the header can
 * carry the same icon-prefixed contact row the letter does — that row needs
 * the fields apart (phone, email, LinkedIn), not the flattened strings the
 * plain-text renderer works from.
 */
export function resumeToLatex(
  resume: RenderedResume,
  profile: Profile,
  template = DEFAULT_RESUME_TEMPLATE,
): string {
  return fillTemplate(template, {
    NAME: escapeLatex(resume.name || 'Votre nom'),
    HEADLINE: escapeLatex(resume.headline),
    CONTACT: contactLine(profile),
    SUMMARY: escapeParagraphs(resume.summary),
    SKILLS: resume.skills.map(escapeLatex).join(' \\quad $\\cdot$ \\quad '),
    EXPERIENCE: experienceBlock(resume),
    EDUCATION: educationBlock(resume),
    LANGUAGES: resume.languages.map(escapeLatex).join(' \\quad $|$ \\quad '),
  })
}

export function coverLetterToLatex(
  profile: Profile,
  job: Pick<SavedJob, 'title' | 'company'>,
  body: string,
  template = DEFAULT_COVER_LETTER_TEMPLATE,
): string {
  const name = `${profile.firstName} ${profile.lastName}`.trim()
  const language = detectLetterLanguage(body)
  const strings = LETTER_STRINGS[language]

  const place = profile.city.trim()
  const date = new Date().toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return fillTemplate(template, {
    NAME: escapeLatex(name || 'Votre nom'),
    HEADLINE: escapeLatex(profile.headline),
    SENDER: senderBlock(profile),
    CONTACT: contactLine(profile),
    COMPANY: escapeLatex(job.company || (language === 'fr' ? 'Service Recrutement' : 'Hiring Team')),
    ROLE: escapeLatex(job.title),
    SUBJECT: escapeLatex(strings.subject(job.title.trim())),
    GREETING: escapeLatex(strings.greeting),
    CLOSING: escapeLatex(strings.closing),
    DATE: escapeLatex(
      place ? (language === 'fr' ? `${place}, le ${date}` : `${place}, ${date}`) : date,
    ),
    BODY: escapeParagraphs(body),
  })
}

/** A filename-safe slug, for naming the downloaded .tex. */
export function slug(value: string, fallback = 'role'): string {
  const cleaned = value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || fallback
}
