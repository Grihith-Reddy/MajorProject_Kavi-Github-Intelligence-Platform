import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, ArrowRight, Clock3, FolderGit2, GitPullRequest, Handshake, RefreshCw, Search, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import {
  RepositorySummary,
  SyncJob,
  SyncJobProgress,
  getSyncJob,
  listRepositories,
  syncRepository,
} from '../services/githubService'
import { getRepositoryHealth, type RepositoryHealth } from '../services/insightsService'
import { getApiErrorMessage } from '../utils/errors'
import cloudImg from '../assets/cloud.webp'

// ─── Card colour palette (matches landing page pastel cards) ─────────────────
const CARD_COLORS = ['var(--kv-sand)', 'var(--kv-lilac)', 'var(--kv-peach)', 'var(--kv-ice)', 'var(--kv-sage)', 'var(--kv-mint)']

const SYNC_PHASE_LABELS: Record<string, string> = {
  queued: 'Waiting for a worker',
  connecting: 'Connecting to GitHub',
  listing: 'Checking what changed',
  analyzing: 'Reading pull requests',
  finishing: 'Building memory',
  completed: 'Done',
}

function SyncProgressCapsule({ progress }: { progress?: SyncJobProgress & { status?: string } }) {
  const phase = progress?.phase ?? 'queued'
  const total = Number(progress?.total ?? 0)
  const processed = Math.min(Number(progress?.processed ?? 0), total || Infinity)
  const determinate = phase === 'analyzing' && total > 0
  const percent = determinate ? Math.max(4, Math.round((processed / total) * 100)) : phase === 'finishing' ? 100 : 0

  return (
    <div className="repo-progress" role="status" aria-live="polite">
      <div className="repo-progress-head">
        <span className="repo-progress-phase">{SYNC_PHASE_LABELS[phase] ?? 'Syncing'}</span>
        {determinate && <span className="repo-progress-count font-archivo">{processed} / {total}</span>}
      </div>
      <div className="repo-progress-track">
        {determinate || phase === 'finishing' ? (
          <motion.div
            className="repo-progress-fill"
            initial={false}
            animate={{ width: `${percent}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 22 }}
          />
        ) : (
          <div className="repo-progress-fill is-indeterminate" />
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={progress?.current_pr ?? phase}
          className="repo-progress-detail font-archivo"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {progress?.current_pr
            ? `#${progress.current_pr} · ${progress.current_title || 'Untitled pull request'}`
            : phase === 'listing'
              ? 'Only new or updated pull requests are analyzed.'
              : 'This keeps running even if you leave the page.'}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

function relativeSync(value?: string | null): string {
  if (!value) return 'Never synced'
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60000)
  if (!Number.isFinite(minutes)) return 'Synced'
  if (minutes < 2) return 'Synced just now'
  if (minutes < 60) return `Synced ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Synced ${hours}h ago`
  return `Synced ${Math.round(hours / 24)}d ago`
}

function RepoHealthStrip({ repoId, health }: { repoId: string; health: RepositoryHealth }) {
  const insights = (tab: string) => `/insights?repoId=${encodeURIComponent(repoId)}&tab=${tab}`
  return (
    <div className="repo-health">
      {health.open_promises > 0 && (
        <Link to={insights('promises')} className="repo-health-chip is-promise" title="Commitments from reviews that no later PR has kept yet">
          <Handshake size={12} /> {health.open_promises} open promise{health.open_promises === 1 ? '' : 's'}
        </Link>
      )}
      {health.at_risk_modules > 0 ? (
        <Link to={insights('map')} className="repo-health-chip is-risk" title="Modules whose only expert has gone quiet">
          <AlertTriangle size={12} /> {health.at_risk_modules} at-risk module{health.at_risk_modules === 1 ? '' : 's'}
        </Link>
      ) : health.single_expert_modules > 0 ? (
        <Link to={insights('map')} className="repo-health-chip" title="Modules where one person holds most of the context">
          <UserRound size={12} /> {health.single_expert_modules} single-expert
        </Link>
      ) : null}
      <span className="repo-health-chip is-muted"><Clock3 size={12} /> {relativeSync(health.synced_at)}</span>
    </div>
  )
}

export function RepositorySelectionPage() {
  const api = useApiClient()
  const navigate = useNavigate()
  const { data, error, loading, setData } = useAsync(() => listRepositories(api), [api])
  const [health, setHealth] = useState<Record<string, RepositoryHealth>>({})
  useEffect(() => {
    if (!data) return
    let active = true
    getRepositoryHealth(api).then((result) => { if (active) setHealth(result) }).catch(() => undefined)
    return () => { active = false }
  }, [api, data])

  const [syncing, setSyncing] = useState<Record<string, boolean>>({})
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [syncedRepoIds, setSyncedRepoIds] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [syncProgress, setSyncProgress] = useState<Record<string, SyncJobProgress & { status?: string }>>({})

  const pollAbortRef = useRef(false)
  useEffect(() => {
    pollAbortRef.current = false
    return () => { pollAbortRef.current = true }
  }, [])

  const waitForJob = async (repoFullName: string, jobId: string): Promise<SyncJob> => {
    const startedAt = Date.now()
    for (;;) {
      if (pollAbortRef.current) throw new Error('cancelled')
      const job = await getSyncJob(api, jobId)
      setSyncProgress((prev) => ({ ...prev, [repoFullName]: { ...(job.progress ?? {}), status: job.status } }))
      if (job.status === 'completed') return job
      if (job.status === 'failed') throw new Error(job.last_error || 'Sync failed')
      if (Date.now() - startedAt > 45 * 60 * 1000) throw new Error('Sync is taking unusually long; it will keep running in the background.')
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
  }

  const handleSync = async (repo: RepositorySummary, fullResync = false) => {
    setSyncing((prev) => ({ ...prev, [repo.full_name]: true }))
    setSyncProgress((prev) => ({ ...prev, [repo.full_name]: { phase: 'queued', processed: 0, total: 0, status: 'queued' } }))
    setSyncError(null)
    setSyncNotice(null)

    try {
      const started = await syncRepository(api, repo.full_name, { fullResync })
      let syncedRepoId = started.repo_id
      let syncedPrs = typeof started.synced_prs === 'number' ? started.synced_prs : 0

      if (started.status === 'queued' && started.job_id) {
        const job = await waitForJob(repo.full_name, started.job_id)
        syncedRepoId = job.repo_id ?? job.result_summary?.repo_id ?? syncedRepoId
        syncedPrs = job.result_summary?.synced_prs ?? 0
      }

      // Refresh counts from the knowledge base: an incremental sync may process
      // zero PRs simply because nothing changed since the last run.
      const refreshed = await listRepositories(api)
      setData(refreshed)
      const refreshedRepo = refreshed.repositories.find((item) => item.id === repo.id)
      const totalPrs = refreshedRepo?.pr_count ?? syncedPrs
      syncedRepoId = syncedRepoId ?? refreshedRepo?.repo_uuid ?? undefined

      if (syncedRepoId) {
        setSyncedRepoIds((prev) => ({ ...prev, [repo.full_name]: syncedRepoId as string }))
      }

      if (syncedRepoId && totalPrs > 0) {
        if (fullResync || repo.synced_at) {
          setSyncNotice(
            syncedPrs > 0
              ? `${repo.full_name} is up to date. ${syncedPrs} pull request${syncedPrs === 1 ? '' : 's'} refreshed.`
              : `${repo.full_name} is already up to date. Nothing changed since the last sync.`
          )
        } else {
          setTimeout(() => navigate(`/chat?repoId=${syncedRepoId}`), 450)
        }
      } else if (totalPrs === 0) {
        setSyncNotice(
          `Sync completed for ${repo.full_name}, but no pull-request discussions were found. Chat remains disabled.`
        )
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') return
      setSyncError(getApiErrorMessage(err, 'Failed to sync repository'))
    } finally {
      setSyncing((prev) => ({ ...prev, [repo.full_name]: false }))
      setSyncProgress((prev) => {
        const next = { ...prev }
        delete next[repo.full_name]
        return next
      })
    }
  }

  const filteredRepos =
    data?.repositories?.filter((repo) =>
      repo.full_name.toLowerCase().includes(searchQuery.trim().toLowerCase())
    ) ?? []

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Gabarito:wght@400;500;600;700&family=Archivo:wght@400;500;600;700&display=swap');

        .repo-page {
          display: flex;
          flex-direction: column;
          gap: 16px;
          font-family: 'Gabarito', sans-serif;
        }

        .font-archivo { font-family: 'Archivo', sans-serif !important; }

        /* ── Hero header card ── */
        .repo-hero-card {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          background: linear-gradient(170deg, var(--kv-sky-1) 0%, var(--kv-sky-2) 100%);
          border-radius: 32px;
          overflow: hidden;
          position: relative;
          padding: 64px 64px 72px;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 32px;
          min-height: 280px;
        }
        @media (max-width: 768px) {
          .repo-hero-card { padding: 40px 32px 48px; flex-direction: column; align-items: flex-start; min-height: auto; }
        }
        @media (max-width: 560px) {
          .repo-hero-card { border-radius: 20px; padding: 28px 16px 32px; gap: 18px; }
        }

        .hero-cloud-bg {
          position: absolute;
          width: 110%;
          left: -5%;
          bottom: -20%;
          opacity: 0.5;
          mix-blend-mode: screen;
          pointer-events: none;
          z-index: 1;
        }

        .repo-hero-text { position: relative; z-index: 2; }
        .repo-eyebrow {
          font-family: 'Gabarito', sans-serif;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--kv-sky-ink);
          margin-bottom: 16px;
        }
        .repo-hero-h1 {
          font-family: 'Archivo', sans-serif;
          font-weight: 600;
          font-size: clamp(30px, 8vw, 72px);
          line-height: 1.05;
          letter-spacing: -0.025em;
          background: linear-gradient(169deg, var(--kv-hero-text-from) 20%, var(--kv-hero-text-to) 74%);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
        }

        /* ── Search ── */
        .repo-search-wrap {
          position: relative;
          z-index: 2;
          flex-shrink: 0;
        }
        .repo-search {
          display: flex;
          align-items: center;
          gap: 10px;
          background: rgb(var(--kv-veil-rgb) / 0.9);
          backdrop-filter: blur(12px);
          border-radius: 9999px;
          padding: 12px 20px;
          border: none;
          min-width: 260px;
        }
        @media (max-width: 900px) {
          .repo-search { min-width: min(340px, 100%); width: min(340px, 100%); }
        }
        @media (max-width: 560px) {
          .repo-search { min-width: 0; width: 100%; padding: 10px 14px; }
          .repo-search-wrap { width: 100%; }
        }
        .repo-search input {
          background: transparent;
          border: none;
          outline: none;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          color: var(--kv-ink);
          width: 100%;
        }
        .repo-search input::placeholder { color: rgb(var(--kv-ink-rgb) / 0.4); }

        /* ── Notices ── */
        .repo-notice {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          border-radius: 20px;
          padding: 16px 24px;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          line-height: 1.5;
        }
        .repo-notice.error { background: var(--kv-danger-bg); color: var(--kv-danger-ink); border: 1px solid rgba(155,58,38,0.12); }
        .repo-notice.info { background: var(--kv-sage); color: var(--kv-ok-ink); border: 1px solid rgba(45,74,26,0.12); }

        /* ── Grid ── */
        .repo-grid {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        @media (max-width: 1200px) { .repo-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 768px) { .repo-grid { grid-template-columns: 1fr; } }

        /* ── Repo card ── */
        .repo-card {
          border-radius: 28px;
          overflow: hidden;
          padding: 32px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 280px;
          cursor: default;
          transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.22s ease;
        }
        @media (max-width: 560px) {
          .repo-card { border-radius: 20px; padding: 20px; min-height: 240px; }
        }
        .repo-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 16px 40px rgb(var(--kv-ink-rgb) / 0.1);
        }

        .repo-card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }

        .repo-icon-wrap {
          width: 44px; height: 44px;
          background: rgb(var(--kv-ink-rgb) / 0.1);
          border-radius: 14px;
          display: flex; align-items: center; justify-content: center;
        }

        .repo-badge {
          font-family: 'Gabarito', sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgb(var(--kv-ink-rgb) / 0.5);
          border: 1px solid rgb(var(--kv-ink-rgb) / 0.18);
          border-radius: 9999px;
          padding: 4px 12px;
        }
        .repo-badge.synced {
          color: var(--kv-ok-ink);
          border-color: rgba(45,74,26,0.25);
          background: rgba(45,74,26,0.08);
        }

        .repo-name {
          font-family: 'Archivo', sans-serif;
          font-size: 20px;
          font-weight: 600;
          color: var(--kv-ink);
          letter-spacing: -0.01em;
          line-height: 1.2;
          margin-bottom: 6px;
          word-break: break-word;
        }
        .repo-meta {
          font-family: 'Archivo', sans-serif;
          font-size: 14px;
          color: rgb(var(--kv-ink-rgb) / 0.5);
          margin-bottom: 16px;
        }

        .repo-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
        .repo-health { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 22px; }
        .repo-health-chip {
          display: inline-flex; align-items: center; gap: 5px; border-radius: 10px; padding: 4px 10px;
          font-family: var(--kv-font-label); font-size: 12.5px; font-weight: 600; text-decoration: none;
          color: var(--kv-ink-2); background: rgb(var(--kv-veil-rgb) / 0.55);
          transition: transform 0.2s var(--kv-spring), background 0.15s ease, color 0.15s ease;
        }
        a.repo-health-chip:hover { transform: translateY(-1px); background: var(--kv-solid); color: var(--kv-on-solid); }
        .repo-health-chip.is-promise { color: var(--kv-warn-ink); }
        .repo-health-chip.is-risk { color: var(--kv-danger-ink); }
        .repo-health-chip.is-muted { color: var(--kv-ink-3); background: transparent; padding-left: 2px; }
        .repo-stat-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid rgb(var(--kv-ink-rgb) / 0.14);
          border-radius: 9999px;
          padding: 5px 12px;
          font-family: 'Archivo', sans-serif;
          font-size: 13px;
          color: rgb(var(--kv-ink-rgb) / 0.6);
          background: rgb(var(--kv-veil-rgb) / 0.5);
        }

        /* ── Buttons ── */
        .repo-btn {
          width: 100%;
          padding: 13px 24px;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.15s, transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
          letter-spacing: 0.01em;
        }
        .repo-btn:hover:not(:disabled) { transform: scale(1.02); }
        .repo-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .repo-btn-dark { background: var(--kv-solid); color: var(--kv-on-solid); }
        .repo-btn-dark:hover:not(:disabled) { background: var(--kv-solid-hover); }
        .repo-btn-outline {
          background: rgb(var(--kv-veil-rgb) / 0.7);
          color: var(--kv-ink);
          border: 1.5px solid rgb(var(--kv-ink-rgb) / 0.2);
        }
        .repo-btn-outline:hover:not(:disabled) { background: rgb(var(--kv-veil-rgb) / 0.95); }

        /* ── Sync progress capsule ── */
        .repo-progress {
          border-radius: 20px;
          background: rgb(var(--kv-veil-rgb) / 0.6);
          border: 1px solid rgb(var(--kv-ink-rgb) / 0.1);
          padding: 14px 16px 12px;
        }
        .repo-progress-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .repo-progress-phase {
          font-family: 'Gabarito', sans-serif;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgb(var(--kv-ink-rgb) / 0.6);
        }
        .repo-progress-count {
          font-size: 13px;
          font-weight: 600;
          color: var(--kv-ink);
          font-variant-numeric: tabular-nums;
        }
        .repo-progress-track {
          position: relative;
          height: 6px;
          border-radius: 9999px;
          background: rgb(var(--kv-ink-rgb) / 0.1);
          overflow: hidden;
        }
        .repo-progress-fill {
          position: absolute;
          inset: 0 auto 0 0;
          border-radius: 9999px;
          background: var(--kv-solid);
        }
        .repo-progress-fill.is-indeterminate {
          width: 36%;
          animation: repo-progress-slide 1.3s cubic-bezier(0.65, 0, 0.35, 1) infinite;
        }
        @keyframes repo-progress-slide {
          from { transform: translateX(-110%); }
          to { transform: translateX(300%); }
        }
        .repo-progress-detail {
          margin-top: 9px;
          font-size: 13px;
          color: rgb(var(--kv-ink-rgb) / 0.55);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .repo-card-actions { display: flex; align-items: center; gap: 8px; }
        .repo-resync-btn {
          width: 32px; height: 32px;
          border-radius: 9999px;
          border: 1px solid rgb(var(--kv-ink-rgb) / 0.18);
          background: rgb(var(--kv-veil-rgb) / 0.5);
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer;
          color: var(--kv-ink);
          transition: background 0.15s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .repo-resync-btn:hover:not(:disabled) { background: rgb(var(--kv-veil-rgb) / 0.9); transform: rotate(-90deg); }
        .repo-resync-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .repo-no-prs {
          margin-top: 10px;
          font-family: 'Archivo', sans-serif;
          font-size: 13px;
          color: rgb(var(--kv-ink-rgb) / 0.5);
          line-height: 1.4;
          text-align: center;
        }

        /* ── Loading skeleton ── */
        .repo-skeleton-card {
          border-radius: 28px;
          min-height: 280px;
          background: var(--kv-mist);
          position: relative;
          overflow: hidden;
        }
        .repo-skeleton-card::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent 0%, rgb(var(--kv-veil-rgb) / 0.6) 50%, transparent 100%);
          animation: shimmer 1.4s infinite;
        }
        @keyframes shimmer {
          from { transform: translateX(-100%); }
          to { transform: translateX(100%); }
        }

        /* ── Empty state ── */
        .repo-empty {
          width: 100%;
          max-width: 1440px;
          margin: 0 auto;
          border-radius: 32px;
          background: var(--kv-mist);
          padding: 80px 48px;
          text-align: center;
        }
        @media (max-width: 560px) {
          .repo-empty { border-radius: 20px; padding: 44px 20px; }
          .repo-empty p { font-size: 16px; }
        }
        .repo-empty-icon {
          width: 56px; height: 56px;
          background: var(--kv-line);
          border-radius: 18px;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
        }
        .repo-empty p {
          font-family: 'Archivo', sans-serif;
          font-size: 18px;
          color: rgb(var(--kv-ink-rgb) / 0.5);
        }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      <div className="repo-page">

        {/* ── Hero card ── */}
        <motion.div
          className="repo-hero-card"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <img src={cloudImg} alt="" className="hero-cloud-bg" />

          <div className="repo-hero-text">
            <p className="repo-eyebrow">Repository workspace</p>
            <h1 className="repo-hero-h1 font-archivo">
              Select a<br />repository.
            </h1>
          </div>

          <div className="repo-search-wrap">
            <div className="repo-search">
              <Search size={16} color="rgb(var(--kv-ink-rgb) / 0.45)" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter repositories…"
                aria-label="Filter repositories"
              />
            </div>
          </div>
        </motion.div>

        {/* ── Notices ── */}
        <AnimatePresence>
          {syncError && (
            <motion.div
              key="error"
              className="repo-notice error font-archivo"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {syncError}
            </motion.div>
          )}
          {syncNotice && (
            <motion.div
              key="notice"
              className="repo-notice info font-archivo"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              {syncNotice}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Loading ── */}
        {loading && (
          <div className="repo-grid" aria-busy="true" aria-label="Loading repositories">
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="repo-skeleton-card"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.05 }}
              />
            ))}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="repo-empty">
            <div className="repo-empty-icon">
              <FolderGit2 size={24} color="rgb(var(--kv-ink-rgb) / 0.4)" />
            </div>
            <p className="font-archivo">Unable to load repositories. {error.message}</p>
          </div>
        )}

        {/* ── Repository grid ── */}
        {!loading && !error && (
          <>
            {filteredRepos.length > 0 ? (
              <section className="repo-grid" aria-label="Repositories">
                {filteredRepos.map((repo, index) => {
                  const synced = Boolean(repo.synced_at)
                  const hasNoPrHistory = synced && (repo.pr_count ?? 0) === 0
                  const isSyncing = Boolean(syncing[repo.full_name])
                  const resolvedRepoId = syncedRepoIds[repo.full_name] ?? repo.repo_uuid ?? null
                  const canOpenChat = Boolean(resolvedRepoId) && !hasNoPrHistory
                  const cardColor = CARD_COLORS[index % CARD_COLORS.length]

                  return (
                    <motion.article
                      key={repo.id}
                      className="repo-card"
                      style={{ background: cardColor }}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        type: 'spring',
                        stiffness: 200,
                        damping: 26,
                        delay: index * 0.06,
                      }}
                    >
                      <div>
                        <div className="repo-card-top">
                          <div className="repo-icon-wrap">
                            <FolderGit2 size={20} color="var(--kv-ink)" strokeWidth={1.5} />
                          </div>
                          <div className="repo-card-actions">
                            {canOpenChat && (
                              <button
                                type="button"
                                className="repo-resync-btn"
                                onClick={() => handleSync(repo)}
                                disabled={isSyncing}
                                aria-label={`Check ${repo.full_name} for new pull requests`}
                                title="Check for new pull requests"
                              >
                                <RefreshCw size={14} strokeWidth={1.75} />
                              </button>
                            )}
                            <span className={`repo-badge${synced ? ' synced' : ''}`}>
                              {synced ? 'Synced' : repo.private ? 'Private' : 'Public'}
                            </span>
                          </div>
                        </div>

                        <p className="repo-name font-archivo">{repo.full_name}</p>
                        <p className="repo-meta font-archivo">Default branch: {repo.default_branch}</p>

                        <div className="repo-stats">
                          <span className="repo-stat-pill font-archivo">
                            <GitPullRequest size={12} />
                            {(repo.pr_count ?? 0).toString()} PRs
                          </span>
                          {!synced && (
                            <span className="repo-stat-pill font-archivo">Not synced</span>
                          )}
                          {synced && !repo.private && (
                            <span className="repo-stat-pill font-archivo">Public</span>
                          )}
                        </div>

                        {resolvedRepoId && health[resolvedRepoId] && (
                          <RepoHealthStrip repoId={resolvedRepoId} health={health[resolvedRepoId]} />
                        )}
                      </div>

                      <div>
                        {isSyncing ? (
                          <SyncProgressCapsule progress={syncProgress[repo.full_name]} />
                        ) : (
                        <button
                          onClick={() => {
                            if (canOpenChat) {
                              navigate(`/chat?repoId=${resolvedRepoId}`)
                              return
                            }
                            handleSync(repo)
                          }}
                          disabled={isSyncing}
                          className={`repo-btn font-archivo ${canOpenChat ? 'repo-btn-dark' : 'repo-btn-outline'}`}
                        >
                          {isSyncing ? (
                            <>
                              <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
                              Syncing…
                            </>
                          ) : canOpenChat ? (
                            <>
                              Open Chat
                              <ArrowRight size={14} />
                            </>
                          ) : synced ? (
                            <>
                              Resync
                              <RefreshCw size={14} />
                            </>
                          ) : (
                            <>
                              Analyze PRs
                              <ArrowRight size={14} />
                            </>
                          )}
                        </button>
                        )}

                        {hasNoPrHistory && (
                          <p className="repo-no-prs font-archivo">
                            No PR discussions found — chat stays unavailable.
                          </p>
                        )}
                      </div>
                    </motion.article>
                  )
                })}
              </section>
            ) : (
              <motion.div
                className="repo-empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
              >
                <div className="repo-empty-icon">
                  <Search size={24} color="rgb(var(--kv-ink-rgb) / 0.4)" />
                </div>
                <p className="font-archivo">No repositories match your filter.</p>
              </motion.div>
            )}
          </>
        )}

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </>
  )
}
