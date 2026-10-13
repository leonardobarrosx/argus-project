// Package finance handles accounts payable and the financial summary (DRE,
// receivables, cash flow and commissions).
package finance

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

// Payable is an account payable.
type Payable struct {
	ID            int64     `json:"id"`
	SupplierID    *int64    `json:"supplierId"`
	SupplierName  string    `json:"supplierName"`
	Description   string    `json:"description"`
	Category      string    `json:"category"`
	Amount        float64   `json:"amount"`
	DueDate       string    `json:"dueDate"`
	Status        string    `json:"status"`
	InvoiceNumber string    `json:"invoiceNumber"`
	PaidAt        string    `json:"paidAt"`
	PaidAmount    *float64  `json:"paidAmount"`
	CancelReason  string    `json:"cancelReason"`
	CreatedAt     time.Time `json:"createdAt"`
}

const payableColumns = `p.id, p.supplier_id, COALESCE(s.name, ''), p.description, p.category, p.amount,
	to_char(p.due_date, 'YYYY-MM-DD'), p.status, p.invoice_number, COALESCE(to_char(p.paid_at, 'YYYY-MM-DD'), ''),
	p.paid_amount, p.cancel_reason, p.created_at`

const payableFrom = ` FROM payables p LEFT JOIN suppliers s ON s.id = p.supplier_id`

func scanPayable(row db.Row) (Payable, error) {
	var p Payable
	err := row.Scan(&p.ID, &p.SupplierID, &p.SupplierName, &p.Description, &p.Category, &p.Amount, &p.DueDate,
		&p.Status, &p.InvoiceNumber, &p.PaidAt, &p.PaidAmount, &p.CancelReason, &p.CreatedAt)
	return p, err
}

func getPayable(ctx context.Context, tx pgx.Tx, id int64) (Payable, error) {
	return scanPayable(tx.QueryRow(ctx, `SELECT `+payableColumns+payableFrom+` WHERE p.id=$1`, id))
}

// ListPayables returns every payable, open ones first by due date.
func ListPayables(ctx context.Context, tx pgx.Tx) ([]Payable, error) {
	rows, err := tx.Query(ctx, `SELECT `+payableColumns+payableFrom+`
		ORDER BY (p.status = 'pending') DESC, p.due_date, p.id`)
	if err != nil {
		return nil, err
	}
	return db.CollectRows(rows, scanPayable)
}

// PayableInput is the create payload.
type PayableInput struct {
	SupplierID    *int64  `json:"supplierId"`
	Description   string  `json:"description" binding:"required,min=2,max=200"`
	Category      string  `json:"category" binding:"max=60"`
	Amount        float64 `json:"amount" binding:"gt=0"`
	DueDate       string  `json:"dueDate" binding:"required"`
	InvoiceNumber string  `json:"invoiceNumber" binding:"max=60"`
}

// InsertPayable creates a payable inside an existing transaction.
func InsertPayable(ctx context.Context, tx pgx.Tx, actor middleware.Actor, in PayableInput) (Payable, error) {
	if !httpx.ValidDate(in.DueDate) || in.DueDate == "" {
		return Payable{}, httpx.Unprocessable("INVALID_DATE", "data de vencimento inválida")
	}
	if in.SupplierID != nil {
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM suppliers WHERE id=$1)`, *in.SupplierID).Scan(&ok); err != nil {
			return Payable{}, err
		}
		if !ok {
			return Payable{}, httpx.Unprocessable("INVALID_SUPPLIER", "fornecedor não encontrado")
		}
	}
	category := strings.TrimSpace(in.Category)
	if category == "" {
		category = "Outros"
	}
	var id int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO payables (tenant_id, supplier_id, description, category, amount, due_date, invoice_number, created_by)
		VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8) RETURNING id`,
		actor.TenantID, in.SupplierID, strings.TrimSpace(in.Description), category, httpx.Round2(in.Amount),
		in.DueDate, strings.TrimSpace(in.InvoiceNumber), actor.UserID).Scan(&id); err != nil {
		return Payable{}, err
	}
	return getPayable(ctx, tx, id)
}

