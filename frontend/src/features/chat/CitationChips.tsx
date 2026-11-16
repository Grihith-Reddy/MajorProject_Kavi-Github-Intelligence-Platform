import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowUpRight, FileCode2, GitPullRequest, ScanLine } from 'lucide-react'

export interface PrInfo {
  url?: string
  title?: string
  intent?: string
  summary?: string
}

export interface FileInfo {
  excerpt?: string
  start?: number
  end?: number
}

/** Shows `card` near the trigger after a short hover/focus delay; fixed-positioned so scroll areas never clip it. */
function HoverPreview({ trigger, card }: { trigger: (handlers: Record<string, unknown>) => ReactNode; card: ReactNode | null }) {
  const [box, setBox] = useState<{ left: number; top: number; above: boolean } | null>(null)
  const timer = useRef<number | null>(null)

  const open = (event: { currentTarget: EventTarget }) => {
    if (!card) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const width = 340
      const above = rect.bottom + 220 > window.innerHeight
      setBox({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: above ? rect.top - 8 : rect.bottom + 8,
        above,
      })
    }, 260)
  }
  const close = () => {
    if (timer.current) window.clearTimeout(timer.current)
    setBox(null)
  }

  return (
    <>
      {trigger({ onMouseEnter: open, onMouseLeave: close, onFocus: open, onBlur: close })}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {box && card && (
            <motion.div
              className="kv-cite-card"
              role="tooltip"
              style={{ left: box.left, top: box.top, transform: box.above ? 'translateY(-100%)' : undefined }}
              initial={{ opacity: 0, y: box.above ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              {card}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

export function PrChip({ number, info }: { number: number; info?: PrInfo }) {
  const body = (
    <>
      <GitPullRequest size={11} strokeWidth={2} />
      PR #{number}
    </>
  )
  const card = info && (info.title || info.intent || info.summary) ? (
    <>
      <span className="kv-cite-kicker"><GitPullRequest size={12} /> Pull request #{number}</span>
      {info.title && <span className="kv-cite-title">{info.title}</span>}
      {(info.intent || info.summary) && <span className="kv-cite-text">{info.intent || info.summary}</span>}
      {info.url && <span className="kv-cite-foot">Opens on GitHub <ArrowUpRight size={11} /></span>}
    </>
  ) : null
  return (
    <HoverPreview
      card={card}
      trigger={(handlers) =>
        info?.url ? (
          <a className="kv-chip" href={info.url} target="_blank" rel="noreferrer" {...handlers}>{body}</a>
        ) : (
          <span className="kv-chip" tabIndex={card ? 0 : undefined} {...handlers}>{body}</span>
        )
      }
    />
  )
}

export function FileChip({ path, start, end, repoId, info }: { path: string; start?: string; end?: string; repoId?: string | null; info?: FileInfo }) {
  const name = path.split('/').pop() ?? path
  const range = start ? `${start}${end ? `–${end}` : ''}` : ''
  const label = (
    <>
      <FileCode2 size={11} strokeWidth={2} />
      <span className="kv-chip-name">{name}</span>
      {range && <span className="kv-chip-range">{range}</span>}
    </>
  )
  const excerpt = info?.excerpt?.replace(/\s+$/, '')
  const firstLine = Number(start) || info?.start || 1
  const card = (
    <>
      <span className="kv-cite-kicker"><FileCode2 size={12} /> {path}</span>
      {excerpt ? (
        <pre className="kv-cite-code">
          {excerpt.split('\n').slice(0, 12).map((line, index) => (
            <span key={index}><span className="kv-cite-ln">{firstLine + index}</span>{line || ' '}{'\n'}</span>
          ))}
        </pre>
      ) : (
        <span className="kv-cite-text">{range ? `Lines ${range}` : 'Whole file'}</span>
      )}
      {repoId && <span className="kv-cite-foot"><ScanLine size={11} /> Click to trace why these lines exist</span>}
    </>
  )
  if (!repoId) return <HoverPreview card={card} trigger={(handlers) => <span className="kv-chip" title={path} tabIndex={0} {...handlers}>{label}</span>} />
  const params = new URLSearchParams({ repoId, path })
  if (start) params.set('line', start)
  if (end) params.set('end', end)
  return (
    <HoverPreview
      card={card}
      trigger={(handlers) => <Link className="kv-chip" to={`/why?${params.toString()}`} {...handlers}>{label}</Link>}
    />
  )
}
