// Theme preference: 'system' follows the OS; the resolved theme lives on <html data-theme>.
import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
const STORAGE_KEY = 'kavi.theme'
const EVENT = 'kavi-theme-change'

export function getThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(preference: ThemePreference = getThemePreference()): void {
  const dark = preference === 'dark' || (preference === 'system' && systemPrefersDark())
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
  applyTheme(preference)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: preference }))
}

/** Keeps 'system' in sync with OS changes. Call once at startup. */
export function watchSystemTheme(): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => { if (getThemePreference() === 'system') applyTheme('system') }
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function useThemePreference(): [ThemePreference, (value: ThemePreference) => void] {
  const [preference, setPreference] = useState<ThemePreference>(getThemePreference)
  useEffect(() => {
    const onChange = (event: Event) => setPreference((event as CustomEvent<ThemePreference>).detail)
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [])
  return [preference, setThemePreference]
}

/** Whether the page is currently dark, following every change (toggle, Settings, or the OS). */
export function useResolvedDark(): boolean {
  const read = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'dark'
  const [dark, setDark] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}
