import { Compass, File, FolderGit2, GitBranch, GitPullRequest, History, type LucideIcon } from 'lucide-react'
import { ChatMode } from '../../../services/chatService'
import { type ChatEntry, type StructuredAnswer, type WorkspacePanelId } from './chatTypes'

// ─── Constants ────────────────────────────────────────────────────────────────

export const ACTIVE_REPO_STORAGE_KEY = 'kavi.activeRepoId'
export const CHAT_STORAGE_PREFIX = 'kavi.chat.'
export const DEFAULT_ASSISTANT_MESSAGE = 'I am ready. Ask why code exists, who decided something, what changed and why, or use "Explain Entire Repo".'
export const QUICK_PROMPTS = ['Explain Entire Repo', 'Explain the main architecture', 'What changed recently, and why?', 'Who knows the most about auth?', 'Which promises are still open?']
export const WORKSPACE_PANEL_ITEMS: { id: WorkspacePanelId; label: string; icon: LucideIcon }[] = [
  { id: 'repository', label: 'Repository', icon: FolderGit2 },
  { id: 'history', label: 'History', icon: History },
  { id: 'focus', label: 'Focus', icon: Compass },
  { id: 'prs', label: 'PRs', icon: GitPullRequest },
  { id: 'files', label: 'Files', icon: File },
  { id: 'git', label: 'Git Visualization', icon: GitBranch },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function defaultMessages(name?: string | null): ChatEntry[] {
  const safeName = typeof name === 'string' && name.trim() ? name.trim() : null
  const greeting = safeName ? `Welcome, ${safeName}.` : 'Welcome.'
  return [{ role: 'assistant', content: `${greeting} ${DEFAULT_ASSISTANT_MESSAGE}` }]
}

export function shouldRenderStructuredAnswer(structured: StructuredAnswer | null | undefined): boolean {
  if (!structured || structured.format === 'plain') return false
  if (structured.format === 'structured') return true
  if (
    (structured.code_references?.length ?? 0) > 0
    || (structured.code_snippets?.length ?? 0) > 0
    || (structured.timeline_highlights?.length ?? 0) > 0
  ) return true

  const sections = structured.sections ?? []
  return sections.length > 1
    && sections.some((section) => !['key takeaways', 'guidance', 'last question'].includes(section.heading.trim().toLowerCase()))
}

export function resolveUserDisplayName(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null
  const record = user as Record<string, unknown>
  const rawName = record.name ?? record.nickname
  if (typeof rawName === 'string' && rawName.trim()) return rawName.trim()
  const rawEmail = record.email
  if (typeof rawEmail === 'string' && rawEmail.includes('@')) return rawEmail.split('@')[0]
  return null
}

export function getChatStorageKey(userSub: string | null, repoId: string | null): string | null {
  if (!userSub || !repoId) return null
  return `${CHAT_STORAGE_PREFIX}${userSub}.${repoId}`
}

export function readStoredRepoId(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage.getItem(ACTIVE_REPO_STORAGE_KEY) } catch { return null }
}

export function splitFilePath(path: string) {
  const normalized = String(path || '').replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const fileName = segments.length ? segments[segments.length - 1] : normalized
  const directory = segments.length > 1 ? segments.slice(0, -1).join('/') : ''
  return { fileName, directory }
}

export function lineLabel(startLine?: number | null, endLine?: number | null) {
  if (startLine && endLine) return `L${startLine}-${endLine}`
  if (startLine) return `L${startLine}`
  return 'Line n/a'
}

export function resolveChatMode(input: string): ChatMode {
  const value = input.trim().toLowerCase()
  const overviewPhrases = ['explain entire repo', 'explain the entire repo', 'repo overview', 'project overview', 'whole repo', 'full repository']
  if (overviewPhrases.some((p) => value.includes(p))) return 'repo_overview'
  if (value.includes('entire repo') || value.includes('whole repo')) return 'repo_overview'
  return 'default'
}
