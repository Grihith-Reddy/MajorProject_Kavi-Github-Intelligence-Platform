import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Check, Info, X } from 'lucide-react'

import { ToastContext, type ToastApi, type ToastOptions } from './toastContext'

interface ToastItem extends ToastOptions {
  id: number
  title: string
}

const ICONS = { neutral: Info, success: Check, error: AlertCircle }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])

  const show = useCallback((title: string, options: ToastOptions = {}) => {
    const id = nextId.current++
    setToasts((current) => [...current.slice(-3), { id, title, tone: 'neutral', ...options }])
    const duration = options.durationMs ?? (options.tone === 'error' ? 6000 : 3200)
    window.setTimeout(() => dismiss(id), duration)
  }, [dismiss])

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (title, options) => show(title, { ...options, tone: 'success' }),
    error: (title, options) => show(title, { ...options, tone: 'error' }),
  }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="kv-toaster" role="region" aria-label="Notifications">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = ICONS[toast.tone ?? 'neutral']
            return (
              <motion.div
                key={toast.id}
                layout
                className={`kv-toast is-${toast.tone}`}
                role={toast.tone === 'error' ? 'alert' : 'status'}
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96, transition: { duration: 0.16 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                <span className="kv-toast-icon"><Icon size={14} strokeWidth={2.25} /></span>
                <span className="kv-toast-body">
                  <span className="kv-toast-title">{toast.title}</span>
                  {toast.description && <span className="kv-toast-desc">{toast.description}</span>}
                </span>
                {toast.action && (
                  <button type="button" className="kv-toast-action" onClick={() => { toast.action?.onClick(); dismiss(toast.id) }}>
                    {toast.action.label}
                  </button>
                )}
                <button type="button" className="kv-toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
                  <X size={13} />
                </button>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
