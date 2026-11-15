import { Copy } from 'lucide-react'

export interface CodeSnippet {
  title?: string
  description?: string
  language?: string
  code?: string
  file_path?: string | null
  start_line?: number | null
  end_line?: number | null
  source?: string
}

function splitFilePath(path: string) {
  const normalized = String(path || '').split('\\').join('/')
  const segments = normalized.split('/').filter(Boolean)
  const fileName = segments.length ? segments[segments.length - 1] : normalized
  return { fileName }
}

function snippetLanguageLabel(language?: string) {
  const value = String(language || '').trim()
  return value || 'text'
}

type CodeTokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'annotation' | 'type' | 'function' | 'operator'

const CODE_THEME_COLORS: Record<CodeTokenKind, string> = {
  plain: '#E6EDF3',
  keyword: '#C792EA',
  string: '#ECC48D',
  comment: '#7F9F7F',
  number: '#F78C6C',
  annotation: '#FFD580',
  type: '#82AAFF',
  function: '#7FDBCA',
  operator: '#89A7C5',
}

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  python: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'import', 'from', 'as', 'with', 'pass', 'raise', 'lambda', 'None', 'True', 'False'],
  javascript: ['function', 'return', 'if', 'else', 'for', 'while', 'const', 'let', 'var', 'class', 'new', 'import', 'from', 'export', 'default', 'try', 'catch', 'finally', 'await', 'async', 'null', 'true', 'false'],
  typescript: ['function', 'return', 'if', 'else', 'for', 'while', 'const', 'let', 'var', 'class', 'new', 'import', 'from', 'export', 'default', 'try', 'catch', 'finally', 'await', 'async', 'interface', 'type', 'extends', 'implements', 'null', 'true', 'false'],
  tsx: ['function', 'return', 'if', 'else', 'for', 'while', 'const', 'let', 'var', 'class', 'new', 'import', 'from', 'export', 'default', 'try', 'catch', 'finally', 'await', 'async', 'interface', 'type', 'extends', 'implements', 'null', 'true', 'false'],
  java: ['class', 'public', 'private', 'protected', 'static', 'final', 'void', 'return', 'if', 'else', 'for', 'while', 'try', 'catch', 'new', 'extends', 'implements', 'package', 'import', 'null', 'true', 'false'],
  go: ['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'struct', 'interface', 'type', 'var', 'const', 'go', 'defer', 'nil', 'true', 'false'],
  csharp: ['class', 'public', 'private', 'protected', 'static', 'void', 'return', 'if', 'else', 'for', 'while', 'try', 'catch', 'using', 'namespace', 'new', 'null', 'true', 'false'],
  sql: ['select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'on', 'insert', 'into', 'update', 'delete', 'group', 'order', 'by', 'limit', 'and', 'or', 'as'],
}

function codeKeywordsForLanguage(language: string): string[] {
  const normalized = language.toLowerCase()
  if (normalized.includes('typescript')) return LANGUAGE_KEYWORDS.typescript
  if (normalized.includes('tsx')) return LANGUAGE_KEYWORDS.tsx
  if (normalized.includes('javascript') || normalized === 'js') return LANGUAGE_KEYWORDS.javascript
  if (normalized.includes('python') || normalized === 'py') return LANGUAGE_KEYWORDS.python
  if (normalized.includes('java')) return LANGUAGE_KEYWORDS.java
  if (normalized.includes('go')) return LANGUAGE_KEYWORDS.go
  if (normalized.includes('csharp') || normalized.includes('c#') || normalized.includes('cs')) return LANGUAGE_KEYWORDS.csharp
  if (normalized.includes('sql')) return LANGUAGE_KEYWORDS.sql
  return LANGUAGE_KEYWORDS.typescript
}

function escapeRegexLiteral(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSemanticPattern(keywords: string[]) {
  const escapedKeywords = keywords.map(escapeRegexLiteral)
  const keywordPart = escapedKeywords.length ? `\\b(?:${escapedKeywords.join('|')})\\b` : ''
  const combined = [
    '@[A-Za-z_][A-Za-z0-9_]*',
    keywordPart,
    '\\b\\d+(?:\\.\\d+)?\\b',
    '\\b[A-Za-z_][A-Za-z0-9_]*(?=\\s*\\()',
    '\\b[A-Z][A-Za-z0-9_]*\\b',
    '[{}()[\\].,;:+\\-*/%=&|!<>?]+',
  ].filter(Boolean)
  return new RegExp(`(${combined.join('|')})`, 'g')
}

function pushSemanticTokens(text: string, keywords: string[], out: { text: string; kind: CodeTokenKind }[]) {
  if (!text) return
  const semanticPattern = buildSemanticPattern(keywords)
  const keywordSet = new Set(keywords.map((keyword) => keyword.toLowerCase()))
  let index = 0
  let match: RegExpExecArray | null
  while ((match = semanticPattern.exec(text)) !== null) {
    const start = match.index
    if (start > index) out.push({ text: text.slice(index, start), kind: 'plain' })
    const value = match[0]
    const lower = value.toLowerCase()
    let kind: CodeTokenKind = 'plain'
    if (value.startsWith('@')) kind = 'annotation'
    else if (keywordSet.has(lower)) kind = 'keyword'
    else if (/^\d/.test(value)) kind = 'number'
    else if (/^[{}()[\].,;:+\-*/%=&|!<>?]+$/.test(value)) kind = 'operator'
    else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      const trailing = text.slice(start + value.length)
      if (/^\s*\(/.test(trailing)) kind = 'function'
      else if (/^[A-Z]/.test(value)) kind = 'type'
    }
    out.push({ text: value, kind })
    index = start + value.length
  }
  if (index < text.length) out.push({ text: text.slice(index), kind: 'plain' })
}

function tokenizeCodeLine(line: string, language: string): { text: string; kind: CodeTokenKind }[] {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--')) {
    return [{ text: line, kind: 'comment' }]
  }

  const keywords = codeKeywordsForLanguage(language)
  const literalPattern = /("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\/\/.*$|#.*$|--.*$)/g
  const tokens: { text: string; kind: CodeTokenKind }[] = []
  let index = 0
  let match: RegExpExecArray | null

  while ((match = literalPattern.exec(line)) !== null) {
    const start = match.index
    if (start > index) {
      pushSemanticTokens(line.slice(index, start), keywords, tokens)
    }
    const value = match[0]
    const kind: CodeTokenKind = value.startsWith('"') || value.startsWith("'") || value.startsWith('`')
      ? 'string'
      : value.startsWith('//') || value.startsWith('#') || value.startsWith('--')
        ? 'comment'
        : 'number'
    tokens.push({ text: value, kind })
    index = start + value.length
    if (kind === 'comment') break
  }

  if (index < line.length) {
    pushSemanticTokens(line.slice(index), keywords, tokens)
  }
  if (!tokens.length) tokens.push({ text: line, kind: 'plain' })
  return tokens
}

export function CodeSnippetCard({ snippet, index, maxHeight = 220 }: { snippet: CodeSnippet; index: number; maxHeight?: number }) {
  const code = String(snippet.code || '')
  if (!code.trim()) return null

  const onCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code)
        return
      }
      if (typeof document !== 'undefined') {
        const probe = document.createElement('textarea')
        probe.value = code
        probe.setAttribute('readonly', '')
        probe.style.position = 'absolute'
        probe.style.left = '-9999px'
        document.body.appendChild(probe)
        probe.select()
        document.execCommand('copy')
        document.body.removeChild(probe)
      }
    } catch {
      // Clipboard writes can fail in unsupported browsers or denied permissions.
    }
  }

  const language = snippetLanguageLabel(snippet.language)
  const filePath = String(snippet.file_path || '').trim()
  const fileName = (filePath ? splitFilePath(filePath).fileName : String(snippet.title || `Snippet ${index + 1}`)).replace(/\s+preview$/i, '')
  const codeLines = code.replace(/\r\n/g, '\n').split('\n')

  return (
    <div
      key={`${snippet.title || 'snippet'}-${index}`}
      style={{
        borderRadius: 14,
        border: '1px solid #262D31',
        background: '#0B0F13',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderBottom: '1px solid #1F262B', background: '#10171D' }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, fontWeight: 600, color: '#E6EDF3' }}>
            {fileName}
          </p>
        </div>
        <button
          type="button"
          onClick={onCopy}
          style={{
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.22)',
            background: 'transparent',
            color: '#FFFFFF',
            fontFamily: "'Gabarito', sans-serif",
            fontSize: 11,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            cursor: 'pointer',
          }}
        >
          <Copy size={12} color="#FFFFFF" />
          Copy
        </button>
      </div>
      {snippet.description && (
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, color: '#B8C5D0', lineHeight: 1.45, padding: '8px 12px 0' }}>
          {snippet.description}
        </p>
      )}
      <div
        style={{
          maxHeight,
          minHeight: Math.min(maxHeight, 64),
          overflow: 'auto',
          margin: 0,
          padding: '12px 0',
          background: 'radial-gradient(circle at top left, rgba(59, 66, 82, 0.14), rgba(13, 17, 23, 1) 58%)',
          fontFamily: "'Fira Code', 'JetBrains Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
          fontSize: 12,
          lineHeight: 1.55,
          color: '#E6EDF3',
          whiteSpace: 'pre',
        }}
      >
        {codeLines.map((line, lineIndex) => {
          const lineNumber = lineIndex + 1
          const tokens = tokenizeCodeLine(line, language)
          return (
            <div key={`${lineNumber}-${line.slice(0, 20)}`} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0,1fr)', alignItems: 'start', paddingInline: 12 }}>
              <span style={{ color: '#6D7B89', textAlign: 'right', paddingRight: 10, userSelect: 'none' }}>{lineNumber}</span>
              <span>
                {tokens.map((token, tokenIndex) => (
                  <span key={`${lineNumber}-${tokenIndex}`} style={{ color: CODE_THEME_COLORS[token.kind] }}>{token.text}</span>
                ))}
                {line === '' ? '\u00A0' : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
