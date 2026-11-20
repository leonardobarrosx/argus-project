// Package publicapi is the versioned REST API (/api/v1) used by integrations
// (sites, BI tools, ERPs, automation). Requests authenticate with an API key
// and every route requires a scope; data stays isolated per ótica by RLS.
package publicapi

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/apikeys"
	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/finance"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
	"github.com/leonardobarrosx/argus/backend/internal/orders"
	"github.com/leonardobarrosx/argus/backend/internal/patients"
	"github.com/leonardobarrosx/argus/backend/internal/sales"
	"github.com/leonardobarrosx/argus/backend/internal/stock"
)

// Handler serves /api/v1.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a public API Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the routes on a group already authenticated by API key.
func Register(rg *gin.RouterGroup, h *Handler) {
	scope := apikeys.RequireScope
	rg.GET("/me", h.Me)
	rg.GET("/patients", scope("patients:read"), h.ListPatients)
	rg.GET("/patients/:id", scope("patients:read"), h.GetPatient)
	rg.POST("/patients", scope("patients:write"), h.CreatePatient)
	rg.GET("/products", scope("catalog:read"), h.ListProducts)
	rg.GET("/lenses", scope("catalog:read"), h.ListLenses)
	rg.GET("/stock/movements", scope("stock:read"), h.ListMovements)
	rg.GET("/orders", scope("orders:read"), h.ListOrders)
	rg.GET("/orders/:number", scope("orders:read"), h.GetOrder)
	rg.GET("/sales", scope("sales:read"), h.ListSales)
	rg.GET("/payables", scope("finance:read"), h.ListPayables)
	rg.GET("/finance/summary", scope("finance:read"), h.FinanceSummary)
}

// page reads ?limit (1–200, default 50) and ?offset.
func page(c *gin.Context) (limit, offset int) {
	limit, offset = 50, 0
	if v, err := strconv.Atoi(c.Query("limit")); err == nil && v > 0 {
		limit = min(v, 200)
	}
	if v, err := strconv.Atoi(c.Query("offset")); err == nil && v > 0 {
		offset = v
	}
	return
}

// list writes a paginated response. Queries fetch limit+1 rows to know if
// there is a next page.
func list[T any](c *gin.Context, items []T, limit, offset int) {
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	c.JSON(http.StatusOK, gin.H{"data": items, "limit": limit, "offset": offset, "hasMore": hasMore})
}

func (h *Handler) run(c *gin.Context, fn func(ctx context.Context, tx pgx.Tx) error) bool {
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	if err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error { return fn(ctx, tx) }); err != nil {
		httpx.Fail(c, err)
		return false
	}
	return true
}

func dateParam(c *gin.Context, name string) (any, bool) {
	v := c.Query(name)
	if v == "" {
		return nil, true
	}
	if !httpx.ValidDate(v) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_DATE", "parâmetro "+name+" deve ser YYYY-MM-DD"))
		return nil, false
	}
	return v, true
}

