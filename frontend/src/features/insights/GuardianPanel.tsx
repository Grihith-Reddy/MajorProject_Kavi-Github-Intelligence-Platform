import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ChevronDown, GitCompareArrows, ShieldCheck, UserRound } from 'lucide-react'

import { MarkdownMessage } from '../chat/MarkdownMessage'
import { useAsync } from '../../hooks/useAsync'
import { useApiClient } from '../../services/apiClient'
import { getGuardianReviews, type GuardianReview } from '../../services/insightsService'
import { PanelError, PanelSkeleton } from './PanelStates'

const VERDICT_META: Record<GuardianReview['verdict'], { label: string; bg: string; ink: string }> = {
  clear: { label: 'Clear', bg: 'var(--kv-sage)', ink: 'var(--kv-ok-ink)' },
  heads_up: { label: 'Worth a look', bg: 'var(--kv-warn-bg)', ink: 'var(--kv-warn-ink)' },
  conflict: { label: 'Possible conflict', bg: 'var(--kv-danger-bg)', ink: 'var(--kv-danger-ink)' },
}

// GitHub comments use HTML wrappers; the in-app renderer shows the Markdown parts.
function commentToMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^\s*<\/?(details|summary)|^\s*<!--|^\s*<sub>/.test(line))
    .map((line) => line.replace(/<summary>(.*?)<\/summary>/, '$1'))
    .join('\n')
    .replace(/^### .*\n/, '')
}

export function GuardianPanel({ repoId }: { repoId: string }) {
  const api = useApiClient()
  const { data, error, loading } = useAsync(() => getGuardianReviews(api, repoId), [api, repoId])
  const [open, setOpen] = useState<string | null>(null)

  if (loading) return <PanelSkeleton rows={3} />
  if (error) return <PanelError message="Couldn’t load Guardian reviews." />
  if (!data?.length) {
    return (
      <div className="ins-empty">
        <span className="ins-empty-icon"><ShieldCheck size={22} strokeWidth={1.5} /></span>
        <p className="ins-empty-title">Guardian hasn’t reviewed a pull request here yet</p>
        <p className="ins-empty-text">Add the Guardian workflow to this repository and every new pull request is checked against the decisions KAVI remembers.</p>
        <Link to="/settings" className="kv-btn kv-btn-dark kv-btn-sm">Set up Guardian</Link>
      </div>
    )
  }

  const counts = data.reduce<Record<string, number>>((acc, review) => ({ ...acc, [review.verdict]: (acc[review.verdict] ?? 0) + 1 }), {})

  return (
    <div className="ins-stack-col">
      <div className="ins-verdict-strip">
        {(Object.keys(VERDICT_META) as Array<GuardianReview['verdict']>).map((verdict) => (
          <span key={verdict} className="ins-verdict-count" style={{ background: VERDICT_META[verdict].bg, color: VERDICT_META[verdict].ink }}>
            <span className="kv-num">{counts[verdict] ?? 0}</span> {VERDICT_META[verdict].label.toLowerCase()}
          </span>
        ))}
      </div>
      <ul className="ins-list">
        {data.map((review, index) => {
          const meta = VERDICT_META[review.verdict]
          const expanded = open === review.id
          return (
            <motion.li key={review.id} className="ins-review" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.03 }}>
              <button type="button" className="ins-review-head" onClick={() => setOpen(expanded ? null : review.id)} aria-expanded={expanded}>
                <span className="ins-verdict" style={{ background: meta.bg, color: meta.ink }}>{meta.label}</span>
                <span className="ins-review-title">Pull request #{review.pr_number}</span>
                <span className="ins-review-meta kv-num">{review.head_sha.slice(0, 7)} · {new Date(review.created_at).toLocaleDateString()}</span>
                <motion.span animate={{ rotate: expanded ? 180 : 0 }} className="ins-chevron"><ChevronDown size={15} /></motion.span>
              </button>
              {!expanded && review.findings[0] && <p className="ins-review-lead">{review.findings[0].title}: {review.findings[0].detail}</p>}
              {!expanded && ((review.impact?.likely_missing?.length ?? 0) > 0 || (review.reviewers?.reviewers?.length ?? 0) > 0) && (
                <div className="ins-impact">
                  {(review.impact?.likely_missing ?? []).slice(0, 2).map((item) => (
                    <span key={item.path} className="ins-impact-chip is-gap" title={`Changed with ${item.because_of} in ${item.support} of ${item.of_prs} past PRs`}>
                      <GitCompareArrows size={12} /> Also usually changes: {item.path.split('/').pop()}
                    </span>
                  ))}
                  {(review.reviewers?.reviewers ?? []).slice(0, 2).map((person) => (
                    <span key={person.login} className="ins-impact-chip" title={person.reason}>
                      <UserRound size={12} /> Suggested reviewer: {person.login}{person.inactive ? ' (inactive)' : ''}
                    </span>
                  ))}
                </div>
              )}
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                    <div className="ins-review-body">
                      <MarkdownMessage content={commentToMarkdown(review.comment_markdown)} repoId={repoId} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}
