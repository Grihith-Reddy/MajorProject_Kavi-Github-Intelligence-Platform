import { AnimatePresence, motion } from 'framer-motion'
import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from '../components/AppShell'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { RequireAuth } from '../features/auth/RequireAuth'
import { RequireGitHubConnection } from '../features/auth/RequireGitHubConnection'

const LandingPage = lazy(() => import('../pages/LandingPage').then((module) => ({ default: module.LandingPage })))
const LoginPage = lazy(() => import('../pages/LoginPage').then((module) => ({ default: module.LoginPage })))
const GitHubConnectPage = lazy(() =>
  import('../pages/GitHubConnectPage').then((module) => ({ default: module.GitHubConnectPage }))
)
const RepositorySelectionPage = lazy(() =>
  import('../pages/RepositorySelectionPage').then((module) => ({ default: module.RepositorySelectionPage }))
)
const ChatPage = lazy(() => import('../pages/ChatPage').then((module) => ({ default: module.ChatPage })))
const FileDetailPage = lazy(() => import('../pages/FileDetailPage').then((module) => ({ default: module.FileDetailPage })))
const KnowledgeTimelinePage = lazy(() =>
  import('../pages/KnowledgeTimelinePage').then((module) => ({ default: module.KnowledgeTimelinePage }))
)
const WhyLensPage = lazy(() => import('../pages/WhyLensPage').then((module) => ({ default: module.WhyLensPage })))
const InsightsPage = lazy(() => import('../pages/InsightsPage').then((module) => ({ default: module.InsightsPage })))
const SettingsPage = lazy(() => import('../pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })))

function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.99 }}
      transition={{ type: 'spring', stiffness: 170, damping: 24, mass: 0.6 }}
    >
      {children}
    </motion.div>
  )
}

function LegacyDashboardRedirect() {
  const location = useLocation()
  return <Navigate to={`/chat${location.search}`} replace />
}

function ShellOutlet() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

export default function App() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [location.pathname])

  return (
    <ErrorBoundary resetKey={location.pathname}>
    <Suspense fallback={<div style={{ minHeight: '100vh', background: 'var(--kv-surface)' }} />}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route
            path="/"
            element={
              <PageTransition>
                <LandingPage />
              </PageTransition>
            }
          />

          <Route
            path="/login"
            element={
              <PageTransition>
                <LoginPage />
              </PageTransition>
            }
          />

          <Route element={<RequireAuth />}>
            <Route
              path="/connect-github"
              element={
                <PageTransition>
                  <GitHubConnectPage />
                </PageTransition>
              }
            />

            <Route element={<RequireGitHubConnection />}>
              <Route element={<ShellOutlet />}>
                <Route
                  path="/repositories"
                  element={
                    <PageTransition>
                      <RepositorySelectionPage />
                    </PageTransition>
                  }
                />
                <Route
                  path="/chat"
                  element={
                    <PageTransition>
                      <ChatPage />
                    </PageTransition>
                  }
                />
                <Route path="/dashboard" element={<LegacyDashboardRedirect />} />
                <Route
                  path="/file"
                  element={
                    <PageTransition>
                      <FileDetailPage />
                    </PageTransition>
                  }
                />
                <Route
                  path="/timeline"
                  element={
                    <PageTransition>
                      <KnowledgeTimelinePage />
                    </PageTransition>
                  }
                />
                <Route
                  path="/why"
                  element={
                    <PageTransition>
                      <WhyLensPage />
                    </PageTransition>
                  }
                />
                <Route
                  path="/insights"
                  element={
                    <PageTransition>
                      <InsightsPage />
                    </PageTransition>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <PageTransition>
                      <SettingsPage />
                    </PageTransition>
                  }
                />
              </Route>
            </Route>
          </Route>

          <Route
            path="*"
            element={
              <PageTransition>
                <NotFoundPage />
              </PageTransition>
            }
          />
        </Routes>
      </AnimatePresence>
    </Suspense>
    </ErrorBoundary>
  )
}