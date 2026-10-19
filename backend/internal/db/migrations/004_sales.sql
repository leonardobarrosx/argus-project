-- ============================================================
-- Migration 004 — Caixa, ordens de serviço e vendas (PDV)
-- ============================================================

-- ─── CAIXA ───────────────────────────────────────────────────────────────────
CREATE TABLE cash_sessions (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opened_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  opened_by_name   TEXT NOT NULL DEFAULT '',
  closed_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  closed_by_name   TEXT NOT NULL DEFAULT '',
  opening_amount   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  closing_amount   NUMERIC(12,2),
  expected_amount  NUMERIC(12,2),
  notes            TEXT NOT NULL DEFAULT '',
  opened_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at        TIMESTAMPTZ
);

CREATE INDEX idx_cash_sessions_tenant ON cash_sessions(tenant_id, opened_at DESC);
-- No máximo um caixa aberto por ótica.
CREATE UNIQUE INDEX idx_cash_sessions_one_open ON cash_sessions(tenant_id) WHERE closed_at IS NULL;

-- Sangrias (withdrawal) e suprimentos (deposit).
CREATE TABLE cash_movements (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id  BIGINT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('withdrawal', 'deposit')),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason      TEXT NOT NULL,
  user_id     BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_name   TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cash_movements_session ON cash_movements(session_id);

-- ─── ORDENS DE SERVIÇO ───────────────────────────────────────────────────────
CREATE TABLE service_orders (
  id                     BIGSERIAL PRIMARY KEY,
  tenant_id              BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number                 INT NOT NULL,
  patient_id             BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  prescription_id        BIGINT REFERENCES prescriptions(id) ON DELETE SET NULL,
  status                 TEXT NOT NULL DEFAULT 'production'
                           CHECK (status IN ('production', 'ready', 'delivered', 'cancelled')),
  frame_product_id       BIGINT REFERENCES products(id) ON DELETE SET NULL,
  lens_product_id        BIGINT REFERENCES products(id) ON DELETE SET NULL,
  lens_id                BIGINT REFERENCES lenses(id) ON DELETE SET NULL,
  lens_description       TEXT NOT NULL DEFAULT '',
  lens_qty_used          INT NOT NULL DEFAULT 0 CHECK (lens_qty_used >= 0),
  total                  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid                   BOOLEAN NOT NULL DEFAULT false,
  sale_id                BIGINT, -- FK abaixo
  due_date               DATE,   -- previsão de entrega
  notes                  TEXT NOT NULL DEFAULT '',
  created_by             BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  production_started_at  TIMESTAMPTZ,
  ready_at               TIMESTAMPTZ,
  delivered_at           TIMESTAMPTZ,
  UNIQUE (tenant_id, number)
);

CREATE INDEX idx_service_orders_tenant ON service_orders(tenant_id, status);
CREATE INDEX idx_service_orders_rx     ON service_orders(prescription_id);

-- ─── VENDAS ──────────────────────────────────────────────────────────────────
CREATE TABLE sales (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id       BIGINT REFERENCES patients(id) ON DELETE SET NULL,
  order_id         BIGINT REFERENCES service_orders(id) ON DELETE SET NULL,
  session_id       BIGINT REFERENCES cash_sessions(id) ON DELETE SET NULL,
  seller_id        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  seller_name      TEXT NOT NULL DEFAULT '',
  subtotal         NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  discount         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total            NUMERIC(12,2) NOT NULL CHECK (total >= 0),
  payment_method   TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  cancel_reason    TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (discount <= subtotal)
);

CREATE INDEX idx_sales_tenant  ON sales(tenant_id, created_at DESC);
CREATE INDEX idx_sales_session ON sales(session_id);
CREATE INDEX idx_sales_order   ON sales(order_id);

CREATE TABLE sale_items (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id          BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('product', 'glasses', 'service_order')),
  product_id       BIGINT REFERENCES products(id) ON DELETE SET NULL,
  lens_id          BIGINT REFERENCES lenses(id) ON DELETE SET NULL,
  beneficiary_id   BIGINT REFERENCES patients(id) ON DELETE SET NULL,
  prescription_id  BIGINT REFERENCES prescriptions(id) ON DELETE SET NULL,
  name             TEXT NOT NULL,
  unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  unit_cost        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  qty              INT NOT NULL CHECK (qty > 0)
);

CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

ALTER TABLE service_orders
  ADD CONSTRAINT service_orders_sale_fk FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_order_fk FOREIGN KEY (order_id) REFERENCES service_orders(id) ON DELETE SET NULL;
