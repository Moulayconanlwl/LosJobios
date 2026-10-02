import { describe, expect, it } from 'vitest'
import { latexToText } from '@/lib/latex-text'
import { extractJobKeywords, scoreResumeAgainstJob } from '@/lib/ats'
import { defaultProfile } from '@/lib/schema'

/**
 * Reading a LaTeX CV.
 *
 * Plenty of engineers keep their CV as `.tex` and compile it to PDF. Uploading
 * the `.tex` was rejected as an unsupported type, so the profile ended up with
 * no resume text at all — and because the ATS scorer reads that text, the
 * score collapsed for a reason that had nothing to do with the CV.
 *
 * The rule under test throughout: drop the markup, keep the argument.
 * `\textbf{Python}` must come out as `Python`, because dropping the braces
 * along with the command deletes the one word that matters.
 */

/** A real CV, trimmed — same structure, packages and macros. */
const CV = String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[margin=1.6cm]{geometry}
\usepackage[french]{babel}
\usepackage{fontawesome5}
\definecolor{darkblue}{RGB}{20,50,90}
\titleformat{\section}{\large\bfseries\color{darkblue}}{}{0em}{}[\titlerule]

\newcommand{\entry}[4]{
  \textbf{#1} \hfill #2 \\
  \textit{#3} \hfill \textit{#4} \\
}

\begin{document}

\begin{center}
{\Huge \textbf{Othmane El YATIMI}}\\[2pt]
{\large Computer Engineer — MBA in Project Management}\\[4pt]
Paris, France \quad $|$ \quad \faEnvelope\ \href{mailto:a@b.com}{a@b.com}
\end{center}

\section*{Expériences professionnelles}
\entry{Proxy Product Owner / Tech Data \& AI Industrialization Consultant}{09/2025 – Present}{SCOR SE}{Paris}
\begin{itemize}[leftmargin=14pt]
  \item Designed and led Quality Tower, a multi-domain monitoring platform centralizing 52 KPIs across 7 domains.
\end{itemize}

\section*{Compétences}
Project Management \quad $\cdot$ \quad Salesforce \quad $\cdot$ \quad Splunk \quad $\cdot$ \quad Python \quad $\cdot$ \quad Docker

\end{document}`

describe('latexToText', () => {
  const text = latexToText(CV)

  it('keeps the words inside formatting commands', () => {
    // The whole point. `\textbf{Othmane El YATIMI}` is a name, not markup.
    expect(text).toContain('Othmane El YATIMI')
    expect(text).toContain('Computer Engineer')
  })

  it('keeps the content of a custom macro call', () => {
    // `\entry{…}{…}{…}{…}` is where every job title and employer lives.
    expect(text).toContain('Proxy Product Owner')
    expect(text).toContain('SCOR SE')
    expect(text).toContain('09/2025')
  })

  it('keeps the skills line, which is what a keyword matcher wants most', () => {
    for (const skill of ['Salesforce', 'Splunk', 'Python', 'Docker', 'Project Management']) {
      expect(text, skill).toContain(skill)
    }
  })

  it('keeps bullet text', () => {
    expect(text).toContain('Quality Tower')
    expect(text).toContain('52 KPIs')
  })

  it('shows the visible label of a link, not its target', () => {
    expect(text).toContain('a@b.com')
    expect(text).not.toContain('mailto:')
  })

  it('drops the preamble entirely', () => {
    /*
     * Package and colour names are configuration. Left in, "fontawesome5",
     * "geometry" and "darkblue" would all be scored as CV keywords.
     */
    for (const noise of ['documentclass', 'usepackage', 'fontawesome5', 'geometry', 'darkblue']) {
      expect(text.toLowerCase(), noise).not.toContain(noise.toLowerCase())
    }
  })

  it('leaves no stray backslash commands or braces behind', () => {
    expect(text).not.toMatch(/\\[A-Za-z]/)
    expect(text).not.toMatch(/[{}]/)
  })

  it('unescapes the characters LaTeX requires escaping', () => {
    // `Data \& AI` is "Data & AI".
    expect(text).toContain('Data & AI')
  })

  it('strips comments but not an escaped percent', () => {
    const source = String.raw`\begin{document}
Kept text % this is a comment
Raised margins by 50\% last year
\end{document}`
    const out = latexToText(source)

    expect(out).toContain('Kept text')
    expect(out).not.toContain('this is a comment')
    expect(out).toContain('50%')
  })

  it('returns an empty string for a file with no body', () => {
    // So the caller can warn rather than storing a blank resume silently.
    expect(latexToText('\\documentclass{article}\\usepackage{geometry}')).toBe('')
  })
})

describe('the extracted text is usable by the ATS scorer', () => {
  it('scores against a matching posting instead of reporting no resume', () => {
    /*
     * The end-to-end point of all of this: the reported failure was 5/100
     * with "No resume text to match", on a profile whose CV existed the whole
     * time — in a format the extractor refused.
     */
    const resumeText = latexToText(CV)

    const result = scoreResumeAgainstJob({
      resumeText,
      profile: { ...defaultProfile(), yearsExperience: 4, currentTitle: 'Product Owner' },
      jobTitle: 'Product Owner',
      jobDescription:
        '- Experience as a Product Owner\n- Splunk and Salesforce\n- Python scripting\n- Docker',
    })

    expect(result.suggestions.map((s) => s.id)).not.toContain('no-resume')
    expect(result.matched).toContain('splunk')
    expect(result.matched).toContain('salesforce')
  })

  it('does not put LaTeX machinery into the keyword pool', () => {
    // A CV whose top terms are "titleformat" and "leftmargin" matches nothing.
    const terms = extractJobKeywords(latexToText(CV)).map((k) => k.term)

    for (const noise of ['titleformat', 'leftmargin', 'hfill', 'textbf', 'quad', 'item']) {
      expect(terms, noise).not.toContain(noise)
    }
  })
})
