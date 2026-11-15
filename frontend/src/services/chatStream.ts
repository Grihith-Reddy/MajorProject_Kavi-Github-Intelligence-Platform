import type { ChatMode } from './chatService'

export interface AgentTraceStep {
  id: string
  tool: string
  label: string
  status: 'running' | 'done' | 'error'
  summary?: string
}

export interface ChatStreamHandlers {
  onMeta?: (data: { conversation?: { id: string } | null; mode?: ChatMode }) => void
  onStep?: (step: AgentTraceStep) => void
  onNote?: (text: string) => void
  onToken?: (text: string) => void
  onLegacy?: (data: Record<string, unknown>) => void
  onDone?: (data: Record<string, unknown>) => void
  onError?: (message: string) => void
}

interface StreamRequest {
  repoId: string
  query: string
  mode: ChatMode
  conversationId?: string | null
  asOf?: string | null
  getToken: () => Promise<string | undefined>
  signal?: AbortSignal
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'

/**
 * POST /chat/stream and dispatch Server-Sent Events as they arrive.
 * Resolves when the stream ends; rejects if the request cannot be started
 * (callers fall back to the non-streaming endpoint).
 */
export async function streamChat(request: StreamRequest, handlers: ChatStreamHandlers): Promise<void> {
  const token = await request.getToken()
  const response = await fetch(`${API_BASE}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      repo_id: request.repoId,
      query: request.query,
      mode: request.mode,
      conversation_id: request.conversationId ?? undefined,
      as_of: request.asOf || undefined,
    }),
    signal: request.signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`Streaming chat unavailable (HTTP ${response.status})`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const dispatch = (rawEvent: string) => {
    let eventName = 'message'
    const dataLines: string[] = []
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (!dataLines.length) return
    let data: Record<string, unknown>
    try {
      data = JSON.parse(dataLines.join('\n'))
    } catch {
      return
    }
    switch (eventName) {
      case 'meta': handlers.onMeta?.(data as never); break
      case 'step': handlers.onStep?.(data as unknown as AgentTraceStep); break
      case 'note': handlers.onNote?.(String(data.text ?? '')); break
      case 'token': handlers.onToken?.(String(data.text ?? '')); break
      case 'legacy': handlers.onLegacy?.(data); break
      case 'done': handlers.onDone?.(data); break
      case 'error': handlers.onError?.(String(data.message ?? 'Something went wrong.')); break
      default: break
    }
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      dispatch(buffer.slice(0, boundary))
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')
    }
  }
  if (buffer.trim()) dispatch(buffer)
}
