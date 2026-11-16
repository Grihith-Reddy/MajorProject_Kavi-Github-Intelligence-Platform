import { type ReactNode } from 'react'

import { SkyCanvas } from '../features/landing/SkyCanvas'
import { KaviMark } from './KaviMark'

/**
 * Full-page status screen (crash, not found, offline): the animated sky from the hero and
 * login, with one calm card in front. Used by the error boundary and the 404 route.
 */
export function StatusPage({
  code,
  title,
  message,
  actions,
  details,
}: {
  code?: string
  title: string
  message: string
  actions: ReactNode
  details?: string
}) {
  return (
    <main className="kv-status-page">
      <div className="kv-status-frame">
        <SkyCanvas className="kv-status-sky" />
        <section className="kv-status-card" role="alert" aria-live="assertive">
          <a href="/" className="kv-status-mark" aria-label="KAVI home"><KaviMark size={30} /></a>
          {code && <p className="kv-status-code">{code}</p>}
          <h1 className="kv-status-title">{title}</h1>
          <p className="kv-status-text">{message}</p>
          <div className="kv-status-actions">{actions}</div>
          {details && (
            <details className="kv-status-details">
              <summary>Technical details</summary>
              <pre>{details}</pre>
            </details>
          )}
        </section>
      </div>
    </main>
  )
}
