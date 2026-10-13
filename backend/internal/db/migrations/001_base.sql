-- ============================================================
-- Migration 001 — Base: óticas (tenants), usuários, sessões
-- ============================================================

-- current_tenant_id() lê o tenant injetado pelo backend via
-- set_config('app.tenant_id', ..., true) em toda transação (db.TenantTx).
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS BIGINT AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::BIGINT;
$$ LANGUAGE sql STABLE;

-- ─── TENANTS (óticas) ────────────────────────────────────────────────────────
CREATE TABLE tenants (
  id                    BIGSERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  slug                  TEXT NOT NULL UNIQUE,
  cnpj                  TEXT NOT NULL DEFAULT '',
  phone                 TEXT NOT NULL DEFAULT '',
  email                 TEXT NOT NULL DEFAULT '',
  address               TEXT NOT NULL DEFAULT '',
  city                  TEXT NOT NULL DEFAULT '',
  state                 TEXT NOT NULL DEFAULT '',
  plan                  TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'basic', 'pro')),
  trial_ends_at         TIMESTAMPTZ,
  os_seq                INT NOT NULL DEFAULT 1000,
  require_cash_session  BOOLEAN NOT NULL DEFAULT true,
  rx_validity_months    INT NOT NULL DEFAULT 12 CHECK (rx_validity_months BETWEEN 1 AND 60),
  receipt_footer        TEXT NOT NULL DEFAULT '',
  active                BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── USERS (equipe) ──────────────────────────────────────────────────────────
-- password_hash NULL = colaborador sem acesso ao sistema (ex.: montador
-- terceirizado que só aparece em comissões/relatórios).
CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  password_hash   TEXT,
  role            TEXT NOT NULL
                    CHECK (role IN ('proprietario','gerente','optometrista','vendedor','montador','atendente')),
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 100),
  active          BOOLEAN NOT NULL DEFAULT true,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
-- Login é por e-mail, global entre óticas: só um usuário com acesso por e-mail.
CREATE UNIQUE INDEX idx_users_login_email ON users (lower(email))
  WHERE password_hash IS NOT NULL;

-- ─── REFRESH TOKENS ──────────────────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
