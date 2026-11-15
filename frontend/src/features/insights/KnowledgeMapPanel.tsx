import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ScanLine } from 'lucide-react'

import { useAsync } from '../../hooks/useAsync'
import { useApiClient } from '../../services/apiClient'
import { getKnowledgeMap, type MapModule, type ModuleRisk } from '../../services/insightsService'
import { forceLayout } from './forceLayout'
import { PanelError, PanelSkeleton } from './PanelStates'

const WIDTH = 720
const HEIGHT = 480
const RISK_META: Record<ModuleRisk, { label: string; fill: string; ring: string; note: string }> = {
  healthy: { label: 'Shared context', fill: '#E4EED2', ring: '#9DB97A', note: 'Several people understand this module.' },
  single_expert: { label: 'Single expert', fill: '#FDF1D8', ring: '#D9A441', note: 'Most context sits with one active person.' },
  at_risk: { label: 'At risk', fill: '#FDE1D6', ring: '#C0583A', note: 'One person held the context and has gone quiet.' },
}

function shortName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function relativeDays(value?: string | null): string {
  if (!value) return 'unknown'
  const days = Math.round((Date.now() - Date.parse(value)) / 86_400_000)
  if (!Number.isFinite(days)) return 'unknown'
  if (days < 1) return 'today'
  if (days < 60) return `${days} days ago`
  return `${Math.round(days / 30)} months ago`
}

