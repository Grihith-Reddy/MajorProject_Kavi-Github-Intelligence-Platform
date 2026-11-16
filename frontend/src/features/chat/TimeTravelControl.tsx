import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { History, X } from 'lucide-react'

import { formatAsOf } from '../../utils/format'


/** Clock button that opens a date picker; answers then reflect the repository on that day. */
export function TimeTravelButton({ value, onChange, disabled }: { value: string | null; onChange: (value: string | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="kv-tt" ref={wrapRef}>
      <button
        type="button"
        className={`kv-tt-btn${value ? ' is-active' : ''}`}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        aria-label="Ask about a past date"
        data-tip="Ask about a past date"
        data-tip-align="start"
      >
        <History size={15} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="kv-tt-pop"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <p className="kv-tt-title">Time-Travel</p>
            <p className="kv-tt-text">Ask about the repository as it was on a past day. KAVI only uses pull requests merged by then and reads the code from that date.</p>
            <input
              type="date"
              className="kv-tt-input"
              max={today}
              value={value ?? ''}
              onChange={(event) => { onChange(event.target.value || null); if (event.target.value) setOpen(false) }}
              aria-label="Date"
            />
            {value && (
              <button type="button" className="kv-btn kv-btn-soft kv-btn-sm" onClick={() => { onChange(null); setOpen(false) }}>
                Back to today
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Banner shown above the composer while Time-Travel is on. */
export function TimeTravelBanner({ value, onClear }: { value: string; onClear: () => void }) {
  return (
    <motion.div className="kv-tt-banner" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
      <History size={13} />
      <span>Answering as of <strong>{formatAsOf(value)}</strong></span>
      <button type="button" onClick={onClear} aria-label="Turn off Time-Travel"><X size={12} /></button>
    </motion.div>
  )
}
