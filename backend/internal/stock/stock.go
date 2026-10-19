// Package stock manages products, the lens catalog and the stock audit trail.
package stock

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/finance"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
)

// ─── Products ────────────────────────────────────────────────────────────────

// Product is a stock item (armação, lente pronta, acessório…).
type Product struct {
	ID            int64   `json:"id"`
	Name          string  `json:"name"`
	Category      string  `json:"category"`
	SKU           string  `json:"sku"`
	Qty           int     `json:"qty"`
	Min           int     `json:"min"`
	Price         float64 `json:"price"`
	CostPrice     float64 `json:"costPrice"`
	CommissionPct float64 `json:"commissionPct"`
	SupplierID    *int64  `json:"supplierId"`
	Supplier      string  `json:"supplier"`
	Active        bool    `json:"active"`
}

// ProductColumns is the SELECT list matching ScanProduct.
const ProductColumns = `id, name, category, sku, qty, min_qty, price, cost_price, commission_pct, supplier_id, supplier_name, active`

// ScanProduct reads a Product.
func ScanProduct(row db.Row) (Product, error) {
	var p Product
	err := row.Scan(&p.ID, &p.Name, &p.Category, &p.SKU, &p.Qty, &p.Min, &p.Price, &p.CostPrice, &p.CommissionPct, &p.SupplierID, &p.Supplier, &p.Active)
	return p, err
}

// ListProducts returns every product.
func ListProducts(ctx context.Context, tx pgx.Tx) ([]Product, error) {
	rows, err := tx.Query(ctx, `SELECT `+ProductColumns+` FROM products ORDER BY category, name`)
	if err != nil {
		return nil, err
	}
	return db.CollectRows(rows, ScanProduct)
}

// GetProduct loads one product, optionally locking it FOR UPDATE.
func GetProduct(ctx context.Context, tx pgx.Tx, id int64, lock bool) (Product, error) {
	q := `SELECT ` + ProductColumns + ` FROM products WHERE id=$1`
	if lock {
		q += ` FOR UPDATE`
	}
	p, err := ScanProduct(tx.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return p, httpx.Unprocessable("INVALID_PRODUCT", "produto não encontrado")
	}
	return p, err
}

// ChangeQty atomically adds delta to the product quantity and returns the
// quantities before/after. Fails with INSUFFICIENT_STOCK if it would go negative.
func ChangeQty(ctx context.Context, tx pgx.Tx, productID int64, delta int) (prev, next int, name string, err error) {
	err = tx.QueryRow(ctx, `
		UPDATE products SET qty = qty + $2, updated_at = NOW()
		WHERE id = $1 AND qty + $2 >= 0
		RETURNING qty - $2, qty, name`, productID, delta).Scan(&prev, &next, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		p, gerr := GetProduct(ctx, tx, productID, false)
		if gerr != nil {
			return 0, 0, "", gerr
		}
		return 0, 0, "", httpx.Unprocessable("INSUFFICIENT_STOCK",
			fmt.Sprintf("estoque insuficiente para %s (disponível: %d)", p.Name, p.Qty))
	}
	return prev, next, name, err
}

// ─── Lens catalog ────────────────────────────────────────────────────────────

// Lens is a surfaced lens sold per pair (no stock control).
type Lens struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	LensType    string  `json:"lensType"`
	Index       string  `json:"index"`
	Price       float64 `json:"price"`
	CostPrice   float64 `json:"costPrice"`
	Active      bool    `json:"active"`
}

const lensColumns = `id, name, description, lens_type, refractive_index, price, cost_price, active`

// ScanLens reads a Lens.
func ScanLens(row db.Row) (Lens, error) {
	var l Lens
	err := row.Scan(&l.ID, &l.Name, &l.Description, &l.LensType, &l.Index, &l.Price, &l.CostPrice, &l.Active)
	return l, err
}

// ListLenses returns the lens catalog.
func ListLenses(ctx context.Context, tx pgx.Tx) ([]Lens, error) {
	rows, err := tx.Query(ctx, `SELECT `+lensColumns+` FROM lenses ORDER BY lens_type, price`)
	if err != nil {
		return nil, err
	}
	return db.CollectRows(rows, ScanLens)
}

