import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LogIn, LogOut } from 'lucide-react'

import { useAuth } from '../features/auth/useAuth'
import { MobileHeaderMenu, MobileNav } from './MobileNav'
import { KaviMark } from './KaviMark'
import { ACTIVE_REPO_STORAGE_KEY, asRepoId, readStoredRepoId } from '../utils/repoId'

const navItems = [
  { to: '/chat', label: 'Chat' },
  { to: '/repositories', label: 'Repositories' },
  { to: '/why', label: 'Why-Lens' },
  { to: '/insights', label: 'Insights' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/settings', label: 'Settings' },
]


export function TopNav() {
  const { isAuthenticated, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [scrolled, setScrolled] = useState(false)
  const [storedRepoId, setStoredRepoId] = useState<string | null>(() => {
    return readStoredRepoId()
  })

  const activeRepoId = useMemo(() => {
    const queryRepoId = asRepoId(new URLSearchParams(location.search).get('repoId'))
    return queryRepoId || storedRepoId
  }, [location.search, storedRepoId])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const queryRepoId = asRepoId(new URLSearchParams(location.search).get('repoId'))
    if (!queryRepoId) return
    setStoredRepoId(queryRepoId)
    try {
      window.localStorage.setItem(ACTIVE_REPO_STORAGE_KEY, queryRepoId)
    } catch {
      // Ignore write failures in private browsing modes or restricted environments.
    }
  }, [location.search])

  const resolveNavTarget = (path: string) => {
    if (!activeRepoId) return path
    if (path === '/chat' || path === '/timeline' || path === '/why' || path === '/insights') {
      return `${path}?repoId=${encodeURIComponent(activeRepoId)}`
    }
    return path
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');

        .kavi-topnav-wrap {
          position: fixed;
          inset-inline: 0;
          top: 0;
          z-index: 1000;
          padding: 20px 24px;
          pointer-events: none;
        }
        @media (max-width: 768px) { .kavi-topnav-wrap { padding: 12px; } }

        .kavi-topnav-inner {
          max-width: 1440px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 8px 8px 16px;
          border-radius: 9999px;
          pointer-events: auto;
          transition: background 0.25s ease, box-shadow 0.25s ease;
        }
        .kavi-topnav-inner.on {
          background: rgb(var(--kv-veil-rgb) / 0.88);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 4px 24px rgba(116, 130, 151, 0.14);
        }

        /* Logo */
        .kavi-nav-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          text-decoration: none;
          flex-shrink: 0;
        }
        .kavi-nav-logomark {
          width: 36px; height: 36px; color: var(--kv-ink);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        /* Nav links — centred absolutely so logo + button stay at edges */
        .kavi-nav-links {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          pointer-events: none;
        }
        @media (max-width: 1024px) { .kavi-nav-links { display: none; } }

        .kavi-nav-link {
          position: relative;
          isolation: isolate;
          pointer-events: auto;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          font-weight: 500;
          color: var(--kv-ink);
          text-decoration: none;
          padding: 8px 18px;
          border-radius: 9999px;
          transition: background 0.15s;
          white-space: nowrap;
        }
        .kavi-nav-link:hover { background: rgb(var(--kv-ink-rgb) / 0.07); }
        .kavi-nav-link.active { color: var(--kv-on-solid); }
        .kavi-nav-link.active:hover { background: transparent; }
        .kavi-nav-pill { position: absolute; inset: 0; border-radius: 9999px; background: var(--kv-solid); z-index: -1; }
        .kavi-nav-link span.kavi-nav-text { position: relative; }

        /* Right side */
        .kavi-nav-right {
          position: relative;
          z-index: 10;
          flex-shrink: 0;
        }
        .kavi-nav-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 20px;
          border-radius: 9999px;
          border: none;
          cursor: pointer;
          font-family: 'Archivo', sans-serif;
          font-size: 15px;
          font-weight: 500;
          letter-spacing: 0.01em;
          white-space: nowrap;
          transition: background 0.15s;
          background: var(--kv-solid);
          color: var(--kv-on-solid);
        }
        .kavi-nav-btn:hover { background: var(--kv-solid-hover); }

        @media (max-width: 560px) {
          .kavi-topnav-inner {
            padding: 6px 6px 6px 10px;
          }
          .kavi-nav-btn {
            font-size: 13px;
            padding: 8px 12px;
            gap: 5px;
          }
        }

        @media (max-width: 1024px) { .kavi-nav-btn-logout { display: none; } }

        @media (max-width: 420px) {
          .kavi-nav-btn {
            font-size: 12px;
            padding: 7px 10px;
          }
        }
      `}</style>

      <header className="kavi-topnav-wrap">
        {/* We use a relative wrapper so the absolute nav-links can center against the full bar */}
        <motion.div
          className={`kavi-topnav-inner${scrolled ? ' on' : ''}`}
          style={{ position: 'relative' }}
          animate={{ y: scrolled ? 0 : 4 }}
          transition={{ type: 'spring', stiffness: 280, damping: 30, mass: 0.5 }}
        >
          {/* Logo */}
          <NavLink to="/" className="kavi-nav-logo" aria-label="Kavi home">
            <span className="kavi-nav-logomark"><KaviMark size={26} /></span>
          </NavLink>

          {/* Centred nav links */}
          <nav className="kavi-nav-links" aria-label="Main navigation">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={resolveNavTarget(item.to)}
                className={({ isActive }) =>
                  `kavi-nav-link${isActive ? ' active' : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="kavi-nav-pill" className="kavi-nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <span className="kavi-nav-text">{item.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          {/* Auth button */}
          <div className="kavi-nav-right">
            {isAuthenticated && <MobileHeaderMenu resolve={resolveNavTarget} onLogout={logout} />}
            {isAuthenticated ? (
              <button onClick={logout} className="kavi-nav-btn kavi-nav-btn-logout">
                <LogOut size={14} />
                Logout
              </button>
            ) : (
              <button onClick={() => navigate('/login?returnTo=%2Fconnect-github')} className="kavi-nav-btn">
                <LogIn size={14} />
                Login
              </button>
            )}
          </div>
        </motion.div>
      </header>
      {isAuthenticated && <MobileNav resolve={resolveNavTarget} />}
    </>
  )
}
