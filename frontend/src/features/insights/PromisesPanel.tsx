import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, Check, GitPullRequest, RotateCcw, X } from 'lucide-react'

import { useAsync } from '../../hooks/useAsync'
import { useApiClient } from '../../services/apiClient'
import { getPromises, setPromiseStatus, type PromiseItem, type PromiseKind, type PromiseStatus } from '../../services/insightsService'
import { PanelError, PanelSkeleton } from './PanelStates'

const KIND_META: Record<PromiseKind, { label: string; color: string }> = {
  follow_up: { label: 'Follow-up', color: 'var(--kv-ice)' },
  temporary: { label: 'Temporary', color: 'var(--kv-peach)' },
  todo: { label: 'TODO', color: 'var(--kv-sand)' },
  tech_debt: { label: 'Tech debt', color: 'var(--kv-lilac)' },
}
const FILTERS: Array<{ id: PromiseStatus | 'all'; label: string }> = [
  { id: 'open', label: 'Open' },
  { id: 'kept', label: 'Kept' },
  { id: 'dismissed', label: 'Dismissed' },
  { id: 'all', label: 'All' },
]

function daysSince(value?: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round((Date.now() - parsed) / 86_400_000)) : null
}

function ageLabel(days: number | null): string {
  if (days === null) return 'date unknown'
  if (days < 1) return 'today'
  if (days < 31) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.round(days / 30)
  return months < 12 ? `${months} month${months === 1 ? '' : 's'} ago` : `${(days / 365).toFixed(1)} years ago`
}

