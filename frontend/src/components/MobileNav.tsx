import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { NavLink, useLocation } from 'react-router-dom'
import { Clock3, FileDown, FileText, FolderGit2, LogOut, MessageSquarePlus, MessageSquareText, MoreHorizontal, Network, ScanLine, Settings, X, type LucideIcon } from 'lucide-react'

import { useChatHeaderActions } from '../features/chat/chatHeaderActions'

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
export function MobileNav({ resolve }: Pick<Props, 'resolve'>) {
  const location = useLocation()
  return (
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
    </nav>
  )
}

/** Phone header actions: New chat (on the chat page) and a More menu for everything else. */
export function MobileHeaderMenu({ resolve, onLogout }: Props) {
  const location = useLocation()
  const chat = useChatHeaderActions()
  const onChatPage = location.pathname.startsWith('/chat') && chat
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus?.() }
  }, [open])

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const items = event.currentTarget.querySelectorAll<HTMLElement>('a, button')
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const exportAs = (format: 'markdown' | 'pdf') => {
    setOpen(false)
    chat?.onExport(format)
  }

  return (
    <div className="kv-mhead">
      {onChatPage && (
        <button type="button" className="kv-mhead-btn is-solid" onClick={chat.onNewChat} aria-label="Start new chat" data-tip="Start new chat" data-tip-pos="below">
          <MessageSquarePlus size={18} />
        </button>
      )}
      <button type="button" className="kv-mhead-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label="More">
        <MoreHorizontal size={18} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <motion.button type="button" className="kv-sheet-backdrop" aria-label="Close menu" onClick={() => setOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              <motion.div
                className="kv-sheet"
                role="dialog"
                aria-modal="true"
                aria-label="More"
                onKeyDown={trapTab}
                initial={{ y: '110%' }}
                animate={{ y: 0 }}
                exit={{ y: '110%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
              >
                <div className="kv-sheet-head">
                  <span className="kv-eyebrow">More</span>
                  <button ref={closeRef} type="button" className="kv-icon-btn" onClick={() => setOpen(false)} aria-label="Close menu"><X size={14} /></button>
                </div>
                {onChatPage && chat.hasConversation && (
                  <>
                    <button type="button" className="kv-sheet-item" onClick={() => exportAs('markdown')}>
                      <FileText size={17} strokeWidth={1.75} /> Download as Markdown
                    </button>
                    <button type="button" className="kv-sheet-item" onClick={() => exportAs('pdf')}>
                      <FileDown size={17} strokeWidth={1.75} /> Save as PDF
                    </button>
                    <div className="kv-sheet-divider" role="separator" />
                  </>
                )}
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
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
