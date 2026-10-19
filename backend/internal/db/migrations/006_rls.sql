-- ============================================================
-- Migration 006 — Row Level Security
-- ============================================================
-- Toda query de negócio roda dentro de db.TenantTx, que faz
-- set_config('app.tenant_id', <id>, true). Rodando o backend com um role
-- que NÃO é dono das tabelas nem superuser (ex.: argus_app), o Postgres
-- garante o isolamento entre óticas mesmo se uma query esquecer o filtro.
-- Superusers e o dono das tabelas ignoram RLS (útil para migrations/seed).

ALTER TABLE tenants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients        ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_orders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payables        ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tenants         USING (id = current_tenant_id());
CREATE POLICY tenant_isolation ON users           USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON refresh_tokens  USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON patients        USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON prescriptions   USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON suppliers       USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON products        USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON lenses          USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON stock_movements USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON cash_sessions   USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON cash_movements  USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON service_orders  USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON sales           USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON sale_items      USING (tenant_id = current_tenant_id());
CREATE POLICY tenant_isolation ON payables        USING (tenant_id = current_tenant_id());

-- ─── Funções de autenticação (antes de existir tenant no contexto) ───────────
-- SECURITY DEFINER: executam como o dono (ignoram RLS) e expõem só o mínimo
-- necessário para login e rotação de refresh token.

CREATE OR REPLACE FUNCTION auth_find_login(p_email TEXT)
RETURNS TABLE (user_id BIGINT, tenant_id BIGINT, password_hash TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.password_hash
  FROM users u
  JOIN tenants t ON t.id = u.tenant_id
  WHERE lower(u.email) = lower(p_email)
    AND u.password_hash IS NOT NULL
    AND u.active AND t.active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_find_refresh(p_hash TEXT)
RETURNS TABLE (user_id BIGINT, tenant_id BIGINT, expires_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.user_id, r.tenant_id, r.expires_at FROM refresh_tokens r WHERE r.token_hash = p_hash;
$$;

CREATE OR REPLACE FUNCTION auth_email_taken(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(p_email) AND password_hash IS NOT NULL);
$$;
