import { useEffect, useRef, useState } from 'react'
import { WifiOff } from 'lucide-react'

import { useToast } from '../features/toast/toastContext'
import { API_UNREACHABLE_EVENT } from '../services/networkEvents'

/**
 * A quiet bar while the device is offline, and one toast (not one per request) when the KAVI
 * server cannot be reached. The API client raises the event; this component throttles it.
 */
export function NetworkStatus() {
  const toast = useToast()
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const lastToast = useRef(0)

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => {
      setOffline(false)
      toast.success('Back online')
    }
    const unreachable = () => {
      if (!navigator.onLine || Date.now() - lastToast.current < 30_000) return
      lastToast.current = Date.now()
      toast.error("Can't reach KAVI right now", { description: 'The server may be waking up. Try again in a few seconds.' })
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    window.addEventListener(API_UNREACHABLE_EVENT, unreachable)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      window.removeEventListener(API_UNREACHABLE_EVENT, unreachable)
    }
  }, [toast])

  if (!offline) return null
  return (
    <div className="kv-offline" role="status">
      <WifiOff size={15} aria-hidden />
      You're offline. KAVI will reconnect when your connection is back.
    </div>
  )
}
