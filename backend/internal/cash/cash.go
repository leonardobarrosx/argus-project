// Package cash handles the cash register (caixa): opening, closing,
// withdrawals (sangria) and deposits (suprimento).
package cash

import (
	"context"
	"errors"
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

// CashMethod is the payment method counted as physical cash in the drawer.
const CashMethod = "Dinheiro"

// Session is a cash register session.
type Session struct {
	ID             int64      `json:"id"`
	OpenedByName   string     `json:"openedByName"`
	ClosedByName   string     `json:"closedByName"`
	OpeningAmount  float64    `json:"openingAmount"`
	ClosingAmount  *float64   `json:"closingAmount"`
	ExpectedAmount *float64   `json:"expectedAmount"`
	Notes          string     `json:"notes"`
	OpenedAt       time.Time  `json:"openedAt"`
	ClosedAt       *time.Time `json:"closedAt"`
	Summary        *Summary   `json:"summary,omitempty"`
}

// Summary aggregates a session's activity.
type Summary struct {
	SalesTotal   float64       `json:"salesTotal"`
	SalesCount   int           `json:"salesCount"`
	ByMethod     []MethodTotal `json:"byMethod"`
	CashSales    float64       `json:"cashSales"`
	Deposits     float64       `json:"deposits"`
	Withdrawals  float64       `json:"withdrawals"`
	ExpectedCash float64       `json:"expectedCash"`
	Movements    []Movement    `json:"movements"`
}

// MethodTotal aggregates sales by payment method.
type MethodTotal struct {
	Method string  `json:"method"`
	Total  float64 `json:"total"`
	Count  int     `json:"count"`
}

// Movement is a withdrawal or deposit.
type Movement struct {
	ID        int64     `json:"id"`
	Type      string    `json:"type"`
	Amount    float64   `json:"amount"`
	Reason    string    `json:"reason"`
	UserName  string    `json:"userName"`
	CreatedAt time.Time `json:"createdAt"`
}

const sessionColumns = `id, opened_by_name, closed_by_name, opening_amount, closing_amount, expected_amount, notes, opened_at, closed_at`

func scanSession(row db.Row) (Session, error) {
	var s Session
	err := row.Scan(&s.ID, &s.OpenedByName, &s.ClosedByName, &s.OpeningAmount, &s.ClosingAmount, &s.ExpectedAmount, &s.Notes, &s.OpenedAt, &s.ClosedAt)
	return s, err
}

// OpenSession returns the open session (nil when the cash register is closed).
func OpenSession(ctx context.Context, tx pgx.Tx, lock bool) (*Session, error) {
	q := `SELECT ` + sessionColumns + ` FROM cash_sessions WHERE closed_at IS NULL LIMIT 1`
	if lock {
		q += ` FOR UPDATE`
	}
	s, err := scanSession(tx.QueryRow(ctx, q))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// SessionForSale returns the open session id to attach to a sale. When the
// ótica requires an open cash register and none is open, it fails.
func SessionForSale(ctx context.Context, tx pgx.Tx, tenantID int64) (*int64, error) {
	s, err := OpenSession(ctx, tx, false)
	if err != nil {
		return nil, err
	}
	if s != nil {
		return &s.ID, nil
	}
	var required bool
	if err := tx.QueryRow(ctx, `SELECT require_cash_session FROM tenants WHERE id=$1`, tenantID).Scan(&required); err != nil {
		return nil, err
	}
	if required {
		return nil, httpx.Unprocessable("CASH_CLOSED", "abra o caixa antes de registrar recebimentos")
	}
	return nil, nil
}

func summarize(ctx context.Context, tx pgx.Tx, s *Session) error {
	sum := Summary{}
	rows, err := tx.Query(ctx, `
		SELECT payment_method, SUM(total), COUNT(*) FROM sales
		WHERE session_id=$1 AND status='completed' GROUP BY payment_method ORDER BY SUM(total) DESC`, s.ID)
	if err != nil {
		return err
	}
	if sum.ByMethod, err = db.CollectRows(rows, func(r db.Row) (MethodTotal, error) {
		var m MethodTotal
		return m, r.Scan(&m.Method, &m.Total, &m.Count)
	}); err != nil {
		return err
	}
	for _, m := range sum.ByMethod {
		sum.SalesTotal += m.Total
		sum.SalesCount += m.Count
		if m.Method == CashMethod {
			sum.CashSales += m.Total
		}
	}
	rows, err = tx.Query(ctx, `
		SELECT id, type, amount, reason, user_name, created_at FROM cash_movements
		WHERE session_id=$1 ORDER BY created_at`, s.ID)
	if err != nil {
		return err
	}
	if sum.Movements, err = db.CollectRows(rows, func(r db.Row) (Movement, error) {
		var m Movement
		return m, r.Scan(&m.ID, &m.Type, &m.Amount, &m.Reason, &m.UserName, &m.CreatedAt)
	}); err != nil {
		return err
	}
	for _, m := range sum.Movements {
		if m.Type == "deposit" {
			sum.Deposits += m.Amount
		} else {
			sum.Withdrawals += m.Amount
		}
	}
	sum.SalesTotal = httpx.Round2(sum.SalesTotal)
	sum.ExpectedCash = httpx.Round2(s.OpeningAmount + sum.CashSales + sum.Deposits - sum.Withdrawals)
	s.Summary = &sum
	return nil
}

// Handler exposes the cash routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a cash Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the cash routes.
func Register(rg *gin.RouterGroup, h *Handler) {
	g := rg.Group("/cash")
	g.GET("/current", h.Current)
	g.POST("/open", middleware.Role(middleware.Sellers...), h.Open)
	g.POST("/close", middleware.Role(middleware.Sellers...), h.Close)
	g.POST("/movements", middleware.Role(middleware.Sellers...), h.AddMovement)
	g.GET("/sessions", middleware.Role(middleware.Managers...), h.History)
}

// Current returns the open session with its live summary (session=null when closed).
// GET /api/cash/current
func (h *Handler) Current(c *gin.Context) {
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var s *Session
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		s, err = CurrentWithSummary(ctx, tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": s})
}

// CurrentWithSummary returns the open session with its summary, or nil.
func CurrentWithSummary(ctx context.Context, tx pgx.Tx) (*Session, error) {
	s, err := OpenSession(ctx, tx, false)
	if err != nil || s == nil {
		return s, err
	}
	return s, summarize(ctx, tx, s)
}

// OpenInput opens the cash register.
type OpenInput struct {
	OpeningAmount float64 `json:"openingAmount" binding:"min=0"`
	Notes         string  `json:"notes" binding:"max=300"`
}

// Open opens a new session.
// POST /api/cash/open
func (h *Handler) Open(c *gin.Context) {
	var in OpenInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var s Session
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		open, err := OpenSession(ctx, tx, true)
		if err != nil {
			return err
		}
		if open != nil {
			return httpx.Unprocessable("CASH_ALREADY_OPEN", "já existe um caixa aberto")
		}
		s, err = scanSession(tx.QueryRow(ctx, `
			INSERT INTO cash_sessions (tenant_id, opened_by, opened_by_name, opening_amount, notes)
			VALUES ($1, $2, $3, $4, $5) RETURNING `+sessionColumns,
			a.TenantID, a.UserID, a.Name, httpx.Round2(in.OpeningAmount), strings.TrimSpace(in.Notes)))
		if err != nil {
			return err
		}
		return summarize(ctx, tx, &s)
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"session": s})
}

// CloseInput closes the cash register with the counted amount.
type CloseInput struct {
	ClosingAmount float64 `json:"closingAmount" binding:"min=0"`
	Notes         string  `json:"notes" binding:"max=300"`
}

// Close closes the open session, storing the expected vs counted amount.
// POST /api/cash/close
func (h *Handler) Close(c *gin.Context) {
	var in CloseInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var s Session
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		open, err := OpenSession(ctx, tx, true)
		if err != nil {
			return err
		}
		if open == nil {
			return httpx.Unprocessable("CASH_CLOSED", "não há caixa aberto")
		}
		if err := summarize(ctx, tx, open); err != nil {
			return err
		}
		notes := open.Notes
		if n := strings.TrimSpace(in.Notes); n != "" {
			if notes != "" {
				notes += " | "
			}
			notes += n
		}
		s, err = scanSession(tx.QueryRow(ctx, `
			UPDATE cash_sessions SET closed_at=NOW(), closed_by=$2, closed_by_name=$3,
			       closing_amount=$4, expected_amount=$5, notes=$6
			WHERE id=$1 RETURNING `+sessionColumns,
			open.ID, a.UserID, a.Name, httpx.Round2(in.ClosingAmount), open.Summary.ExpectedCash, notes))
		if err != nil {
			return err
		}
		s.Summary = open.Summary
		return nil
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"session": s})
}

