import { useState } from 'react'
import { motion } from 'framer-motion'
import { ThumbsDown, ThumbsUp } from 'lucide-react'

import { useApiClient } from '../../services/apiClient'
import { rateMessage } from '../../services/chatService'

/** Helpful / not helpful on an assistant answer. Clicking the active choice clears it. */
export function AnswerFeedback({ messageId, initial = 0 }: { messageId: string; initial?: -1 | 0 | 1 }) {
  const api = useApiClient()
  const [rating, setRating] = useState<-1 | 0 | 1>(initial)
  const [saving, setSaving] = useState(false)

  const choose = async (value: -1 | 1) => {
    const next = rating === value ? 0 : value
    const previous = rating
    setRating(next)
    setSaving(true)
    try {
      await rateMessage(api, messageId, next)
    } catch {
      setRating(previous)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="kv-feedback" role="group" aria-label="Was this answer helpful?">
      {rating !== 0 && (
        <motion.span className="kv-feedback-note" initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }}>
          {rating === 1 ? 'Thanks, noted.' : 'Noted. This shows up on Insights → Quality.'}
        </motion.span>
      )}
      <button type="button" className={`kv-feedback-btn${rating === 1 ? ' is-active' : ''}`} onClick={() => choose(1)} disabled={saving} aria-pressed={rating === 1} aria-label="Mark helpful" data-tip="Mark helpful">
        <ThumbsUp size={13} />
      </button>
      <button type="button" className={`kv-feedback-btn${rating === -1 ? ' is-active is-down' : ''}`} onClick={() => choose(-1)} disabled={saving} aria-pressed={rating === -1} aria-label="Mark not helpful" data-tip="Mark not helpful">
        <ThumbsDown size={13} />
      </button>
    </div>
  )
}
