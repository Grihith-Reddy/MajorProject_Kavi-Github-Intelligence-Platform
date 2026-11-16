import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FileCode2,
  GitCommitHorizontal,
  GitPullRequest,
  MessageSquareText,
  ScanLine,
  Search,
} from 'lucide-react'

import cloudImg from '../assets/cloud.webp'
import { CodeLens } from '../features/whylens/CodeLens'
import { HistorySlider } from '../features/whylens/HistorySlider'
import { COMMIT_COLOR, PR_COLORS, segmentKey } from '../features/whylens/whyLensUtils'
import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { getRepositoryTree, getWhyLens, type WhyLensResponse, type WhySegment } from '../services/insightsService'
import { listKnowledgeFiles } from '../services/knowledgeService'
import { getApiErrorMessage } from '../utils/errors'

const CARD_COLORS = ['var(--kv-sand)', 'var(--kv-lilac)', 'var(--kv-peach)', 'var(--kv-ice)', 'var(--kv-sage)', 'var(--kv-mint)']
const ACTIVE_REPO_STORAGE_KEY = 'kavi.activeRepoId'

function formatDate(value?: string | null): string {
  if (!value) return ''
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}

function readStoredRepoId(): string | null {
  try { return window.localStorage.getItem(ACTIVE_REPO_STORAGE_KEY) } catch { return null }
}

// ── File picker ─────────────────────────────────────────────────────────────

