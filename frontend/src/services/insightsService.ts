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
