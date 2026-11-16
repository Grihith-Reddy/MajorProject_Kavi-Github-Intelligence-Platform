import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, Check, Copy, KeyRound, ShieldCheck, TerminalSquare, Trash2 } from 'lucide-react'

import { CodeSnippetCard } from '../chat/CodeSnippetCard'
import { useApiClient } from '../../services/apiClient'
import { listRepositories, type RepositorySummary } from '../../services/githubService'
import {
  apiOrigin,
  createToken,
  getGuardianWorkflow,
  listTokens,
  revokeToken,
  type PersonalToken,
} from '../../services/insightsService'
import { getApiErrorMessage } from '../../utils/errors'
import { useToast } from '../toast/toastContext'

function useCopy() {
  const toast = useToast()
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      toast.success('Copied to clipboard')
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600)
    } catch {
      // Clipboard can be blocked; the value stays visible for manual copying.
    }
  }
  return { copied, copy }
}

function SecretField({ value, copyKey, copied, onCopy }: { value: string; copyKey: string; copied: string | null; onCopy: (key: string, value: string) => void }) {
  return (
    <div className="kv-secret">
      <code>{value}</code>
      <button type="button" className="kv-icon-btn" onClick={() => onCopy(copyKey, value)} aria-label="Copy to clipboard">
        {copied === copyKey ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

function Step({ index, title, children, done }: { index: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <li className={`int-step${done ? ' is-done' : ''}`}>
      <span className="int-step-index kv-num">{done ? <Check size={13} strokeWidth={2.5} /> : index}</span>
      <div className="int-step-body">
        <p className="int-step-title">{title}</p>
        {children}
      </div>
    </li>
  )
}

export function IntegrationsSection() {
  const api = useApiClient()
  const toast = useToast()
  const { copied, copy } = useCopy()
  const [repos, setRepos] = useState<RepositorySummary[]>([])
  const [tokens, setTokens] = useState<PersonalToken[] | null>(null)
  const [workflow, setWorkflow] = useState<string>('')
  const [repoId, setRepoId] = useState('')
  const [guardianToken, setGuardianToken] = useState<PersonalToken | null>(null)
  const [mcpToken, setMcpToken] = useState<PersonalToken | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    listRepositories(api)
      .then((data) => {
        if (!active) return
        const synced = data.repositories.filter((repo) => repo.repo_uuid)
        setRepos(synced)
        setRepoId((current) => current || synced[0]?.repo_uuid || '')
      })
      .catch(() => undefined)
    listTokens(api).then((rows) => active && setTokens(rows)).catch(() => active && setTokens([]))
    getGuardianWorkflow(api).then((text) => active && setWorkflow(text)).catch(() => undefined)
    return () => { active = false }
  }, [api])

  const selectedRepo = useMemo(() => repos.find((repo) => repo.repo_uuid === repoId) ?? null, [repos, repoId])
  const origin = apiOrigin()

  const generate = async (scope: 'guardian' | 'mcp') => {
    setBusy(scope)
    setError(null)
    try {
      const token = await createToken(api, scope, scope === 'guardian' ? repoId : null, scope === 'guardian' ? 'GitHub Action' : 'Editor')
      if (scope === 'guardian') setGuardianToken(token)
      else setMcpToken(token)
      setTokens(await listTokens(api))
      toast.success(scope === 'guardian' ? 'Guardian token created' : 'Editor token created', { description: 'Copy it now; it is shown only once.' })
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not create a token'))
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (token: PersonalToken) => {
    setBusy(token.id)
    try {
      await revokeToken(api, token.id)
      setTokens((current) => (current ?? []).filter((item) => item.id !== token.id))
      toast.show('Token revoked', { description: 'Anything using it stops working right away.' })
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not revoke the token'))
    } finally {
      setBusy(null)
    }
  }

  const mcpCommand = `claude mcp add kavi -e KAVI_API_URL=${origin} -e KAVI_TOKEN=${mcpToken?.token ?? '<your-token>'} -- python path/to/kavi/mcp/kavi_mcp.py`
  const mcpJson = JSON.stringify(
    { mcpServers: { kavi: { command: 'python', args: ['path/to/kavi/mcp/kavi_mcp.py'], env: { KAVI_API_URL: origin, KAVI_TOKEN: mcpToken?.token ?? '<your-token>' } } } },
    null,
    2
  )

  return (
    <section className="int-section" aria-labelledby="integrations-heading">
      <style>{INTEGRATIONS_CSS}</style>
      <div className="int-head">
        <p className="kv-eyebrow">Integrations</p>
        <h2 id="integrations-heading" className="int-h2 kv-balance">Put KAVI’s memory where the work happens.</h2>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p className="int-error" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="int-grid">
        <motion.article
          className="int-card int-guardian"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 200, damping: 26 }}
        >
          <div className="int-card-top">
            <span className="int-icon"><ShieldCheck size={20} strokeWidth={1.5} /></span>
            <span className="kv-pill" style={{ background: 'rgb(var(--kv-veil-rgb) / 0.55)' }}>GitHub Action · free</span>
          </div>
          <h3 className="int-h3">Guardian</h3>
          <p className="int-lede">
            Reviews every new pull request against the decisions your team already made, and comments when a change
            contradicts one. It runs in your repository with its own token, so KAVI never gets write access.
          </p>

          <ol className="int-steps">
            <Step index={1} title="Create a repository token" done={Boolean(guardianToken)}>
              {repos.length ? (
                <div className="int-row">
                  <select className="kv-select" value={repoId} onChange={(event) => { setRepoId(event.target.value); setGuardianToken(null) }} aria-label="Repository">
                    {repos.map((repo) => <option key={repo.repo_uuid} value={repo.repo_uuid ?? ''}>{repo.full_name}</option>)}
                  </select>
                  <button type="button" className="kv-btn kv-btn-dark kv-btn-sm" disabled={!repoId || busy === 'guardian'} onClick={() => generate('guardian')}>
                    <KeyRound size={14} /> {busy === 'guardian' ? 'Creating…' : 'Create token'}
                  </button>
                </div>
              ) : (
                <p className="int-muted">Sync a repository first; Guardian reviews against what KAVI remembers.</p>
              )}
              {guardianToken?.token && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="int-reveal">
                  <SecretField value={guardianToken.token} copyKey="guardian" copied={copied} onCopy={copy} />
                  <p className="int-muted">Shown once. Save it as a repository secret named <code>KAVI_GUARDIAN_TOKEN</code>.</p>
                </motion.div>
              )}
            </Step>
            <Step index={2} title="Add the secret and API address">
              <p className="int-muted">
                In <strong>{selectedRepo?.full_name ?? 'your repository'}</strong> → Settings → Secrets and variables → Actions:
                add the secret above, and a variable <code>KAVI_API_URL</code> set to
              </p>
              <SecretField value={origin} copyKey="origin" copied={copied} onCopy={copy} />
              {selectedRepo && (
                <a className="int-link" href={`https://github.com/${selectedRepo.full_name}/settings/secrets/actions`} target="_blank" rel="noreferrer">
                  Open Actions settings <ArrowUpRight size={13} />
                </a>
              )}
            </Step>
            <Step index={3} title="Commit the workflow">
              <p className="int-muted">Save this as <code>.github/workflows/kavi-guardian.yml</code>. Draft PRs are skipped.</p>
              {workflow ? (
                <CodeSnippetCard index={0} maxHeight={240} snippet={{ code: workflow, language: 'yaml', title: 'kavi-guardian.yml', file_path: '.github/workflows/kavi-guardian.yml' }} />
              ) : (
                <div className="int-skeleton" />
              )}
            </Step>
          </ol>
        </motion.article>

        <div className="int-side">
          <motion.article
            className="int-card int-mcp"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 26, delay: 0.06 }}
          >
            <div className="int-card-top">
              <span className="int-icon"><TerminalSquare size={20} strokeWidth={1.5} /></span>
              <span className="kv-pill" style={{ background: 'rgb(var(--kv-veil-rgb) / 0.55)' }}>MCP</span>
            </div>
            <h3 className="int-h3">Your editor’s agent</h3>
            <p className="int-lede">
              Let Claude Code, Cursor or any MCP client ask KAVI why code exists, search decisions and find who knows a
              topic.
            </p>
            {mcpToken?.token ? (
              <div className="int-reveal">
                <SecretField value={mcpToken.token} copyKey="mcp" copied={copied} onCopy={copy} />
                <p className="int-muted">Shown once. Then register the server:</p>
                <SecretField value={mcpCommand} copyKey="mcp-cmd" copied={copied} onCopy={copy} />
                <details className="int-details">
                  <summary>JSON config for other clients</summary>
                  <CodeSnippetCard index={1} maxHeight={200} snippet={{ code: mcpJson, language: 'json', title: 'mcp.json' }} />
                </details>
              </div>
            ) : (
              <button type="button" className="kv-btn kv-btn-dark" disabled={busy === 'mcp'} onClick={() => generate('mcp')}>
                <KeyRound size={15} /> {busy === 'mcp' ? 'Creating…' : 'Create editor token'}
              </button>
            )}
          </motion.article>

          <motion.article
            className="int-card int-tokens"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 26, delay: 0.12 }}
          >
            <p className="kv-eyebrow" style={{ marginBottom: 10 }}>Active tokens</p>
            {tokens === null ? (
              <div className="int-skeleton" style={{ height: 52 }} />
            ) : tokens.length === 0 ? (
              <p className="int-muted">No tokens yet. Each one can be revoked here at any time.</p>
            ) : (
              <ul className="int-token-list">
                <AnimatePresence initial={false}>
                  {tokens.map((token) => (
                    <motion.li key={token.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 12 }}>
                      <div className="int-token-meta">
                        <span className="int-token-name">{token.scope === 'guardian' ? token.repo_full_name ?? 'Guardian' : 'Editor (MCP)'}</span>
                        <span className="int-token-sub kv-num">
                          {token.token_prefix}… · {token.last_used_at ? `used ${new Date(token.last_used_at).toLocaleDateString()}` : 'never used'}
                        </span>
                      </div>
                      <button type="button" className="kv-icon-btn" onClick={() => revoke(token)} disabled={busy === token.id} aria-label="Revoke token" title="Revoke">
                        <Trash2 size={13} />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </motion.article>
        </div>
      </div>
    </section>
  )
}

const INTEGRATIONS_CSS = `
.int-section { display: flex; flex-direction: column; gap: 14px; margin-top: 8px; }
.int-head { padding: 8px 4px 0; }
.int-h2 { font-family: var(--kv-font-read); font-size: clamp(24px, 3.4vw, 36px); font-weight: 600; letter-spacing: -0.025em; color: var(--kv-ink); line-height: 1.1; margin-top: 6px; max-width: 18ch; }
.int-error { border-radius: 16px; background: var(--kv-danger-bg); color: var(--kv-danger-ink); padding: 12px 16px; font-family: var(--kv-font-read); font-size: 14px; }
.int-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.int-side { display: flex; flex-direction: column; gap: 16px; }
.int-card { border-radius: 28px; padding: 28px; transition: transform 0.3s var(--kv-spring), box-shadow 0.3s ease; }
.int-card:hover { transform: translateY(-3px); box-shadow: 0 18px 40px rgb(var(--kv-shadow-rgb) / 0.08); }
.int-token-list li { transition: border-color 0.15s ease; }
.int-token-list li:hover { border-color: var(--kv-line-strong); }
.int-guardian { background: var(--kv-peach); }
.int-mcp { background: var(--kv-ice); }
.int-tokens { background: var(--kv-mist); border: 1px solid var(--kv-line); padding: 20px 22px; }
.int-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px; }
.int-icon { width: 44px; height: 44px; border-radius: 14px; background: rgb(var(--kv-ink-rgb) / 0.1); display: inline-flex; align-items: center; justify-content: center; color: var(--kv-ink); }
.int-h3 { font-family: var(--kv-font-read); font-size: 22px; font-weight: 600; letter-spacing: -0.015em; color: var(--kv-ink); margin-bottom: 6px; }
.int-lede { font-family: var(--kv-font-read); font-size: 14px; line-height: 1.6; color: rgb(var(--kv-ink-rgb) / 0.7); max-width: 60ch; margin-bottom: 20px; }
.int-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 18px; }
.int-step { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 14px; position: relative; }
.int-step:not(:last-child)::after { content: ''; position: absolute; left: 13.5px; top: 32px; bottom: -14px; width: 1px; background: rgb(var(--kv-ink-rgb) / 0.14); }
.int-step-index { width: 28px; height: 28px; border-radius: 9999px; background: rgb(var(--kv-veil-rgb) / 0.7); border: 1px solid rgb(var(--kv-ink-rgb) / 0.16); display: inline-flex; align-items: center; justify-content: center; font-family: var(--kv-font-label); font-size: 13px; font-weight: 600; color: var(--kv-ink); }
.int-step.is-done .int-step-index { background: var(--kv-solid); border-color: var(--kv-solid); color: var(--kv-on-solid); }
.int-step-body { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding-top: 3px; }
.int-step-title { font-family: var(--kv-font-read); font-size: 15px; font-weight: 600; color: var(--kv-ink); }
.int-row { display: flex; gap: 8px; align-items: center; }
.int-row .kv-select { flex: 1; min-width: 0; }
.int-row .kv-btn { flex-shrink: 0; }
.int-reveal { display: flex; flex-direction: column; gap: 8px; overflow: hidden; }
.int-muted { font-family: var(--kv-font-read); font-size: 13px; line-height: 1.55; color: rgb(var(--kv-ink-rgb) / 0.65); }
.int-muted code, .int-step-body code { font-family: var(--kv-font-mono); font-size: 12px; background: rgb(var(--kv-veil-rgb) / 0.65); padding: 1px 6px; border-radius: 6px; }
.int-link { display: inline-flex; align-items: center; gap: 4px; font-family: var(--kv-font-label); font-size: 13px; font-weight: 600; color: var(--kv-ink); text-decoration: none; width: fit-content; border-bottom: 1px solid rgb(var(--kv-ink-rgb) / 0.25); }
.int-link:hover { border-bottom-color: var(--kv-ink); }
.int-details summary { cursor: pointer; font-family: var(--kv-font-label); font-size: 13px; font-weight: 600; color: var(--kv-ink); margin: 4px 0 8px; }
.int-skeleton { height: 120px; border-radius: 14px; background: rgb(var(--kv-veil-rgb) / 0.5); position: relative; overflow: hidden; }
.int-skeleton::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgb(var(--kv-veil-rgb) / 0.7), transparent); animation: wl-shimmer 1.4s infinite; }
@keyframes wl-shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
.int-token-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.int-token-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--kv-surface); border: 1px solid var(--kv-line); border-radius: 14px; padding: 10px 10px 10px 14px; }
.int-token-meta { display: flex; flex-direction: column; min-width: 0; }
.int-token-name { font-family: var(--kv-font-read); font-size: 13px; font-weight: 600; color: var(--kv-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.int-token-sub { font-family: var(--kv-font-label); font-size: 12px; color: var(--kv-ink-4); }
@media (max-width: 980px) { .int-grid { grid-template-columns: 1fr; } }
@media (max-width: 560px) {
  .int-card { border-radius: 20px; padding: 20px; }
  .int-row { flex-direction: column; align-items: stretch; }
}
`
