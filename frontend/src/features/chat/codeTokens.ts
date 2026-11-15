// Lightweight syntax tokenizer shared by every code surface in KAVI.

export type CodeTokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'annotation' | 'type' | 'function' | 'operator'

export const CODE_THEME_COLORS: Record<CodeTokenKind, string> = {
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

export function tokenizeCodeLine(line: string, language: string): { text: string; kind: CodeTokenKind }[] {
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
