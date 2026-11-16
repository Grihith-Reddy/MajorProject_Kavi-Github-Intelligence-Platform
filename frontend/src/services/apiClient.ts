import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { useEffect, useRef } from 'react'

import { useAuth } from '../features/auth/useAuth'
import { reportApiUnreachable } from './networkEvents'

type RetryableConfig = InternalAxiosRequestConfig & { _authRetries?: number }

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

/**
 * Attaches the Firebase token to every request. When the API answers 401 we try twice more
 * before giving up: once with the same token a moment later (a token issued a second "in the
 * future" by a clock that runs behind becomes valid), then with a freshly refreshed token.
 * Only then is the session treated as expired.
 */
export function createApiClient(
  getToken: (forceRefresh?: boolean) => Promise<string | undefined>,
  onSessionExpired: () => void = () => {}
): AxiosInstance {
  const client = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api'
  })

  client.interceptors.request.use(async (config: RetryableConfig) => {
    const token = await getToken(config._authRetries === 2)
    if (token) {
      config.headers = config.headers ?? {}
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  client.interceptors.response.use(undefined, async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined
    // No response at all: offline, or the free-tier server is still waking up.
    if (!error.response && !axios.isCancel(error)) reportApiUnreachable()
    if (error.response?.status !== 401 || !config) throw error
    const attempt = (config._authRetries ?? 0) + 1
    if (attempt > 2) {
      onSessionExpired()
      throw error
    }
    config._authRetries = attempt
    await wait(1200)
    return client(config)
  })

  return client
}

export function useApiClient() {
  const { getToken, expireSession } = useAuth()
  const getTokenRef = useRef(getToken)
  const expireRef = useRef(expireSession)
  const clientRef = useRef<AxiosInstance | null>(null)

  useEffect(() => {
    getTokenRef.current = getToken
    expireRef.current = expireSession
  }, [getToken, expireSession])

  if (!clientRef.current) {
    clientRef.current = createApiClient(
      (forceRefresh) => getTokenRef.current(forceRefresh),
      () => { void expireRef.current() }
    )
  }

  return clientRef.current
}
