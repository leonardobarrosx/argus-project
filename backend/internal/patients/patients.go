// Package patients manages patients (clientes/dependentes) and prescriptions.
package patients

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
)

// Patient is a client or dependent.
type Patient struct {
	ID        int64     `json:"id"`
	ParentID  *int64    `json:"parentId"`
	Name      string    `json:"name"`
	CPF       string    `json:"cpf"`
	Phone     string    `json:"phone"`
	Email     string    `json:"email"`
	BirthDate string    `json:"birthDate"` // YYYY-MM-DD or ""
	Notes     string    `json:"notes"`
	CreatedAt time.Time `json:"createdAt"`
}

const patientColumns = `id, parent_id, name, cpf, phone, email, COALESCE(to_char(birth_date, 'YYYY-MM-DD'), ''), notes, created_at`

func scanPatient(row db.Row) (Patient, error) {
	var p Patient
	err := row.Scan(&p.ID, &p.ParentID, &p.Name, &p.CPF, &p.Phone, &p.Email, &p.BirthDate, &p.Notes, &p.CreatedAt)
	return p, err
}

// ListPatients returns all patients of the tenant.
func ListPatients(ctx context.Context, tx pgx.Tx) ([]Patient, error) {
	rows, err := tx.Query(ctx, `SELECT `+patientColumns+` FROM patients ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return db.CollectRows(rows, scanPatient)
}

// RxData is one eye of a prescription.
type RxData struct {
	Sph    string `json:"sph" binding:"max=10"`
	Cyl    string `json:"cyl" binding:"max=10"`
	Axis   string `json:"axis" binding:"max=10"`
	Add    string `json:"add" binding:"max=10"`
	DNP    string `json:"dnp" binding:"max=10"`
	Height string `json:"height" binding:"max=10"`
}

// Prescription is an eye exam result.
type Prescription struct {
	ID         int64     `json:"id"`
	PatientID  int64     `json:"patientId"`
	RxOD       RxData    `json:"rxOD"`
	RxOE       RxData    `json:"rxOE"`
	ExamDate   string    `json:"examDate"`
	ExpiresAt  string    `json:"expiresAt"`
	LensType   string    `json:"lensType"`
	Prescriber string    `json:"prescriber"`
	Notes      string    `json:"notes"`
	CreatedAt  time.Time `json:"createdAt"`
}

const rxColumns = `id, patient_id, rx_od, rx_oe, to_char(exam_date, 'YYYY-MM-DD'), to_char(expires_at, 'YYYY-MM-DD'),
	lens_type, prescriber, notes, created_at`

func scanRx(row db.Row) (Prescription, error) {
	var p Prescription
	var od, oe []byte
	if err := row.Scan(&p.ID, &p.PatientID, &od, &oe, &p.ExamDate, &p.ExpiresAt, &p.LensType, &p.Prescriber, &p.Notes, &p.CreatedAt); err != nil {
		return p, err
	}
	_ = json.Unmarshal(od, &p.RxOD)
	_ = json.Unmarshal(oe, &p.RxOE)
	return p, nil
}

// ListPrescriptions returns all prescriptions of the tenant.
func ListPrescriptions(ctx context.Context, tx pgx.Tx) ([]Prescription, error) {
	rows, err := tx.Query(ctx, `SELECT `+rxColumns+` FROM prescriptions ORDER BY exam_date DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	return db.CollectRows(rows, scanRx)
}

// PatientInput is the create/update payload.
type PatientInput struct {
	ParentID  *int64 `json:"parentId"`
	Name      string `json:"name" binding:"required,min=2,max=120"`
	CPF       string `json:"cpf" binding:"max=20"`
	Phone     string `json:"phone" binding:"max=30"`
	Email     string `json:"email" binding:"omitempty,email,max=160"`
	BirthDate string `json:"birthDate"`
	Notes     string `json:"notes" binding:"max=1000"`
}

// PrescriptionInput is the create payload.
type PrescriptionInput struct {
	PatientID  int64  `json:"patientId" binding:"required,min=1"`
	RxOD       RxData `json:"rxOD"`
	RxOE       RxData `json:"rxOE"`
	ExamDate   string `json:"examDate" binding:"required"`
	ExpiresAt  string `json:"expiresAt"`
	LensType   string `json:"lensType" binding:"max=60"`
	Prescriber string `json:"prescriber" binding:"max=120"`
	Notes      string `json:"notes" binding:"max=1000"`
}

// Handler exposes the patient routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a patients Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the patient routes.
func Register(rg *gin.RouterGroup, h *Handler) {
	rg.GET("/patients", h.List)
	rg.POST("/patients", middleware.Role(middleware.Clinical...), h.Create)
	rg.PUT("/patients/:id", middleware.Role(middleware.Clinical...), h.Update)
	rg.GET("/prescriptions", h.ListRx)
	rg.POST("/prescriptions", middleware.Role(middleware.Clinical...), h.CreateRx)
}

func normalizeCPF(s string) string { return strings.TrimSpace(s) }

func validatePatient(ctx context.Context, tx pgx.Tx, in PatientInput, selfID int64) error {
	if !httpx.ValidDate(in.BirthDate) {
		return httpx.Unprocessable("INVALID_DATE", "data de nascimento inválida")
	}
	if in.BirthDate != "" {
		if d, _ := time.Parse("2006-01-02", in.BirthDate); d.After(time.Now()) {
			return httpx.Unprocessable("INVALID_DATE", "data de nascimento no futuro")
		}
	}
	if cpf := normalizeCPF(in.CPF); cpf != "" {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM patients WHERE cpf=$1 AND id<>$2)`, cpf, selfID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return httpx.Errf(http.StatusConflict, "CPF_TAKEN", "já existe um paciente com este CPF")
		}
	}
	if in.ParentID != nil {
		if *in.ParentID == selfID {
			return httpx.Unprocessable("INVALID_PARENT", "um paciente não pode ser responsável por si mesmo")
		}
		var parentOfParent *int64
		if err := tx.QueryRow(ctx, `SELECT parent_id FROM patients WHERE id=$1`, *in.ParentID).Scan(&parentOfParent); err != nil {
			if err == pgx.ErrNoRows {
				return httpx.Unprocessable("INVALID_PARENT", "responsável não encontrado")
			}
			return err
		}
		if parentOfParent != nil {
			return httpx.Unprocessable("INVALID_PARENT", "o responsável não pode ser um dependente")
		}
		if selfID > 0 {
			var hasDeps bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM patients WHERE parent_id=$1)`, selfID).Scan(&hasDeps); err != nil {
				return err
			}
			if hasDeps {
				return httpx.Unprocessable("INVALID_PARENT", "este paciente possui dependentes e não pode virar dependente")
			}
		}
	}
	return nil
}

