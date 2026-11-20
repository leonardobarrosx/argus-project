// HTTP client for the Argus API. The access token lives only in memory; the
// refresh token is an httpOnly cookie rotated by POST /api/auth/refresh.
import type { ApiErrorBody, SessionDTO } from './types'

const BASE_URL: string = import.meta.env.VITE_API_URL ?? ''

let accessToken: string | null = null
let onSessionExpired: (() => void) | null = null

export function setAccessToken(token: string | null) { accessToken = token }
export function setSessionExpiredHandler(fn: (() => void) | null) { onSessionExpired = fn }

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

let refreshing: Promise<SessionDTO | null> | null = null

/** Rotates the refresh cookie. Concurrent callers share one request. */
export function refreshSession(): Promise<SessionDTO | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
        if (!res.ok) return null
        const session = (await res.json()) as SessionDTO
        setAccessToken(session.token.accessToken)
        return session
      } catch {
        return null
      } finally {
        setTimeout(() => { refreshing = null }, 0)
      }
    })()
  }
  return refreshing
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody = { error: 'Erro inesperado', code: 'UNKNOWN' }
  try { body = (await res.json()) as ApiErrorBody } catch { /* not JSON */ }
  return new ApiError(res.status, body.code, body.error)
}

export async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor. Verifique sua internet.')
  }

  if (res.status === 401 && retry && accessToken) {
    const session = await refreshSession()
    if (session) return request<T>(method, path, body, false)
    setAccessToken(null)
    onSessionExpired?.()
    throw new ApiError(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.')
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

/**
 * POSTs a JSON body and reads a Server-Sent Events response, calling onEvent
 * for each event as it arrives. Errors before the stream starts are thrown as
 * ApiError (with the same session refresh as request()).
 */
export async function streamEvents(path: string, body: unknown, onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal, retry = true): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body), signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor. Verifique sua internet.')
  }
  if (res.status === 401 && retry && accessToken) {
    const session = await refreshSession()
    if (session) return streamEvents(path, body, onEvent, signal, false)
    setAccessToken(null)
    onSessionExpired?.()
    throw new ApiError(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.')
  }
  if (!res.ok) throw await parseError(res)
  if (!res.body) throw new ApiError(0, 'NO_STREAM', 'O navegador não suporta respostas em tempo real.')

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  const flush = (chunk: string) => {
    let event = 'message'
    const data: string[] = []
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length === 0) return
    try { onEvent(event, JSON.parse(data.join('\n'))) } catch { onEvent(event, data.join('\n')) }
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value.replace(/\r\n/g, '\n')
    let idx: number
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      flush(buffer.slice(0, idx))
      buffer = buffer.slice(idx + 2)
    }
  }
  if (buffer.trim()) flush(buffer)
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message.charAt(0).toUpperCase() + err.message.slice(1)
  if (err instanceof Error) return err.message
  return 'Erro inesperado'
}
