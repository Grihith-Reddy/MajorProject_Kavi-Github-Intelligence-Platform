/** Raised by the API client when a request gets no response at all (server asleep, offline, DNS). */
export const API_UNREACHABLE_EVENT = 'kavi:api-unreachable'

export function reportApiUnreachable() {
  window.dispatchEvent(new Event(API_UNREACHABLE_EVENT))
}
