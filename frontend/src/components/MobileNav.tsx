import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NavLink, useLocation } from 'react-router-dom'
import { Clock3, FolderGit2, LogOut, MessageSquareText, MoreHorizontal, Network, ScanLine, Settings, X, type LucideIcon } from 'lucide-react'

interface Props {
  resolve: (path: string) => string
  onLogout: () => void
}

const PRIMARY: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/chat', label: 'Chat', icon: MessageSquareText },
  { to: '/repositories', label: 'Repos', icon: FolderGit2 },
  { to: '/why', label: 'Why-Lens', icon: ScanLine },
  { to: '/insights', label: 'Insights', icon: Network },
]
const MORE: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: '/timeline', label: 'Timeline', icon: Clock3 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/** Floating bottom tab bar for phones and tablets (the top nav links hide below 1024px). */
export function MobileNav({ resolve, onLogout }: Props) {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreActive = MORE.some((item) => location.pathname.startsWith(item.to))

  useEffect(() => { setMoreOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  return (
    <>
      <nav className="kv-tabbar" aria-label="App navigation">
        {PRIMARY.map((item) => {
          const Icon = item.icon
          const active = location.pathname.startsWith(item.to)
          return (
            <NavLink key={item.to} to={resolve(item.to)} className={`kv-tab${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
              {active && <motion.span layoutId="kv-tab-pill" className="kv-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span className="kv-tab-content"><Icon size={18} strokeWidth={1.75} /><span className="kv-tab-label">{item.label}</span></span>
            </NavLink>
          )
        })}
        <button type="button" className={`kv-tab${moreActive || moreOpen ? ' is-active' : ''}`} onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-haspopup="dialog">
          {(moreActive || moreOpen) && <motion.span layoutId="kv-tab-pill" className="kv-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <span className="kv-tab-content"><MoreHorizontal size={18} strokeWidth={1.75} /><span className="kv-tab-label">More</span></span>
        </button>
      </nav>

      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.button
              type="button"
              className="kv-sheet-backdrop"
              aria-label="Close menu"
              onClick={() => setMoreOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="kv-sheet"
              role="dialog"
              aria-label="More"
              initial={{ y: '110%' }}
              animate={{ y: 0 }}
              exit={{ y: '110%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            >
              <div className="kv-sheet-head">
                <span className="kv-eyebrow">More</span>
                <button type="button" className="kv-icon-btn" onClick={() => setMoreOpen(false)} aria-label="Close menu"><X size={14} /></button>
              </div>
              {MORE.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink key={item.to} to={resolve(item.to)} className="kv-sheet-item">
                    <Icon size={17} strokeWidth={1.75} /> {item.label}
                  </NavLink>
                )
              })}
              <button type="button" className="kv-sheet-item is-danger" onClick={onLogout}>
                <LogOut size={17} strokeWidth={1.75} /> Sign out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
