import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, MessageSquarePlus } from 'lucide-react'

import { useApiClient } from '../../services/apiClient'
import { listConversations, type ConversationSummary } from '../../services/chatService'

function relativeTime(value?: string | null): string {
  if (!value) return ''
  const then = Date.parse(value)
  if (!Number.isFinite(then)) return ''
  const minutes = Math.round((Date.now() - then) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ConversationHistory({
  repoId,
  activeConversationId,
  onSelect,
  onNew,
}: {
  repoId: string
  activeConversationId: string | null
  onSelect: (conversationId: string) => void
  onNew: () => void
}) {
  const api = useApiClient()
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    listConversations(api, repoId)
      .then((rows) => { if (active) setConversations(rows) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [api, repoId])

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" className="kv-btn kv-btn-dark" onClick={onNew} style={{ marginBottom: 6 }}>
        <MessageSquarePlus size={14} /> New conversation
      </button>
      <p className="kv-eyebrow" style={{ margin: '6px 0 4px' }}>Recent</p>
      {error ? (
        <p style={{ fontFamily: 'var(--kv-font-read)', fontSize: 13, color: 'var(--kv-danger-ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={13} /> Couldn’t load conversations.
        </p>
      ) : conversations === null ? (
        [0, 1, 2].map((i) => <div key={i} className="kv-history-item" style={{ height: 58, opacity: 0.5 }} />)
      ) : conversations.length === 0 ? (
        <p style={{ fontFamily: 'var(--kv-font-read)', fontSize: 13, color: 'var(--kv-ink-3)', lineHeight: 1.5 }}>
          Conversations you have here are saved and remembered across devices.
        </p>
      ) : (
        conversations.map((conversation, index) => (
          <motion.button
            key={conversation.id}
            type="button"
            className={`kv-history-item${conversation.id === activeConversationId ? ' is-active' : ''}`}
            onClick={() => onSelect(conversation.id)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.025, type: 'spring', stiffness: 260, damping: 26 }}
          >
            <span className="kv-history-title">{conversation.title || 'Conversation'}</span>
            <span className="kv-history-meta">
              {Math.max(1, Math.round((conversation.message_count ?? 0) / 2))} question{Math.round((conversation.message_count ?? 0) / 2) === 1 ? '' : 's'}
              {conversation.last_message_at ? ` · ${relativeTime(conversation.last_message_at)}` : ''}
            </span>
          </motion.button>
        ))
      )}
    </section>
  )
}
