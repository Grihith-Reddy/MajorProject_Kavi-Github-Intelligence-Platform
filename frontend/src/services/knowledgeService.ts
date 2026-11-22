import { AxiosInstance } from 'axios'

export interface GitExplorerParticipant {
  login: string
  role: 'author' | 'reviewer' | 'commenter'
  interactions: number
}

export interface GitExplorerPullRequest {
  github_pr_number: number
  title: string | null
  state: string | null
  base_branch: string | null
  head_branch: string | null
  author_login: string | null
  url: string | null
  created_at: string | null
  merged_at: string | null
  updated_at: string | null
  intent: string | null
  summary: string | null
  tags: string[]
  commit_count: number
  first_commit_at: string | null
  last_commit_at: string | null
  participants: GitExplorerParticipant[]
  files: string[]
  open_promises: number
  kept_promises: number
}

export interface GitExplorerCommit {
  github_sha: string
  message: string
  author_name: string | null
  committed_at: string | null
  url: string | null
  github_pr_number: number | null
}

export interface GitExplorerResponse {
  repository?: { id?: string; full_name?: string; default_branch?: string | null }
  pull_requests?: GitExplorerPullRequest[]
  commits?: GitExplorerCommit[]
}

export const getGitExplorer = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/knowledge/repositories/${repoId}/git-explorer`)
  return data as GitExplorerResponse
}

export const listKnowledgeEntries = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/knowledge/repositories/${repoId}/entries`)
  return data
}

export const getProjectEvolution = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/knowledge/repositories/${repoId}/evolution`)
  return data
}

export const listKnowledgeFiles = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get(`/knowledge/repositories/${repoId}/files`)
  return data
}

export const getFileDetails = async (api: AxiosInstance, repoId: string, path: string) => {
  const { data } = await api.get(`/knowledge/files`, { params: { repo_id: repoId, path } })
  return data
}
