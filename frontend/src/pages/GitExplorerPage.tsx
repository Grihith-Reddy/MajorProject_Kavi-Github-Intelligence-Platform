import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ExternalLink, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, Search, Users2, X } from 'lucide-react'

import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { getGitExplorer, type GitExplorerCommit, type GitExplorerResponse } from '../services/knowledgeService'
import { getApiErrorMessage } from '../utils/errors'
import { asRepoId } from '../utils/repoId'
import { safeExternalUrl } from '../utils/safeUrl'
import {
  COMPACT, ROOMY, ROW_HEIGHT, layoutGraph, monthlyActivity, summariseBranches, summarisePeople, toExplorerPrs,
  type ExplorerPr, type LanePath, type PrStatus,
} from '../features/git/gitLayout'
import '../features/git/gitExplorer.css'

type Tab = 'graph' | 'branches' | 'people' | 'activity'
type StatusFilter = 'all' | PrStatus

const STATUS_LABEL: Record<PrStatus, string> = { merged: 'Merged', open: 'Open', closed: 'Closed' }

function relative(ms: number) {
  if (!ms) return 'unknown'
  const days = Math.round((Date.now() - ms) / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  return `${(days / 365).toFixed(1)} years ago`
}
const day = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const parse = (value: string | null | undefined) => (value ? Date.parse(value) || 0 : 0)
function duration(fromMs: number, toMs: number) {
  if (!fromMs || !toMs || toMs < fromMs) return '—'
  const hours = (toMs - fromMs) / 3_600_000
  if (hours < 1) return 'under an hour'
  if (hours < 48) return `${Math.round(hours)} hours`
  return `${Math.round(hours / 24)} days`
}

export function GitExplorerPage() {
  const api = useApiClient()
  const [searchParams] = useSearchParams()
  const repoId = asRepoId(searchParams.get('repoId'))
  const { data, error, loading } = useAsync(() => (repoId ? getGitExplorer(api, repoId) : Promise.resolve(null)), [api, repoId])
  return <GitExplorerView repoId={repoId} data={data} error={error} loading={loading} />
}

/** The page without data loading, so it can be rendered from any source of Git Explorer data. */
export function GitExplorerView({ repoId, data, error, loading }: {
  repoId: string | null
  data: GitExplorerResponse | null
  error: Error | null
  loading: boolean
}) {
  const [tab, setTab] = useState<Tab>('graph')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)

  const mainBranch = data?.repository?.default_branch || 'main'
  const allCommits: GitExplorerCommit[] = useMemo(() => (Array.isArray(data?.commits) ? data.commits : []), [data])
  const allPrs = useMemo(
    () => toExplorerPrs(Array.isArray(data?.pull_requests) ? data.pull_requests : [], allCommits, mainBranch),
    [data, allCommits, mainBranch]
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '')
    return allPrs.filter((pr) => {
      if (status !== 'all' && pr.status !== status) return false
      if (!q) return true
      return [String(pr.github_pr_number), pr.title, pr.head, pr.base, pr.author_login].some((v) => (v ?? '').toLowerCase().includes(q))
    })
  }, [allPrs, query, status])
  const compact = useNarrowScreen()
  const layout = useMemo(() => layoutGraph(filtered, mainBranch, compact ? COMPACT : ROOMY), [filtered, mainBranch, compact])
  const branches = useMemo(() => summariseBranches(allPrs), [allPrs])
  const people = useMemo(() => summarisePeople(allPrs), [allPrs])
  const months = useMemo(() => monthlyActivity(allPrs), [allPrs])
  const selectedPr = allPrs.find((pr) => pr.github_pr_number === selected) ?? null

  useEffect(() => {
    if (selected == null) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  if (!repoId) {
    return (
      <div className="gx-card gx-empty">
        <p className="gx-empty-title">No repository selected</p>
        <p className="gx-muted">Open a repository in chat first, then choose Git Explorer from the side dock.</p>
        <Link to="/repositories" className="kv-btn kv-btn-dark">Back to repositories</Link>
      </div>
    )
  }

  const repoName = data?.repository?.full_name ?? 'Repository'
  const shortName = repoName.includes('/') ? repoName.split('/').pop() : repoName
  const merged = allPrs.filter((pr) => pr.status === 'merged').length
  const open = allPrs.filter((pr) => pr.status === 'open').length
  const directCommits = allCommits.filter((c) => c.github_pr_number == null).length
  const totalCommits = allPrs.reduce((sum, pr) => sum + (pr.commit_count || 0), 0) + directCommits
  const firstAt = allPrs.reduce((min, pr) => (pr.startAt && pr.startAt < min ? pr.startAt : min), Infinity)
  const lastAt = allPrs.reduce((max, pr) => Math.max(max, pr.eventAt), 0)

  return (
    <div className="gx-page">
      <header className="gx-head">
        <Link to={`/chat?repoId=${repoId}`} className="gx-back"><ArrowLeft size={14} /> Back to chat</Link>
        <p className="gx-eyebrow">Git Explorer</p>
        <h1 className="gx-title">{shortName}</h1>
        <p className="gx-muted">
          Every branch, pull request and commit KAVI has synced{Number.isFinite(firstAt) && lastAt ? `, from ${day(firstAt)} to ${day(lastAt)}` : ''}.
        </p>
      </header>

      {loading ? (
        <div className="gx-card gx-muted">Loading the repository's history…</div>
      ) : error ? (
        <div className="gx-card gx-error"><AlertCircle size={14} /> {getApiErrorMessage(error, 'Unable to load the Git history.')}</div>
      ) : !allPrs.length ? (
        <div className="gx-card gx-empty">
          <p className="gx-empty-title">No pull requests synced yet</p>
          <p className="gx-muted">Sync this repository from the repositories page, and its branches and merges will appear here.</p>
        </div>
      ) : (
        <>
          <section className="gx-stats" aria-label="Repository summary">
            {[
              ['Pull requests', allPrs.length, GitPullRequest],
              ['Merged', merged, GitMerge],
              ['Open', open, GitPullRequest],
              ['Branches', branches.length, GitBranch],
              ['Commits', totalCommits, GitCommitHorizontal],
              ['People', people.length, Users2],
            ].map(([label, value, Icon]) => {
              const I = Icon as typeof GitBranch
              return (
                <div key={label as string} className="gx-stat">
                  <span className="gx-stat-label"><I size={13} /> {label as string}</span>
                  <span className="gx-stat-value">{(value as number).toLocaleString()}</span>
                </div>
              )
            })}
          </section>

          <div className="gx-tabs" role="tablist" aria-label="Git Explorer views">
            {(['graph', 'branches', 'people', 'activity'] as Tab[]).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={`gx-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>
                {id === 'graph' ? 'Graph' : id === 'branches' ? 'Branches' : id === 'people' ? 'People' : 'Activity'}
              </button>
            ))}
          </div>

          {tab === 'graph' && (
            <div className={`gx-main${selectedPr ? ' has-drawer' : ''}`}>
              <section className="gx-card gx-graph-card">
                <div className="gx-toolbar">
                  <label className="gx-search">
                    <span className="gx-sr">Search pull requests</span>
                    <Search size={14} aria-hidden />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, branch, author or #number" />
                  </label>
                  <div className="gx-segment" role="group" aria-label="Filter by status">
                    {(['all', 'merged', 'open', 'closed'] as StatusFilter[]).map((s) => (
                      <button key={s} type="button" aria-pressed={status === s} className={status === s ? 'is-active' : ''} onClick={() => setStatus(s)}>
                        {s === 'all' ? 'All' : STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
                <Legend mainBranch={mainBranch} />
                {filtered.length ? (
                  <GraphView layout={layout} selected={selected} hovered={hovered} onHover={setHovered} onSelect={setSelected} />
                ) : (
                  <p className="gx-muted gx-pad">No pull requests match these filters.</p>
                )}
              </section>
              {selectedPr && <DetailDrawer pr={selectedPr} repoId={repoId} onClose={() => setSelected(null)} />}
            </div>
          )}

          {tab === 'branches' && <BranchesView branches={branches} mainBranch={mainBranch} />}
          {tab === 'people' && <PeopleView people={people} commits={allCommits} />}
          {tab === 'activity' && <ActivityView months={months} prs={allPrs} />}
        </>
      )}
    </div>
  )
}

function useNarrowScreen() {
  const query = '(max-width: 640px)'
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setNarrow(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return narrow
}

function Legend({ mainBranch }: { mainBranch: string }) {
  return (
    <div className="gx-legend" aria-hidden>
      <span><svg width="14" height="14"><line x1="7" y1="0" x2="7" y2="14" stroke="var(--kv-ink)" strokeWidth="2.2" /></svg> {mainBranch}</span>
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#15AEEA" stroke="var(--kv-surface)" strokeWidth="2" /></svg> Merged</span>
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="4.5" fill="var(--kv-surface)" stroke="#15AEEA" strokeWidth="2" /></svg> Open</span>
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="4.5" fill="var(--kv-surface)" stroke="rgb(var(--kv-ink-rgb) / 0.4)" strokeWidth="2" strokeDasharray="2 2" /></svg> Closed</span>
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="2.6" fill="#15AEEA" /></svg> Commit</span>
    </div>
  )
}

function lanePathD(p: LanePath, laneX: (lane: number) => number) {
  const x = laneX(p.lane)
  const bx = laneX(p.baseLane)
  const { topY, bottomY } = p
  const fork = `M ${bx} ${bottomY} C ${bx} ${bottomY - 10}, ${x} ${bottomY - 6}, ${x} ${bottomY - 16}`
  if (p.pr.status === 'merged') return `${fork} L ${x} ${topY + 16} C ${x} ${topY + 6}, ${bx} ${topY + 10}, ${bx} ${topY}`
  return `${fork} L ${x} ${topY}`
}

function GraphView({ layout, selected, hovered, onHover, onSelect }: {
  layout: ReturnType<typeof layoutGraph>
  selected: number | null
  hovered: number | null
  onHover: (n: number | null) => void
  onSelect: (n: number | null) => void
}) {
  const focus = hovered ?? selected
  const laneX = layout.laneX
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <div className="gx-graph-scroll" ref={scrollRef}>
      <div className="gx-graph-body" style={{ gridTemplateColumns: `${layout.width}px minmax(0, 1fr)`, height: layout.height }}>
        <svg width={layout.width} height={layout.height} className="gx-svg" role="img" aria-label={`Branch graph of ${layout.rows.length} pull requests`}>
          <line x1={laneX(0)} y1={0} x2={laneX(0)} y2={layout.height} stroke="var(--kv-ink)" strokeWidth={2.2} strokeLinecap="round" />
          {layout.paths.map((p) => {
            const dim = focus != null && focus !== p.pr.github_pr_number
            const strong = focus === p.pr.github_pr_number
            return (
              <g key={p.pr.github_pr_number} opacity={dim ? 0.22 : 1}>
                {p.lane !== 0 && (
                  <path d={lanePathD(p, laneX)} fill="none" stroke={p.color} strokeWidth={strong ? 3 : 2}
                    strokeDasharray={p.pr.status === 'closed' ? '4 4' : undefined} strokeLinecap="round" />
                )}
                {p.lane !== 0 && p.commitYs.map((y, i) => <circle key={i} cx={laneX(p.lane)} cy={y} r={2.6} fill={p.color} />)}
                {p.pr.status === 'merged' ? (
                  <circle cx={laneX(p.baseLane)} cy={p.topY} r={strong ? 7 : 5.5} fill={p.lane === 0 ? 'var(--kv-ink)' : p.color} stroke="var(--kv-surface)" strokeWidth={2} />
                ) : (
                  <circle cx={laneX(p.lane)} cy={p.topY} r={strong ? 6.5 : 5} fill="var(--kv-surface)"
                    stroke={p.pr.status === 'open' ? p.color : 'rgb(var(--kv-ink-rgb) / 0.4)'} strokeWidth={2}
                    strokeDasharray={p.pr.status === 'closed' ? '2 2' : undefined} />
                )}
              </g>
            )
          })}
        </svg>
        <ol className="gx-rows">
          {layout.rows.map((pr) => (
            <li key={pr.github_pr_number} style={{ height: ROW_HEIGHT }}>
              <button
                type="button"
                className={`gx-row${selected === pr.github_pr_number ? ' is-selected' : ''}`}
                aria-pressed={selected === pr.github_pr_number}
                onMouseEnter={() => onHover(pr.github_pr_number)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(pr.github_pr_number)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(selected === pr.github_pr_number ? null : pr.github_pr_number)}
              >
                <span className="gx-row-title">
                  <span className={`gx-badge gx-badge-${pr.status}`}>{STATUS_LABEL[pr.status]}</span>
                  <span className="gx-ellipsis">{pr.title || 'Untitled pull request'}</span>
                </span>
                <span className="gx-row-meta">
                  <span>#{pr.github_pr_number}</span>
                  {pr.author_login && <span>{pr.author_login}</span>}
                  <span className="gx-branches">
                    <code className="gx-branch" title={pr.head}>{pr.head}</code>
                    <span aria-label="into">→</span>
                    <code className="gx-branch" title={pr.base}>{pr.base}</code>
                  </span>
                  <span>{pr.commit_count || pr.commits.length} commits</span>
                  <span>{relative(pr.eventAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function DetailDrawer({ pr, repoId, onClose }: { pr: ExplorerPr; repoId: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [pr.github_pr_number])
  const url = safeExternalUrl(pr.url)
  const reviewers = (pr.participants ?? []).filter((p) => p.role !== 'author')
  const opened = parse(pr.created_at)
  const finished = parse(pr.merged_at) || (pr.status === 'closed' ? parse(pr.updated_at) : 0)
  return (
    <>
      <button type="button" className="gx-drawer-backdrop" aria-label="Close details" onClick={onClose} />
      <aside className="gx-card gx-drawer" aria-label={`Pull request #${pr.github_pr_number}`}>
        <div className="gx-drawer-head">
          <span className={`gx-badge gx-badge-${pr.status}`}>{STATUS_LABEL[pr.status]}</span>
          <span className="gx-muted">#{pr.github_pr_number}</span>
          <button ref={closeRef} type="button" className="kv-icon-btn gx-drawer-close" onClick={onClose} aria-label="Close details"><X size={14} /></button>
        </div>
        <h2 className="gx-drawer-title">{pr.title || 'Untitled pull request'}</h2>
        <p className="gx-branches gx-drawer-branches">
          <code className="gx-branch" title={pr.head}>{pr.head}</code> <span>→</span> <code className="gx-branch" title={pr.base}>{pr.base}</code>
        </p>

        <dl className="gx-facts">
          <div><dt>Author</dt><dd>{pr.author_login || '—'}</dd></div>
          <div><dt>Opened</dt><dd>{day(opened)}</dd></div>
          <div><dt>{pr.status === 'merged' ? 'Merged' : pr.status === 'closed' ? 'Closed' : 'Last update'}</dt><dd>{day(finished || parse(pr.updated_at))}</dd></div>
          <div><dt>Lifetime</dt><dd>{pr.status === 'open' ? `open ${relative(opened).replace(' ago', '')}` : duration(opened, finished)}</dd></div>
        </dl>

        {(pr.intent || pr.summary) && (
          <section className="gx-drawer-section">
            <h3>Why it was made</h3>
            {pr.intent && <p>{pr.intent}</p>}
            {pr.summary && pr.summary !== pr.intent && <p className="gx-muted">{pr.summary}</p>}
            {!!pr.tags?.length && <p className="gx-tags">{pr.tags.map((t) => <span key={t} className="gx-tag">{t}</span>)}</p>}
          </section>
        )}

        <section className="gx-drawer-section">
          <h3>Commits <span className="gx-count">{pr.commit_count || pr.commits.length}</span></h3>
          {pr.commits.length ? (
            <ol className="gx-commits">
              {pr.commits.slice().reverse().map((c) => {
                const link = safeExternalUrl(c.url)
                return (
                  <li key={c.github_sha}>
                    <code className="gx-sha">{link ? <a href={link} target="_blank" rel="noreferrer">{c.github_sha.slice(0, 7)}</a> : c.github_sha.slice(0, 7)}</code>
                    <span className="gx-commit-msg">{c.message || '(no message)'}</span>
                    <span className="gx-muted gx-commit-meta">{c.author_name || 'unknown'} · {relative(parse(c.committed_at))}</span>
                  </li>
                )
              })}
            </ol>
          ) : <p className="gx-muted">No commits recorded for this pull request.</p>}
        </section>

        {!!reviewers.length && (
          <section className="gx-drawer-section">
            <h3>Reviewers and commenters</h3>
            <p className="gx-tags">{reviewers.map((p) => <span key={`${p.login}-${p.role}`} className="gx-tag">{p.login} · {p.role} · {p.interactions}</span>)}</p>
          </section>
        )}

        {!!pr.files?.length && (
          <section className="gx-drawer-section">
            <h3>Files touched <span className="gx-count">{pr.files.length}</span></h3>
            <ul className="gx-files">
              {pr.files.slice(0, 20).map((f) => (
                <li key={f}><Link to={`/why?repoId=${repoId}&path=${encodeURIComponent(f)}`} title={`Open ${f} in Why-Lens`}>{f}</Link></li>
              ))}
            </ul>
          </section>
        )}

        {(pr.open_promises > 0 || pr.kept_promises > 0) && (
          <section className="gx-drawer-section">
            <h3>Promises made in review</h3>
            <p>{pr.open_promises} open · {pr.kept_promises} kept</p>
          </section>
        )}

        {url && <a className="kv-btn kv-btn-soft kv-btn-sm gx-gh" href={url} target="_blank" rel="noreferrer">Open on GitHub <ExternalLink size={12} /></a>}
      </aside>
    </>
  )
}

function BranchesView({ branches, mainBranch }: { branches: ReturnType<typeof summariseBranches>; mainBranch: string }) {
  return (
    <section className="gx-card gx-table-card">
      <p className="gx-muted gx-pad-b">{branches.length} branches have opened pull requests into <code className="gx-branch">{mainBranch}</code> or other branches.</p>
      <div className="gx-table-scroll">
        <table className="gx-table">
          <thead><tr><th>Branch</th><th>Into</th><th>PRs</th><th>Commits</th><th>Status</th><th>Active for</th><th>Last activity</th></tr></thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.name}>
                <td><code className="gx-branch gx-branch-wide" title={b.name}>{b.name}</code></td>
                <td>{b.targets.map((t) => <code key={t} className="gx-branch" title={t}>{t}</code>)}</td>
                <td>{b.prs}</td>
                <td>{b.commits}</td>
                <td><span className={`gx-badge gx-badge-${b.status}`}>{STATUS_LABEL[b.status]}</span></td>
                <td>{duration(b.firstAt, b.lastAt)}</td>
                <td>{relative(b.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PeopleView({ people, commits }: { people: ReturnType<typeof summarisePeople>; commits: GitExplorerCommit[] }) {
  const commitAuthors = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of commits) { const name = c.author_name || 'unknown'; map.set(name, (map.get(name) ?? 0) + 1) }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [commits])
  const maxCommits = Math.max(1, ...commitAuthors.map(([, n]) => n))
  return (
    <div className="gx-two">
      <section className="gx-card gx-table-card">
        <h2 className="gx-section-title">Who works on what</h2>
        <div className="gx-table-scroll">
          <table className="gx-table">
            <thead><tr><th>Person</th><th>PRs authored</th><th>Reviews</th><th>Comments</th><th>Last seen</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.login}><td>{p.login}</td><td>{p.authored}</td><td>{p.reviewed}</td><td>{p.commented}</td><td>{relative(p.lastAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="gx-card">
        <h2 className="gx-section-title">Commits by author</h2>
        <ul className="gx-bars">
          {commitAuthors.map(([name, n]) => (
            <li key={name}>
              <span className="gx-ellipsis">{name}</span>
              <span className="gx-bar"><span style={{ width: `${(n / maxCommits) * 100}%` }} /></span>
              <span className="gx-num">{n}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function ActivityView({ months, prs }: { months: ReturnType<typeof monthlyActivity>; prs: ExplorerPr[] }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.opened, m.merged)))
  const merges = prs.filter((p) => p.status === 'merged' && parse(p.created_at))
  const avgHours = merges.length ? merges.reduce((s, p) => s + (parse(p.merged_at) - parse(p.created_at)) / 3_600_000, 0) / merges.length : 0
  const busiest = months.slice().sort((a, b) => b.opened - a.opened)[0]
  const W = Math.max(months.length * 34, 320)
  return (
    <div className="gx-two">
      <section className="gx-card">
        <h2 className="gx-section-title">Pull requests per month</h2>
        <div className="gx-legend"><span><i className="gx-key gx-key-open" /> Opened</span><span><i className="gx-key gx-key-merged" /> Merged</span></div>
        <div className="gx-chart-scroll">
          <svg width={W} height={200} role="img" aria-label="Pull requests opened and merged per month">
            {months.map((m, i) => {
              const x = 14 + i * 34
              const h1 = (m.opened / max) * 150
              const h2 = (m.merged / max) * 150
              return (
                <g key={m.month}>
                  <title>{`${m.month}: ${m.opened} opened, ${m.merged} merged`}</title>
                  <rect x={x} y={170 - h1} width={12} height={h1} rx={3} fill="var(--kv-ice)" stroke="rgb(var(--kv-ink-rgb) / 0.25)" />
                  <rect x={x + 13} y={170 - h2} width={12} height={h2} rx={3} fill="#15AEEA" />
                  {(i % Math.ceil(months.length / 10) === 0) && <text x={x + 12} y={188} textAnchor="middle" className="gx-axis">{m.month.slice(2)}</text>}
                </g>
              )
            })}
            <line x1={8} y1={170} x2={W - 4} y2={170} stroke="var(--kv-line)" />
          </svg>
        </div>
      </section>
      <section className="gx-card">
        <h2 className="gx-section-title">At a glance</h2>
        <dl className="gx-facts gx-facts-col">
          <div><dt>Average time to merge</dt><dd>{avgHours ? (avgHours < 48 ? `${Math.round(avgHours)} hours` : `${Math.round(avgHours / 24)} days`) : '—'}</dd></div>
          <div><dt>Busiest month</dt><dd>{busiest ? `${busiest.month} · ${busiest.opened} opened` : '—'}</dd></div>
          <div><dt>Merge rate</dt><dd>{prs.length ? `${Math.round((merges.length / prs.length) * 100)}%` : '—'}</dd></div>
          <div><dt>Months with activity</dt><dd>{months.length}</dd></div>
        </dl>
      </section>
    </div>
  )
}
