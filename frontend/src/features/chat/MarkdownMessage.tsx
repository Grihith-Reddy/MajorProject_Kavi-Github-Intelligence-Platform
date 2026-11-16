import { Fragment, useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { FileChip, PrChip, type FileInfo, type PrInfo } from './CitationChips'
import { CodeSnippetCard } from './CodeSnippetCard'
import { isInternalPath, safeExternalUrl } from '../../utils/safeUrl'

/**
 * A small, dependency-free Markdown renderer tuned to KAVI's design language.
 * Supports headings, paragraphs, lists, quotes, tables, fenced code (rendered with
 * the shared code card), inline code, emphasis and links, plus two citation forms:
 *   [PR #12]           → pull-request chip (links to GitHub when known)
 *   `path/file.py:10-24` → file chip that opens Why-Lens at that line
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language: string; code: string }
  | { kind: 'table'; header: string[]; rows: string[][] }

const FILE_REF_RE = /^([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)*\.[A-Za-z0-9]{1,8})(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/
const INLINE_RE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[PR #\d+\](?:\([^)\s]*\))?)|(\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]*\))|(\*[^*\s][^*\n]*\*)/g

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = line.match(/^\s*```\s*([\w+#.-]*)/)
    if (fence) {
      flushParagraph()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i])
        i++
      }
      blocks.push({ kind: 'code', language: fence[1] || 'text', code: code.join('\n') })
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }
    if (/^\s*([-*•])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph()
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/.test(lines[i]) : /^\s*([-*•])\s+/.test(lines[i]))) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/, ''))
        i++
        // Continuation lines indented under a list item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`
          i++
        }
      }
      i--
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    if (/^>\s?/.test(line)) {
      flushParagraph()
      const quote: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      i--
      blocks.push({ kind: 'quote', text: quote.join(' ') })
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushParagraph()
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]))
        i++
      }
      i--
      blocks.push({ kind: 'table', header, rows })
      continue
    }
    if (!line.trim()) {
      flushParagraph()
      continue
    }
    paragraph.push(line.trim())
  }
  flushParagraph()
  return blocks
}

interface InlineContext {
  repoId?: string | null
  prInfo: Record<number, PrInfo>
  fileInfo: Record<string, FileInfo>
}

function renderInline(text: string, ctx: InlineContext): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(text.slice(last, index))
    const token = match[0]
    if (match[1]) {
      const inner = token.slice(1, -1)
      const fileRef = inner.match(FILE_REF_RE)
      if (fileRef && (inner.includes('/') || fileRef[2])) {
        nodes.push(<FileChip key={key++} path={fileRef[1]} start={fileRef[2]} end={fileRef[3]} repoId={ctx.repoId} info={ctx.fileInfo[fileRef[1]] ?? ctx.fileInfo[fileRef[1].split('/').pop() ?? '']} />)
      } else {
        nodes.push(<code key={key++} className="kv-inline-code">{inner}</code>)
      }
    } else if (match[2]) {
      nodes.push(<strong key={key++}>{renderInline(token.slice(2, -2), ctx)}</strong>)
    } else if (match[3]) {
      const number = Number(token.match(/#(\d+)/)?.[1])
      const explicit = token.match(/\]\(([^)]*)\)/)?.[1]
      nodes.push(<PrChip key={key++} number={number} info={{ ...ctx.prInfo[number], url: safeExternalUrl(explicit) ?? safeExternalUrl(ctx.prInfo[number]?.url) }} />)
    } else if (match[4]) {
      const label = token.slice(1, token.indexOf(']('))
      const href = token.slice(token.indexOf('](') + 2, -1)
      const external = safeExternalUrl(href)
      nodes.push(
        isInternalPath(href)
          ? <Link key={key++} className="kv-link" to={href}>{label}</Link>
          : external
            ? <a key={key++} className="kv-link" href={external} target="_blank" rel="noreferrer">{label}</a>
            : label
      )
    } else if (match[5]) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>)
    }
    last = index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

export function MarkdownMessage({
  content,
  streaming = false,
  repoId,
  prUrls = {},
  sources = [],
}: {
  content: string
  streaming?: boolean
  repoId?: string | null
  prUrls?: Record<number, string | undefined>
  sources?: Array<Record<string, unknown>>
}) {
  const blocks = useMemo(() => parseMarkdown(content), [content])
  const ctx: InlineContext = useMemo(() => {
    const prInfo: Record<number, PrInfo> = {}
    const fileInfo: Record<string, FileInfo> = {}
    for (const [number, url] of Object.entries(prUrls)) prInfo[Number(number)] = { url }
    for (const source of sources) {
      const number = Number(source.pr_number)
      if (number) {
        prInfo[number] = {
          url: (source.pr_url as string) || prInfo[number]?.url,
          title: source.pr_title as string,
          intent: source.intent as string,
          summary: source.summary as string,
        }
      }
      const files = Array.isArray(source.files) ? (source.files as Array<Record<string, unknown>>) : []
      for (const file of files) {
        const path = String(file.file_path || '')
        if (!path) continue
        const info = { excerpt: (source.excerpt as string) || undefined, start: Number(file.start_line) || undefined, end: Number(file.end_line) || undefined }
        if (!fileInfo[path] || info.excerpt) {
          fileInfo[path] = info
          fileInfo[path.split('/').pop() ?? path] = info
        }
      }
    }
    return { repoId, prInfo, fileInfo }
  }, [repoId, prUrls, sources])

  return (
    <div className="kv-md">
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1
        const caret = streaming && isLast && block.kind !== 'code' ? <span className="kv-caret" aria-hidden /> : null
        switch (block.kind) {
          case 'heading':
            return <p key={index} className={`kv-md-h kv-md-h${block.level}`}>{renderInline(block.text, ctx)}{caret}</p>
          case 'paragraph':
            return <p key={index} className="kv-md-p">{renderInline(block.text, ctx)}{caret}</p>
          case 'quote':
            return <blockquote key={index} className="kv-md-quote">{renderInline(block.text, ctx)}{caret}</blockquote>
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul'
            return (
              <Tag key={index} className={`kv-md-list${block.ordered ? ' is-ordered' : ''}`}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {renderInline(item, ctx)}
                    {itemIndex === block.items.length - 1 ? caret : null}
                  </li>
                ))}
              </Tag>
            )
          }
          case 'table':
            return (
              <div key={index} className="kv-md-table-wrap">
                <table className="kv-md-table">
                  <thead>
                    <tr>{block.header.map((cell, c) => <th key={c}>{renderInline(cell, ctx)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>{row.map((cell, c) => <td key={c}>{renderInline(cell, ctx)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'code':
            return (
              <Fragment key={index}>
                <CodeSnippetCard
                  index={index}
                  maxHeight={380}
                  snippet={{ code: block.code, language: block.language, title: block.language === 'text' ? 'Snippet' : block.language }}
                />
              </Fragment>
            )
          default:
            return null
        }
      })}
      {streaming && !blocks.length && <span className="kv-caret" aria-hidden />}
    </div>
  )
}
