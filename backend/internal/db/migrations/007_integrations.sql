-- ============================================================
-- Migration 007 — Integrações: chaves de API e webhooks
-- ============================================================

-- ─── CHAVES DE API ───────────────────────────────────────────────────────────
-- A chave em si só é mostrada uma vez, na criação. O banco guarda o hash
-- SHA-256 (a chave tem 160 bits aleatórios, então hash rápido é suficiente) e
-- um prefixo legível para o usuário reconhecer a chave na lista.
CREATE TABLE api_keys (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  prefix           TEXT NOT NULL,
  key_hash         TEXT NOT NULL UNIQUE,
  scopes           TEXT[] NOT NULL DEFAULT '{}',
  created_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_by_name  TEXT NOT NULL DEFAULT '',
  last_used_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id, created_at DESC);

-- ─── WEBHOOKS ────────────────────────────────────────────────────────────────
-- secret_enc: segredo de assinatura HMAC cifrado com AES-GCM pela API
-- (SECRETS_KEY). Precisa ser recuperável para assinar cada entrega.
CREATE TABLE webhooks (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  events            TEXT[] NOT NULL DEFAULT '{}',
  secret_enc        TEXT NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhooks_tenant ON webhooks(tenant_id);

-- Outbox transacional: o evento é gravado na mesma transação da regra de
-- negócio (venda, OS, estoque…). Um dispatcher em segundo plano entrega com
-- retentativas e backoff exponencial.
CREATE TABLE webhook_deliveries (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_id       BIGINT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id         TEXT NOT NULL,
  event            TEXT NOT NULL,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts         INT NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until     TIMESTAMPTZ,
  response_status  INT,
  response_body    TEXT NOT NULL DEFAULT '',
  error            TEXT NOT NULL DEFAULT '',
  duration_ms      INT,
  delivered_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX idx_webhook_deliveries_due ON webhook_deliveries(next_attempt_at) WHERE status = 'pending';

ALTER TABLE api_keys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON api_keys           USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON webhooks           USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON webhook_deliveries USING (tenant_id = current_tenant_id());

-- ─── Funções sem tenant no contexto (SECURITY DEFINER, expõem o mínimo) ─────

-- Autenticação por chave de API: devolve o tenant e os escopos da chave.
CREATE OR REPLACE FUNCTION auth_find_api_key(p_hash TEXT)
RETURNS TABLE (key_id BIGINT, tenant_id BIGINT, name TEXT, scopes TEXT[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.tenant_id, k.name, k.scopes
  FROM api_keys k
  JOIN tenants t ON t.id = k.tenant_id
  WHERE k.key_hash = p_hash
    AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > NOW())
    AND t.active
  LIMIT 1;
$$;

-- O dispatcher reserva entregas vencidas de todas as óticas por um período
-- (lease). Várias instâncias da API podem rodar em paralelo sem entregar o
-- mesmo evento duas vezes ao mesmo tempo (SKIP LOCKED + locked_until).
CREATE OR REPLACE FUNCTION webhook_claim_deliveries(p_limit INT, p_lease_seconds INT)
RETURNS TABLE (delivery_id BIGINT, tenant_id BIGINT)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE webhook_deliveries d
     SET locked_until = NOW() + make_interval(secs => p_lease_seconds)
   WHERE d.id IN (
     SELECT x.id FROM webhook_deliveries x
      WHERE x.status = 'pending'
        AND x.next_attempt_at <= NOW()
        AND (x.locked_until IS NULL OR x.locked_until < NOW())
      ORDER BY x.next_attempt_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED)
  RETURNING d.id, d.tenant_id;
$$;
