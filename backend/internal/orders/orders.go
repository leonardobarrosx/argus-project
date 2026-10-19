// Package orders manages service orders (OS) for the optical lab.
package orders

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
	"github.com/leonardobarrosx/argus/backend/internal/stock"
)

// Order is a service order.
type Order struct {
	ID                  int64      `json:"id"`
	Number              int        `json:"number"`
	PatientID           int64      `json:"patientId"`
	PrescriptionID      *int64     `json:"prescriptionId"`
	Status              string     `json:"status"`
	FrameProductID      *int64     `json:"frameProductId"`
	LensProductID       *int64     `json:"lensProductId"`
	LensID              *int64     `json:"lensId"`
	LensDescription     string     `json:"lensDescription"`
	LensQtyUsed         int        `json:"lensQtyUsed"`
	Total               float64    `json:"total"`
	Paid                bool       `json:"paid"`
	SaleID              *int64     `json:"saleId"`
	DueDate             string     `json:"dueDate"`
	Notes               string     `json:"notes"`
	CreatedAt           time.Time  `json:"createdAt"`
	ProductionStartedAt *time.Time `json:"productionStartedAt"`
	ReadyAt             *time.Time `json:"readyAt"`
	DeliveredAt         *time.Time `json:"deliveredAt"`
}

// Columns is the SELECT list matching Scan.
const Columns = `id, number, patient_id, prescription_id, status, frame_product_id, lens_product_id, lens_id,
	lens_description, lens_qty_used, total, paid, sale_id, COALESCE(to_char(due_date, 'YYYY-MM-DD'), ''), notes,
	created_at, production_started_at, ready_at, delivered_at`

// Scan reads an Order.
func Scan(row db.Row) (Order, error) {
	var o Order
	err := row.Scan(&o.ID, &o.Number, &o.PatientID, &o.PrescriptionID, &o.Status, &o.FrameProductID, &o.LensProductID,
		&o.LensID, &o.LensDescription, &o.LensQtyUsed, &o.Total, &o.Paid, &o.SaleID, &o.DueDate, &o.Notes,
		&o.CreatedAt, &o.ProductionStartedAt, &o.ReadyAt, &o.DeliveredAt)
	return o, err
}

// List returns every order (newest first).
func List(ctx context.Context, tx pgx.Tx) ([]Order, error) {
	rows, err := tx.Query(ctx, `SELECT `+Columns+` FROM service_orders ORDER BY number DESC`)
	if err != nil {
		return nil, err
	}
	return db.CollectRows(rows, Scan)
}

// GetByNumber loads an order by its public number, optionally locking it.
func GetByNumber(ctx context.Context, tx pgx.Tx, number int, lock bool) (Order, error) {
	q := `SELECT ` + Columns + ` FROM service_orders WHERE number=$1`
	if lock {
		q += ` FOR UPDATE`
	}
	o, err := Scan(tx.QueryRow(ctx, q, number))
	if errors.Is(err, pgx.ErrNoRows) {
		return o, httpx.ErrNotFound
	}
	return o, err
}

// Get loads an order by id.
func Get(ctx context.Context, tx pgx.Tx, id int64) (Order, error) {
	return Scan(tx.QueryRow(ctx, `SELECT `+Columns+` FROM service_orders WHERE id=$1`, id))
}

// Insert describes a new order.
type Insert struct {
	PatientID       int64
	PrescriptionID  *int64
	FrameProductID  *int64
	LensProductID   *int64
	LensID          *int64
	LensDescription string
	LensQtyUsed     int
	Total           float64
	Paid            bool
	SaleID          *int64
	DueDate         string
	Notes           string
}

// Create inserts a new order with the next sequential number.
func Create(ctx context.Context, tx pgx.Tx, actor middleware.Actor, in Insert) (Order, error) {
	var number int
	if err := tx.QueryRow(ctx, `UPDATE tenants SET os_seq = os_seq + 1 WHERE id=$1 RETURNING os_seq`, actor.TenantID).Scan(&number); err != nil {
		return Order{}, err
	}
	return Scan(tx.QueryRow(ctx, `
		INSERT INTO service_orders (tenant_id, number, patient_id, prescription_id, frame_product_id, lens_product_id,
		                            lens_id, lens_description, lens_qty_used, total, paid, sale_id, due_date, notes,
		                            created_by, production_started_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14, $15, NOW())
		RETURNING `+Columns,
		actor.TenantID, number, in.PatientID, in.PrescriptionID, in.FrameProductID, in.LensProductID, in.LensID,
		in.LensDescription, in.LensQtyUsed, httpx.Round2(in.Total), in.Paid, in.SaleID, httpx.NullIfEmpty(in.DueDate),
		in.Notes, actor.UserID))
}

