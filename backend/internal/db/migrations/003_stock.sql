-- ============================================================
-- Migration 003 — Fornecedores, produtos, lentes e movimentações
-- ============================================================

CREATE TABLE suppliers (
  id           BIGSERIAL PRIMARY KEY,
  tenant_id    BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  cnpj         TEXT NOT NULL DEFAULT '',
  contact      TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  credit_term  INT NOT NULL DEFAULT 30 CHECK (credit_term BETWEEN 0 AND 180), -- prazo em dias
  notes        TEXT NOT NULL DEFAULT '',
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_suppliers_tenant ON suppliers(tenant_id);

CREATE TABLE products (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  sku             TEXT NOT NULL DEFAULT '',
  qty             INT NOT NULL DEFAULT 0 CHECK (qty >= 0),
  min_qty         INT NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  price           NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  cost_price      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  commission_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 100),
  supplier_id     BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name   TEXT NOT NULL DEFAULT '',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_tenant ON products(tenant_id);

-- Catálogo de lentes surfaçadas (vendidas por par, sem controle de estoque).
CREATE TABLE lenses (
  id                BIGSERIAL PRIMARY KEY,
  tenant_id         BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  lens_type         TEXT NOT NULL,
  refractive_index  TEXT NOT NULL DEFAULT '',
  price             NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  cost_price        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lenses_tenant ON lenses(tenant_id);

-- Trilha de auditoria de estoque. order_id recebe FK na migration 004.
CREATE TABLE stock_movements (
  id                 BIGSERIAL PRIMARY KEY,
  tenant_id          BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id         BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty                INT NOT NULL CHECK (qty > 0),
  type               TEXT NOT NULL CHECK (type IN ('in', 'out')),
  reason             TEXT NOT NULL
                       CHECK (reason IN ('service_order','sale','manual_adjustment','purchase','physical_count','sale_cancel')),
  performed_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  performed_by_name  TEXT NOT NULL DEFAULT '',
  notes              TEXT NOT NULL DEFAULT '',
  order_id           BIGINT,
  prescription_id    BIGINT REFERENCES prescriptions(id) ON DELETE SET NULL,
  invoice_number     TEXT NOT NULL DEFAULT '',
  previous_qty       INT,
  new_qty            INT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stock_movements_tenant  ON stock_movements(tenant_id, created_at DESC);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
