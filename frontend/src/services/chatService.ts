import { AxiosInstance } from 'axios'

export type ChatMode = 'default' | 'repo_overview'

export const queryChat = async (
  api: AxiosInstance,
  repoId: string,
  query: string,
  mode: ChatMode = 'default',
  conversationId?: string | null
) => {
  const { data } = await api.post('/chat/query', {
    repo_id: repoId,
    query,
    mode,
    conversation_id: conversationId ?? undefined
  })
  return data
}

export interface ConversationSummary {
  id: string
  repo_id?: string
  title?: string
  status?: string
  message_count?: number
  last_message_at?: string | null
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  answer_structured?: Record<string, unknown> | null
  sources?: Array<Record<string, unknown>> | null
  created_at?: string | null
}

export const listConversations = async (api: AxiosInstance, repoId: string) => {
  const { data } = await api.get('/chat/conversations', { params: { repo_id: repoId } })
  return ((data?.conversations ?? []) as ConversationSummary[])
}

export const getConversation = async (api: AxiosInstance, conversationId: string) => {
  const { data } = await api.get(`/chat/conversations/${conversationId}`)
  return data as { conversation: ConversationSummary; messages: ConversationMessage[] }
}

export const rateMessage = async (api: AxiosInstance, messageId: string, rating: -1 | 0 | 1) => {
  await api.post(`/chat/messages/${messageId}/feedback`, { rating })
}
