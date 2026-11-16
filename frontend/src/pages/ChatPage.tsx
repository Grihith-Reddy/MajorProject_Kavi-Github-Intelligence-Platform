import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useToast } from '../features/toast/toastContext'
import { useAuth } from '../features/auth/useAuth'
import { ConversationHistory } from '../features/chat/ConversationHistory'
import { streamChat, type AgentTraceStep } from '../services/chatStream'
import { useAsync } from '../hooks/useAsync'
import { useApiClient } from '../services/apiClient'
import { ChatMode, clearConversations, getConversation, queryChat } from '../services/chatService'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { getApiErrorMessage } from '../utils/errors'
import { getRepositoryStatus } from '../services/githubService'
import { getGitVisualization, listKnowledgeEntries, listKnowledgeFiles } from '../services/knowledgeService'
import { ChatWorkspace } from '../features/chat/workspace/ChatWorkspace'
import { ACTIVE_REPO_STORAGE_KEY, defaultMessages, getChatStorageKey, readStoredRepoId, resolveChatMode, resolveUserDisplayName } from '../features/chat/workspace/chatHelpers'
import { type ChatEntry, type ChatQueryResponse, type ChatSource, type StructuredAnswer } from '../features/chat/workspace/chatTypes'
import { asRepoId } from '../utils/repoId'

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ChatPage() {
  const api = useApiClient()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryRepoId = asRepoId(searchParams.get('repoId'))
  const [storedRepoId, setStoredRepoId] = useState<string | null>(() => readStoredRepoId())
  const repoId = queryRepoId || storedRepoId
  const userSub = typeof user?.sub === 'string' ? user.sub : null
  const welcomeName = useMemo(() => resolveUserDisplayName(user), [user])
  const chatStorageKey = useMemo(() => getChatStorageKey(userSub, repoId), [userSub, repoId])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasInitialPositionedRef = useRef(false)

  const { data: filesData, error: filesError, loading: filesLoading } = useAsync(() => (repoId ? listKnowledgeFiles(api, repoId) : Promise.resolve(null)), [api, repoId])
  const { data: entriesData, error: entriesError, loading: entriesLoading } = useAsync(() => (repoId ? listKnowledgeEntries(api, repoId) : Promise.resolve(null)), [api, repoId])
  const { data: repositoryStatus } = useAsync(() => (repoId ? getRepositoryStatus(api, repoId) : Promise.resolve(null)), [api, repoId])
  const { data: gitVisualizationData, error: gitVisualizationError, loading: gitVisualizationLoading } = useAsync(() => (repoId ? getGitVisualization(api, repoId) : Promise.resolve(null)), [api, repoId])

  const [messages, setMessages] = useState<ChatEntry[]>(() => defaultMessages(welcomeName))
  const [chatLoading, setChatLoading] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatSources, setChatSources] = useState<ChatSource[]>([])
  const [chatConversationId, setChatConversationId] = useState<string | null>(null)
  const [chatHydrated, setChatHydrated] = useState(false)
  const [streamingIndex, setStreamingIndex] = useState<number | null>(null)
  const [timeTravel, setTimeTravel] = useState<string | null>(null)

  const scrollToLatestMessage = useCallback((behavior: ScrollBehavior = 'smooth') => {
    requestAnimationFrame(() => { messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' }) })
  }, [])

  useEffect(() => {
    if (!queryRepoId) return
    setStoredRepoId(queryRepoId)
    try {
      window.localStorage.setItem(ACTIVE_REPO_STORAGE_KEY, queryRepoId)
    } catch {
      // Ignore localStorage write errors in restricted browser environments.
    }
  }, [queryRepoId])

  useEffect(() => {
    setChatHydrated(false)
    hasInitialPositionedRef.current = false
    if (!chatStorageKey) { setMessages(defaultMessages(welcomeName)); setChatSources([]); setChatConversationId(null); setChatHydrated(true); return }
    try {
      const raw = window.localStorage.getItem(chatStorageKey)
      if (!raw) { setMessages(defaultMessages(welcomeName)); setChatSources([]); setChatConversationId(null); setChatHydrated(true); return }
      const parsed = JSON.parse(raw) as { messages?: unknown; chatSources?: unknown; conversationId?: unknown }
      const persistedMessages = Array.isArray(parsed.messages)
        ? parsed.messages.filter((item): item is ChatEntry => Boolean(item) && typeof item === 'object' && (item as ChatEntry).role !== undefined && ((item as ChatEntry).role === 'assistant' || (item as ChatEntry).role === 'user') && typeof (item as ChatEntry).content === 'string')
            .map((item) => ({ role: item.role, content: item.content, structured: item.structured && typeof item.structured === 'object' ? (item.structured as StructuredAnswer) : undefined, format: item.format === 'markdown' ? 'markdown' as const : undefined, trace: Array.isArray(item.trace) ? item.trace : undefined, prUrls: item.prUrls && typeof item.prUrls === 'object' ? item.prUrls : undefined, messageId: typeof item.messageId === 'string' ? item.messageId : undefined, sources: Array.isArray(item.sources) ? item.sources : undefined, asOf: typeof item.asOf === 'string' ? item.asOf : undefined }))
        : []
      const persistedSources = Array.isArray(parsed.chatSources) ? parsed.chatSources : []
      const persistedConversationId = typeof parsed.conversationId === 'string' && parsed.conversationId.trim() ? parsed.conversationId.trim() : null
      setMessages(persistedMessages.length ? persistedMessages : defaultMessages(welcomeName))
      setChatSources(persistedSources as ChatSource[])
      setChatConversationId(persistedConversationId)
    } catch { setMessages(defaultMessages(welcomeName)); setChatSources([]); setChatConversationId(null) }
    finally { setChatHydrated(true) }
  }, [chatStorageKey, welcomeName])

  useEffect(() => {
    if (!chatStorageKey || !chatHydrated) return
    try {
      window.localStorage.setItem(
        chatStorageKey,
        JSON.stringify({
          messages,
          chatSources,
          conversationId: chatConversationId,
          updatedAt: new Date().toISOString(),
        })
      )
    } catch {
      // Persisted chat state is best-effort; continue without blocking UI updates.
    }
  }, [chatStorageKey, chatHydrated, messages, chatSources, chatConversationId])

  useEffect(() => {
    if (!chatHydrated || hasInitialPositionedRef.current) return
    hasInitialPositionedRef.current = true
    scrollToLatestMessage('auto')
  }, [chatHydrated, scrollToLatestMessage])

  const files = useMemo(() => filesData?.files ?? [], [filesData])
  const entries = useMemo(() => entriesData?.entries ?? [], [entriesData])
  const repositoryName = useMemo(() => { const fn = repositoryStatus?.repository?.full_name; return typeof fn === 'string' && fn.trim() ? fn : 'Selected repository' }, [repositoryStatus])
  const noPrContext = !filesLoading && !entriesLoading && !filesError && !entriesError && entries.length === 0 && files.length === 0
  const handleAssistantStreamComplete = useCallback((index: number) => {
    setStreamingIndex((current) => (current === index ? null : current))
  }, [])

  const { getToken } = useAuth()
  const streamAbortRef = useRef<AbortController | null>(null)
  useEffect(() => () => streamAbortRef.current?.abort(), [])

  const updateLiveMessage = useCallback((updater: (message: ChatEntry) => ChatEntry) => {
    setMessages((prev) => {
      const index = prev.length - 1
      if (index < 0 || !prev[index].live) return prev
      const next = prev.slice()
      next[index] = updater(prev[index])
      return next
    })
  }, [])

  const replaceLiveWith = useCallback((entry: ChatEntry, typewriter: boolean) => {
    setMessages((prev) => {
      const base = prev[prev.length - 1]?.live ? prev.slice(0, -1) : prev
      const next = [...base, entry]
      setStreamingIndex(typewriter ? next.length - 1 : null)
      return next
    })
  }, [])

  const sendWithLegacyEndpoint = async (trimmed: string, mode: ChatMode) => {
    const data = (await queryChat(api, repoId as string, trimmed, mode, chatConversationId)) as ChatQueryResponse
    const structured = data.answer_structured || null
    replaceLiveWith({ role: 'assistant', content: data.answer || "I couldn't generate an answer.", structured }, !structured)
    if (Array.isArray(data.sources)) setChatSources(data.sources)
    else if (Array.isArray(data.context)) setChatSources(data.context)
    else setChatSources([])
    if (typeof data.conversation_id === 'string' && data.conversation_id.trim()) {
      setChatConversationId(data.conversation_id.trim())
    }
  }

  const handleSend = async (input: string) => {
    if (!repoId || !input.trim() || chatLoading) return
    const trimmed = input.trim()
    const mode = resolveChatMode(trimmed)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmed },
      { role: 'assistant', content: '', format: 'markdown', trace: [], notes: [], live: true, asOf: timeTravel },
    ])
    setChatInput('')
    setChatLoading(true)
    scrollToLatestMessage('smooth')

    const controller = new AbortController()
    streamAbortRef.current = controller
    let receivedAnything = false
    let legacyHandled = false

    try {
      await streamChat(
        { repoId, query: trimmed, mode, conversationId: chatConversationId, asOf: timeTravel, getToken, signal: controller.signal },
        {
          onMeta: (data) => {
            receivedAnything = true
            if (data.conversation?.id) setChatConversationId(data.conversation.id)
          },
          onStep: (step) => {
            receivedAnything = true
            updateLiveMessage((message) => {
              const trace = message.trace ?? []
              const existing = trace.findIndex((item) => item.id === step.id)
              const nextTrace = existing >= 0 ? trace.map((item, i) => (i === existing ? step : item)) : [...trace, step]
              return { ...message, trace: nextTrace }
            })
          },
          onNote: (text) => {
            updateLiveMessage((message) => ({ ...message, content: '', notes: [...(message.notes ?? []), text.trim()].filter(Boolean) }))
          },
          onToken: (text) => {
            receivedAnything = true
            updateLiveMessage((message) => ({ ...message, content: message.content + text }))
          },
          onLegacy: (data) => {
            receivedAnything = true
            legacyHandled = true
            const legacy = data as unknown as ChatQueryResponse
            const structured = legacy.answer_structured || null
            replaceLiveWith({ role: 'assistant', content: legacy.answer || "I couldn't generate an answer.", structured }, !structured)
            if (Array.isArray(legacy.sources)) setChatSources(legacy.sources)
            if (typeof legacy.conversation_id === 'string' && legacy.conversation_id) setChatConversationId(legacy.conversation_id)
          },
          onDone: (data) => {
            if (legacyHandled) return
            const sources = Array.isArray(data.sources) ? (data.sources as ChatSource[]) : []
            const prUrls: Record<number, string> = {}
            for (const source of sources) {
              const number = Number(source.pr_number)
              if (number && typeof source.pr_url === 'string') prUrls[number] = source.pr_url
            }
            const finalAnswer = typeof data.answer === 'string' ? data.answer : null
            updateLiveMessage((message) => ({
              ...message,
              content: finalAnswer ?? message.content,
              trace: Array.isArray(data.trace) ? (data.trace as AgentTraceStep[]) : message.trace,
              prUrls,
              sources,
              messageId: typeof data.assistant_message_id === 'string' && data.assistant_message_id ? data.assistant_message_id : message.messageId,
              live: false,
            }))
            setChatSources(sources)
            const conversation = data.conversation as { id?: string } | null
            if (conversation?.id) setChatConversationId(conversation.id)
          },
          onError: (message) => {
            updateLiveMessage((entry) => ({ ...entry, content: entry.content || message, live: false }))
          },
        }
      )
      // The stream ended without a terminal event: close the live bubble.
      updateLiveMessage((message) => ({ ...message, live: false, content: message.content || 'The answer was interrupted. Please try again.' }))
    } catch {
      if (controller.signal.aborted) return
      if (!receivedAnything) {
        try {
          await sendWithLegacyEndpoint(trimmed, mode)
        } catch {
          replaceLiveWith({ role: 'assistant', content: 'An error occurred while processing your query.' }, true)
        }
      } else {
        updateLiveMessage((message) => ({ ...message, live: false, content: message.content || 'The connection dropped before the answer finished.' }))
      }
    } finally {
      setChatLoading(false)
      if (streamAbortRef.current === controller) streamAbortRef.current = null
    }
  }

  // Questions handed over from other pages (e.g. Why-Lens) via ?ask=
  const pendingAsk = searchParams.get('ask')
  const askHandledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingAsk || !chatHydrated || !repoId || chatLoading) return
    if (askHandledRef.current === pendingAsk) return
    askHandledRef.current = pendingAsk
    const next = new URLSearchParams(searchParams)
    next.delete('ask')
    setSearchParams(next, { replace: true })
    void handleSend(pendingAsk)
    // handleSend is recreated every render; the ref guard keeps this one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk, chatHydrated, repoId])

  const toast = useToast()

  const stopAnswer = useCallback(() => {
    if (!streamAbortRef.current) return
    streamAbortRef.current.abort()
    updateLiveMessage((message) => ({ ...message, live: false, content: message.content || '_Stopped before an answer was written._' }))
    setChatLoading(false)
  }, [updateLiveMessage])

  const lastUserQuestion = () => [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''

  const dropLastTurn = () => {
    setMessages((prev) => {
      const lastUser = prev.map((message) => message.role).lastIndexOf('user')
      return lastUser >= 0 ? prev.slice(0, lastUser) : prev
    })
  }

  const regenerateAnswer = () => {
    const question = lastUserQuestion()
    if (!question || chatLoading) return
    dropLastTurn()
    window.setTimeout(() => { void handleSend(question) }, 0)
  }

  const editLastQuestion = () => {
    const question = lastUserQuestion()
    if (!question || chatLoading) return
    dropLastTurn()
    setChatInput(question)
  }

  const exportConversation = (format: 'markdown' | 'pdf') => {
    const turns = messages.filter((message) => message.content.trim() && !message.live)
    if (!turns.length) return
    if (format === 'pdf') {
      window.print()
      return
    }
    const lines = [`# KAVI conversation: ${repositoryName}`, '', `Exported ${new Date().toLocaleString()}`, '']
    for (const message of turns) {
      if (message.role === 'user') {
        lines.push(`## ${message.content.trim()}`, '')
        continue
      }
      if (message.asOf) lines.push(`_As of ${message.asOf}_`, '')
      lines.push(message.content.trim(), '')
      const cited = (message.sources ?? []).filter((source) => source.pr_number)
      if (cited.length) {
        lines.push('**Sources**', '')
        for (const source of cited.slice(0, 8)) {
          const title = String(source.pr_title || '').trim()
          const url = typeof source.pr_url === 'string' ? source.pr_url : ''
          lines.push(`- PR #${source.pr_number}${title ? `: ${title}` : ''}${url ? ` (${url})` : ''}`)
        }
        lines.push('')
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `kavi-${repositoryName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.md`
    link.click()
    URL.revokeObjectURL(url)
    toast.success('Conversation exported', { description: 'Saved as a Markdown file.' })
  }

  const startNewConversation = useCallback(() => {
    streamAbortRef.current?.abort()
    setMessages(defaultMessages(welcomeName))
    setChatSources([])
    setChatConversationId(null)
    setStreamingIndex(null)
  }, [welcomeName])

  const [clearOpen, setClearOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [historyVersion, setHistoryVersion] = useState(0)
  const clearAllChats = async () => {
    if (!repoId) return
    setClearing(true)
    try {
      const deleted = await clearConversations(api, repoId)
      if (chatStorageKey) {
        try { window.localStorage.removeItem(chatStorageKey) } catch { /* storage may be unavailable */ }
      }
      startNewConversation()
      setHistoryVersion((version) => version + 1)
      setClearOpen(false)
      toast.success('All chats cleared', { description: deleted === 1 ? '1 conversation deleted.' : `${deleted} conversations deleted.` })
    } catch (error) {
      toast.error("Couldn't clear chats", { description: getApiErrorMessage(error, 'Please try again.') })
    } finally {
      setClearing(false)
    }
  }

  const openConversation = useCallback(async (conversationId: string) => {
    try {
      const { messages: rows } = await getConversation(api, conversationId)
      const mapped: ChatEntry[] = rows
        .filter((row) => row.role === 'user' || row.role === 'assistant')
        .map((row) => {
          const structured = (row.answer_structured ?? null) as StructuredAnswer | null
          const prUrls: Record<number, string> = {}
          for (const source of row.sources ?? []) {
            const number = Number(source.pr_number)
            if (number && typeof source.pr_url === 'string') prUrls[number] = source.pr_url
          }
          return {
            role: row.role as 'user' | 'assistant',
            content: row.content,
            structured,
            format: structured?.format === 'markdown' ? ('markdown' as const) : undefined,
            trace: structured?.trace,
            prUrls,
            sources: (row.sources ?? undefined) as ChatSource[] | undefined,
            messageId: row.role === 'assistant' ? row.id : undefined,
            asOf: structured?.as_of ?? null,
          }
        })
      const lastAssistant = [...rows].reverse().find((row) => row.role === 'assistant')
      setMessages(mapped.length ? mapped : defaultMessages(welcomeName))
      setChatSources((lastAssistant?.sources ?? []) as ChatSource[])
      setChatConversationId(conversationId)
      setStreamingIndex(null)
      scrollToLatestMessage('auto')
    } catch {
      // Keep the current conversation if the selected one cannot be loaded.
    }
  }, [api, welcomeName, scrollToLatestMessage])

  if (!repoId) {
    return (
      <div style={{ borderRadius: 32, background: 'var(--kv-mist)', border: '1px solid var(--kv-line)', padding: '64px 48px', textAlign: 'center' }}>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 22, fontWeight: 600, color: 'var(--kv-ink)', marginBottom: 8 }}>No repository selected</p>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, color: 'var(--kv-ink-2)', marginBottom: 28 }}>Pick a synced repository before opening chat.</p>
        <Link to="/repositories" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: 'var(--kv-solid)', color: 'var(--kv-on-solid)', borderRadius: 9999, fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>
          Open repositories <ArrowRight size={15} />
        </Link>
      </div>
    )
  }

  return (
    <>
    <ChatWorkspace
      repoId={repoId}
      repositoryName={repositoryName}
      userName={welcomeName}
      messages={messages}
      chatLoading={chatLoading}
      chatInput={chatInput}
      setChatInput={setChatInput}
      chatSources={chatSources}
      entries={entries}
      files={files}
      entriesLoading={entriesLoading}
      entriesError={entriesError}
      filesLoading={filesLoading}
      filesError={filesError}
      noPrContext={noPrContext}
      onSend={handleSend}
      messagesEndRef={messagesEndRef}
      streamingIndex={streamingIndex}
      onAssistantStreamComplete={handleAssistantStreamComplete}
      gitVisualization={gitVisualizationData ?? null}
      gitVisualizationLoading={gitVisualizationLoading}
      gitVisualizationError={gitVisualizationError}
      timeTravel={timeTravel}
      controls={{ onStop: stopAnswer, onRegenerate: regenerateAnswer, onEditLast: editLastQuestion, onExport: exportConversation, onNewChat: startNewConversation, onClearAll: () => setClearOpen(true) }}
      setTimeTravel={setTimeTravel}
      renderHistory={(close) => (
        <ConversationHistory
          key={historyVersion}
          repoId={repoId}
          activeConversationId={chatConversationId}
          onNew={() => { startNewConversation(); close() }}
          onSelect={(id) => { void openConversation(id); close() }}
        />
      )}
    />
    <ConfirmDialog
      open={clearOpen}
      title="Clear all chats?"
      description={<>This permanently deletes every conversation you have had about <strong>{repositoryName}</strong>, and what KAVI learned from them. It can't be undone.</>}
      confirmLabel="Delete all chats"
      destructive
      busy={clearing}
      onConfirm={() => { void clearAllChats() }}
      onCancel={() => setClearOpen(false)}
    />
    </>
  )
}