// Me — GET /api/v1/me: which ótica and permissions this key has.
func (h *Handler) Me(c *gin.Context) {
	a := middleware.GetActor(c)
	var name string
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT name FROM tenants WHERE id=$1`, a.TenantID).Scan(&name)
	}) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"tenant": gin.H{"id": a.TenantID, "name": name},
		"key": gin.H{"id": a.KeyID, "name": strings.TrimPrefix(a.Name, "API · "), "scopes": a.Scopes}})
}

// ListPatients — GET /api/v1/patients?q=&createdSince=YYYY-MM-DD
func (h *Handler) ListPatients(c *gin.Context) {
	limit, offset := page(c)
	since, ok := dateParam(c, "createdSince")
	if !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	var out []patients.Patient
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+patients.Columns+` FROM patients
			WHERE ($1 = '' OR name ILIKE '%' || $1 || '%' OR cpf = $1 OR phone ILIKE '%' || $1 || '%' OR email ILIKE $1)
			  AND ($2::date IS NULL OR created_at::date >= $2::date)
			ORDER BY id LIMIT $3 OFFSET $4`, q, since, limit+1, offset)
		if err != nil {
			return err
		}
		out, err = db.CollectRows(rows, patients.Scan)
		return err
	}) {
		return
	}
	list(c, out, limit, offset)
}

// GetPatient — GET /api/v1/patients/:id (with prescriptions)
func (h *Handler) GetPatient(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var p patients.Patient
	var rx []patients.Prescription
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		if p, err = patients.Scan(tx.QueryRow(ctx, `SELECT `+patients.Columns+` FROM patients WHERE id=$1`, id)); err != nil {
			return err
		}
		rx, err = patients.PrescriptionsOf(ctx, tx, id)
		return err
	}) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"patient": p, "prescriptions": rx}})
}

// CreatePatient — POST /api/v1/patients
func (h *Handler) CreatePatient(c *gin.Context) {
	var in patients.PatientInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	var p patients.Patient
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		p, err = patients.Insert(ctx, tx, a.TenantID, in)
		return err
	}) {
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// ListProducts — GET /api/v1/products?category=&lowStock=true&active=true
func (h *Handler) ListProducts(c *gin.Context) {
	limit, offset := page(c)
	category := strings.TrimSpace(c.Query("category"))
	low := c.Query("lowStock") == "true"
	activeOnly := c.Query("active") == "true"
	var out []stock.Product
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+stock.ProductColumns+` FROM products
			WHERE ($1 = '' OR category = $1) AND (NOT $2 OR qty <= min_qty) AND (NOT $3 OR active)
			ORDER BY id LIMIT $4 OFFSET $5`, category, low, activeOnly, limit+1, offset)
		if err != nil {
			return err
		}
		out, err = db.CollectRows(rows, stock.ScanProduct)
		return err
	}) {
		return
	}
	list(c, out, limit, offset)
}

// ListLenses — GET /api/v1/lenses
func (h *Handler) ListLenses(c *gin.Context) {
	var out []stock.Lens
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = stock.ListLenses(ctx, tx)
		return err
	}) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ListMovements — GET /api/v1/stock/movements?from=&to=&productId=
func (h *Handler) ListMovements(c *gin.Context) {
	limit, offset := page(c)
	from, ok1 := dateParam(c, "from")
	to, ok2 := dateParam(c, "to")
	if !ok1 || !ok2 {
		return
	}
	productID, _ := strconv.ParseInt(c.Query("productId"), 10, 64)
	var out []stock.Movement
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+stock.MovementColumns+` FROM stock_movements
			WHERE ($1::date IS NULL OR created_at::date >= $1::date) AND ($2::date IS NULL OR created_at::date <= $2::date)
			  AND ($3 = 0 OR product_id = $3)
			ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5`, from, to, productID, limit+1, offset)
		if err != nil {
			return err
		}
		out, err = db.CollectRows(rows, stock.ScanMovement)
		return err
	}) {
		return
	}
	list(c, out, limit, offset)
}

// ListOrders — GET /api/v1/orders?status=production|ready|delivered|cancelled
func (h *Handler) ListOrders(c *gin.Context) {
	limit, offset := page(c)
	status := c.Query("status")
	switch status {
	case "", "production", "ready", "delivered", "cancelled":
	default:
		httpx.Fail(c, httpx.Unprocessable("INVALID_STATUS", "status inválido"))
		return
	}
	var out []orders.Order
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+orders.Columns+` FROM service_orders
			WHERE ($1 = '' OR status = $1) ORDER BY number DESC LIMIT $2 OFFSET $3`, status, limit+1, offset)
		if err != nil {
			return err
		}
		out, err = db.CollectRows(rows, orders.Scan)
		return err
	}) {
		return
	}
	list(c, out, limit, offset)
}

// GetOrder — GET /api/v1/orders/:number
func (h *Handler) GetOrder(c *gin.Context) {
	number, err := strconv.Atoi(c.Param("number"))
	if err != nil || number <= 0 {
		httpx.Fail(c, httpx.Errf(http.StatusBadRequest, "INVALID_ID", "número de OS inválido"))
		return
	}
	var o orders.Order
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		o, err = orders.GetByNumber(ctx, tx, number, false)
		return err
	}) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": o})
}

// ListSales — GET /api/v1/sales?from=&to=&status=completed|cancelled
func (h *Handler) ListSales(c *gin.Context) {
	limit, offset := page(c)
	from, ok1 := dateParam(c, "from")
	to, ok2 := dateParam(c, "to")
	if !ok1 || !ok2 {
		return
	}
	status := c.Query("status")
	if status != "" && status != "completed" && status != "cancelled" {
		httpx.Fail(c, httpx.Unprocessable("INVALID_STATUS", "status inválido"))
		return
	}
	var out []sales.Sale
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = sales.Query(ctx, tx, `($1::date IS NULL OR created_at::date >= $1::date)
			AND ($2::date IS NULL OR created_at::date <= $2::date) AND ($3 = '' OR status = $3)
			AND id IN (SELECT id FROM sales ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5)`,
			from, to, status, limit+1+offset, 0)
		if err != nil {
			return err
		}
		// Offset applied after filtering keeps the subquery simple and stable.
		if offset >= len(out) {
			out = out[:0]
		} else {
			out = out[offset:]
		}
		return nil
	}) {
		return
	}
	list(c, out, limit, offset)
}

// ListPayables — GET /api/v1/payables?status=pending|paid|cancelled
func (h *Handler) ListPayables(c *gin.Context) {
	limit, offset := page(c)
	status := c.Query("status")
	if status != "" && status != "pending" && status != "paid" && status != "cancelled" {
		httpx.Fail(c, httpx.Unprocessable("INVALID_STATUS", "status inválido"))
		return
	}
	var out []finance.Payable
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, finance.PayableSelect+`
			WHERE ($1 = '' OR p.status = $1) ORDER BY p.due_date, p.id LIMIT $2 OFFSET $3`, status, limit+1, offset)
		if err != nil {
			return err
		}
		out, err = db.CollectRows(rows, finance.ScanPayable)
		return err
	}) {
		return
	}
	list(c, out, limit, offset)
}

// FinanceSummary — GET /api/v1/finance/summary?from=&to=
func (h *Handler) FinanceSummary(c *gin.Context) {
	from, to, err := finance.Period(c.Query("from"), c.Query("to"))
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var s finance.Summary
	if !h.run(c, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		s, err = finance.ComputeSummary(ctx, tx, from, to)
		return err
	}) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": s})
}