// List returns patients.
// GET /api/patients
func (h *Handler) List(c *gin.Context) {
	a := middleware.GetActor(c)
	var out []Patient
	err := db.TenantTx(c.Request.Context(), h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		out, err = ListPatients(c.Request.Context(), tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"patients": out})
}

// Create registers a patient.
// POST /api/patients
func (h *Handler) Create(c *gin.Context) {
	var in PatientInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var p Patient
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		if err := validatePatient(ctx, tx, in, 0); err != nil {
			return err
		}
		var err error
		p, err = scanPatient(tx.QueryRow(ctx, `
			INSERT INTO patients (tenant_id, parent_id, name, cpf, phone, email, birth_date, notes)
			VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8) RETURNING `+patientColumns,
			a.TenantID, in.ParentID, strings.TrimSpace(in.Name), normalizeCPF(in.CPF), strings.TrimSpace(in.Phone),
			strings.TrimSpace(in.Email), httpx.NullIfEmpty(in.BirthDate), strings.TrimSpace(in.Notes)))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"patient": p})
}

// Update edits a patient.
// PUT /api/patients/:id
func (h *Handler) Update(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in PatientInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var p Patient
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		if err := validatePatient(ctx, tx, in, id); err != nil {
			return err
		}
		var err error
		p, err = scanPatient(tx.QueryRow(ctx, `
			UPDATE patients SET parent_id=$2, name=$3, cpf=$4, phone=$5, email=$6, birth_date=$7::date, notes=$8, updated_at=NOW()
			WHERE id=$1 RETURNING `+patientColumns,
			id, in.ParentID, strings.TrimSpace(in.Name), normalizeCPF(in.CPF), strings.TrimSpace(in.Phone),
			strings.TrimSpace(in.Email), httpx.NullIfEmpty(in.BirthDate), strings.TrimSpace(in.Notes)))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"patient": p})
}

// ListRx returns prescriptions.
// GET /api/prescriptions
func (h *Handler) ListRx(c *gin.Context) {
	a := middleware.GetActor(c)
	var out []Prescription
	err := db.TenantTx(c.Request.Context(), h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		out, err = ListPrescriptions(c.Request.Context(), tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"prescriptions": out})
}

// CreateRx registers a prescription. When expiresAt is omitted it defaults to
// examDate + the ótica's rx validity setting.
// POST /api/prescriptions
func (h *Handler) CreateRx(c *gin.Context) {
	var in PrescriptionInput
	if !httpx.Bind(c, &in) {
		return
	}
	if !httpx.ValidDate(in.ExamDate) || !httpx.ValidDate(in.ExpiresAt) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_DATE", "datas da receita inválidas"))
		return
	}
	if exam, _ := time.Parse("2006-01-02", in.ExamDate); exam.After(time.Now().Add(24 * time.Hour)) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_DATE", "data do exame no futuro"))
		return
	}
	if in.ExpiresAt != "" && in.ExpiresAt < in.ExamDate {
		httpx.Fail(c, httpx.Unprocessable("INVALID_DATE", "a validade não pode ser anterior ao exame"))
		return
	}
	lensType := strings.TrimSpace(in.LensType)
	if lensType == "" {
		lensType = "Simples"
	}
	od, _ := json.Marshal(in.RxOD)
	oe, _ := json.Marshal(in.RxOE)

	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var rx Prescription
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM patients WHERE id=$1)`, in.PatientID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return httpx.Unprocessable("INVALID_PATIENT", "paciente não encontrado")
		}
		var err error
		rx, err = scanRx(tx.QueryRow(ctx, `
			INSERT INTO prescriptions (tenant_id, patient_id, rx_od, rx_oe, exam_date, expires_at, lens_type, prescriber, notes, created_by)
			VALUES ($1, $2, $3, $4, $5::date,
			        COALESCE($6::date, ($5::date + make_interval(months => (SELECT rx_validity_months FROM tenants WHERE id=$1)))::date),
			        $7, $8, $9, $10)
			RETURNING `+rxColumns,
			a.TenantID, in.PatientID, od, oe, in.ExamDate, httpx.NullIfEmpty(in.ExpiresAt), lensType,
			strings.TrimSpace(in.Prescriber), strings.TrimSpace(in.Notes), a.UserID))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"prescription": rx})
}
