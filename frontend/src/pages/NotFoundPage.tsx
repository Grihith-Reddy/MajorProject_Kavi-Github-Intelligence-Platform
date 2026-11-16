import { Link } from 'react-router-dom'

import { EmptyState } from '../components/EmptyState'

export function NotFoundPage() {
  return (
    <div className="kv-state-page">
    <EmptyState
      title="Page not found"
      description="The page you're looking for doesn't exist yet."
      action={
        <Link to="/" className="kv-btn kv-btn-dark kv-btn-sm">
          Back to home
        </Link>
      }
    />
    </div>
  )
}

