-- ============================================================
-- Migration 008 — Assistente de IA
-- ============================================================

-- Configuração da IA por ótica. A chave própria (opcional) fica cifrada com
-- AES-GCM (SECRETS_KEY); sem ela a API usa ANTHROPIC_API_KEY do servidor.
CREATE TABLE ai_settings (
  tenant_id     BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  model         TEXT NOT NULL DEFAULT 'claude-opus-5-5',
  effort        TEXT NOT NULL DEFAULT 'medium' CHECK (effort IN ('low', 'medium', 'high')),
  api_key_enc   TEXT,
  api_key_hint  TEXT NOT NULL DEFAULT '',
  instructions  TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai_conversations (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT 'Nova conversa',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_conversations_user ON ai_conversations(tenant_id, user_id, updated_at DESC);

-- tools: consultas que o assistente fez para responder (mostradas na UI).
CREATE TABLE ai_messages (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  BIGINT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  tools            JSONB NOT NULL DEFAULT '[]',
  model            TEXT NOT NULL DEFAULT '',
  input_tokens     INT NOT NULL DEFAULT 0,
  output_tokens    INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id, id);
CREATE INDEX idx_ai_messages_usage ON ai_messages(tenant_id, created_at);

ALTER TABLE ai_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages      ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ai_settings      USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON ai_conversations USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON ai_messages      USING (tenant_id = current_tenant_id());