// Handler exposes the finance routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a finance Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the finance routes (managers only).
func Register(rg *gin.RouterGroup, h *Handler) {
	g := rg.Group("", middleware.Role(middleware.Managers...))
	g.GET("/payables", h.List)
	g.POST("/payables", h.Create)
	g.POST("/payables/:id/pay", h.Pay)
	g.POST("/payables/:id/cancel", h.Cancel)
	g.GET("/finance/summary", h.Summary)
}

// List — GET /api/payables
func (h *Handler) List(c *gin.Context) {
	a := middleware.GetActor(c)
	var out []Payable
	err := db.TenantTx(c.Request.Context(), h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		out, err = ListPayables(c.Request.Context(), tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"payables": out})
}

// Create — POST /api/payables
func (h *Handler) Create(c *gin.Context) {
	var in PayableInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var p Payable
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		p, err = InsertPayable(ctx, tx, a, in)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"payable": p})
}

// PayInput settles a payable.
type PayInput struct {
	PaidAt     string   `json:"paidAt"`
	PaidAmount *float64 `json:"paidAmount" binding:"omitempty,gt=0"`
}

// Pay marks a pending payable as paid.
// POST /api/payables/:id/pay
func (h *Handler) Pay(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in PayInput
	if !httpx.Bind(c, &in) {
		return
	}
	if !httpx.ValidDate(in.PaidAt) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_DATE", "data de pagamento inválida"))
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var p Payable
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE payables SET status='paid', paid_at=COALESCE($2::date, CURRENT_DATE),
			       paid_amount=COALESCE($3, amount), updated_at=NOW()
			WHERE id=$1 AND status='pending'`, id, httpx.NullIfEmpty(in.PaidAt), in.PaidAmount)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			if _, err := getPayable(ctx, tx, id); err != nil {
				return err
			}
			return httpx.Unprocessable("INVALID_STATUS", "apenas contas pendentes podem ser pagas")
		}
		p, err = getPayable(ctx, tx, id)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"payable": p})
}

// CancelInput cancels a payable.
type CancelInput struct {
	Reason string `json:"reason" binding:"required,min=3,max=300"`
}

// Cancel cancels a pending payable.
// POST /api/payables/:id/cancel
func (h *Handler) Cancel(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in CancelInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var p Payable
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE payables SET status='cancelled', cancel_reason=$2, updated_at=NOW()
			WHERE id=$1 AND status='pending'`, id, strings.TrimSpace(in.Reason))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			if _, err := getPayable(ctx, tx, id); err != nil {
				return err
			}
			return httpx.Unprocessable("INVALID_STATUS", "apenas contas pendentes podem ser canceladas")
		}
		p, err = getPayable(ctx, tx, id)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"payable": p})
}

// ─── Summary ─────────────────────────────────────────────────────────────────

// Summary is the financial overview for a period.
type Summary struct {
	From                 string          `json:"from"`
	To                   string          `json:"to"`
	Revenue              float64         `json:"revenue"`
	SalesCount           int             `json:"salesCount"`
	AvgTicket            float64         `json:"avgTicket"`
	Discounts            float64         `json:"discounts"`
	COGS                 float64         `json:"cogs"`
	GrossProfit          float64         `json:"grossProfit"`
	GrossMarginPct       float64         `json:"grossMarginPct"`
	OperatingExpenses    float64         `json:"operatingExpenses"`
	MerchandisePurchases float64         `json:"merchandisePurchases"`
	NetResult            float64         `json:"netResult"`
	Receivables          float64         `json:"receivables"`
	ReceivablesCount     int             `json:"receivablesCount"`
	PayablesPending      float64         `json:"payablesPending"`
	PayablesOverdue      float64         `json:"payablesOverdue"`
	PayablesOverdueCount int             `json:"payablesOverdueCount"`
	ByMethod             []MethodTotal   `json:"byMethod"`
	ExpensesByCategory   []CategoryTotal `json:"expensesByCategory"`
	Daily                []DailyRow      `json:"daily"`
	Commissions          []Commission    `json:"commissions"`
}

