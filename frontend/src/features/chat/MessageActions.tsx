import { useState } from 'react'
import { Check, Copy, Pencil, RotateCcw } from 'lucide-react'

import { useToast } from '../toast/toastContext'

/** Copy / regenerate for an answer; regenerate only on the latest one. */
export function AnswerActions({ content, onRegenerate, canRegenerate }: { content: string; onRegenerate?: () => void; canRegenerate: boolean }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      toast.success('Answer copied')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Couldn’t copy the answer', { description: 'Your browser blocked clipboard access.' })
    }
  }

  return (
    <div className="kv-msg-actions">
      <button type="button" className="kv-msg-action" onClick={copy} aria-label="Copy answer" title="Copy answer">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {canRegenerate && onRegenerate && (
        <button type="button" className="kv-msg-action" onClick={onRegenerate} aria-label="Regenerate answer" title="Regenerate answer">
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  )
}

/** Edit the latest question (puts it back in the composer). */
export function EditQuestionButton({ onEdit }: { onEdit: () => void }) {
  return (
    <button type="button" className="kv-edit-question" onClick={onEdit} aria-label="Edit question" title="Edit question">
      <Pencil size={12} />
    </button>
  )
}
