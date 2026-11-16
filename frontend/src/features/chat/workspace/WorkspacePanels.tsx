import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, FolderGit2, GitPullRequest, X } from 'lucide-react'
import { GitVisualizationPanel } from './GitVisualizationPanel'
import { WORKSPACE_PANEL_ITEMS, splitFilePath } from './chatHelpers'
import { type WorkspaceOverlayProps, type WorkspacePanelId } from './chatTypes'

// ─── Icon rail ────────────────────────────────────────────────────────────────

const HOVER_OPEN_MS = 90
const HOVER_CLOSE_MS = 150
const EASE_OUT = [0.16, 1, 0.3, 1] as const
const EASE_IN = [0.7, 0, 0.84, 0] as const

/** Mouse and trackpad only: touch tablets tap an icon to open its panel directly. */
function useFinePointer() {
  const [fine, setFine] = useState(() => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches)
  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)')
    const onChange = () => setFine(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return fine
}

interface RailProps {
  activePanel: WorkspacePanelId | null
  onToggle: (panel: WorkspacePanelId) => void
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

/**
 * Collapsed, the rail is a column of icons. Hovering it (or tabbing into it) lays a wider
 * layer over the chat where every icon grows its name, so nobody waits for a tooltip.
 */
export function WorkspaceIconRail({ activePanel, onToggle, expanded, onExpandedChange }: RailProps) {
  const finePointer = useFinePointer()
  const timer = useRef<number | null>(null)
  const [focusedId, setFocusedId] = useState<WorkspacePanelId | null>(null)

  const schedule = (open: boolean) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onExpandedChange(open), open ? HOVER_OPEN_MS : HOVER_CLOSE_MS)
  }
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const choose = (panel: WorkspacePanelId) => {
    if (timer.current) window.clearTimeout(timer.current)
    onExpandedChange(false)
    onToggle(panel)
  }

  return (
    <div
      className="db-rail-wrap"
      onPointerEnter={(event) => { if (finePointer && event.pointerType === 'mouse') schedule(true) }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') schedule(false) }}
    >
      <nav className="db-icon-rail" aria-label="Workspace panels">
        {WORKSPACE_PANEL_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              className={`db-rail-btn${activePanel === item.id ? ' is-active' : ''}`}
              onClick={() => choose(item.id)}
              onFocus={(event) => { if (event.currentTarget.matches(':focus-visible')) { setFocusedId(item.id); onExpandedChange(true) } }}
              onBlur={() => { setFocusedId(null); onExpandedChange(false) }}
              aria-label={item.label}
              aria-pressed={activePanel === item.id}
            >
              <Icon size={16} />
            </button>
          )
        })}
      </nav>

      <AnimatePresence>
        {expanded && (
          // Pointer layer over the real buttons above, which stay the accessible controls.
          <motion.div
            className="db-rail-expanded"
            aria-hidden
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15, ease: EASE_IN } }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
          >
            {WORKSPACE_PANEL_ITEMS.map((item, index) => {
              const Icon = item.icon
              const active = activePanel === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  tabIndex={-1}
                  className={`db-rail-item${active ? ' is-active' : ''}${focusedId === item.id ? ' is-focused' : ''}`}
                  onClick={() => choose(item.id)}
                >
                  <span className={`db-rail-btn${active ? ' is-active' : ''}`}><Icon size={16} /></span>
                  <motion.span
                    className="db-rail-label"
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.02, duration: 0.15, ease: EASE_OUT }}
                  >
                    {item.label}
                  </motion.span>
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Phone menu ───────────────────────────────────────────────────────────────

/**
 * On phones the rail becomes one "Workspace" button that opens this bottom sheet.
 * Portalled to <body> so it rises above the floating dock instead of the workspace's layer.
 */
export function WorkspaceMenuSheet({ open, activePanel, onClose, onChoose }: { open: boolean; activePanel: WorkspacePanelId | null; onClose: () => void; onChoose: (panel: WorkspacePanelId) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  // Move focus into the sheet, and give it back to whatever opened it.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => opener?.focus?.()
  }, [open])

  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const items = event.currentTarget.querySelectorAll<HTMLElement>('button')
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.button type="button" className="kv-sheet-backdrop" aria-label="Close workspace menu" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className="kv-sheet"
            role="dialog"
            aria-modal="true"
            onKeyDown={trapTab}
            aria-label="Workspace"
            initial={{ y: '110%' }}
            animate={{ y: 0 }}
            exit={{ y: '110%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="kv-sheet-head">
              <span className="kv-eyebrow">Workspace</span>
              <button ref={closeRef} type="button" className="kv-icon-btn" onClick={onClose} aria-label="Close workspace menu"><X size={14} /></button>
            </div>
            {WORKSPACE_PANEL_ITEMS.map((item) => {
              const Icon = item.icon
              const active = activePanel === item.id
              return (
                <button key={item.id} type="button" className={`kv-sheet-item kv-sheet-item-rich${active ? ' active' : ''}`} onClick={() => onChoose(item.id)}>
                  <span className={`db-rail-btn${active ? ' is-active' : ''}`}><Icon size={16} /></span>
                  <span className="kv-sheet-item-text">
                    <span>{item.label}</span>
                    <small>{item.hint}</small>
                  </span>
                </button>
              )
            })}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}

// ─── Overlay panel content ────────────────────────────────────────────────────

export function WorkspaceOverlayPanel({
  panel,
  repoId,
  repositoryName,
  entries,
  files,
  chatSources,
  entriesLoading,
  entriesError,
  filesLoading,
  filesError,
  onNavigate,
  gitVisualization,
  gitVisualizationLoading,
  gitVisualizationError,
  historyNode,
}: WorkspaceOverlayProps & { panel: WorkspacePanelId }) {
  const referencedEntries = (entries.length ? entries : (chatSources as any[])).slice(0, 7)
  const shortRepo = repositoryName.includes('/') ? repositoryName.split('/').pop() ?? repositoryName : repositoryName

  const pillStyle: React.CSSProperties = { fontFamily: "'Gabarito', sans-serif", fontSize: 11, border: '1px solid var(--kv-line)', borderRadius: 9999, padding: '3px 10px', color: 'rgb(var(--kv-ink-rgb) / 0.55)', background: 'var(--kv-surface)' }
  const cardStyle: React.CSSProperties = { borderRadius: 16, border: '1px solid var(--kv-line)', background: 'var(--kv-mist-2)', padding: '12px 14px', marginBottom: 8 }
  const labelStyle: React.CSSProperties = { fontFamily: "'Gabarito', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: 'rgb(var(--kv-ink-rgb) / 0.4)', marginBottom: 10 }

  if (panel === 'repository') return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={cardStyle}>
        <p style={labelStyle}>Repository</p>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, color: 'var(--kv-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortRepo}</p>
      </div>
      <div className="db-repo-stats-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[['PR Contexts', entries.length], ['Indexed Files', files.length]].map(([label, value]) => (
          <div key={label as string} style={{ borderRadius: 14, border: '1px solid var(--kv-line)', background: 'var(--kv-mist-2)', padding: '10px 14px' }}>
            <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, color: 'rgb(var(--kv-ink-rgb) / 0.5)', marginBottom: 4 }}>{label}</p>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 20, fontWeight: 600, color: 'var(--kv-ink)' }}>{value}</p>
          </div>
        ))}
      </div>
      <Link to={`/timeline?repoId=${repoId}`} onClick={onNavigate} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 20px', background: 'var(--kv-solid)', color: 'var(--kv-on-solid)', borderRadius: 9999, border: 'none', fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}>
        Project timeline <ArrowRight size={13} />
      </Link>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Link to={`/why?repoId=${repoId}`} onClick={onNavigate} className="kv-btn kv-btn-soft kv-btn-sm">Why-Lens</Link>
        <Link to={`/insights?repoId=${repoId}`} onClick={onNavigate} className="kv-btn kv-btn-soft kv-btn-sm">Insights</Link>
      </div>
      <Link to="/repositories" onClick={onNavigate} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 20px', background: 'var(--kv-mist)', color: 'var(--kv-ink)', borderRadius: 9999, border: '1px solid var(--kv-line)', fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}>
        Switch repository <FolderGit2 size={13} />
      </Link>
    </section>
  )

  if (panel === 'history') return <>{historyNode}</>

  if (panel === 'focus') return (
    <section style={cardStyle}>
      <p style={labelStyle}>Workspace Focus</p>
      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, lineHeight: 1.6, color: 'var(--kv-ink-2)', marginBottom: 8 }}>Ask architecture-level questions and trace PR evolution quickly.</p>
      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, lineHeight: 1.6, color: 'var(--kv-ink-2)', marginBottom: 8 }}>Use concise prompts to get cleaner structured responses.</p>
      <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 12, color: 'rgb(var(--kv-ink-rgb) / 0.45)' }}>Tip: start with "Explain Entire Repo" for baseline context.</p>
    </section>
  )

  if (panel === 'prs') return (
    <section>
      <p style={labelStyle}>Referenced PRs</p>
      {entriesLoading ? (
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgb(var(--kv-ink-rgb) / 0.5)' }}>Loading pull requests…</p>
      ) : entriesError ? (
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'var(--kv-danger-ink)', display: 'flex', alignItems: 'center', gap: 4 }}><AlertCircle size={12} /> Unable to load PR context.</p>
      ) : referencedEntries.length ? referencedEntries.map((entry: any, i: number) => {
        const prNumber = entry?.pr_number ?? entry?.github_pr_number ?? entry?.pr ?? '?'
        const title = entry?.pr_title ?? entry?.title ?? 'Untitled pull request'
        const summary = entry?.intent ?? entry?.summary ?? entry?.excerpt ?? 'No summary available.'
        return (
          <div key={`${title}-${i}`} style={cardStyle}>
            <p style={{ ...pillStyle, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 6 }}><GitPullRequest size={11} /> PR #{prNumber}</p>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: 'var(--kv-ink)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</p>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, color: 'var(--kv-ink-2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{summary}</p>
          </div>
        )
      }) : <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgb(var(--kv-ink-rgb) / 0.5)' }}>No PR context available yet.</p>}
    </section>
  )

  if (panel === 'git') return (
    <section>
      <p style={labelStyle}>Git Visualization</p>
      <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 12, color: 'rgb(var(--kv-ink-rgb) / 0.55)', marginBottom: 10 }}>
        Main branch stays centered while side branches are split left and right, with merge paths connected per PR.
      </p>
      <GitVisualizationPanel data={gitVisualization} loading={gitVisualizationLoading} error={gitVisualizationError} />
    </section>
  )

  return (
    <section>
      <p style={labelStyle}>Indexed Files</p>
      {filesLoading ? (
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgb(var(--kv-ink-rgb) / 0.5)' }}>Loading files…</p>
      ) : filesError ? (
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'var(--kv-danger-ink)', display: 'flex', alignItems: 'center', gap: 4 }}><AlertCircle size={12} /> Unable to load files.</p>
      ) : files.length ? files.slice(0, 14).map((file: any) => {
        const { fileName, directory } = splitFilePath(file.file_path)
        return (
          <Link key={file.file_path} to={`/file?repoId=${repoId}&path=${encodeURIComponent(file.file_path)}`} onClick={onNavigate} style={{ display: 'block', ...cardStyle, textDecoration: 'none' }}>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, fontWeight: 600, color: 'var(--kv-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</p>
            <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 12, color: 'rgb(var(--kv-ink-rgb) / 0.45)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{directory || '(repository root)'}</p>
          </Link>
        )
      }) : <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgb(var(--kv-ink-rgb) / 0.5)' }}>No files indexed.</p>}
    </section>
  )
}
