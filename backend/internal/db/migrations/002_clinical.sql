-- ============================================================
-- Migration 002 — Pacientes e prescrições
-- ============================================================

CREATE TABLE patients (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id   BIGINT REFERENCES patients(id) ON DELETE SET NULL, -- responsável financeiro
  name        TEXT NOT NULL,
  cpf         TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  birth_date  DATE,
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patients_tenant ON patients(tenant_id);
CREATE INDEX idx_patients_parent ON patients(parent_id);
-- CPF único por ótica quando informado.
CREATE UNIQUE INDEX idx_patients_cpf ON patients(tenant_id, cpf) WHERE cpf <> '';

CREATE TABLE prescriptions (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id  BIGINT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  rx_od       JSONB NOT NULL DEFAULT '{}',
  rx_oe       JSONB NOT NULL DEFAULT '{}',
  exam_date   DATE NOT NULL,
  expires_at  DATE NOT NULL,
  lens_type   TEXT NOT NULL DEFAULT 'Simples',
  prescriber  TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at >= exam_date)
);

CREATE INDEX idx_prescriptions_tenant  ON prescriptions(tenant_id);
CREATE INDEX idx_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX idx_prescriptions_expiry  ON prescriptions(tenant_id, expires_at);
