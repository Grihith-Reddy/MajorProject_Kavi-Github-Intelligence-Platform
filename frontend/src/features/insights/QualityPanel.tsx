import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FlaskConical } from 'lucide-react'

import { useApiClient } from '../../services/apiClient'
import { getQualityRuns, startQualityRun, type EvalRun, type StrategyMetrics } from '../../services/insightsService'
import { getApiErrorMessage } from '../../utils/errors'
import { PanelError, PanelSkeleton } from './PanelStates'

const STRATEGIES: Array<{ id: 'fulltext' | 'lexical' | 'semantic' | 'hybrid'; label: string; note: string }> = [
  { id: 'fulltext', label: 'Full-text', note: 'PostgreSQL text search (KAVI 1.0)' },
  { id: 'lexical', label: 'Keyword', note: 'Term and file-path matching' },
  { id: 'semantic', label: 'Semantic', note: 'Gemini embeddings, cosine similarity' },
  { id: 'hybrid', label: 'Hybrid', note: 'All three fused with reciprocal rank fusion' },
]
const METRICS: Array<{ id: keyof StrategyMetrics; label: string }> = [
  { id: 'recall@1', label: 'Top 1' },
  { id: 'recall@3', label: 'Top 3' },
  { id: 'recall@5', label: 'Top 5' },
  { id: 'mrr', label: 'MRR' },
]

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

export function QualityPanel({ repoId }: { repoId: string }) {
  const api = useApiClient()
  const [runs, setRuns] = useState<EvalRun[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const load = useCallback(async () => {
    try {
      setRuns(await getQualityRuns(api, repoId))
    } catch (err) {
      setError(getApiErrorMessage(err, 'Couldn’t load evaluation runs'))
    }
  }, [api, repoId])

  useEffect(() => { void load() }, [load])
  const latest = runs?.[0]
  const running = latest?.status === 'running'

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => { void load() }, 3000)
    return () => clearInterval(timer)
  }, [running, load])

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      await startQualityRun(api, repoId)
      await load()
    } catch (err) {
      setError(getApiErrorMessage(err, 'Couldn’t start the evaluation'))
    } finally {
      setStarting(false)
    }
  }

  if (runs === null && !error) return <PanelSkeleton rows={2} />
  if (runs === null && error) return <PanelError message={error} />

  const completed = runs?.find((run) => run.status === 'completed' && run.metrics)
  const metrics = completed?.metrics
  const best = metrics ? STRATEGIES.reduce((a, b) => (metrics.strategies[b.id]['recall@5'] > metrics.strategies[a.id]['recall@5'] ? b : a)) : null
  const gain = metrics ? metrics.strategies.hybrid['recall@5'] - metrics.strategies.fulltext['recall@5'] : 0

  return (
    <div className="ins-stack-col">
      <div className="ins-quality-head">
        <div>
          <p className="ins-card-title" style={{ marginBottom: 4 }}>How well does KAVI find the right evidence?</p>
          <p className="ins-muted" style={{ maxWidth: '62ch' }}>
            KAVI writes questions a newcomer might ask, each answered by a known pull request, then checks where every retrieval
            strategy ranks that pull request. No training involved: it measures the system as it runs.
          </p>
        </div>
        <button type="button" className="kv-btn kv-btn-dark kv-btn-sm" onClick={start} disabled={starting || running}>
          <FlaskConical size={14} /> {running ? 'Evaluating…' : completed ? 'Run again' : 'Run evaluation'}
        </button>
      </div>

      {error && <PanelError message={error} />}
      {latest?.status === 'failed' && <PanelError message={latest.error || 'The last evaluation failed.'} />}
      {running && (
        <div className="ins-running"><span className="kv-trace-pulse is-active" /> Generating questions and scoring four strategies. This takes about a minute.</div>
      )}

      {metrics ? (
        <>
          <div className="ins-headline">
            <p className="ins-big kv-num">{pct(metrics.strategies.hybrid['recall@5'])}</p>
            <p className="ins-headline-text">
              of questions have the right pull request in hybrid retrieval’s top five
              {gain > 0 ? <>: <strong className="kv-num">+{Math.round(gain * 100)} points</strong> over KAVI 1.0’s full-text search.</> : '.'}
              <span className="ins-muted"> {metrics.question_count} {metrics.question_source === 'generated' ? 'AI-written' : 'template'} questions · {metrics.duration_seconds}s</span>
            </p>
          </div>

          <div className="ins-scoreboard" role="table" aria-label="Retrieval quality by strategy">
            <div className="ins-score-row is-head" role="row">
              <span role="columnheader">Strategy</span>
              {METRICS.map((metric) => <span key={metric.id} role="columnheader">{metric.label}</span>)}
            </div>
            {STRATEGIES.map((strategy, rowIndex) => (
              <div key={strategy.id} className={`ins-score-row${best?.id === strategy.id ? ' is-best' : ''}`} role="row">
                <span className="ins-score-name" role="cell">
                  <strong>{strategy.label}</strong>
                  <small>{strategy.note}</small>
                </span>
                {METRICS.map((metric) => {
                  const value = metrics.strategies[strategy.id][metric.id]
                  return (
                    <span key={metric.id} className="ins-score-cell" role="cell">
                      <span className="ins-score-bar"><motion.span initial={{ width: 0 }} animate={{ width: `${value * 100}%` }} transition={{ type: 'spring', stiffness: 110, damping: 20, delay: rowIndex * 0.06 }} /></span>
                      <span className="kv-num">{metric.id === 'mrr' ? value.toFixed(2) : pct(value)}</span>
                    </span>
                  )
                })}
              </div>
            ))}
          </div>

          {completed?.cases && (
            <details className="ins-cases">
              <summary>See every question and where each strategy ranked the answer</summary>
              <div className="ins-cases-table">
                {completed.cases.map((item, index) => (
                  <div key={index} className="ins-case">
                    <p className="ins-case-q">{item.question}</p>
                    <div className="ins-case-ranks">
                      <span className="kv-chip">PR #{item.pr_number}</span>
                      {STRATEGIES.map((strategy) => {
                        const rank = item.ranks[strategy.id]
                        return (
                          <span key={strategy.id} className={`ins-rank${rank === 1 ? ' is-top' : rank ? ' is-found' : ''}`} title={strategy.label}>
                            {strategy.label.slice(0, 4)} {rank ? `#${rank}` : '—'}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      ) : (
        !running && (
          <div className="ins-empty">
            <p className="ins-empty-title">No evaluation yet</p>
            <p className="ins-empty-text">Run one to compare KAVI’s retrieval strategies on this repository. It needs at least five indexed pull requests.</p>
          </div>
        )
      )}
    </div>
  )
}
