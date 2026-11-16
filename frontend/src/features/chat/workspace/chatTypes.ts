import { type ReactNode, type RefObject } from 'react'
import { type CodeSnippet } from '../../../features/chat/CodeSnippetCard'
import { type AgentTraceStep } from '../../../services/chatStream'
import { ChatMode } from '../../../services/chatService'
import { type GitVisualizationResponse } from '../../../services/knowledgeService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StructuredSection { heading: string; bullets: string[] }
export interface CodeReference { file_path: string; start_line?: number | null; end_line?: number | null; pr_number?: number | null; note?: string }
export interface TimelineHighlight { label: string; detail: string }
export interface StructuredAnswer { format?: 'plain' | 'structured' | 'markdown'; trace?: AgentTraceStep[]; as_of?: string | null; title?: string; summary?: string; sections?: StructuredSection[]; code_references?: CodeReference[]; code_snippets?: CodeSnippet[]; timeline_highlights?: TimelineHighlight[]; limitations?: string[] }
export interface ChatEntry {
  role: 'user' | 'assistant'
  content: string
  structured?: StructuredAnswer | null
  format?: 'markdown'
  trace?: AgentTraceStep[]
  notes?: string[]
  live?: boolean
  prUrls?: Record<number, string>
  messageId?: string
  sources?: ChatSource[]
  asOf?: string | null
}
export interface ChatSource { [key: string]: unknown }
export interface ChatConversationSummary {
  id: string
  repo_id?: string
  title?: string
  status?: string
  message_count?: number
  last_message_at?: string
}
export interface KnowledgeFileRow { file_path: string; reference_count?: number }
export interface KnowledgeEntryRow {
  id?: string
  summary?: string
  intent?: string
  github_pr_number?: number
  pr_title?: string
  pr_state?: string
  created_at?: string
}
export interface ChatQueryResponse {
  answer?: string
  answer_structured?: StructuredAnswer | null
  sources?: ChatSource[]
  context?: ChatSource[]
  mode?: ChatMode
  conversation_id?: string | null
  conversation?: ChatConversationSummary | null
}
export interface WorkspaceRenderProps { repoId: string; repositoryName: string; userName: string | null; messages: ChatEntry[]; chatLoading: boolean; chatInput: string; setChatInput: (v: string) => void; chatSources: ChatSource[]; entries: KnowledgeEntryRow[]; files: KnowledgeFileRow[]; entriesLoading: boolean; entriesError: Error | null; filesLoading: boolean; filesError: Error | null; noPrContext: boolean; onSend: (input: string) => void; messagesEndRef: RefObject<HTMLDivElement>; streamingIndex: number | null; onAssistantStreamComplete: (index: number) => void; gitVisualization: GitVisualizationResponse | null; gitVisualizationLoading: boolean; gitVisualizationError: Error | null; renderHistory: (close: () => void) => ReactNode; timeTravel: string | null; setTimeTravel: (value: string | null) => void; controls: ChatControls }
export interface WorkspaceOverlayProps { repoId: string; repositoryName: string; entries: KnowledgeEntryRow[]; files: KnowledgeFileRow[]; chatSources: ChatSource[]; entriesLoading: boolean; entriesError: Error | null; filesLoading: boolean; filesError: Error | null; onNavigate?: () => void; gitVisualization: GitVisualizationResponse | null; gitVisualizationLoading: boolean; gitVisualizationError: Error | null; historyNode?: ReactNode }
export interface ChatControls {
  onStop: () => void
  onRegenerate: () => void
  onEditLast: () => void
  onExport: (format: 'markdown' | 'pdf') => void
  onNewChat: () => void
  /** Opens the confirmation to delete every chat in this repository. */
  onClearAll: () => void
}
export interface ChatPaneProps { controls: ChatControls; repoId: string; repositoryName: string; userName: string | null; timeTravel: string | null; setTimeTravel: (value: string | null) => void; messages: ChatEntry[]; chatLoading: boolean; chatInput: string; setChatInput: (v: string) => void; noPrContext: boolean; onSend: (input: string) => void; messagesEndRef: RefObject<HTMLDivElement>; streamingIndex: number | null; onAssistantStreamComplete: (index: number) => void; onOpenMenu: () => void; menuOpen: boolean }

export type WorkspacePanelId = 'repository' | 'history' | 'focus' | 'prs' | 'files' | 'git'
