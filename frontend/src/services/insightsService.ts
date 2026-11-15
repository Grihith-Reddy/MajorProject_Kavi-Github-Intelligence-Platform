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
