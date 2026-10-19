// Package suppliers manages the ótica's suppliers (fornecedores).
package suppliers

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

// Supplier is a vendor.
type Supplier struct {
	ID         int64     `json:"id"`
	Name       string    `json:"name"`
	CNPJ       string    `json:"cnpj"`
	Contact    string    `json:"contact"`
	Phone      string    `json:"phone"`
	Email      string    `json:"email"`
	CreditTerm int       `json:"creditTerm"`
	Notes      string    `json:"notes"`
	Active     bool      `json:"active"`
	CreatedAt  time.Time `json:"createdAt"`
}

const columns = `id, name, cnpj, contact, phone, email, credit_term, notes, active, created_at`

func scan(row db.Row) (Supplier, error) {
	var s Supplier
	err := row.Scan(&s.ID, &s.Name, &s.CNPJ, &s.Contact, &s.Phone, &s.Email, &s.CreditTerm, &s.Notes, &s.Active, &s.CreatedAt)
	return s, err
}

// List returns all suppliers (active first).
func List(ctx context.Context, tx pgx.Tx) ([]Supplier, error) {
	rows, err := tx.Query(ctx, `SELECT `+columns+` FROM suppliers ORDER BY active DESC, name`)
	if err != nil {
		return nil, err
	}
	return db.CollectRows(rows, scan)
}

// Input is the create/update payload.
type Input struct {
	Name       string `json:"name" binding:"required,min=2,max=120"`
	CNPJ       string `json:"cnpj" binding:"max=20"`
	Contact    string `json:"contact" binding:"max=120"`
	Phone      string `json:"phone" binding:"max=30"`
	Email      string `json:"email" binding:"omitempty,email,max=160"`
	CreditTerm int    `json:"creditTerm" binding:"min=0,max=180"`
	Notes      string `json:"notes" binding:"max=1000"`
	Active     *bool  `json:"active"`
}

// Handler exposes the supplier routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a suppliers Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the supplier routes.
func Register(rg *gin.RouterGroup, h *Handler) {
	g := rg.Group("/suppliers")
	g.GET("", h.List)
	g.POST("", middleware.Role(middleware.Managers...), h.Create)
	g.PUT("/:id", middleware.Role(middleware.Managers...), h.Update)
}

// List returns suppliers.
// GET /api/suppliers
func (h *Handler) List(c *gin.Context) {
	a := middleware.GetActor(c)
	var out []Supplier
	err := db.TenantTx(c.Request.Context(), h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		out, err = List(c.Request.Context(), tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"suppliers": out})
}

// Create adds a supplier.
// POST /api/suppliers
func (h *Handler) Create(c *gin.Context) {
	var in Input
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var s Supplier
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		s, err = scan(tx.QueryRow(ctx, `
			INSERT INTO suppliers (tenant_id, name, cnpj, contact, phone, email, credit_term, notes)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+columns,
			a.TenantID, strings.TrimSpace(in.Name), strings.TrimSpace(in.CNPJ), strings.TrimSpace(in.Contact),
			strings.TrimSpace(in.Phone), strings.TrimSpace(in.Email), in.CreditTerm, strings.TrimSpace(in.Notes)))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"supplier": s})
}

// Update edits a supplier (including activation).
// PUT /api/suppliers/:id
func (h *Handler) Update(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in Input
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var s Supplier
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		s, err = scan(tx.QueryRow(ctx, `
			UPDATE suppliers SET name=$2, cnpj=$3, contact=$4, phone=$5, email=$6, credit_term=$7, notes=$8,
			       active=COALESCE($9, active), updated_at=NOW()
			WHERE id=$1 RETURNING `+columns,
			id, strings.TrimSpace(in.Name), strings.TrimSpace(in.CNPJ), strings.TrimSpace(in.Contact),
			strings.TrimSpace(in.Phone), strings.TrimSpace(in.Email), in.CreditTerm, strings.TrimSpace(in.Notes), in.Active))
		if err != nil {
			return err
		}
		// Keep the denormalized supplier name on products in sync.
		_, err = tx.Exec(ctx, `UPDATE products SET supplier_name=$2 WHERE supplier_id=$1`, id, s.Name)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"supplier": s})
}
