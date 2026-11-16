import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, FolderGit2, GitPullRequest } from 'lucide-react'
import { GitVisualizationPanel } from './GitVisualizationPanel'
import { WORKSPACE_PANEL_ITEMS, splitFilePath } from './chatHelpers'
import { type WorkspaceOverlayProps, type WorkspacePanelId } from './chatTypes'

// ─── Icon rail ────────────────────────────────────────────────────────────────

export function WorkspaceIconRail({ activePanel, onToggle }: { activePanel: WorkspacePanelId | null; onToggle: (panel: WorkspacePanelId) => void }) {
  return (
    <aside className="db-icon-rail" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 8px', background: 'var(--kv-mist)', borderRadius: 24, border: '1px solid var(--kv-line)' }}>
      {WORKSPACE_PANEL_ITEMS.map((item) => {
        const Icon = item.icon
        const active = activePanel === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.id)}
            title={item.label}
            aria-label={item.label}
            style={{
              width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 14,
              border: active ? 'none' : '1px solid var(--kv-line)',
              background: active ? 'var(--kv-solid)' : 'var(--kv-surface)',
              color: active ? 'var(--kv-on-solid)' : 'rgb(var(--kv-ink-rgb) / 0.6)',
              cursor: 'pointer',
              transition: 'all 0.18s cubic-bezier(0.34,1.56,0.64,1)',
            }}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </aside>
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