// GetLens loads one lens.
func GetLens(ctx context.Context, tx pgx.Tx, id int64) (Lens, error) {
	l, err := ScanLens(tx.QueryRow(ctx, `SELECT `+lensColumns+` FROM lenses WHERE id=$1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return l, httpx.Unprocessable("INVALID_LENS", "lente não encontrada no catálogo")
	}
	return l, err
}

type defaultLens struct {
	name, desc, kind, index string
	price, cost             float64
}

var defaultLenses = []defaultLens{
	{"Visão Simples CR-39 1.56", "Lente básica para miopia/hipermetropia leve", "Simples", "1.56", 120, 45},
	{"Visão Simples Policarbonato 1.59", "Resistente a impacto, ideal para crianças e esportes", "Simples", "1.59", 180, 70},
	{"Visão Simples Alto Índice 1.67", "Mais fina, ideal para graus médios", "Simples", "1.67", 280, 110},
	{"Visão Simples Ultra Fina 1.74", "Ultra fina, graus altos (+/- 4.00 ou mais)", "Simples", "1.74", 450, 190},
	{"Blue Light 1.56", "Filtro de luz azul para uso digital", "Blue Light", "1.56", 189.90, 70},
	{"Blue Light Policarbonato 1.59", "Policarbonato + filtro luz azul", "Blue Light", "1.59", 250, 95},
	{"Blue Light Alto Índice 1.67", "Fina + filtro luz azul", "Blue Light", "1.67", 350, 140},
	{"Progressiva Standard 1.56", "Multifocal básica", "Progressiva", "1.56", 350, 140},
	{"Progressiva Premium 1.67", "Multifocal fina, campo visual ampliado", "Progressiva", "1.67", 650, 260},
	{"Progressiva Elite 1.74", "Multifocal ultra fina, máxima precisão", "Progressiva", "1.74", 950, 400},
	{"Transitions Gen8 1.56", "Fotossensível, adapta-se à luz", "Transitions", "1.56", 450, 180},
	{"Transitions Gen8 1.67", "Fotossensível fina", "Transitions", "1.67", 680, 280},
	{"Lente Pronta Leitura", "Óculos pronto para leitura simples (sem grau personalizado)", "Leitura", "1.50", 60, 15},
	{"Lente Solar (sem grau)", "Lente escura para óculos de sol", "Solar", "1.50", 80, 20},
}

// SeedDefaultLenses inserts the default lens catalog for a new ótica.
func SeedDefaultLenses(ctx context.Context, tx pgx.Tx, tenantID int64) error {
	for _, l := range defaultLenses {
		if _, err := tx.Exec(ctx, `
			INSERT INTO lenses (tenant_id, name, description, lens_type, refractive_index, price, cost_price)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`, tenantID, l.name, l.desc, l.kind, l.index, l.price, l.cost); err != nil {
			return err
		}
	}
	return nil
}

// ─── Movements ───────────────────────────────────────────────────────────────

// Movement is one entry of the stock audit trail.
type Movement struct {
	ID             int64     `json:"id"`
	ProductID      int64     `json:"productId"`
	Qty            int       `json:"qty"`
	Type           string    `json:"type"`
	Reason         string    `json:"reason"`
	PerformedBy    string    `json:"performedBy"`
	Notes          string    `json:"notes"`
	OrderNumber    *int      `json:"orderNumber"`
	PrescriptionID *int64    `json:"prescriptionId"`
	InvoiceNumber  string    `json:"invoiceNumber"`
	PreviousQty    *int      `json:"previousQty"`
	NewQty         *int      `json:"newQty"`
	CreatedAt      time.Time `json:"createdAt"`
}

const movementColumns = `id, product_id, qty, type, reason, performed_by_name, notes,
	(SELECT so.number FROM service_orders so WHERE so.id = order_id), prescription_id, invoice_number,
	previous_qty, new_qty, created_at`

func scanMovement(row db.Row) (Movement, error) {
	var m Movement
	err := row.Scan(&m.ID, &m.ProductID, &m.Qty, &m.Type, &m.Reason, &m.PerformedBy, &m.Notes, &m.OrderNumber,
		&m.PrescriptionID, &m.InvoiceNumber, &m.PreviousQty, &m.NewQty, &m.CreatedAt)
	return m, err
}

// ListMovements returns the most recent movements (newest first).
func ListMovements(ctx context.Context, tx pgx.Tx, limit int) ([]Movement, error) {
	rows, err := tx.Query(ctx, `SELECT `+movementColumns+` FROM stock_movements ORDER BY created_at DESC, id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return db.CollectRows(rows, scanMovement)
}

// MovementInput describes a movement to record.
type MovementInput struct {
	ProductID      int64
	Qty            int
	Type           string // in | out
	Reason         string
	Notes          string
	OrderID        *int64
	PrescriptionID *int64
	InvoiceNumber  string
	PreviousQty    int
	NewQty         int
}

// InsertMovement records a movement performed by actor.
func InsertMovement(ctx context.Context, tx pgx.Tx, actor middleware.Actor, in MovementInput) (Movement, error) {
	return scanMovement(tx.QueryRow(ctx, `
		INSERT INTO stock_movements (tenant_id, product_id, qty, type, reason, performed_by, performed_by_name,
		                             notes, order_id, prescription_id, invoice_number, previous_qty, new_qty)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING `+movementColumns,
		actor.TenantID, in.ProductID, in.Qty, in.Type, in.Reason, actor.UserID, actor.Name, in.Notes,
		in.OrderID, in.PrescriptionID, in.InvoiceNumber, in.PreviousQty, in.NewQty))
}

// Move changes the product quantity by delta and records the movement.
func Move(ctx context.Context, tx pgx.Tx, actor middleware.Actor, productID int64, delta int, reason, notes string,
	orderID, prescriptionID *int64, invoice string) (Movement, error) {
	if delta == 0 {
		return Movement{}, fmt.Errorf("stock.Move: zero delta")
	}
	prev, next, _, err := ChangeQty(ctx, tx, productID, delta)
	if err != nil {
		return Movement{}, err
	}
	typ, qty := "in", delta
	if delta < 0 {
		typ, qty = "out", -delta
	}
	return InsertMovement(ctx, tx, actor, MovementInput{
		ProductID: productID, Qty: qty, Type: typ, Reason: reason, Notes: notes, OrderID: orderID,
		PrescriptionID: prescriptionID, InvoiceNumber: invoice, PreviousQty: prev, NewQty: next,
	})
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

// Handler exposes the stock routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a stock Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the stock routes.
func Register(rg *gin.RouterGroup, h *Handler) {
	rg.GET("/products", h.ListProducts)
	rg.POST("/products", middleware.Role(middleware.Managers...), h.CreateProduct)
	rg.PUT("/products/:id", middleware.Role(middleware.Managers...), h.UpdateProduct)
	rg.GET("/stock/movements", h.ListMovements)
	rg.POST("/stock/adjust", middleware.Role(middleware.Managers...), h.Adjust)
	rg.POST("/stock/entries", middleware.Role(middleware.Managers...), h.Entry)
	rg.GET("/lenses", h.ListLenses)
	rg.POST("/lenses", middleware.Role(middleware.Managers...), h.CreateLens)
	rg.PUT("/lenses/:id", middleware.Role(middleware.Managers...), h.UpdateLens)
}

// ProductInput is the create/update payload (quantity changes only through
// entries, adjustments, sales and service orders).
type ProductInput struct {
	Name          string  `json:"name" binding:"required,min=2,max=120"`
	Category      string  `json:"category" binding:"required,max=60"`
	SKU           string  `json:"sku" binding:"max=60"`
	Min           int     `json:"min" binding:"min=0,max=100000"`
	Price         float64 `json:"price" binding:"gt=0"`
	CostPrice     float64 `json:"costPrice" binding:"min=0"`
	CommissionPct float64 `json:"commissionPct" binding:"min=0,max=100"`
	SupplierID    *int64  `json:"supplierId"`
	Supplier      string  `json:"supplier" binding:"max=120"`
	Active        *bool   `json:"active"`
}

func resolveSupplier(ctx context.Context, tx pgx.Tx, id *int64, name string) (*int64, string, error) {
	if id == nil {
		return nil, strings.TrimSpace(name), nil
	}
	var n string
	if err := tx.QueryRow(ctx, `SELECT name FROM suppliers WHERE id=$1`, *id).Scan(&n); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, "", httpx.Unprocessable("INVALID_SUPPLIER", "fornecedor não encontrado")
		}
		return nil, "", err
	}
	return id, n, nil
}

func (h *Handler) list(c *gin.Context, key string, fn func(context.Context, pgx.Tx) (any, error)) {
	a := middleware.GetActor(c)
	var out any
	err := db.TenantTx(c.Request.Context(), h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		out, err = fn(c.Request.Context(), tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{key: out})
}

// ListProducts — GET /api/products
func (h *Handler) ListProducts(c *gin.Context) {
	h.list(c, "products", func(ctx context.Context, tx pgx.Tx) (any, error) { return ListProducts(ctx, tx) })
}

// ListLenses — GET /api/lenses
func (h *Handler) ListLenses(c *gin.Context) {
	h.list(c, "lenses", func(ctx context.Context, tx pgx.Tx) (any, error) { return ListLenses(ctx, tx) })
}

// ListMovements — GET /api/stock/movements
func (h *Handler) ListMovements(c *gin.Context) {
	h.list(c, "movements", func(ctx context.Context, tx pgx.Tx) (any, error) { return ListMovements(ctx, tx, 5000) })
}

// CreateProduct adds a product to the catalog with zero quantity.
// POST /api/products
func (h *Handler) CreateProduct(c *gin.Context) {
	var in ProductInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var p Product
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		supID, supName, err := resolveSupplier(ctx, tx, in.SupplierID, in.Supplier)
		if err != nil {
			return err
		}
		p, err = ScanProduct(tx.QueryRow(ctx, `
			INSERT INTO products (tenant_id, name, category, sku, min_qty, price, cost_price, commission_pct, supplier_id, supplier_name)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING `+ProductColumns,
			a.TenantID, strings.TrimSpace(in.Name), strings.TrimSpace(in.Category), strings.TrimSpace(in.SKU), in.Min,
			httpx.Round2(in.Price), httpx.Round2(in.CostPrice), in.CommissionPct, supID, supName))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"product": p})
}