function FilePicker({ repoId, onPick }: { repoId: string; onPick: (path: string) => void }) {
  const api = useApiClient()
  const { data, loading, error } = useAsync(() => getRepositoryTree(api, repoId), [api, repoId])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)

  const matches = useMemo(() => {
    const files = data?.files ?? []
    const q = query.trim().toLowerCase()
    if (!q) return []
    return files
      .filter((file) => file.path.toLowerCase().includes(q))
      .sort((a, b) => {
        const aName = a.path.split('/').pop()!.toLowerCase().includes(q) ? 0 : 1
        const bName = b.path.split('/').pop()!.toLowerCase().includes(q) ? 0 : 1
        return aName - bName || a.path.length - b.path.length
      })
      .slice(0, 8)
  }, [data, query])

  const pick = (path: string) => {
    setQuery('')
    setOpen(false)
    onPick(path)
  }

  return (
    <div className="wl-picker">
      <div className="wl-search">
        <Search size={16} color="rgb(var(--kv-ink-rgb) / 0.45)" />
        <input
          value={query}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setHighlight(0) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((h) => Math.min(h + 1, matches.length - 1)) }
            if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
            if (event.key === 'Enter' && matches[highlight]) pick(matches[highlight].path)
          }}
          placeholder={loading ? 'Loading files…' : error ? 'File list unavailable' : 'Open a file…'}
          aria-label="Search repository files"
          disabled={Boolean(error)}
        />
      </div>
      <AnimatePresence>
        {open && matches.length > 0 && (
          <motion.ul
            className="wl-results"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            {matches.map((file, index) => {
              const parts = file.path.split('/')
              const name = parts.pop()
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    className={index === highlight ? 'is-active' : ''}
                    onMouseDown={(event) => { event.preventDefault(); pick(file.path) }}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    <FileCode2 size={14} />
                    <span className="wl-result-name">{name}</span>
                    <span className="wl-result-dir">{parts.join('/')}</span>
                  </button>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export function WhyLensPage() {
  const api = useApiClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const repoId = searchParams.get('repoId') || readStoredRepoId()
  const path = searchParams.get('path')
  const lineParam = Number(searchParams.get('line')) || null

  const [data, setData] = useState<WhyLensResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [focusLine, setFocusLine] = useState<number | null>(null)
  const [asOf, setAsOf] = useState<string | null>(null)
  const [historySegments, setHistorySegments] = useState<WhySegment[]>([])

  const { data: hotFiles } = useAsync(() => (repoId ? listKnowledgeFiles(api, repoId) : Promise.resolve(null)), [api, repoId])

  useEffect(() => {
    if (!repoId || !path) { setData(null); return }
    let active = true
    setLoading(true)
    setError(null)
    getWhyLens(api, repoId, path, asOf)
      .then((result) => {
        if (!active) return
        setData(result)
        // Keep the newest blame's dates as slider stops while scrubbing into the past.
        if (!asOf) setHistorySegments(result.segments)
        const target = lineParam
          ? result.segments.find((s) => s.start_line <= lineParam && s.end_line >= lineParam)
          : result.segments.find((s) => s.pr_number && s.pr_number === result.prs[0]?.pr_number) ?? result.segments[0]
        setActiveKey(target ? segmentKey(target) : null)
        setFocusLine(lineParam)
      })
      .catch((err) => { if (active) setError(getApiErrorMessage(err, 'Unable to open this file')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, repoId, path, lineParam, asOf])

  useEffect(() => { setAsOf(null); setHistorySegments([]) }, [path])

  const colorByPr = useMemo(() => {
    const map = new Map<number, string>()
    data?.prs.forEach((pr, index) => map.set(pr.pr_number, PR_COLORS[index % PR_COLORS.length]))
    return map
  }, [data])
  const colorFor = (segment: WhySegment) => (segment.pr_number ? colorByPr.get(segment.pr_number) ?? PR_COLORS[0] : COMMIT_COLOR)

  const activeSegments = useMemo(() => data?.segments.filter((s) => segmentKey(s) === activeKey) ?? [], [data, activeKey])
  const activeSegment = activeSegments[0] ?? null
  const activePr = activeSegment?.pr_number ? data?.prs.find((pr) => pr.pr_number === activeSegment.pr_number) ?? null : null
  const activeRange = activeSegments.length
    ? { start: Math.min(...activeSegments.map((s) => s.start_line)), end: Math.max(...activeSegments.map((s) => s.end_line)) }
    : null
  const totalBlamedLines = data?.segments.reduce((sum, s) => sum + (s.end_line - s.start_line + 1), 0) ?? 0
  const commitOnlyLines = data?.segments.filter((s) => !s.pr_number).reduce((sum, s) => sum + (s.end_line - s.start_line + 1), 0) ?? 0

  const openPath = (nextPath: string) => {
    const params = new URLSearchParams()
    if (repoId) params.set('repoId', repoId)
    params.set('path', nextPath)
    setSearchParams(params)
  }

  const askAboutSelection = () => {
    if (!repoId || !data || !activeRange) return
    const question = `Why do lines ${activeRange.start}-${activeRange.end} of ${data.path} exist, and what would break if I changed them?`
    navigate(`/chat?repoId=${encodeURIComponent(repoId)}&ask=${encodeURIComponent(question)}`)
  }

  const selectPr = (prNumber: number) => {
    const segment = data?.segments.find((s) => s.pr_number === prNumber)
    if (!segment) return
    setActiveKey(segmentKey(segment))
    setFocusLine(segment.start_line)
  }

  if (!repoId) {
    return (
      <div className="wl-empty">
        <p className="wl-empty-title">No repository selected</p>
        <p className="wl-empty-text">Open a synced repository first to trace why its code exists.</p>
        <Link to="/repositories" className="kv-btn kv-btn-dark">Open repositories <ArrowRight size={14} /></Link>
      </div>
    )
  }

  const fileName = path?.split('/').pop()
  const directory = path?.split('/').slice(0, -1).join('/')

  return (
    <>
      <style>{WHY_LENS_CSS}</style>
      <div className="wl-page">
        <motion.header
          className="wl-hero"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="wl-hero-clip"><img src={cloudImg} alt="" className="wl-hero-cloud" /></div>
          <div className="wl-hero-text">
            <p className="wl-eyebrow"><ScanLine size={14} /> Why-Lens</p>
            <h1 className="wl-hero-h1">{fileName ?? <>Why does this<br />code exist?</>}</h1>
            {directory !== undefined && <p className="wl-hero-path">{directory || 'repository root'}</p>}
          </div>
          <FilePicker repoId={repoId} onPick={openPath} />
        </motion.header>

        {!path && (
          <section>
            <p className="kv-eyebrow" style={{ margin: '8px 4px 12px' }}>Most-changed files</p>
            <div className="wl-hot-grid">
              {((hotFiles?.files ?? []) as Array<{ file_path: string; reference_count?: number }>).slice(0, 9).map((file, index) => (
                <motion.button
                  key={file.file_path}
                  type="button"
                  className="wl-hot-card"
                  style={{ background: CARD_COLORS[index % CARD_COLORS.length] }}
                  onClick={() => openPath(file.file_path)}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 26, delay: index * 0.05 }}
                >
                  <span className="wl-hot-icon"><FileCode2 size={18} strokeWidth={1.5} /></span>
                  <span className="wl-hot-name">{file.file_path.split('/').pop()}</span>
                  <span className="wl-hot-dir">{file.file_path.split('/').slice(0, -1).join('/') || 'repository root'}</span>
                  <span className="wl-hot-foot">
                    <span className="kv-pill" style={{ background: 'rgb(var(--kv-veil-rgb) / 0.55)' }}><GitPullRequest size={11} /> {file.reference_count ?? 0} PRs</span>
                    <ArrowRight size={15} />
                  </span>
                </motion.button>
              ))}
            </div>
            {!(hotFiles?.files ?? []).length && (
              <div className="wl-empty" style={{ marginTop: 0 }}>
                <p className="wl-empty-text">Search for any file above to see which pull requests shaped each of its lines.</p>
              </div>
            )}
          </section>
        )}

        {path && loading && !data && (
          <div className="wl-layout" aria-busy="true">
            <div className="wl-skeleton" style={{ height: 520 }} />
            <div className="wl-skeleton" style={{ height: 360 }} />
          </div>
        )}

        {path && error && !loading && (
          <div className="wl-empty">
            <p className="wl-empty-title">Couldn’t open {fileName}</p>
            <p className="wl-empty-text">{error}</p>
          </div>
        )}

        {path && data && !error && (
          <HistorySlider segments={historySegments.length ? historySegments : data.segments} value={asOf} onChange={setAsOf} disabled={loading} />
        )}

        {path && data && !error && (
          <div className={`wl-layout${loading ? ' is-loading' : ''}`}>
            <CodeLens
              data={data}
              colorFor={colorFor}
              activeKey={activeKey}
              hoverKey={hoverKey}
              onHover={setHoverKey}
              onSelect={(segment) => setActiveKey(segmentKey(segment))}
              focusLine={focusLine}
            />

            <aside className="wl-side">
              <div className="wl-card">
                <p className="kv-eyebrow">Who shaped this file</p>
                <div className="wl-composition" role="img" aria-label="Share of lines by pull request">
                  {data.prs.filter((pr) => pr.line_count > 0).map((pr) => (
                    <motion.button
                      key={pr.pr_number}
                      type="button"
                      title={`PR #${pr.pr_number}: ${pr.line_count} lines`}
                      onClick={() => selectPr(pr.pr_number)}
                      initial={{ flexGrow: 0 }}
                      animate={{ flexGrow: pr.line_count }}
                      transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                      style={{ background: colorByPr.get(pr.pr_number), flexBasis: 0 }}
                      className={activePr?.pr_number === pr.pr_number ? 'is-active' : ''}
                    />
                  ))}
                  {commitOnlyLines > 0 && (
                    <motion.span initial={{ flexGrow: 0 }} animate={{ flexGrow: commitOnlyLines }} style={{ background: '#C9CDD1', flexBasis: 0 }} />
                  )}
                </div>
                <ul className="wl-legend">
                  {data.prs.slice(0, 6).map((pr) => (
                    <li key={pr.pr_number}>
                      <button type="button" onClick={() => selectPr(pr.pr_number)} className={activePr?.pr_number === pr.pr_number ? 'is-active' : ''}>
                        <span className="wl-dot" style={{ background: colorByPr.get(pr.pr_number) }} />
                        <span className="wl-legend-title">#{pr.pr_number} {pr.title}</span>
                        <span className="wl-legend-share">{totalBlamedLines ? Math.round((pr.line_count / totalBlamedLines) * 100) : 0}%</span>
                      </button>
                    </li>
                  ))}
                  {commitOnlyLines > 0 && (
                    <li>
                      <span className="wl-legend-static">
                        <span className="wl-dot" style={{ background: '#C9CDD1' }} />
                        <span className="wl-legend-title">Direct commits (no PR)</span>
                        <span className="wl-legend-share">{Math.round((commitOnlyLines / Math.max(totalBlamedLines, 1)) * 100)}%</span>
                      </span>
                    </li>
                  )}
                </ul>
              </div>

              <AnimatePresence mode="wait">
                {activeSegment && (
                  <motion.div
                    key={activeKey}
                    className="wl-card wl-intent"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
                    transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                  >
                    <div className="wl-intent-head">
                      <span className="wl-intent-band" style={{ background: colorFor(activeSegment) }} />
                      {activePr ? (
                        <span className="kv-pill"><GitPullRequest size={11} /> PR #{activePr.pr_number}</span>
                      ) : (
                        <span className="kv-pill"><GitCommitHorizontal size={11} /> {activeSegment.commit_short}</span>
                      )}
                      {activeRange && <span className="kv-pill">Lines {activeRange.start}–{activeRange.end}</span>}
                    </div>
                    <p className="wl-intent-title">{activePr?.title ?? activeSegment.commit_headline ?? 'Direct commit'}</p>
                    <p className="wl-intent-meta">
                      {(activePr?.author_login ?? activeSegment.author_login ?? activeSegment.author_name) || 'Unknown author'}
                      {' · '}
                      {formatDate(activePr?.merged_at ?? activeSegment.committed_at)}
                    </p>

                    {activePr?.intent ? (
                      <blockquote className="wl-intent-quote">{activePr.intent}</blockquote>
                    ) : activePr && !activePr.indexed ? (
                      <p className="wl-intent-note">KAVI hasn’t indexed this pull request yet. Resync the repository to capture its intent.</p>
                    ) : !activePr ? (
                      <p className="wl-intent-note">These lines were committed directly, without a pull request, so no discussion was recorded.</p>
                    ) : null}

                    {activePr?.summary && <p className="wl-intent-summary">{activePr.summary}</p>}

                    {!!activePr?.decisions?.length && (
                      <div className="wl-intent-block">
                        <p className="kv-eyebrow">Decisions</p>
                        <ul>
                          {activePr.decisions.slice(0, 5).map((decision, i) => (
                            <li key={i}><CheckCircle2 size={13} /> {decision}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!!activePr?.risks?.length && (
                      <div className="wl-intent-block is-risk">
                        <p className="kv-eyebrow">Risks noted</p>
                        <ul>
                          {activePr.risks.slice(0, 4).map((risk, i) => (
                            <li key={i}><AlertTriangle size={13} /> {risk}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="wl-intent-actions">
                      <button type="button" className="kv-btn kv-btn-dark kv-btn-sm" onClick={askAboutSelection}>
                        <MessageSquareText size={14} /> Ask KAVI about these lines
                      </button>
                      {(activePr?.url ?? activeSegment.pr_url) && (
                        <a className="kv-btn kv-btn-soft kv-btn-sm" href={(activePr?.url ?? activeSegment.pr_url) as string} target="_blank" rel="noreferrer">
                          Open PR <ArrowUpRight size={14} />
                        </a>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </aside>
          </div>
        )}
      </div>
    </>
  )
}

const WHY_LENS_CSS = `
.wl-page { display: flex; flex-direction: column; gap: 16px; }

.wl-hero {
  position: relative;
  overflow: visible;
  border-radius: 32px;
  padding: 56px 56px 60px;
  background: linear-gradient(170deg, var(--kv-sky-1) 0%, var(--kv-sky-2) 100%);
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  min-height: 240px;
  z-index: 5;
}
.wl-hero-clip { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; }
.wl-hero-cloud { position: absolute; width: 110%; left: -5%; bottom: -20%; opacity: 0.5; mix-blend-mode: screen; }
.wl-hero-text { position: relative; z-index: 2; min-width: 0; }
.wl-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-family: var(--kv-font-label); font-size: 14px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--kv-sky-ink); margin-bottom: 14px; }
.wl-hero-h1 {
  font-family: var(--kv-font-read);
  font-weight: 600;
  font-size: clamp(30px, 6vw, 64px);
  line-height: 1.05;
  letter-spacing: -0.025em;
  background: linear-gradient(169deg, var(--kv-hero-text-from) 20%, var(--kv-hero-text-to) 74%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  overflow-wrap: anywhere;
}
.wl-hero-path { margin-top: 10px; font-family: var(--kv-font-mono); font-size: 13px; color: rgba(3, 90, 135, 0.8); overflow-wrap: anywhere; }

.wl-picker { position: relative; z-index: 3; flex-shrink: 0; width: min(360px, 100%); }
.wl-search { display: flex; align-items: center; gap: 10px; background: rgb(var(--kv-veil-rgb) / 0.92); backdrop-filter: blur(12px); border-radius: 9999px; padding: 12px 20px; }
.wl-search input { border: none; outline: none; background: transparent; width: 100%; font-family: var(--kv-font-read); font-size: 15px; color: var(--kv-ink); box-shadow: none; padding: 0; }
.wl-search input::placeholder { color: rgb(var(--kv-ink-rgb) / 0.4); }
.wl-results { position: absolute; top: calc(100% + 8px); left: 0; right: 0; list-style: none; margin: 0; padding: 6px; background: var(--kv-surface); border: 1px solid var(--kv-line); border-radius: 20px; box-shadow: 0 24px 48px rgb(var(--kv-ink-rgb) / 0.14); transform-origin: top; }
.wl-results button { width: 100%; display: grid; grid-template-columns: 16px auto minmax(0, 1fr); align-items: center; gap: 8px; text-align: left; padding: 9px 12px; border-radius: 14px; border: none; background: transparent; cursor: pointer; color: var(--kv-ink); }
.wl-results button.is-active { background: var(--kv-mist); }
.wl-result-name { font-family: var(--kv-font-read); font-size: 14px; font-weight: 600; white-space: nowrap; }
.wl-result-dir { font-family: var(--kv-font-label); font-size: 12px; color: var(--kv-ink-4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wl-hot-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.wl-hot-card { display: flex; flex-direction: column; align-items: flex-start; text-align: left; gap: 4px; min-height: 190px; border: none; border-radius: 28px; padding: 26px; cursor: pointer; transition: transform 0.22s var(--kv-spring), box-shadow 0.22s ease; }
.wl-hot-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgb(var(--kv-ink-rgb) / 0.1); }
.wl-hot-icon { width: 40px; height: 40px; border-radius: 14px; background: rgb(var(--kv-ink-rgb) / 0.08); display: inline-flex; align-items: center; justify-content: center; color: var(--kv-ink); margin-bottom: 14px; }
.wl-hot-name { font-family: var(--kv-font-read); font-size: 18px; font-weight: 600; color: var(--kv-ink); letter-spacing: -0.01em; overflow-wrap: anywhere; }
.wl-hot-dir { font-family: var(--kv-font-label); font-size: 13px; color: rgb(var(--kv-ink-rgb) / 0.5); overflow-wrap: anywhere; }
.wl-hot-foot { margin-top: auto; padding-top: 16px; width: 100%; display: flex; align-items: center; justify-content: space-between; color: var(--kv-ink); }

.wl-layout { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 16px; align-items: start; }
.wl-skeleton { border-radius: 24px; background: var(--kv-mist); position: relative; overflow: hidden; }
.wl-skeleton::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgb(var(--kv-veil-rgb) / 0.6), transparent); animation: wl-shimmer 1.4s infinite; }
@keyframes wl-shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }

.wl-code { border-radius: 24px; overflow: hidden; background: #0B0F13; border: 1px solid #1F262B; }
.wl-code-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: #10171D; border-bottom: 1px solid #1F262B; }
.wl-code-title { display: inline-flex; align-items: center; gap: 8px; font-family: var(--kv-font-read); font-size: 13px; font-weight: 600; color: #E6EDF3; min-width: 0; }
.wl-code-meta { display: inline-flex; gap: 6px; font-family: var(--kv-font-label); font-size: 12px; color: #6D7B89; white-space: nowrap; overflow: hidden; }
.wl-code-body { height: calc(100vh - 300px); min-height: 360px; overflow: auto; padding: 0; font-family: var(--kv-font-mono); font-size: 12.5px; line-height: 1.6; color: #E6EDF3; scrollbar-width: thin; scrollbar-color: #2A333A transparent; }
.wl-line { position: relative; display: grid; grid-template-columns: 4px 52px minmax(0, 1fr) auto; align-items: center; height: 20px; line-height: 20px; cursor: pointer; white-space: pre; transition: background 0.12s ease; }
.wl-band { align-self: stretch; background: var(--band); opacity: 0.55; transition: opacity 0.15s ease; }
.wl-line.is-hover { background: rgba(255,255,255,0.035); }
.wl-line.is-hover .wl-band { opacity: 0.85; }
.wl-line.is-active { background: color-mix(in srgb, var(--band) 11%, transparent); }
.wl-line.is-active .wl-band { opacity: 1; }
.wl-line.is-focus .wl-num { color: #fff; }
.wl-num { color: #56636F; text-align: right; padding-right: 14px; user-select: none; }
.wl-src { padding-right: 16px; }
.wl-tag { position: sticky; right: 10px; margin-right: 10px; font-family: var(--kv-font-label); font-size: 11px; font-weight: 600; padding: 0 7px; border-radius: 9999px; background: rgba(255,255,255,0.06); border: 1px solid currentColor; line-height: 1.5; align-self: center; }

.wl-side { position: sticky; top: 100px; display: flex; flex-direction: column; gap: 12px; }
.wl-card { border-radius: 24px; border: 1px solid var(--kv-line); background: var(--kv-mist); padding: 18px; }
.wl-composition { display: flex; gap: 3px; height: 14px; margin: 12px 0 14px; border-radius: 9999px; overflow: hidden; }
.wl-composition > * { border: none; padding: 0; min-width: 4px; cursor: pointer; transition: filter 0.15s ease, transform 0.2s var(--kv-spring); }
.wl-composition > button:hover, .wl-composition > button.is-active { filter: saturate(1.4) brightness(0.92); }
.wl-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.wl-legend button, .wl-legend-static { width: 100%; display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 12px; border: none; background: transparent; cursor: pointer; text-align: left; }
.wl-legend-static { cursor: default; }
.wl-legend button:hover, .wl-legend button.is-active { background: var(--kv-surface); }
.wl-dot { width: 10px; height: 10px; border-radius: 9999px; }
.wl-legend-title { font-family: var(--kv-font-read); font-size: 13px; color: var(--kv-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wl-legend-share { font-family: var(--kv-font-label); font-size: 12px; color: var(--kv-ink-3); font-variant-numeric: tabular-nums; }

.wl-intent { background: var(--kv-surface); box-shadow: 0 16px 40px rgb(var(--kv-ink-rgb) / 0.06); }
.wl-intent-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.wl-intent-band { width: 18px; height: 18px; border-radius: 6px; }
.wl-intent-title { font-family: var(--kv-font-read); font-size: 17px; font-weight: 600; letter-spacing: -0.01em; color: var(--kv-ink); line-height: 1.3; }
.wl-intent-meta { font-family: var(--kv-font-label); font-size: 13px; color: var(--kv-ink-3); margin: 4px 0 12px; }
.wl-intent-quote { margin: 0 0 12px; padding: 12px 14px; border-radius: 16px; background: var(--kv-ice); font-family: var(--kv-font-read); font-size: 15px; line-height: 1.55; color: var(--kv-ink); }
.wl-intent-note { margin: 0 0 12px; padding: 12px 14px; border-radius: 16px; background: var(--kv-mist); font-family: var(--kv-font-read); font-size: 13px; line-height: 1.55; color: var(--kv-ink-2); }
.wl-intent-summary { font-family: var(--kv-font-read); font-size: 13px; line-height: 1.6; color: var(--kv-ink-2); margin-bottom: 12px; }
.wl-intent-block { margin-bottom: 12px; }
.wl-intent-block ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.wl-intent-block li { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 8px; font-family: var(--kv-font-read); font-size: 13px; line-height: 1.5; color: var(--kv-ink-2); }
.wl-intent-block li svg { margin-top: 3px; color: var(--kv-ok-ink); }
.wl-intent-block.is-risk li svg { color: var(--kv-warn-ink); }
.wl-intent-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }

.wl-empty { border-radius: 32px; background: var(--kv-mist); border: 1px solid var(--kv-line); padding: 56px 32px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.wl-empty-title { font-family: var(--kv-font-read); font-size: 22px; font-weight: 600; color: var(--kv-ink); }
.wl-empty-text { font-family: var(--kv-font-read); font-size: 15px; color: var(--kv-ink-2); max-width: 480px; margin-bottom: 8px; }

.wl-code-tools { display: flex; align-items: center; gap: 12px; min-width: 0; }
.wl-search-in { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px 0 10px; border-radius: 9999px; background: #0b0f13; border: 1px solid #263039; color: #8b98a5; }
.wl-search-in:focus-within { border-color: #4a6a82; }
.wl-search-in input { width: 130px; border: none; outline: none; background: transparent; color: #e6edf3; font-family: var(--kv-font-read); font-size: 12.5px; padding: 0; box-shadow: none; }
.wl-search-in input::placeholder { color: #5d6b78; }
.wl-search-in button { width: 22px; height: 22px; border-radius: 9999px; border: none; background: transparent; color: #a9b6c2; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.wl-search-in button:hover:not(:disabled) { background: #1c252d; color: #fff; }
.wl-search-in button:disabled { opacity: 0.35; cursor: default; }
.wl-search-count { font-family: var(--kv-font-label); font-size: 11.5px; color: #8b98a5; font-variant-numeric: tabular-nums; }
.wl-code-main { display: grid; grid-template-columns: minmax(0, 1fr) 14px; }
.wl-line.is-match .wl-src { background: rgba(247, 215, 116, 0.12); }
.wl-line.is-current-match .wl-src { background: rgba(247, 215, 116, 0.28); }
.wl-minimap { position: relative; background: #0d1217; border-left: 1px solid #1f262b; cursor: pointer; }
.wl-mini-band { position: absolute; left: 3px; right: 3px; border-radius: 2px; opacity: 0.55; transition: opacity 0.15s ease; }
.wl-mini-band.is-active { opacity: 1; }
.wl-mini-match { position: absolute; left: 0; right: 0; height: 2px; background: #f7d774; }
.wl-mini-viewport { position: absolute; left: 0; right: 0; background: rgba(230, 237, 243, 0.12); border: 1px solid rgba(230, 237, 243, 0.25); border-radius: 3px; pointer-events: none; }
.wl-history { display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-radius: 9999px; background: var(--kv-mist); border: 1px solid var(--kv-line); }
.wl-history-label { display: inline-flex; align-items: center; gap: 6px; font-family: var(--kv-font-label); font-size: 13px; font-weight: 600; color: var(--kv-ink-2); white-space: nowrap; }
.wl-history-range { flex: 1; appearance: none; height: 6px; border-radius: 9999px; background: linear-gradient(90deg, var(--kv-solid) var(--fill), var(--kv-line) var(--fill)); cursor: pointer; }
.wl-history-range::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; border-radius: 9999px; background: var(--kv-surface); border: 2px solid var(--kv-solid); box-shadow: 0 2px 8px rgb(var(--kv-shadow-rgb) / 0.2); transition: transform 0.2s var(--kv-spring); }
.wl-history-range::-webkit-slider-thumb:hover { transform: scale(1.15); }
.wl-history-range::-moz-range-thumb { width: 16px; height: 16px; border-radius: 9999px; background: var(--kv-surface); border: 2px solid var(--kv-solid); }
.wl-history-range:disabled { opacity: 0.5; }
.wl-history-value { min-width: 96px; text-align: right; font-family: var(--kv-font-read); font-size: 13px; font-weight: 600; color: var(--kv-ink); font-variant-numeric: tabular-nums; }
.wl-history-value.is-past { color: var(--kv-sky-ink); }
.wl-layout.is-loading { opacity: 0.55; pointer-events: none; transition: opacity 0.2s ease; }
@media (max-width: 768px) { .wl-search-in input { width: 90px; } .wl-code-meta { display: none; } .wl-history { border-radius: 20px; flex-wrap: wrap; } }

@media (max-width: 1100px) {
  .wl-layout { grid-template-columns: 1fr; }
  .wl-side { position: static; }
  .wl-hot-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 768px) {
  .wl-hero { padding: 36px 28px 40px; flex-direction: column; align-items: flex-start; min-height: auto; }
  .wl-picker { width: 100%; }
  .wl-hot-grid { grid-template-columns: 1fr; }
  .wl-code-body { max-height: 70vh; }
}
@media (max-width: 560px) {
  .wl-hero { border-radius: 20px; padding: 28px 16px 32px; }
  .wl-line { grid-template-columns: 3px 40px minmax(0, 1fr) auto; }
  .wl-num { padding-right: 10px; }
}
`
