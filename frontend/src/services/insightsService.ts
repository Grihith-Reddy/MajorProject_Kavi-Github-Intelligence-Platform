import { AxiosInstance } from 'axios'

export interface RepositoryTreeFile {
  path: string
  size?: number | null
}

export interface WhySegment {
  start_line: number
  end_line: number
  age?: number
  commit_oid?: string | null
  commit_short?: string | null
  commit_headline?: string | null
  committed_at?: string | null
  author_name?: string | null
  author_login?: string | null
  pr_number?: number | null
  pr_title?: string | null
  pr_url?: string | null
}

export interface WhyPullRequest {
  pr_number: number
  title?: string | null
  url?: string | null
  author_login?: string | null
  merged_at?: string | null
  summary?: string | null
  intent?: string | null
  decisions?: string[]
  risks?: string[]
  tags?: string[]
  indexed: boolean
  line_count: number
}

export interface WhyLensResponse {
  path: string
  ref: string
  commit_oid?: string | null
  line_count: number
  content?: string | null
  segments: WhySegment[]
  prs: WhyPullRequest[]
}

export const getRepositoryTree = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/insights/repositories/${repoId}/tree`)
  return data as { branch?: string; files: RepositoryTreeFile[] }
}

export const getWhyLens = async (api: AxiosInstance, repoId: string, path: string) => {
  const { data } = await api.get(`/insights/repositories/${repoId}/why`, { params: { path } })
  return data as WhyLensResponse
}

export interface PersonalToken {
  id: string
  scope: 'guardian' | 'mcp'
  repo_id?: string | null
  repo_full_name?: string | null
  label?: string | null
  token_prefix: string
  last_used_at?: string | null
  created_at?: string | null
  token?: string
}

export const listTokens = async (api: AxiosInstance) => {
  const { data } = await api.get('/insights/tokens')
  return (data?.tokens ?? []) as PersonalToken[]
}

export const createToken = async (api: AxiosInstance, scope: 'guardian' | 'mcp', repoId?: string | null, label?: string) => {
  const { data } = await api.post('/insights/tokens', { scope, repo_id: repoId ?? null, label })
  return data.token as PersonalToken
}

export const revokeToken = async (api: AxiosInstance, tokenId: string) => {
  await api.post(`/insights/tokens/${tokenId}/revoke`)
}

export const getGuardianWorkflow = async (api: AxiosInstance) => {
  const { data } = await api.get('/guardian/workflow', { responseType: 'text', transformResponse: (value) => value })
  return String(data)
}

export const apiOrigin = (): string => {
  const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
  return base.replace(/\/api\/?$/, '')
}

// ── Promise Tracker ────────────────────────────────────────────────────────

export type PromiseStatus = 'open' | 'kept' | 'dismissed'
export type PromiseKind = 'follow_up' | 'todo' | 'temporary' | 'tech_debt'

export interface PromiseItem {
  id: string
  quote: string
  summary?: string | null
  kind: PromiseKind
  source: string
  source_url?: string | null
  status: PromiseStatus
  author_login?: string | null
  made_at?: string | null
  resolution_note?: string | null
  resolution_confidence?: number | null
  github_pr_number: number
  pr_title?: string | null
  pr_url?: string | null
  resolved_pr_number?: number | null
  resolved_pr_title?: string | null
  resolved_pr_url?: string | null
  resolved_at?: string | null
}

export interface PromiseStats {
  total: number
  open: number
  kept: number
  dismissed: number
  oldest_open_days: number | null
  median_open_days: number | null
  median_days_to_keep: number | null
}

export const getPromises = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/insights/repositories/${repoId}/promises`)
  return data as { stats: PromiseStats; promises: PromiseItem[] }
}

export const setPromiseStatus = async (api: AxiosInstance, promiseId: string, status: PromiseStatus) => {
  await api.post(`/insights/promises/${promiseId}/status`, { status })
}

// ── Knowledge map ──────────────────────────────────────────────────────────

export type ModuleRisk = 'healthy' | 'single_expert' | 'at_risk'

export interface MapModule {
  id: string
  path: string
  pr_count: number
  file_count: number
  bus_factor: number
  risk: ModuleRisk
  contributors: Array<{ login: string; share: number; last_seen_at?: string | null }>
  last_activity?: string | null
}

export interface MapEdge {
  source: string
  target: string
  shared_prs: number
  strength: number
}

export interface KnowledgeMap {
  modules: MapModule[]
  edges: MapEdge[]
  people: Array<{ login: string; pr_count: number; module_count: number; last_seen_at?: string | null; active: boolean }>
  summary: { module_count: number; at_risk: number; single_expert: number; healthy: number; strongest_coupling?: MapEdge | null }
}

export const getKnowledgeMap = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/insights/repositories/${repoId}/knowledge-map`)
  return data as KnowledgeMap
}

// ── Guardian ───────────────────────────────────────────────────────────────

export interface GuardianReview {
  id: string
  pr_number: number
  head_sha: string
  verdict: 'clear' | 'heads_up' | 'conflict'
  findings: Array<{ kind: string; pr_number?: number | null; file?: string | null; title: string; detail: string; confidence: number }>
  comment_markdown: string
  impact?: {
    likely_missing: Array<{ path: string; because_of: string; confidence: number; support: number; of_prs: number; example_prs: number[] }>
    likely_missing_modules: Array<{ module: string; because_of: string; confidence: number; support: number; of_prs: number }>
    blast_radius: { coupled_files: number; modules: string[]; history_prs: number }
  } | null
  reviewers?: {
    reviewers: Array<{ login: string; share: number; pr_numbers: number[]; files: string[]; reason: string; inactive: boolean }>
    context_risk?: { login: string; share: number; inactive: boolean; message: string } | null
  } | null
  created_at: string
}

export const getGuardianReviews = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/guardian/repositories/${repoId}/reviews`)
  return (data?.reviews ?? []) as GuardianReview[]
}

// ── Quality ────────────────────────────────────────────────────────────────

export type StrategyMetrics = { 'recall@1': number; 'recall@3': number; 'recall@5': number; mrr: number }

export interface EvalRun {
  id: string
  status: 'running' | 'completed' | 'failed'
  metrics?: {
    question_count: number
    question_source: 'generated' | 'template' | null
    duration_seconds: number
    faithfulness?: { answers: number; claims: number; supported_rate: number | null; cites_gold_rate: number } | null
    strategies: Record<'fulltext' | 'lexical' | 'semantic' | 'hybrid', StrategyMetrics>
  } | null
  cases?: Array<{
    question: string
    pr_number: number
    source: string
    ranks: Record<string, number | null>
    faithfulness?: { answer: string; claims: Array<{ text: string; cites: number[]; supported: boolean }>; supported: number; total: number; cites_gold: boolean }
  }> | null
  error?: string | null
  created_at: string
  finished_at?: string | null
}

export interface FeedbackSummary {
  helpful: number
  not_helpful: number
  helpful_rate: number | null
  recent_not_helpful: Array<{ reason?: string | null; answer: string; created_at: string }>
}

export const getQualityRuns = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/insights/repositories/${repoId}/quality`)
  return { runs: (data?.runs ?? []) as EvalRun[], feedback: (data?.feedback ?? null) as FeedbackSummary | null }
}

export const startQualityRun = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.post(`/insights/repositories/${repoId}/quality/run`)
  return data as { run_id: string; status: string }
}
