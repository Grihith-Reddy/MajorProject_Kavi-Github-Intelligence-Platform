import { motion } from 'framer-motion'
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'

import { useThemePreference, type ThemePreference } from './theme'

const OPTIONS: Array<{ id: ThemePreference; label: string; icon: LucideIcon }> = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
]

export function AppearanceCard() {
  const [preference, setPreference] = useThemePreference()
  return (
    <section className="kv-appearance">
      <p className="kv-eyebrow" style={{ marginBottom: 12 }}>Appearance</p>
      <div className="kv-segmented" role="radiogroup" aria-label="Theme">
        {OPTIONS.map((option) => {
          const Icon = option.icon
          const active = preference === option.id
          return (
            <button key={option.id} type="button" role="radio" aria-checked={active} className={`kv-segment${active ? ' is-active' : ''}`} onClick={() => setPreference(option.id)}>
              {active && <motion.span layoutId="kv-theme-indicator" className="kv-segment-indicator" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span className="kv-segment-content"><Icon size={14} /> {option.label}</span>
            </button>
          )
        })}
      </div>
      <p className="kv-appearance-note">System follows your device and switches automatically.</p>
    </section>
  )
}
