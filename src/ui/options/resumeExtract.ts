// The worker file itself is only referenced by URL here — pdfjs-dist's actual
// code is loaded lazily below, so a page that never touches file upload never
// pays for either library.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { reconstructLines, type PositionedTextItem } from '@/lib/pdf-text'
import { htmlToTextWithLinks } from './htmlText'

/**
 * Turning an uploaded resume file into plain text.
 *
 * Deliberately its own module, imported only from the options UI: pdfjs-dist
 * and mammoth are sizable, and neither the content script nor the background
 * worker has any business carrying them — they run entirely inside this
 * extension page, with no network access and nothing sent anywhere.
 */

export type ExtractedResume = {
  text: string
  /** Set when extraction "succeeded" but produced nothing usable — e.g. a scanned PDF. */
  warning?: string
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

  const buffer = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise

  const pages: string[] = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum += 1) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()

    // getTextContent() hands back a flat stream of fragments with no notion
    // of "line" — joining them with a bare space collapses the whole page
    // into one string and breaks every line-oriented heuristic downstream
    // (the candidate's name is the first line; a Skills section reads until
    // the next blank line). reconstructLines rebuilds real lines from each
    // fragment's position instead.
    const items: PositionedTextItem[] = content.items.map((item) =>
      'str' in item
        ? { str: item.str, transform: item.transform, width: item.width, height: item.height, hasEOL: item.hasEOL }
        : { str: '', transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0, hasEOL: false },
    )

    const pageText = reconstructLines(items).join('\n')
    if (pageText.trim()) pages.push(pageText)
  }

  await doc.destroy()
  return pages.join('\n\n')
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()

  // convertToHtml, not extractRawText: raw-text mode throws hyperlink targets
  // away entirely, and resumes routinely hide a LinkedIn/GitHub URL behind an
  // icon or a "LinkedIn" label with no other trace of the URL in the document.
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return htmlToTextWithLinks(result.value).trim()
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown']

export async function extractResumeText(file: File): Promise<ExtractedResume> {
  const name = file.name.toLowerCase()

  try {
    if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
      const text = await extractPdfText(file)
      return text
        ? { text }
        : {
            text: '',
            warning:
              'This PDF has no extractable text layer — it’s likely a scanned image. Paste your resume as text below instead.',
          }
    }

    if (file.type === DOCX_MIME || name.endsWith('.docx')) {
      const text = await extractDocxText(file)
      return { text }
    }

    if (name.endsWith('.doc')) {
      throw new Error(
        'Old-format .doc files aren’t supported. Save it as .docx or .pdf, or paste the text below.',
      )
    }

    if (file.type.startsWith('text/') || TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      return { text: (await file.text()).trim() }
    }
  } catch (err) {
    if (err instanceof Error) throw err
    throw new Error('Could not read that file.')
  }

  throw new Error('Unsupported file type. Upload a PDF, DOCX, or plain-text resume.')
}
