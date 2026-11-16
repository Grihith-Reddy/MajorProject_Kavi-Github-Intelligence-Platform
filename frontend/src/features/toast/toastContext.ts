import { createContext, useContext } from 'react'

export type ToastTone = 'neutral' | 'success' | 'error'

export interface ToastOptions {
  tone?: ToastTone
  description?: string
  durationMs?: number
  action?: { label: string; onClick: () => void }
}

export interface ToastApi {
  show: (title: string, options?: ToastOptions) => void
  success: (title: string, options?: Omit<ToastOptions, 'tone'>) => void
  error: (title: string, options?: Omit<ToastOptions, 'tone'>) => void
}

const noop = () => undefined
export const ToastContext = createContext<ToastApi>({ show: noop, success: noop, error: noop })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}
