import { Copy } from 'lucide-react'

import { CODE_THEME_COLORS, tokenizeCodeLine } from './codeTokens'

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
