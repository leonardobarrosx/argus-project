// Integrações (chaves de API e webhooks) e o assistente de IA.
import { http, streamEvents } from './client'

export interface ScopeInfo { scope: string; label: string; description: string }
export interface ApiKeyDTO {
  id: number; name: string; prefix: string; scopes: string[]; createdByName: string
  lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string
}
export interface EventInfo { type: string; label: string; description: string }
export interface WebhookDTO {
  id: number; url: string; description: string; events: string[]; active: boolean; createdAt: string
  lastStatus: '' | 'pending' | 'delivered' | 'failed'; lastAt: string | null; failed24h: number; pending: number
}
export interface WebhookInput { url: string; description: string; events: string[]; active: boolean }
export interface DeliveryDTO {
  id: number; webhookId: number; eventId: string; event: string; payload: unknown
  status: 'pending' | 'delivered' | 'failed'; attempts: number; nextAttemptAt: string
  responseStatus: number | null; responseBody: string; error: string; durationMs: number | null
  deliveredAt: string | null; createdAt: string
}

export interface AIModel { id: string; label: string; hint: string }
export type AIEffort = 'low' | 'medium' | 'high'
export interface AISettings {
  enabled: boolean; model: string; effort: AIEffort; instructions: string; hasOwnKey: boolean; keyHint: string
  serverKeyAvailable: boolean; ready: boolean; models: AIModel[]; updatedAt: string | null
}
export interface AISettingsInput {
  enabled: boolean; model: string; effort: AIEffort; instructions: string; apiKey?: string; clearApiKey?: boolean
}
export interface AIUsage { answers: number; inputTokens: number; outputTokens: number }
export interface AIConversation { id: number; title: string; createdAt: string; updatedAt: string }
export interface AIToolCall { name: string; label: string; input: Record<string, unknown>; error?: string }
export interface AIMessage {
  id: number; role: 'user' | 'assistant'; content: string; tools: AIToolCall[] | null; model: string
  inputTokens: number; outputTokens: number; createdAt: string
}

export type ChatEvent =
  | { type: 'conversation'; conversation: AIConversation }
  | { type: 'status'; tool: string; label: string }
  | { type: 'message'; message: AIMessage }
  | { type: 'error'; error: string; code: string }

export const integrationsApi = {
  scopes: () => http.get<{ scopes: ScopeInfo[] }>('/api/integrations/scopes'),
  apiKeys: () => http.get<{ apiKeys: ApiKeyDTO[] }>('/api/integrations/api-keys'),
  createApiKey: (name: string, scopes: string[], expiresInDays: number) =>
    http.post<{ apiKey: ApiKeyDTO; key: string }>('/api/integrations/api-keys', { name, scopes, expiresInDays }),
  revokeApiKey: (id: number) => http.post<{ apiKey: ApiKeyDTO }>(`/api/integrations/api-keys/${id}/revoke`),

  events: () => http.get<{ events: EventInfo[] }>('/api/integrations/events'),
  webhooks: () => http.get<{ webhooks: WebhookDTO[] }>('/api/integrations/webhooks'),
  createWebhook: (input: WebhookInput) => http.post<{ webhook: WebhookDTO; secret: string }>('/api/integrations/webhooks', input),
  updateWebhook: (id: number, input: WebhookInput) => http.put<{ webhook: WebhookDTO }>(`/api/integrations/webhooks/${id}`, input),
  deleteWebhook: (id: number) => http.del<void>(`/api/integrations/webhooks/${id}`),
  webhookSecret: (id: number) => http.get<{ secret: string }>(`/api/integrations/webhooks/${id}/secret`),
  rotateWebhookSecret: (id: number) => http.post<{ secret: string }>(`/api/integrations/webhooks/${id}/rotate-secret`),
  testWebhook: (id: number) => http.post<{ delivery: DeliveryDTO }>(`/api/integrations/webhooks/${id}/test`),
  deliveries: (id: number) => http.get<{ deliveries: DeliveryDTO[] }>(`/api/integrations/webhooks/${id}/deliveries`),
  retryDelivery: (id: number) => http.post<{ delivery: DeliveryDTO }>(`/api/integrations/deliveries/${id}/retry`),
}

export const aiApi = {
  settings: () => http.get<{ settings: AISettings }>('/api/ai/settings'),
  updateSettings: (input: AISettingsInput) => http.put<{ settings: AISettings }>('/api/ai/settings', input),
  usage: () => http.get<{ usage: AIUsage }>('/api/ai/usage'),
  conversations: () => http.get<{ conversations: AIConversation[] }>('/api/ai/conversations'),
  conversation: (id: number) => http.get<{ conversation: AIConversation; messages: AIMessage[] }>(`/api/ai/conversations/${id}`),
  deleteConversation: (id: number) => http.del<void>(`/api/ai/conversations/${id}`),
  /** Sends a question and streams the answer's progress. */
  chat: (message: string, conversationId: number | null, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) =>
    streamEvents('/api/ai/chat', { message, ...(conversationId ? { conversationId } : {}) },
      (event, data) => onEvent({ type: event, ...(data as object) } as ChatEvent), signal),
}