// MethodTotal aggregates revenue by payment method.
type MethodTotal struct {
	Method string  `json:"method"`
	Total  float64 `json:"total"`
	Count  int     `json:"count"`
}

// CategoryTotal aggregates paid expenses by category.
type CategoryTotal struct {
	Category string  `json:"category"`
	Total    float64 `json:"total"`
}

// DailyRow is one day of the cash flow.
type DailyRow struct {
	Date    string  `json:"date"`
	Inflow  float64 `json:"inflow"`
	Outflow float64 `json:"outflow"`
	Balance float64 `json:"balance"`
}

// Commission is the commission owed to a seller in the period.
type Commission struct {
	SellerID      int64   `json:"sellerId"`
	SellerName    string  `json:"sellerName"`
	SalesTotal    float64 `json:"salesTotal"`
	SalesCount    int     `json:"salesCount"`
	CommissionPct float64 `json:"commissionPct"`
	Commission    float64 `json:"commission"`
}

func parsePeriod(c *gin.Context) (string, string, error) {
	now := time.Now()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local).Format("2006-01-02")
	to := now.Format("2006-01-02")
	if f := c.Query("from"); f != "" {
		from = f
	}
	if t := c.Query("to"); t != "" {
		to = t
	}
	if !httpx.ValidDate(from) || !httpx.ValidDate(to) || from > to {
		return "", "", httpx.Unprocessable("INVALID_PERIOD", "período inválido")
	}
	if f, _ := time.Parse("2006-01-02", from); f.AddDate(2, 0, 1).Before(mustDate(to)) {
		return "", "", httpx.Unprocessable("INVALID_PERIOD", "período máximo de 2 anos")
	}
	return from, to, nil
}

func mustDate(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

// Summary — GET /api/finance/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
func (h *Handler) Summary(c *gin.Context) {
	from, to, err := parsePeriod(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	s := Summary{From: from, To: to}
	err = db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		return computeSummary(ctx, tx, &s)
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"summary": s})
}

