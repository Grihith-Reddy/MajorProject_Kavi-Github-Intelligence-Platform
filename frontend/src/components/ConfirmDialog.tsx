import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A small modal that asks before something cannot be undone. Focus starts on Cancel (the safe
 * choice), stays inside the dialog, and returns to whatever opened it. Escape and the backdrop cancel.
 */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = 'Cancel', destructive, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus?.() }
  }, [open, busy, onCancel])

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const items = event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled])')
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="kv-confirm-layer">
          <motion.div className="kv-confirm-backdrop" onClick={() => { if (!busy) onCancel() }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className="kv-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="kv-confirm-title"
            aria-describedby="kv-confirm-desc"
            onKeyDown={trapTab}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <h2 id="kv-confirm-title" className="kv-confirm-title">{title}</h2>
            <div id="kv-confirm-desc" className="kv-confirm-desc">{description}</div>
            <div className="kv-confirm-actions">
              <button ref={cancelRef} type="button" className="kv-confirm-btn" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
              <button type="button" className={`kv-confirm-btn is-primary${destructive ? ' is-danger' : ''}`} onClick={onConfirm} disabled={busy}>
                {busy && <Loader2 size={14} className="kv-spin" aria-hidden />}
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
