import { type ReactNode } from 'react'

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="kv-state">
      <p className="kv-state-title">{title}</p>
      <p className="kv-state-text">{description}</p>
      {action}
    </div>
  )
}