// ValidPrescription checks the prescription belongs to the patient and is not expired.
func ValidPrescription(ctx context.Context, tx pgx.Tx, rxID, patientID int64) error {
	var owner int64
	var expired bool
	err := tx.QueryRow(ctx, `SELECT patient_id, expires_at < CURRENT_DATE FROM prescriptions WHERE id=$1`, rxID).Scan(&owner, &expired)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.Unprocessable("INVALID_PRESCRIPTION", "receita não encontrada")
	}
	if err != nil {
		return err
	}
	if patientID != 0 && owner != patientID {
		return httpx.Unprocessable("INVALID_PRESCRIPTION", "a receita não pertence a este paciente")
	}
	if expired {
		return httpx.Unprocessable("EXPIRED_PRESCRIPTION", "receita vencida: não é possível abrir OS")
	}
	return nil
}

// Label formats an order number as shown to users (OS-1234).
func Label(number int) string { return "OS-" + strconv.Itoa(number) }

// ─── HTTP ────────────────────────────────────────────────────────────────────

// Handler exposes the order routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates an orders Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the order routes. Payment of an order lives in the sales
// package (it creates a sale).
func Register(rg *gin.RouterGroup, h *Handler) {
	rg.GET("/orders", h.List)
	rg.POST("/orders", middleware.Role(middleware.Clinical...), h.Create)
	rg.POST("/orders/:number/advance", h.Advance)
	rg.POST("/orders/:number/cancel", middleware.Role(middleware.Managers...), h.Cancel)
}

func paramNumber(c *gin.Context) (int, bool) {
	n, err := strconv.Atoi(strings.TrimPrefix(strings.ToUpper(c.Param("number")), "OS-"))
	if err != nil || n <= 0 {
		httpx.Fail(c, httpx.Errf(http.StatusBadRequest, "INVALID_ID", "número de OS inválido"))
		return 0, false
	}
	return n, true
}

// List — GET /api/orders
func (h *Handler) List(c *gin.Context) {
	a := middleware.GetActor(c)
	var out []Order
	err := db.TenantTx(c.Request.Context(), h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		out, err = List(c.Request.Context(), tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"orders": out})
}

// CreateInput opens an OS directly from a prescription (lab flow), consuming
// a frame and lenses from stock.
type CreateInput struct {
	PrescriptionID int64    `json:"prescriptionId" binding:"required,min=1"`
	FrameProductID int64    `json:"frameProductId" binding:"required,min=1"`
	LensProductID  int64    `json:"lensProductId" binding:"required,min=1"`
	LensQty        int      `json:"lensQty" binding:"required,oneof=1 2"`
	Total          *float64 `json:"total" binding:"omitempty,min=0"`
	DueDate        string   `json:"dueDate"`
	Notes          string   `json:"notes" binding:"max=500"`
}

