import axios from 'axios'

interface ApiErrorData {
  detail?: unknown
  message?: unknown
  request_id?: unknown
}

const BY_STATUS: Record<number, string> = {
  400: "That request didn't look right. Check what you entered and try again.",
  401: 'Your session expired. Sign in again to continue.',
  403: "You don't have access to that.",
  404: "We couldn't find that. It may have been removed or renamed.",
  409: 'That changed in the meantime. Refresh and try again.',
  413: 'That is too large to send.',
  422: "Some of the details weren't valid. Check them and try again.",
  429: 'Too many requests at once. Wait a minute and try again.',
  503: 'KAVI is busy or waking up. Try again in a few seconds.',
}

/**
 * A message a person can act on. Prefers the API's own explanation; otherwise maps the status to
 * plain language. Never surfaces raw exception text or bare status codes.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) return "Can't reach KAVI right now. Check your connection and try again."
    const status = error.response.status
    const data = error.response.data as ApiErrorData | undefined
    const detail = typeof data?.detail === 'string' ? data.detail.trim() : ''
    // Server errors carry a reference id so a bug report can be traced in the logs.
    if (status >= 500) {
      const ref = typeof data?.request_id === 'string' ? ` (reference ${data.request_id.slice(0, 8)})` : ''
      return (BY_STATUS[status] ?? `${fallback}. Something went wrong on our side.`) + ref
    }
    if (detail) return detail
    if (typeof data?.message === 'string' && data.message.trim()) return data.message
    return BY_STATUS[status] ?? fallback
  }
  return fallback
}
