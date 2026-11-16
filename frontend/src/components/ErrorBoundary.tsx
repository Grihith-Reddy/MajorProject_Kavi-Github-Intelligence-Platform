import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Home, RefreshCw, RotateCcw } from 'lucide-react'

import { StatusPage } from './StatusPage'

const RELOAD_FLAG = 'kavi.chunk-reload'

/** A deploy replaced the code files the open page still points at. */
function isStaleChunk(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(text)
}

type Props = { children: ReactNode; resetKey?: string }
type State = { error: Error | null }

/**
 * Catches render crashes anywhere below it and shows a friendly page instead of a blank screen.
 * After a new deploy, an open tab can fail to load a page's code: it reloads once to pick up the
 * new version. The boundary resets itself when the route changes.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isStaleChunk(error)) {
      try {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1')
          window.location.reload()
          return
        }
      } catch {
        // storage unavailable: fall through to the error page
      }
    }
    console.error('KAVI crashed while rendering', error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  private retry = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) {
      try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* ignore */ }
      return this.props.children
    }

    const stale = isStaleChunk(error)
    return (
      <StatusPage
        code={stale ? 'New version available' : 'Something broke'}
        title={stale ? 'KAVI was just updated' : 'Something went wrong'}
        message={
          stale
            ? 'This tab is running an older version. Reload to get the latest one; nothing you saved is lost.'
            : 'This page hit an unexpected problem. Try again, and if it keeps happening, reload or head back home.'
        }
        details={import.meta.env.DEV ? `${error.name}: ${error.message}` : undefined}
        actions={
          <>
            {!stale && (
              <button type="button" className="kv-btn kv-btn-dark" onClick={this.retry}>
                <RotateCcw size={15} /> Try again
              </button>
            )}
            <button type="button" className={`kv-btn ${stale ? 'kv-btn-dark' : 'kv-btn-soft'}`} onClick={() => window.location.reload()}>
              <RefreshCw size={15} /> Reload
            </button>
            <a href="/" className="kv-btn kv-btn-soft">
              <Home size={15} /> Home
            </a>
          </>
        }
      />
    )
  }
}