// UpdateProduct edits product data (not quantity).
// PUT /api/products/:id
func (h *Handler) UpdateProduct(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in ProductInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var p Product
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		supID, supName, err := resolveSupplier(ctx, tx, in.SupplierID, in.Supplier)
		if err != nil {
			return err
		}
		p, err = ScanProduct(tx.QueryRow(ctx, `
			UPDATE products SET name=$2, category=$3, sku=$4, min_qty=$5, price=$6, cost_price=$7, commission_pct=$8,
			       supplier_id=$9, supplier_name=$10, active=COALESCE($11, active), updated_at=NOW()
			WHERE id=$1 RETURNING `+ProductColumns,
			id, strings.TrimSpace(in.Name), strings.TrimSpace(in.Category), strings.TrimSpace(in.SKU), in.Min,
			httpx.Round2(in.Price), httpx.Round2(in.CostPrice), in.CommissionPct, supID, supName, in.Active))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"product": p})
}

// AdjustInput is a manual adjustment or physical count.
type AdjustInput struct {
	ProductID int64  `json:"productId" binding:"required,min=1"`
	NewQty    int    `json:"newQty" binding:"min=0,max=1000000"`
	Type      string `json:"type" binding:"required,oneof=adjust count"`
	Reason    string `json:"reason" binding:"max=300"`
}

