import { AlertTriangle, RotateCcw } from 'lucide-react'

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="kv-state" role="alert">
      <span className="kv-state-icon is-danger"><AlertTriangle size={18} /></span>
      <p className="kv-state-title">{message}</p>
      {onRetry && (
        <button type="button" className="kv-btn kv-btn-soft kv-btn-sm" onClick={onRetry}>
          <RotateCcw size={14} /> Try again
        </button>
      )}
    </div>
  )
}
