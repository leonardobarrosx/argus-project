// Package bootstrap returns, in a single round trip, everything the web app
// needs to render after login.
package bootstrap

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/cash"
	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/finance"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
	"github.com/leonardobarrosx/argus/backend/internal/orders"
	"github.com/leonardobarrosx/argus/backend/internal/patients"
	"github.com/leonardobarrosx/argus/backend/internal/sales"
	"github.com/leonardobarrosx/argus/backend/internal/stock"
	"github.com/leonardobarrosx/argus/backend/internal/suppliers"
	"github.com/leonardobarrosx/argus/backend/internal/team"
	"github.com/leonardobarrosx/argus/backend/internal/tenant"
)

// MovementLimit caps how many stock movements are sent on bootstrap.
const MovementLimit = 5000

// Data is the bootstrap payload.
type Data struct {
	Tenant        tenant.Tenant           `json:"tenant"`
	User          team.Member             `json:"user"`
	Users         []team.Member           `json:"users"`
	Patients      []patients.Patient      `json:"patients"`
	Prescriptions []patients.Prescription `json:"prescriptions"`
	Products      []stock.Product         `json:"products"`
	Lenses        []stock.Lens            `json:"lenses"`
	Movements     []stock.Movement        `json:"movements"`
	Suppliers     []suppliers.Supplier    `json:"suppliers"`
	Orders        []orders.Order          `json:"orders"`
	Sales         []sales.Sale            `json:"sales"`
	Payables      []finance.Payable       `json:"payables"`
	CashSession   *cash.Session           `json:"cashSession"`
}

// Handler serves GET /api/bootstrap.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a bootstrap Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the bootstrap route.
func Register(rg *gin.RouterGroup, h *Handler) { rg.GET("/bootstrap", h.Get) }

// Get loads all tenant data in one RLS-scoped, read-only transaction.
func (h *Handler) Get(c *gin.Context) {
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var d Data
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SET TRANSACTION READ ONLY`); err != nil {
			return err
		}
		var err error
		if d.Tenant, err = tenant.Get(ctx, tx, a.TenantID); err != nil {
			return err
		}
		if d.User, err = team.Get(ctx, tx, a.UserID); err != nil {
			return err
		}
		if d.Users, err = team.List(ctx, tx); err != nil {
			return err
		}
		if d.Patients, err = patients.ListPatients(ctx, tx); err != nil {
			return err
		}
		if d.Prescriptions, err = patients.ListPrescriptions(ctx, tx); err != nil {
			return err
		}
		if d.Products, err = stock.ListProducts(ctx, tx); err != nil {
			return err
		}
		if d.Lenses, err = stock.ListLenses(ctx, tx); err != nil {
			return err
		}
		if d.Movements, err = stock.ListMovements(ctx, tx, MovementLimit); err != nil {
			return err
		}
		if d.Suppliers, err = suppliers.List(ctx, tx); err != nil {
			return err
		}
		if d.Orders, err = orders.List(ctx, tx); err != nil {
			return err
		}
		if d.Sales, err = sales.List(ctx, tx); err != nil {
			return err
		}
		if a.IsManager() {
			if d.Payables, err = finance.ListPayables(ctx, tx); err != nil {
				return err
			}
		} else {
			d.Payables = []finance.Payable{}
		}
		d.CashSession, err = cash.CurrentWithSummary(ctx, tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}
