import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { History } from 'lucide-react'

import type { WhySegment } from '../../services/insightsService'
import { formatAsOf } from '../../utils/format'

/**
 * Scrub a file back through the dates of the commits that shaped it.
 * The rightmost stop is "Today"; picking any other stop reloads the file as of that day.
 */
export function HistorySlider({ segments, value, onChange, disabled }: { segments: WhySegment[]; value: string | null; onChange: (date: string | null) => void; disabled?: boolean }) {
  const stops = useMemo(() => {
    const days = new Set<string>()
    for (const segment of segments) {
      if (segment.committed_at) days.add(segment.committed_at.slice(0, 10))
    }
    return [...days].sort()
  }, [segments])
  const allStops = useMemo(() => {
    const merged = new Set(stops)
    if (value) merged.add(value)
    return [...merged].sort()
  }, [stops, value])

  if (allStops.length < 1) return null
  const index = value ? allStops.indexOf(value) : allStops.length
  const max = allStops.length
  const label = value ? formatAsOf(value) : 'Today'

  return (
    <div className="wl-history">
      <span className="wl-history-label"><History size={14} /> File history</span>
      <input
        type="range"
        className="wl-history-range"
        min={0}
        max={max}
        step={1}
        value={index}
        disabled={disabled}
        aria-label="View the file at a past commit date"
        aria-valuetext={label}
        onChange={(event) => {
          const next = Number(event.target.value)
          onChange(next >= max ? null : allStops[next])
        }}
        style={{ ['--fill' as string]: `${(index / max) * 100}%` }}
      />
      <motion.span key={label} className={`wl-history-value${value ? ' is-past' : ''}`} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}>
        {label}
      </motion.span>
    </div>
  )
}