// Create opens an OS, deducting stock.
// POST /api/orders
func (h *Handler) Create(c *gin.Context) {
	var in CreateInput
	if !httpx.Bind(c, &in) {
		return
	}
	if !httpx.ValidDate(in.DueDate) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_DATE", "previsão de entrega inválida"))
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var o Order
	movements := []stock.Movement{}
	products := []stock.Product{}
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var patientID int64
		if err := tx.QueryRow(ctx, `SELECT patient_id FROM prescriptions WHERE id=$1`, in.PrescriptionID).Scan(&patientID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.Unprocessable("INVALID_PRESCRIPTION", "receita não encontrada")
			}
			return err
		}
		if err := ValidPrescription(ctx, tx, in.PrescriptionID, patientID); err != nil {
			return err
		}
		var active bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM service_orders WHERE prescription_id=$1 AND status IN ('production','ready'))`,
			in.PrescriptionID).Scan(&active); err != nil {
			return err
		}
		if active {
			return httpx.Unprocessable("ACTIVE_ORDER", "esta receita já possui uma OS ativa")
		}
		frame, err := stock.GetProduct(ctx, tx, in.FrameProductID, true)
		if err != nil {
			return err
		}
		lens, err := stock.GetProduct(ctx, tx, in.LensProductID, true)
		if err != nil {
			return err
		}
		total := frame.Price + lens.Price
		if in.Total != nil {
			total = *in.Total
		}
		o, err = Create(ctx, tx, a, Insert{
			PatientID: patientID, PrescriptionID: &in.PrescriptionID, FrameProductID: &frame.ID,
			LensProductID: &lens.ID, LensDescription: lens.Name, LensQtyUsed: in.LensQty, Total: total,
			DueDate: in.DueDate, Notes: strings.TrimSpace(in.Notes),
		})
		if err != nil {
			return err
		}
		note := Label(o.Number)
		for _, mv := range []struct {
			id  int64
			qty int
		}{{lens.ID, in.LensQty}, {frame.ID, 1}} {
			m, err := stock.Move(ctx, tx, a, mv.id, -mv.qty, "service_order", note, &o.ID, &in.PrescriptionID, "")
			if err != nil {
				return err
			}
			movements = append(movements, m)
		}
		for _, id := range []int64{frame.ID, lens.ID} {
			p, err := stock.GetProduct(ctx, tx, id, false)
			if err != nil {
				return err
			}
			products = append(products, p)
		}
		return nil
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"order": o, "movements": movements, "products": products})
}

// Advance moves production → ready → delivered. Delivery requires payment.
// POST /api/orders/:number/advance
func (h *Handler) Advance(c *gin.Context) {
	number, ok := paramNumber(c)
	if !ok {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var o Order
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		cur, err := GetByNumber(ctx, tx, number, true)
		if err != nil {
			return err
		}
		var q string
		switch cur.Status {
		case "production":
			q = `UPDATE service_orders SET status='ready', ready_at=NOW() WHERE id=$1 RETURNING ` + Columns
		case "ready":
			if !cur.Paid && cur.Total > 0 {
				return httpx.Unprocessable("ORDER_UNPAID", "registre o pagamento da OS antes de entregar")
			}
			q = `UPDATE service_orders SET status='delivered', delivered_at=NOW() WHERE id=$1 RETURNING ` + Columns
		default:
			return httpx.Unprocessable("INVALID_STATUS", fmt.Sprintf("OS %s não pode avançar (status: %s)", Label(number), cur.Status))
		}
		o, err = Scan(tx.QueryRow(ctx, q, cur.ID))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": o})
}

// CancelInput cancels an OS.
type CancelInput struct {
	Reason string `json:"reason" binding:"required,min=3,max=300"`
}

// Cancel cancels an unpaid, undelivered OS and returns its items to stock.
// POST /api/orders/:number/cancel
func (h *Handler) Cancel(c *gin.Context) {
	number, ok := paramNumber(c)
	if !ok {
		return
	}
	var in CancelInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var o Order
	movements := []stock.Movement{}
	products := []stock.Product{}
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		cur, err := GetByNumber(ctx, tx, number, true)
		if err != nil {
			return err
		}
		if cur.Status == "delivered" || cur.Status == "cancelled" {
			return httpx.Unprocessable("INVALID_STATUS", "OS entregue ou já cancelada")
		}
		if cur.Paid {
			return httpx.Unprocessable("ORDER_PAID", "OS paga: cancele a venda vinculada para estornar")
		}
		movements, products, err = Restock(ctx, tx, a, cur, "Cancelamento "+Label(cur.Number)+": "+strings.TrimSpace(in.Reason))
		if err != nil {
			return err
		}
		o, err = Scan(tx.QueryRow(ctx, `
			UPDATE service_orders SET status='cancelled', notes = TRIM(notes || ' [Cancelada: ' || $2 || ']')
			WHERE id=$1 RETURNING `+Columns, cur.ID, strings.TrimSpace(in.Reason)))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"order": o, "movements": movements, "products": products})
}

// Restock returns the stock consumed by an order (frame and stock lenses).
func Restock(ctx context.Context, tx pgx.Tx, actor middleware.Actor, o Order, note string) ([]stock.Movement, []stock.Product, error) {
	movements := []stock.Movement{}
	products := []stock.Product{}
	type item struct {
		id  *int64
		qty int
	}
	for _, it := range []item{{o.FrameProductID, 1}, {o.LensProductID, o.LensQtyUsed}} {
		if it.id == nil || it.qty <= 0 {
			continue
		}
		m, err := stock.Move(ctx, tx, actor, *it.id, it.qty, "sale_cancel", note, &o.ID, o.PrescriptionID, "")
		if err != nil {
			return nil, nil, err
		}
		movements = append(movements, m)
		p, err := stock.GetProduct(ctx, tx, *it.id, false)
		if err != nil {
			return nil, nil, err
		}
		products = append(products, p)
	}
	return movements, products, nil
}
