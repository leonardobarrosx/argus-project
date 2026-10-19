-- ============================================================
-- Migration 005 — Financeiro: contas a pagar
-- ============================================================

CREATE TABLE payables (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  description     TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'Outros',
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  invoice_number  TEXT NOT NULL DEFAULT '',
  paid_at         DATE,
  paid_amount     NUMERIC(12,2),
  cancel_reason   TEXT NOT NULL DEFAULT '',
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payables_tenant ON payables(tenant_id, status, due_date);
