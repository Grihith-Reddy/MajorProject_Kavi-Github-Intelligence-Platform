import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

import { useThemePreference } from './theme'

function resolvedDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

/** One-tap light/dark switch for pages without the Settings appearance card (landing, login). */
export function ThemeToggle({ className }: { className?: string }) {
  const [preference, setPreference] = useThemePreference()
  const [dark, setDark] = useState(resolvedDark)

  // Follow every change: this toggle, Settings, or the OS when the preference is 'system'.
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(resolvedDark()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [preference])

  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button type="button" className={className} onClick={() => setPreference(dark ? 'light' : 'dark')} aria-label={label} title={label}>
      {dark ? <Sun size={17} strokeWidth={1.9} /> : <Moon size={17} strokeWidth={1.9} />}
    </button>
  )
}