// Adjust sets the product quantity, recording the delta in the audit trail.
// POST /api/stock/adjust
func (h *Handler) Adjust(c *gin.Context) {
	var in AdjustInput
	if !httpx.Bind(c, &in) {
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Type == "adjust" && in.Reason == "" {
		httpx.Fail(c, httpx.Unprocessable("REASON_REQUIRED", "informe o motivo do ajuste"))
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var p Product
	var mv *Movement
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		cur, err := GetProduct(ctx, tx, in.ProductID, true)
		if err != nil {
			return err
		}
		delta := in.NewQty - cur.Qty
		if delta != 0 {
			reason, notes := "manual_adjustment", in.Reason
			if in.Type == "count" {
				reason = "physical_count"
				notes = fmt.Sprintf("Contagem física: %d → %d", cur.Qty, in.NewQty)
				if in.Reason != "" {
					notes += " · " + in.Reason
				}
			}
			m, err := Move(ctx, tx, a, cur.ID, delta, reason, notes, nil, nil, "")
			if err != nil {
				return err
			}
			mv = &m
		}
		p, err = GetProduct(ctx, tx, in.ProductID, false)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	movements := []Movement{}
	if mv != nil {
		movements = append(movements, *mv)
	}
	c.JSON(http.StatusOK, gin.H{"product": p, "movements": movements})
}

// EntryInput is a purchase (NF) entry with one or more products.
type EntryInput struct {
	InvoiceNumber string `json:"invoiceNumber" binding:"max=60"`
	SupplierID    *int64 `json:"supplierId"`
	Supplier      string `json:"supplier" binding:"max=120"`
	Items         []struct {
		ProductID int64    `json:"productId" binding:"required,min=1"`
		Qty       int      `json:"qty" binding:"required,min=1,max=100000"`
		CostPrice *float64 `json:"costPrice" binding:"omitempty,min=0"`
	} `json:"items" binding:"required,min=1,max=200,dive"`
	CreatePayable bool   `json:"createPayable"`
	DueDate       string `json:"dueDate"`
}

// Entry registers a purchase: adds quantities, updates cost prices and,
// optionally, creates the matching account payable.
// POST /api/stock/entries
func (h *Handler) Entry(c *gin.Context) {
	var in EntryInput
	if !httpx.Bind(c, &in) {
		return
	}
	if !httpx.ValidDate(in.DueDate) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_DATE", "data de vencimento inválida"))
		return
	}
	nf := strings.TrimSpace(in.InvoiceNumber)
	a := middleware.GetActor(c)
	ctx := c.Request.Context()

	products := []Product{}
	movements := []Movement{}
	var payable *finance.Payable
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		supID, supName, err := resolveSupplier(ctx, tx, in.SupplierID, in.Supplier)
		if err != nil {
			return err
		}
		seen := map[int64]bool{}
		var totalCost float64
		for _, it := range in.Items {
			if seen[it.ProductID] {
				return httpx.Unprocessable("DUPLICATE_ITEM", "produto repetido na mesma entrada")
			}
			seen[it.ProductID] = true
			cur, err := GetProduct(ctx, tx, it.ProductID, true)
			if err != nil {
				return err
			}
			cost := cur.CostPrice
			if it.CostPrice != nil && *it.CostPrice > 0 {
				cost = httpx.Round2(*it.CostPrice)
			}
			totalCost += cost * float64(it.Qty)
			notes := "Entrada NF"
			if nf != "" {
				notes += ": " + nf
			}
			if supName != "" {
				notes += " · " + supName
			}
			m, err := Move(ctx, tx, a, cur.ID, it.Qty, "purchase", notes, nil, nil, nf)
			if err != nil {
				return err
			}
			movements = append(movements, m)
			p, err := ScanProduct(tx.QueryRow(ctx, `
				UPDATE products SET cost_price=$2,
				       supplier_id=COALESCE($3, supplier_id),
				       supplier_name=CASE WHEN $4 <> '' THEN $4 ELSE supplier_name END,
				       updated_at=NOW()
				WHERE id=$1 RETURNING `+ProductColumns, cur.ID, cost, supID, supName))
			if err != nil {
				return err
			}
			products = append(products, p)
		}
		if in.CreatePayable && totalCost > 0 {
			due := in.DueDate
			if due == "" {
				term := 30
				if supID != nil {
					if err := tx.QueryRow(ctx, `SELECT credit_term FROM suppliers WHERE id=$1`, *supID).Scan(&term); err != nil {
						return err
					}
				}
				due = time.Now().AddDate(0, 0, term).Format("2006-01-02")
			}
			desc := "Compra de mercadorias"
			if nf != "" {
				desc += " — NF " + nf
			}
			if supName != "" {
				desc += " · " + supName
			}
			p, err := finance.InsertPayable(ctx, tx, a, finance.PayableInput{
				SupplierID: supID, Description: desc, Category: "Mercadorias", Amount: httpx.Round2(totalCost),
				DueDate: due, InvoiceNumber: nf,
			})
			if err != nil {
				return err
			}
			payable = &p
		}
		return nil
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"products": products, "movements": movements, "payable": payable})
}

