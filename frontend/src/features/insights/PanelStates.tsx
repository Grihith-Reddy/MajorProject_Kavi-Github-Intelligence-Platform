import { AlertCircle } from 'lucide-react'

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ins-skeleton-wrap" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="ins-skeleton" style={{ height: index === 0 ? 140 : 88 }} />
      ))}
    </div>
  )
}

export function PanelError({ message }: { message: string }) {
  return (
    <div className="ins-error" role="alert">
      <AlertCircle size={15} /> {message} Please try again.
    </div>
  )
}