export function KnowledgeMapPanel({ repoId }: { repoId: string }) {
  const api = useApiClient()
  const { data, error, loading } = useAsync(() => getKnowledgeMap(api, repoId), [api, repoId])
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const layout = useMemo(() => {
    if (!data?.modules.length) return null
    const maxPrs = Math.max(...data.modules.map((m) => m.pr_count))
    const nodes = data.modules.map((m) => ({ id: m.id, radius: 14 + Math.sqrt(m.pr_count / maxPrs) * 26 }))
    const positions = forceLayout(nodes, data.edges.map((e) => ({ source: e.source, target: e.target, weight: e.strength })), WIDTH, HEIGHT)
    return { nodes, positions, radius: Object.fromEntries(nodes.map((n) => [n.id, n.radius])) }
  }, [data])

  const neighbours = useMemo(() => {
    const focus = hovered ?? selected
    if (!focus || !data) return null
    const set = new Set<string>([focus])
    for (const edge of data.edges) {
      if (edge.source === focus) set.add(edge.target)
      if (edge.target === focus) set.add(edge.source)
    }
    return set
  }, [hovered, selected, data])

  if (loading) return <PanelSkeleton rows={2} />
  if (error) return <PanelError message="Couldn’t build the knowledge map." />
  if (!data || !layout) {
    return (
      <div className="ins-empty">
        <p className="ins-empty-title">Not enough history yet</p>
        <p className="ins-empty-text">The map appears once KAVI has indexed pull requests that change files.</p>
      </div>
    )
  }

  const focusModule: MapModule | undefined = data.modules.find((m) => m.id === (selected ?? hovered)) ?? undefined
  const riskOrder: ModuleRisk[] = ['at_risk', 'single_expert', 'healthy']
  const ranked = [...data.modules].sort((a, b) => riskOrder.indexOf(a.risk) - riskOrder.indexOf(b.risk) || b.pr_count - a.pr_count)

  return (
    <div className="ins-split is-wide">
      <section className="ins-map-card">
        <div className="ins-map-legend">
          {riskOrder.map((risk) => (
            <span key={risk} className="ins-legend-item"><span className="ins-legend-dot" style={{ background: RISK_META[risk].fill, borderColor: RISK_META[risk].ring }} />{RISK_META[risk].label} <span className="kv-num">{data.summary[risk]}</span></span>
          ))}
          <span className="ins-legend-item ins-legend-line">Lines: changed together</span>
        </div>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="ins-map" role="img" aria-label="Modules sized by pull requests and linked when they change together" onMouseLeave={() => setHovered(null)}>
          {data.edges.map((edge) => {
            const a = layout.positions[edge.source]
            const b = layout.positions[edge.target]
            if (!a || !b) return null
            const active = !neighbours || (neighbours.has(edge.source) && neighbours.has(edge.target))
            return (
              <line
                key={`${edge.source}-${edge.target}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="#181D1F"
                strokeOpacity={active ? 0.12 + edge.strength * 0.35 : 0.04}
                strokeWidth={1 + edge.strength * 4}
                strokeLinecap="round"
                style={{ transition: 'stroke-opacity 0.2s ease' }}
              />
            )
          })}
          {data.modules.map((module, index) => {
            const p = layout.positions[module.id]
            const r = layout.radius[module.id]
            const meta = RISK_META[module.risk]
            const dim = neighbours && !neighbours.has(module.id)
            const isFocus = module.id === (selected ?? hovered)
            return (
              <motion.g
                key={module.id}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: dim ? 0.28 : 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 220, damping: 22, delay: Math.min(index, 20) * 0.02 }}
                style={{ transformOrigin: `${p.x}px ${p.y}px`, cursor: 'pointer' }}
                onMouseEnter={() => setHovered(module.id)}
                onClick={() => setSelected((current) => (current === module.id ? null : module.id))}
                role="button"
                aria-label={`${module.path}: ${module.pr_count} pull requests, ${meta.label}`}
              >
                <circle cx={p.x} cy={p.y} r={r + (isFocus ? 5 : 0)} fill={meta.fill} stroke={meta.ring} strokeWidth={isFocus ? 2.5 : 1.5} style={{ transition: 'r 0.25s cubic-bezier(0.34,1.56,0.64,1)' }} />
                {module.risk === 'at_risk' && <circle cx={p.x} cy={p.y} r={r + 9} fill="none" stroke={meta.ring} strokeOpacity={0.35} strokeDasharray="3 4" />}
                <text x={p.x} y={p.y + 4} textAnchor="middle" className="ins-map-count">{module.pr_count}</text>
                <text x={p.x} y={p.y + r + 15} textAnchor="middle" className="ins-map-label">{shortName(module.path)}</text>
              </motion.g>
            )
          })}
        </svg>
      </section>

      <aside className="ins-side">
        <AnimatePresence mode="wait">
          {focusModule ? (
            <motion.div key={focusModule.id} className="ins-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
              <span className="ins-risk-chip" style={{ background: RISK_META[focusModule.risk].fill, borderColor: RISK_META[focusModule.risk].ring }}>{RISK_META[focusModule.risk].label}</span>
              <p className="ins-card-title">{focusModule.path}</p>
              <p className="ins-muted">{RISK_META[focusModule.risk].note}</p>
              <dl className="ins-facts is-compact">
                <div><dt>Pull requests</dt><dd className="kv-num">{focusModule.pr_count}</dd></div>
                <div><dt>Files</dt><dd className="kv-num">{focusModule.file_count}</dd></div>
                <div><dt>Bus factor</dt><dd className="kv-num">{focusModule.bus_factor}</dd></div>
              </dl>
              <p className="kv-eyebrow" style={{ margin: '14px 0 8px' }}>Who holds the context</p>
              <ul className="ins-owners">
                {focusModule.contributors.map((person) => (
                  <li key={person.login}>
                    <span className="ins-owner-name">@{person.login}</span>
                    <span className="ins-owner-bar"><motion.span initial={{ width: 0 }} animate={{ width: `${Math.round(person.share * 100)}%` }} transition={{ type: 'spring', stiffness: 140, damping: 22 }} /></span>
                    <span className="ins-owner-share kv-num">{Math.round(person.share * 100)}%</span>
                    <span className="ins-owner-seen">active {relativeDays(person.last_seen_at)}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : (
            <motion.div key="overview" className="ins-card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
              <p className="kv-eyebrow" style={{ marginBottom: 10 }}>Modules by risk</p>
              <ul className="ins-risk-list">
                {ranked.slice(0, 8).map((module) => (
                  <li key={module.id}>
                    <button type="button" onClick={() => setSelected(module.id)} onMouseEnter={() => setHovered(module.id)} onMouseLeave={() => setHovered(null)}>
                      <span className="ins-legend-dot" style={{ background: RISK_META[module.risk].fill, borderColor: RISK_META[module.risk].ring }} />
                      <span className="ins-risk-name">{module.path}</span>
                      <span className="ins-risk-owner">{module.contributors[0] ? `@${module.contributors[0].login}` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {data.summary.strongest_coupling && (
                <p className="ins-coupling">
                  <strong>{shortName(data.summary.strongest_coupling.source)}</strong> and <strong>{shortName(data.summary.strongest_coupling.target)}</strong> changed together in{' '}
                  <span className="kv-num">{data.summary.strongest_coupling.shared_prs}</span> pull requests. A change to one usually needs the other.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <Link to={`/why?repoId=${encodeURIComponent(repoId)}`} className="kv-btn kv-btn-soft kv-btn-sm" style={{ alignSelf: 'flex-start' }}>
          <ScanLine size={14} /> Trace a file in Why-Lens
        </Link>
      </aside>
    </div>
  )
}