// MovementInput is a withdrawal (sangria) or deposit (suprimento).
type MovementInput struct {
	Type   string  `json:"type" binding:"required,oneof=withdrawal deposit"`
	Amount float64 `json:"amount" binding:"gt=0"`
	Reason string  `json:"reason" binding:"required,min=3,max=200"`
}

// AddMovement records a withdrawal/deposit on the open session.
// POST /api/cash/movements
func (h *Handler) AddMovement(c *gin.Context) {
	var in MovementInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var s *Session
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		open, err := OpenSession(ctx, tx, true)
		if err != nil {
			return err
		}
		if open == nil {
			return httpx.Unprocessable("CASH_CLOSED", "não há caixa aberto")
		}
		if in.Type == "withdrawal" {
			if err := summarize(ctx, tx, open); err != nil {
				return err
			}
			if httpx.Round2(in.Amount) > open.Summary.ExpectedCash {
				return httpx.Unprocessable("INSUFFICIENT_CASH", "valor da sangria maior que o dinheiro em caixa")
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO cash_movements (tenant_id, session_id, type, amount, reason, user_id, user_name)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			a.TenantID, open.ID, in.Type, httpx.Round2(in.Amount), strings.TrimSpace(in.Reason), a.UserID, a.Name); err != nil {
			return err
		}
		s, err = CurrentWithSummary(ctx, tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"session": s})
}

// History lists the most recent sessions with their summaries.
// GET /api/cash/sessions
func (h *Handler) History(c *gin.Context) {
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var out []Session
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+sessionColumns+` FROM cash_sessions ORDER BY opened_at DESC LIMIT 60`)
		if err != nil {
			return err
		}
		if out, err = db.CollectRows(rows, scanSession); err != nil {
			return err
		}
		for i := range out {
			if err := summarize(ctx, tx, &out[i]); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"sessions": out})
}
