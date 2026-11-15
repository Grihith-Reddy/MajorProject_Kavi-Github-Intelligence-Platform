import { motion } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, FlaskConical, Handshake, Network, ShieldCheck, type LucideIcon } from 'lucide-react'

import cloudImg from '../assets/cloud.webp'
import { GuardianPanel } from '../features/insights/GuardianPanel'
import { KnowledgeMapPanel } from '../features/insights/KnowledgeMapPanel'
import { PromisesPanel } from '../features/insights/PromisesPanel'
import { QualityPanel } from '../features/insights/QualityPanel'
import '../features/insights/insights.css'
import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { getRepositoryStatus } from '../services/githubService'

type TabId = 'promises' | 'map' | 'guardian' | 'quality'
const TABS: Array<{ id: TabId; label: string; icon: LucideIcon; blurb: string }> = [
  { id: 'promises', label: 'Promises', icon: Handshake, blurb: 'Commitments made in reviews, and whether they were kept.' },
  { id: 'map', label: 'Knowledge map', icon: Network, blurb: 'Who holds the context for each module, and what changes together.' },
  { id: 'guardian', label: 'Guardian', icon: ShieldCheck, blurb: 'Pull requests checked against the decisions your team already made.' },
  { id: 'quality', label: 'Quality', icon: FlaskConical, blurb: 'How reliably KAVI retrieves the right evidence, measured.' },
]
const ACTIVE_REPO_STORAGE_KEY = 'kavi.activeRepoId'

function readStoredRepoId(): string | null {
  try { return window.localStorage.getItem(ACTIVE_REPO_STORAGE_KEY) } catch { return null }
}

export function InsightsPage() {
  const api = useApiClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const repoId = searchParams.get('repoId') || readStoredRepoId()
  const tab = (TABS.find((item) => item.id === searchParams.get('tab'))?.id ?? 'promises') as TabId
  const { data: status } = useAsync(() => (repoId ? getRepositoryStatus(api, repoId) : Promise.resolve(null)), [api, repoId])
  const repoName = status?.repository?.full_name ?? ''
  const active = TABS.find((item) => item.id === tab)!

  if (!repoId) {
    return (
      <div className="ins-empty" style={{ padding: '64px 32px' }}>
        <p className="ins-empty-title">No repository selected</p>
        <p className="ins-empty-text">Open a synced repository to see what it remembers.</p>
        <Link to="/repositories" className="kv-btn kv-btn-dark">Open repositories <ArrowRight size={14} /></Link>
      </div>
    )
  }

  const selectTab = (id: TabId) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', id)
    next.set('repoId', repoId)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="ins-page">
      <motion.header
        className="ins-hero"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="ins-hero-clip"><img src={cloudImg} alt="" /></div>
        <div className="ins-hero-text">
          <p className="ins-eyebrow">Insights{repoName ? ` · ${repoName}` : ''}</p>
          <h1 className="ins-hero-h1 kv-balance">What this repository remembers.</h1>
        </div>
        <p className="ins-hero-blurb">{active.blurb}</p>
      </motion.header>

      <nav className="ins-tabs" role="tablist" aria-label="Insight views">
        {TABS.map((item) => {
          const Icon = item.icon
          const selected = item.id === tab
          return (
            <button key={item.id} type="button" role="tab" aria-selected={selected} className={`ins-tab${selected ? ' is-active' : ''}`} onClick={() => selectTab(item.id)}>
              {selected && <motion.span layoutId="ins-tab-indicator" className="ins-tab-indicator" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span className="ins-tab-content"><Icon size={15} strokeWidth={1.75} /> {item.label}</span>
            </button>
          )
        })}
      </nav>

      <motion.section
        key={tab}
        role="tabpanel"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
      >
        {tab === 'promises' && <PromisesPanel repoId={repoId} />}
        {tab === 'map' && <KnowledgeMapPanel repoId={repoId} />}
        {tab === 'guardian' && <GuardianPanel repoId={repoId} />}
        {tab === 'quality' && <QualityPanel repoId={repoId} />}
      </motion.section>
    </div>
  )
}