export function PromisesPanel({ repoId }: { repoId: string }) {
  const api = useApiClient()
  const { data, error, loading, setData } = useAsync(() => getPromises(api, repoId), [api, repoId])
  const [filter, setFilter] = useState<PromiseStatus | 'all'>('open')
  const [busy, setBusy] = useState<string | null>(null)

  const promises = useMemo(() => data?.promises ?? [], [data])
  const visible = useMemo(() => (filter === 'all' ? promises : promises.filter((p) => p.status === filter)), [promises, filter])
  const maxAge = useMemo(() => Math.max(30, ...promises.map((p) => daysSince(p.made_at) ?? 0)), [promises])

  const update = async (promise: PromiseItem, status: PromiseStatus) => {
    setBusy(promise.id)
    try {
      await setPromiseStatus(api, promise.id, status)
      setData((current) => {
        if (!current) return current
        const next = current.promises.map((p) => (p.id === promise.id ? { ...p, status } : p))
        const count = (s: PromiseStatus) => next.filter((p) => p.status === s).length
        return { ...current, promises: next, stats: { ...current.stats, open: count('open'), kept: count('kept'), dismissed: count('dismissed') } }
      })
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <PanelSkeleton rows={4} />
  if (error) return <PanelError message="Couldn’t load the promise ledger." />
  const stats = data!.stats

  if (!stats.total) {
    return (
      <div className="ins-empty">
        <p className="ins-empty-title">No promises found yet</p>
        <p className="ins-empty-text">
          KAVI looks for commitments like “I’ll handle this in a follow-up” or “temporary workaround” in PR discussions.
          Resync the repository to scan its history.
        </p>
      </div>
    )
  }

  const keptRate = stats.kept + stats.open ? Math.round((stats.kept / (stats.kept + stats.open)) * 100) : 0

  return (
    <div className="ins-split">
      <aside className="ins-summary">
        <p className="kv-eyebrow">Promise ledger</p>
        <p className="ins-big kv-num">{stats.open}</p>
        <p className="ins-big-label">open promise{stats.open === 1 ? '' : 's'}</p>
        <div className="ins-stack" role="img" aria-label={`${stats.kept} kept, ${stats.open} open, ${stats.dismissed} dismissed`}>
          {[['kept', stats.kept, 'var(--kv-ink)'], ['open', stats.open, 'var(--kv-sky-2)'], ['dismissed', stats.dismissed, '#C9CDD1']].map(([key, value, color]) =>
            Number(value) > 0 ? (
              <motion.span key={key as string} initial={{ flexGrow: 0 }} animate={{ flexGrow: Number(value) }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} style={{ background: color as string, flexBasis: 0 }} />
            ) : null
          )}
        </div>
        <dl className="ins-facts">
          <div><dt>Kept so far</dt><dd className="kv-num">{keptRate}%</dd></div>
          <div><dt>Oldest open</dt><dd className="kv-num">{stats.oldest_open_days !== null ? `${stats.oldest_open_days} d` : '—'}</dd></div>
          <div><dt>Typical time to keep</dt><dd className="kv-num">{stats.median_days_to_keep !== null ? `${stats.median_days_to_keep} d` : '—'}</dd></div>
        </dl>
      </aside>

      <section className="ins-main">
        <div className="ins-filters" role="tablist" aria-label="Filter promises">
          {FILTERS.map((item) => {
            const count = item.id === 'all' ? stats.total : stats[item.id]
            return (
              <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={`ins-filter${filter === item.id ? ' is-active' : ''}`} onClick={() => setFilter(item.id)}>
                {item.label} <span className="kv-num">{count}</span>
              </button>
            )
          })}
        </div>

        <ul className="ins-list">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((promise, index) => {
              const age = daysSince(promise.made_at)
              const meta = KIND_META[promise.kind] ?? KIND_META.follow_up
              return (
                <motion.li
                  key={promise.id}
                  layout
                  className={`ins-promise is-${promise.status}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26, delay: Math.min(index, 8) * 0.02 }}
                >
                  <div className="ins-promise-top">
                    <span className="ins-kind" style={{ background: meta.color }}>{meta.label}</span>
                    <span className="ins-promise-age">{ageLabel(age)}</span>
                  </div>
                  <p className="ins-promise-title">{promise.summary || promise.quote}</p>
                  {promise.summary && <p className="ins-promise-quote">“{promise.quote}”</p>}
                  {promise.status === 'open' && age !== null && (
                    <div className="ins-age-bar" aria-hidden><span style={{ width: `${Math.min(100, (age / maxAge) * 100)}%` }} /></div>
                  )}
                  <div className="ins-promise-foot">
                    <span className="ins-promise-meta">
                      {promise.pr_url ? (
                        <a className="kv-chip" href={promise.pr_url} target="_blank" rel="noreferrer"><GitPullRequest size={11} /> PR #{promise.github_pr_number}</a>
                      ) : (
                        <span className="kv-chip"><GitPullRequest size={11} /> PR #{promise.github_pr_number}</span>
                      )}
                      {promise.author_login && <span>by @{promise.author_login}</span>}
                    </span>
                    <span className="ins-promise-actions">
                      {promise.status === 'open' ? (
                        <>
                          <button type="button" className="kv-icon-btn" title="Mark as kept" aria-label="Mark as kept" disabled={busy === promise.id} onClick={() => update(promise, 'kept')}><Check size={14} /></button>
                          <button type="button" className="kv-icon-btn" title="Dismiss" aria-label="Dismiss" disabled={busy === promise.id} onClick={() => update(promise, 'dismissed')}><X size={14} /></button>
                        </>
                      ) : (
                        <button type="button" className="kv-icon-btn" title="Reopen" aria-label="Reopen" disabled={busy === promise.id} onClick={() => update(promise, 'open')}><RotateCcw size={13} /></button>
                      )}
                    </span>
                  </div>
                  {promise.status === 'kept' && promise.resolved_pr_number && (
                    <div className="ins-kept">
                      <Check size={13} strokeWidth={2.5} />
                      <span>
                        Kept in{' '}
                        {promise.resolved_pr_url ? (
                          <a href={promise.resolved_pr_url} target="_blank" rel="noreferrer">PR #{promise.resolved_pr_number} <ArrowUpRight size={11} /></a>
                        ) : (
                          `PR #${promise.resolved_pr_number}`
                        )}
                        {promise.resolution_note ? ` · ${promise.resolution_note}` : ''}
                      </span>
                    </div>
                  )}
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
        {!visible.length && <p className="ins-muted">Nothing here.</p>}
      </section>
    </div>
  )
}