func computeSummary(ctx context.Context, tx pgx.Tx, s *Summary) error {
	const salesInPeriod = `status = 'completed' AND created_at::date BETWEEN $1::date AND $2::date`

	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(total), 0), COUNT(*), COALESCE(SUM(discount), 0)
		FROM sales WHERE `+salesInPeriod, s.From, s.To).Scan(&s.Revenue, &s.SalesCount, &s.Discounts); err != nil {
		return err
	}
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(i.unit_cost * i.qty), 0)
		FROM sale_items i JOIN sales s ON s.id = i.sale_id
		WHERE s.status = 'completed' AND s.created_at::date BETWEEN $1::date AND $2::date`, s.From, s.To).Scan(&s.COGS); err != nil {
		return err
	}
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(paid_amount) FILTER (WHERE category <> 'Mercadorias'), 0),
		       COALESCE(SUM(paid_amount) FILTER (WHERE category = 'Mercadorias'), 0)
		FROM payables WHERE status = 'paid' AND paid_at BETWEEN $1::date AND $2::date`, s.From, s.To).
		Scan(&s.OperatingExpenses, &s.MerchandisePurchases); err != nil {
		return err
	}
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(total), 0), COUNT(*) FROM service_orders
		WHERE NOT paid AND status <> 'cancelled' AND total > 0`).Scan(&s.Receivables, &s.ReceivablesCount); err != nil {
		return err
	}
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount), 0),
		       COALESCE(SUM(amount) FILTER (WHERE due_date < CURRENT_DATE), 0),
		       COUNT(*) FILTER (WHERE due_date < CURRENT_DATE)
		FROM payables WHERE status = 'pending'`).Scan(&s.PayablesPending, &s.PayablesOverdue, &s.PayablesOverdueCount); err != nil {
		return err
	}

	rows, err := tx.Query(ctx, `
		SELECT payment_method, SUM(total), COUNT(*) FROM sales WHERE `+salesInPeriod+`
		GROUP BY payment_method ORDER BY SUM(total) DESC`, s.From, s.To)
	if err != nil {
		return err
	}
	if s.ByMethod, err = db.CollectRows(rows, func(r db.Row) (MethodTotal, error) {
		var m MethodTotal
		return m, r.Scan(&m.Method, &m.Total, &m.Count)
	}); err != nil {
		return err
	}

	rows, err = tx.Query(ctx, `
		SELECT category, SUM(paid_amount) FROM payables
		WHERE status = 'paid' AND paid_at BETWEEN $1::date AND $2::date
		GROUP BY category ORDER BY SUM(paid_amount) DESC`, s.From, s.To)
	if err != nil {
		return err
	}
	if s.ExpensesByCategory, err = db.CollectRows(rows, func(r db.Row) (CategoryTotal, error) {
		var m CategoryTotal
		return m, r.Scan(&m.Category, &m.Total)
	}); err != nil {
		return err
	}

	rows, err = tx.Query(ctx, `
		WITH days AS (SELECT generate_series($1::date, $2::date, '1 day')::date AS d),
		     inflow AS (SELECT created_at::date AS d, SUM(total) AS v FROM sales WHERE `+salesInPeriod+` GROUP BY 1),
		     outflow AS (SELECT paid_at AS d, SUM(paid_amount) AS v FROM payables
		                 WHERE status = 'paid' AND paid_at BETWEEN $1::date AND $2::date GROUP BY 1)
		SELECT to_char(days.d, 'YYYY-MM-DD'), COALESCE(inflow.v, 0), COALESCE(outflow.v, 0)
		FROM days LEFT JOIN inflow ON inflow.d = days.d LEFT JOIN outflow ON outflow.d = days.d
		ORDER BY days.d`, s.From, s.To)
	if err != nil {
		return err
	}
	var running float64
	if s.Daily, err = db.CollectRows(rows, func(r db.Row) (DailyRow, error) {
		var d DailyRow
		if err := r.Scan(&d.Date, &d.Inflow, &d.Outflow); err != nil {
			return d, err
		}
		running += d.Inflow - d.Outflow
		d.Balance = httpx.Round2(running)
		return d, nil
	}); err != nil {
		return err
	}

	rows, err = tx.Query(ctx, `
		SELECT u.id, u.name, SUM(s.total), COUNT(*), u.commission_pct
		FROM sales s JOIN users u ON u.id = s.seller_id
		WHERE s.status = 'completed' AND s.created_at::date BETWEEN $1::date AND $2::date
		GROUP BY u.id, u.name, u.commission_pct ORDER BY SUM(s.total) DESC`, s.From, s.To)
	if err != nil {
		return err
	}
	if s.Commissions, err = db.CollectRows(rows, func(r db.Row) (Commission, error) {
		var m Commission
		if err := r.Scan(&m.SellerID, &m.SellerName, &m.SalesTotal, &m.SalesCount, &m.CommissionPct); err != nil {
			return m, err
		}
		m.Commission = httpx.Round2(m.SalesTotal * m.CommissionPct / 100)
		return m, nil
	}); err != nil {
		return err
	}

	s.GrossProfit = httpx.Round2(s.Revenue - s.COGS)
	if s.Revenue > 0 {
		s.AvgTicket = httpx.Round2(s.Revenue / float64(s.SalesCount))
		s.GrossMarginPct = httpx.Round2(s.GrossProfit / s.Revenue * 100)
	}
	s.NetResult = httpx.Round2(s.GrossProfit - s.OperatingExpenses)
	return nil
}
