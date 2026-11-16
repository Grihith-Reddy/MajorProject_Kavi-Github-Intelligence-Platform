import { Moon, Sun } from 'lucide-react'

import { setThemePreference, useResolvedDark } from './theme'

/** One-tap light/dark switch for pages without the Settings appearance card (landing, login, footer). */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useResolvedDark()
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'
  return (
    <button type="button" className={className} onClick={() => setThemePreference(dark ? 'light' : 'dark')} aria-label={label} title={label}>
      {dark ? <Sun size={17} strokeWidth={1.9} /> : <Moon size={17} strokeWidth={1.9} />}
    </button>
  )
}
