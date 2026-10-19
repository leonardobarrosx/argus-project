// Package tenant handles the ótica (tenant) profile and settings.
package tenant

import (
	"context"
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

// Tenant is the ótica profile plus operational settings.
type Tenant struct {
	ID                 int64      `json:"id"`
	Name               string     `json:"name"`
	Slug               string     `json:"slug"`
	CNPJ               string     `json:"cnpj"`
	Phone              string     `json:"phone"`
	Email              string     `json:"email"`
	Address            string     `json:"address"`
	City               string     `json:"city"`
	State              string     `json:"state"`
	Plan               string     `json:"plan"`
	TrialEndsAt        *time.Time `json:"trialEndsAt"`
	RequireCashSession bool       `json:"requireCashSession"`
	RxValidityMonths   int        `json:"rxValidityMonths"`
	ReceiptFooter      string     `json:"receiptFooter"`
	CreatedAt          time.Time  `json:"createdAt"`
}

const columns = `id, name, slug, cnpj, phone, email, address, city, state, plan, trial_ends_at,
	require_cash_session, rx_validity_months, receipt_footer, created_at`

func scan(row db.Row) (Tenant, error) {
	var t Tenant
	err := row.Scan(&t.ID, &t.Name, &t.Slug, &t.CNPJ, &t.Phone, &t.Email, &t.Address, &t.City, &t.State,
		&t.Plan, &t.TrialEndsAt, &t.RequireCashSession, &t.RxValidityMonths, &t.ReceiptFooter, &t.CreatedAt)
	return t, err
}

// Get loads the current tenant inside an RLS-scoped transaction.
func Get(ctx context.Context, tx pgx.Tx, tenantID int64) (Tenant, error) {
	return scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM tenants WHERE id = $1`, tenantID))
}

// UpdateInput is the settings payload.
type UpdateInput struct {
	Name               string `json:"name" binding:"required,min=2,max=120"`
	CNPJ               string `json:"cnpj" binding:"max=20"`
	Phone              string `json:"phone" binding:"max=30"`
	Email              string `json:"email" binding:"omitempty,email,max=160"`
	Address            string `json:"address" binding:"max=200"`
	City               string `json:"city" binding:"max=80"`
	State              string `json:"state" binding:"max=2"`
	RequireCashSession bool   `json:"requireCashSession"`
	RxValidityMonths   int    `json:"rxValidityMonths" binding:"min=1,max=60"`
	ReceiptFooter      string `json:"receiptFooter" binding:"max=300"`
}

// Handler exposes the tenant routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a tenant Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the tenant routes.
func Register(rg *gin.RouterGroup, h *Handler) {
	rg.GET("/tenant", h.Get)
	rg.PUT("/tenant", middleware.Role(middleware.Managers...), h.Update)
}

// Get returns the current tenant.
// GET /api/tenant
func (h *Handler) Get(c *gin.Context) {
	a := middleware.GetActor(c)
	var t Tenant
	err := db.TenantTx(c.Request.Context(), h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		t, err = Get(c.Request.Context(), tx, a.TenantID)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tenant": t})
}

// Update saves the ótica profile and settings.
// PUT /api/tenant
func (h *Handler) Update(c *gin.Context) {
	var in UpdateInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var t Tenant
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		t, err = scan(tx.QueryRow(ctx, `
			UPDATE tenants SET name=$2, cnpj=$3, phone=$4, email=$5, address=$6, city=$7, state=$8,
			       require_cash_session=$9, rx_validity_months=$10, receipt_footer=$11, updated_at=NOW()
			WHERE id=$1 RETURNING `+columns,
			a.TenantID, strings.TrimSpace(in.Name), strings.TrimSpace(in.CNPJ), strings.TrimSpace(in.Phone),
			strings.TrimSpace(in.Email), strings.TrimSpace(in.Address), strings.TrimSpace(in.City),
			strings.ToUpper(strings.TrimSpace(in.State)), in.RequireCashSession, in.RxValidityMonths,
			strings.TrimSpace(in.ReceiptFooter)))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"tenant": t})
}
