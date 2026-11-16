import { HTMLAttributes } from 'react'
import clsx from 'clsx'

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-white/22 bg-[rgb(var(--kv-veil-rgb) / 0.08)] p-4 shadow-sm',
        className
      )}
      {...props}
    />
  )
}
