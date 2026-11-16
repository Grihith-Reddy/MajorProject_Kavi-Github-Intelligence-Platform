import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, FileCode2, Search, X } from 'lucide-react'

import { CODE_THEME_COLORS, tokenizeCodeLine } from '../chat/codeTokens'
import type { WhyLensResponse, WhySegment } from '../../services/insightsService'
import { ROW_HEIGHT, languageFromPath, segmentKey } from './whyLensUtils'

const OVERSCAN = 24

interface Props {
  data: WhyLensResponse
  colorFor: (segment: WhySegment) => string
  activeKey: string | null
  hoverKey: string | null
  onHover: (key: string | null) => void
  onSelect: (segment: WhySegment) => void
  focusLine: number | null
}

/**
 * The Why-Lens code view: gutter banded by the PR behind each line, in-file search,
 * a clickable minimap, and windowed rendering so very large files stay smooth.
 */
export function CodeLens({ data, colorFor, activeKey, hoverKey, onHover, onSelect, focusLine }: Props) {
  const lines = useMemo(() => (data.content ?? '').replace(/\r\n/g, '\n').split('\n'), [data.content])
  const language = languageFromPath(data.path)
  const segmentByLine = useMemo(() => {
    const map = new Map<number, WhySegment>()
    for (const segment of data.segments) {
      for (let line = segment.start_line; line <= segment.end_line; line++) map.set(line, segment)
    }
    return map
  }, [data.segments])

  const bodyRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return [] as number[]
    const found: number[] = []
    lines.forEach((line, index) => { if (line.toLowerCase().includes(q)) found.push(index + 1) })
    return found
  }, [lines, query])
  const matchSet = useMemo(() => new Set(matches), [matches])

  const scrollToLine = useCallback((line: number, smooth = true) => {
    const body = bodyRef.current
    if (!body) return
    const target = Math.max(0, (line - 1) * ROW_HEIGHT - body.clientHeight / 2 + ROW_HEIGHT)
    body.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' })
    // Render the destination window right away rather than waiting for scroll events.
    setScrollTop(target)
  }, [])

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const measure = () => setViewport(body.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (focusLine) scrollToLine(focusLine)
  }, [focusLine, data.path, scrollToLine])

  useEffect(() => {
    setMatchIndex(0)
    if (matches.length) scrollToLine(matches[0])
  }, [matches, scrollToLine])

  const stepMatch = (direction: 1 | -1) => {
    if (!matches.length) return
    const next = (matchIndex + direction + matches.length) % matches.length
    setMatchIndex(next)
    scrollToLine(matches[next])
  }

  const total = lines.length
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + OVERSCAN)
  const visible = lines.slice(first, last)

  const onMinimap = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientY - rect.top) / rect.height
    scrollToLine(Math.max(1, Math.round(ratio * total)), false)
  }

  return (
    <div className="wl-code">
      <div className="wl-code-head">
        <div className="wl-code-title">
          <FileCode2 size={14} />
          <span>{data.path.split('/').pop()}</span>
        </div>
        <div className="wl-code-tools">
          <label className="wl-search-in">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); stepMatch(event.shiftKey ? -1 : 1) } if (event.key === 'Escape') setQuery('') }}
              placeholder="Find in file"
              aria-label="Find in file"
            />
            {query && (
              <>
                <span className="wl-search-count">{matches.length ? `${matchIndex + 1}/${matches.length}` : '0'}</span>
                <button type="button" onClick={() => stepMatch(-1)} aria-label="Previous match" disabled={!matches.length}><ChevronUp size={13} /></button>
                <button type="button" onClick={() => stepMatch(1)} aria-label="Next match" disabled={!matches.length}><ChevronDown size={13} /></button>
                <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={12} /></button>
              </>
            )}
          </label>
          <div className="wl-code-meta">
            <span>{total} lines</span>
            {data.commit_oid && (<><span>·</span><span>{data.commit_oid.slice(0, 7)}</span></>)}
          </div>
        </div>
      </div>

      <div className="wl-code-main">
        <div className="wl-code-body" ref={bodyRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} onMouseLeave={() => onHover(null)}>
          <div style={{ height: first * ROW_HEIGHT }} aria-hidden />
          {visible.map((line, offset) => {
            const number = first + offset + 1
            const segment = segmentByLine.get(number)
            const key = segment ? segmentKey(segment) : null
            const color = segment ? colorFor(segment) : 'transparent'
            const isActive = key !== null && key === activeKey
            const isHover = key !== null && key === hoverKey && !isActive
            const isStart = segment?.start_line === number
            const isMatch = matchSet.has(number)
            const isCurrentMatch = isMatch && matches[matchIndex] === number
            return (
              <div
                key={number}
                data-line={number}
                className={`wl-line${isActive ? ' is-active' : ''}${isHover ? ' is-hover' : ''}${number === focusLine ? ' is-focus' : ''}${isMatch ? ' is-match' : ''}${isCurrentMatch ? ' is-current-match' : ''}`}
                style={{ ['--band' as string]: color }}
                onMouseEnter={() => onHover(key)}
                onClick={() => segment && onSelect(segment)}
              >
                <span className="wl-band" />
                <span className="wl-num">{number}</span>
                <span className="wl-src">
                  {tokenizeCodeLine(line, language).map((token, tokenIndex) => (
                    <span key={tokenIndex} style={{ color: CODE_THEME_COLORS[token.kind] }}>{token.text}</span>
                  ))}
                  {line === '' ? ' ' : ''}
                </span>
                {isStart && segment && (
                  <span className="wl-tag" style={{ color }}>
                    {segment.pr_number ? `#${segment.pr_number}` : segment.commit_short}
                  </span>
                )}
              </div>
            )
          })}
          <div style={{ height: Math.max(0, (total - last) * ROW_HEIGHT) }} aria-hidden />
        </div>

        <div className="wl-minimap" onClick={onMinimap} role="presentation" title="Jump to a part of the file">
          {data.segments.map((segment) => (
            <span
              key={`${segment.start_line}-${segment.end_line}`}
              className={`wl-mini-band${segmentKey(segment) === activeKey ? ' is-active' : ''}`}
              style={{
                top: `${((segment.start_line - 1) / Math.max(total, 1)) * 100}%`,
                height: `${Math.max(0.6, ((segment.end_line - segment.start_line + 1) / Math.max(total, 1)) * 100)}%`,
                background: colorFor(segment),
              }}
            />
          ))}
          {matches.map((line) => (
            <span key={`m-${line}`} className="wl-mini-match" style={{ top: `${((line - 1) / Math.max(total, 1)) * 100}%` }} />
          ))}
          <span
            className="wl-mini-viewport"
            style={{
              top: `${(scrollTop / Math.max(total * ROW_HEIGHT, 1)) * 100}%`,
              height: `${Math.min(100, (viewport / Math.max(total * ROW_HEIGHT, 1)) * 100)}%`,
            }}
          />
        </div>
      </div>
    </div>
  )
}
