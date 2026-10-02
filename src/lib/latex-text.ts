/**
 * Readable text out of a LaTeX CV.
 *
 * Plenty of engineers keep their CV as `.tex` and compile it to PDF. Uploading
 * the `.tex` used to be rejected outright, which left the profile with no
 * resume text at all — and since the ATS scorer reads that text, the score
 * collapsed for a reason that had nothing to do with the CV's contents.
 *
 * This is deliberately not a LaTeX parser. It needs to recover the *words* a
 * keyword matcher would see, so the rule throughout is: drop the markup, keep
 * the argument. `\textbf{Python}` has to come out as `Python`, because
 * dropping the braces with the command would delete the one word that matters.
 */

/** Commands whose argument is formatting metadata rather than CV prose. */
const DROP_WITH_ARGUMENT = [
  'documentclass',
  'usepackage',
  'geometry',
  'definecolor',
  'hypersetup',
  'titleformat',
  'titlespacing',
  'setlength',
  'pagestyle',
  'newcommand',
  'renewcommand',
  'input',
  'include',
  'bibliographystyle',
  'label',
  'ref',
  'vspace',
  'hspace',
  'rule',
  'includegraphics',
  'color',
  'textcolor',
]

/** Commands that are purely visual and take no argument worth keeping. */
const DROP_BARE =
  /\\(?:titlerule|hfill|newline|clearpage|newpage|noindent|centering|raggedright|bigskip|medskip|smallskip|par|item|maketitle|Huge|huge|LARGE|Large|large|normalsize|small|footnotesize|scriptsize|tiny|bfseries|itshape|rmfamily|sffamily|ttfamily|quad|qquad|,|;|:|!)\b/g

/** `\fa…` icons from fontawesome, which carry no text. */
const FONT_AWESOME = /\\fa[A-Za-z]+\b/g

const ESCAPES: Record<string, string> = {
  '\\&': '&',
  '\\%': '%',
  '\\$': '$',
  '\\#': '#',
  '\\_': '_',
  '\\{': '{',
  '\\}': '}',
  '\\textasciitilde': '~',
  '\\textbackslash': '\\',
  '\\ldots': '…',
  '\\dots': '…',
}

export function latexToText(source: string): string {
  let text = source

  // Only the body is the CV. The preamble is configuration, and keeping it
  // would put package names like "fontawesome5" into the keyword pool.
  const bodyStart = text.indexOf('\\begin{document}')
  if (bodyStart !== -1) text = text.slice(bodyStart + '\\begin{document}'.length)
  const bodyEnd = text.indexOf('\\end{document}')
  if (bodyEnd !== -1) text = text.slice(0, bodyEnd)

  // Comments: `%` to end of line, unless it was escaped as `\%`.
  text = text.replace(/(^|[^\\])%.*$/gm, '$1')

  for (const command of DROP_WITH_ARGUMENT) {
    // Optional `[...]` then any number of `{...}` arguments, all discarded.
    text = text.replace(new RegExp(`\\\\${command}\\s*(\\[[^\\]]*\\])?(\\{[^{}]*\\})*`, 'g'), ' ')
  }

  text = text.replace(/\\(begin|end)\s*\{[^{}]*\}(\[[^\]]*\])?/g, ' ')
  text = text.replace(/\\href\s*\{[^{}]*\}\s*\{([^{}]*)\}/g, '$1')
  text = text.replace(FONT_AWESOME, ' ')
  text = text.replace(DROP_BARE, ' ')

  /*
   * Keep the argument, drop the command — repeatedly, because CVs nest these
   * (`\textbf{\href{…}{Name}}`). Bounded rather than `while (true)`: a
   * pathological file should degrade to slightly messier text, never hang the
   * options page.
   */
  for (let pass = 0; pass < 6; pass += 1) {
    const next = text.replace(/\\[A-Za-z]+\s*(\[[^\]]*\])?\s*\{([^{}]*)\}/g, ' $2 ')
    if (next === text) break
    text = next
  }

  // Any command that still has no argument left to keep.
  text = text.replace(/\\[A-Za-z]+\b/g, ' ')

  /*
   * `\\` is a line break, and `\\[12pt]` is one with extra leading. Handled
   * here so the optional bracket goes with the command — dropping only the
   * backslashes leaves a bare "[12pt]" sitting in the prose.
   */
  text = text.replace(/\\\\\s*(\[[^\]]*\])?/g, '\n')

  /*
   * A bare `&` is a column separator. Removed *before* the escape table,
   * because that table turns `\&` into a real ampersand that has to survive:
   * "Data \& AI" is "Data & AI", and stripping separators afterwards ate it.
   */
  text = text.replace(/(^|[^\\])&/g, '$1 ')

  for (const [escape, literal] of Object.entries(ESCAPES)) {
    text = text.split(escape).join(literal)
  }

  // Maths delimiters and leftover grouping braces are separators, not words.
  // `&` is deliberately absent: anything still here is a real ampersand.
  text = text.replace(/[${}~^]/g, ' ')

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