// LensInput is the lens create/update payload.
type LensInput struct {
	Name        string  `json:"name" binding:"required,min=2,max=120"`
	Description string  `json:"description" binding:"max=300"`
	LensType    string  `json:"lensType" binding:"required,max=40"`
	Index       string  `json:"index" binding:"max=10"`
	Price       float64 `json:"price" binding:"min=0"`
	CostPrice   float64 `json:"costPrice" binding:"min=0"`
	Active      *bool   `json:"active"`
}

// CreateLens — POST /api/lenses
func (h *Handler) CreateLens(c *gin.Context) {
	var in LensInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var l Lens
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		l, err = ScanLens(tx.QueryRow(ctx, `
			INSERT INTO lenses (tenant_id, name, description, lens_type, refractive_index, price, cost_price)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+lensColumns,
			a.TenantID, strings.TrimSpace(in.Name), strings.TrimSpace(in.Description), strings.TrimSpace(in.LensType),
			strings.TrimSpace(in.Index), httpx.Round2(in.Price), httpx.Round2(in.CostPrice)))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"lens": l})
}

// UpdateLens — PUT /api/lenses/:id
func (h *Handler) UpdateLens(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in LensInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var l Lens
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		l, err = ScanLens(tx.QueryRow(ctx, `
			UPDATE lenses SET name=$2, description=$3, lens_type=$4, refractive_index=$5, price=$6, cost_price=$7,
			       active=COALESCE($8, active)
			WHERE id=$1 RETURNING `+lensColumns,
			id, strings.TrimSpace(in.Name), strings.TrimSpace(in.Description), strings.TrimSpace(in.LensType),
			strings.TrimSpace(in.Index), httpx.Round2(in.Price), httpx.Round2(in.CostPrice), in.Active))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"lens": l})
}
