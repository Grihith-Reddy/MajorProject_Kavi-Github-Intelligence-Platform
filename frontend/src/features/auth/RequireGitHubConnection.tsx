import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { ErrorState } from '../../components/ErrorState'
import { useAsync } from '../../hooks/useAsync'
import { useApiClient } from '../../services/apiClient'
import { getGitHubStatus } from '../../services/githubService'

export function RequireGitHubConnection() {
  const api = useApiClient()
  const location = useLocation()
  const [attempt, setAttempt] = useState(0)
  const { data, error, loading } = useAsync(() => getGitHubStatus(api), [api, attempt])

  if (loading) {
    return <div style={{ minHeight: '100vh', background: 'var(--kv-surface)' }} />
  }

  if (error) {
    return (
      <div className="kv-state-page">
        <ErrorState message="We couldn’t check your GitHub connection." onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    )
  }

  if (!data?.connected) {
    return <Navigate to="/connect-github" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}