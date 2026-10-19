// Package sales implements the point of sale (PDV): sales of products and
// complete glasses (frame + lens + prescription), service-order generation,
// payment of open service orders and sale cancellation.
package sales

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

	"github.com/leonardobarrosx/argus/backend/internal/cash"
	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
	"github.com/leonardobarrosx/argus/backend/internal/orders"
	"github.com/leonardobarrosx/argus/backend/internal/stock"
)

// PaymentMethods accepted by the PDV.
var PaymentMethods = []string{"Dinheiro", "PIX", "Cartão crédito", "Cartão débito", "Boleto", "Crediário"}

func validMethod(m string) bool {
	for _, v := range PaymentMethods {
		if v == m {
			return true
		}
	}
	return false
}

// Item is a sale line.
type Item struct {
	ID             int64   `json:"id"`
	Kind           string  `json:"kind"`
	ProductID      *int64  `json:"productId"`
	LensID         *int64  `json:"lensId"`
	BeneficiaryID  *int64  `json:"beneficiaryId"`
	PrescriptionID *int64  `json:"prescriptionId"`
	Name           string  `json:"name"`
	Price          float64 `json:"price"`
	Cost           float64 `json:"cost"`
	Qty            int     `json:"qty"`
}

// Sale is a completed (or cancelled) sale.
type Sale struct {
	ID            int64     `json:"id"`
	PatientID     *int64    `json:"patientId"`
	OrderNumber   *int      `json:"orderNumber"`
	SessionID     *int64    `json:"sessionId"`
	SellerID      *int64    `json:"sellerId"`
	SellerName    string    `json:"sellerName"`
	Subtotal      float64   `json:"subtotal"`
	Discount      float64   `json:"discount"`
	Total         float64   `json:"total"`
	PaymentMethod string    `json:"paymentMethod"`
	Status        string    `json:"status"`
	CancelReason  string    `json:"cancelReason"`
	CreatedAt     time.Time `json:"createdAt"`
	Items         []Item    `json:"items"`
}

const saleColumns = `id, patient_id, (SELECT so.number FROM service_orders so WHERE so.id = sales.order_id), session_id,
	seller_id, seller_name, subtotal, discount, total, payment_method, status, cancel_reason, created_at`

func scanSale(row db.Row) (Sale, error) {
	var s Sale
	err := row.Scan(&s.ID, &s.PatientID, &s.OrderNumber, &s.SessionID, &s.SellerID, &s.SellerName, &s.Subtotal,
		&s.Discount, &s.Total, &s.PaymentMethod, &s.Status, &s.CancelReason, &s.CreatedAt)
	s.Items = []Item{}
	return s, err
}

const itemColumns = `id, sale_id, kind, product_id, lens_id, beneficiary_id, prescription_id, name, unit_price, unit_cost, qty`

func scanItem(row db.Row) (int64, Item, error) {
	var it Item
	var saleID int64
	err := row.Scan(&it.ID, &saleID, &it.Kind, &it.ProductID, &it.LensID, &it.BeneficiaryID, &it.PrescriptionID,
		&it.Name, &it.Price, &it.Cost, &it.Qty)
	return saleID, it, err
}

func attachItems(ctx context.Context, tx pgx.Tx, list []Sale) error {
	if len(list) == 0 {
		return nil
	}
	idx := make(map[int64]int, len(list))
	ids := make([]int64, len(list))
	for i, s := range list {
		idx[s.ID] = i
		ids[i] = s.ID
	}
	rows, err := tx.Query(ctx, `SELECT `+itemColumns+` FROM sale_items WHERE sale_id = ANY($1) ORDER BY id`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		saleID, it, err := scanItem(rows)
		if err != nil {
			return err
		}
		if i, ok := idx[saleID]; ok {
			list[i].Items = append(list[i].Items, it)
		}
	}
	return rows.Err()
}

// List returns every sale with its items (newest first).
func List(ctx context.Context, tx pgx.Tx) ([]Sale, error) {
	rows, err := tx.Query(ctx, `SELECT `+saleColumns+` FROM sales ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	out, err := db.CollectRows(rows, scanSale)
	if err != nil {
		return nil, err
	}
	return out, attachItems(ctx, tx, out)
}

// Get loads one sale with items.
func Get(ctx context.Context, tx pgx.Tx, id int64, lock bool) (Sale, error) {
	q := `SELECT ` + saleColumns + ` FROM sales WHERE id=$1`
	if lock {
		q += ` FOR UPDATE`
	}
	s, err := scanSale(tx.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return s, httpx.ErrNotFound
	}
	if err != nil {
		return s, err
	}
	list := []Sale{s}
	if err := attachItems(ctx, tx, list); err != nil {
		return s, err
	}
	return list[0], nil
}

type newItem struct {
	Kind           string
	ProductID      *int64
	LensID         *int64
	BeneficiaryID  *int64
	PrescriptionID *int64
	Name           string
	Price          float64
	Cost           float64
	Qty            int
}

func insertSale(ctx context.Context, tx pgx.Tx, a middleware.Actor, patientID, orderID, sessionID *int64,
	items []newItem, discount float64, method string) (Sale, error) {
	var subtotal float64
	for _, it := range items {
		subtotal += it.Price * float64(it.Qty)
	}
	subtotal = httpx.Round2(subtotal)
	discount = httpx.Round2(discount)
	if discount > subtotal {
		return Sale{}, httpx.Unprocessable("INVALID_DISCOUNT", "desconto maior que o valor da venda")
	}
	var id int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO sales (tenant_id, patient_id, order_id, session_id, seller_id, seller_name, subtotal, discount, total, payment_method)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
		a.TenantID, patientID, orderID, sessionID, a.UserID, a.Name, subtotal, discount, httpx.Round2(subtotal-discount), method).
		Scan(&id); err != nil {
		return Sale{}, err
	}
	for _, it := range items {
		if _, err := tx.Exec(ctx, `
			INSERT INTO sale_items (tenant_id, sale_id, kind, product_id, lens_id, beneficiary_id, prescription_id, name, unit_price, unit_cost, qty)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			a.TenantID, id, it.Kind, it.ProductID, it.LensID, it.BeneficiaryID, it.PrescriptionID, it.Name,
			httpx.Round2(it.Price), httpx.Round2(it.Cost), it.Qty); err != nil {
			return Sale{}, err
		}
	}
	return Get(ctx, tx, id, false)
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

// Handler exposes the sales routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a sales Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the sales routes.
func Register(rg *gin.RouterGroup, h *Handler) {
	rg.GET("/sales", h.List)
	rg.POST("/sales", middleware.Role(middleware.Sellers...), h.Create)
	rg.POST("/sales/:id/cancel", middleware.Role(middleware.Managers...), h.Cancel)
	rg.POST("/orders/:number/pay", middleware.Role(middleware.Sellers...), h.PayOrder)
}

// List — GET /api/sales
func (h *Handler) List(c *gin.Context) {
	a := middleware.GetActor(c)
	var out []Sale
	err := db.TenantTx(c.Request.Context(), h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		out, err = List(c.Request.Context(), tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"sales": out})
}

// CreateInput is a PDV checkout.
type CreateInput struct {
	PatientID int64 `json:"patientId" binding:"required,min=1"`
	Items     []struct {
		ProductID int64 `json:"productId" binding:"required,min=1"`
		Qty       int   `json:"qty" binding:"required,min=1,max=1000"`
	} `json:"items" binding:"max=100,dive"`
	Glasses []struct {
		BeneficiaryID  int64  `json:"beneficiaryId" binding:"required,min=1"`
		FrameProductID int64  `json:"frameProductId" binding:"required,min=1"`
		LensID         *int64 `json:"lensId"`
		PrescriptionID *int64 `json:"prescriptionId"`
		ReadyMade      bool   `json:"readyMade"`
	} `json:"glasses" binding:"max=20,dive"`
	GenerateOS    bool    `json:"generateOs"`
	OSPaid        bool    `json:"osPaid"`
	DueDate       string  `json:"dueDate"`
	PaymentMethod string  `json:"paymentMethod" binding:"required"`
	Discount      float64 `json:"discount" binding:"min=0"`
}

type checkoutResult struct {
	Sale      *Sale            `json:"sale"`
	Orders    []orders.Order   `json:"orders"`
	Products  []stock.Product  `json:"products"`
	Movements []stock.Movement `json:"movements"`
}

// Create finalizes a PDV sale.
//
// Rules:
//   - accessories/products are charged and leave stock immediately;
//   - each pair of glasses consumes its frame from stock;
//   - with generateOs, one OS is opened per pair; if osPaid is false the glasses
//     are NOT charged now and become a receivable on the OS (paid at delivery);
//   - a sale is only recorded when something is charged now, and requires an
//     open cash register when the ótica demands it.
//
// POST /api/sales
func (h *Handler) Create(c *gin.Context) {
	var in CreateInput
	if !httpx.Bind(c, &in) {
		return
	}
	if !validMethod(in.PaymentMethod) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_PAYMENT_METHOD", "forma de pagamento inválida"))
		return
	}
	if len(in.Items) == 0 && len(in.Glasses) == 0 {
		httpx.Fail(c, httpx.Unprocessable("EMPTY_CART", "carrinho vazio"))
		return
	}
	if !httpx.ValidDate(in.DueDate) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_DATE", "previsão de entrega inválida"))
		return
	}

	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	res := checkoutResult{Orders: []orders.Order{}, Products: []stock.Product{}, Movements: []stock.Movement{}}

	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var clientParent *int64
		if err := tx.QueryRow(ctx, `SELECT parent_id FROM patients WHERE id=$1`, in.PatientID).Scan(&clientParent); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return httpx.Unprocessable("INVALID_PATIENT", "cliente não encontrado")
			}
			return err
		}

		touched := map[int64]bool{}
		var charged []newItem

		for _, it := range in.Items {
			p, err := stock.GetProduct(ctx, tx, it.ProductID, true)
			if err != nil {
				return err
			}
			if !p.Active {
				return httpx.Unprocessable("INACTIVE_PRODUCT", p.Name+" está inativo")
			}
			id := p.ID
			charged = append(charged, newItem{Kind: "product", ProductID: &id, Name: p.Name, Price: p.Price, Cost: p.CostPrice, Qty: it.Qty})
		}

		type pair struct {
			frame       stock.Product
			lens        *stock.Lens
			beneficiary int64
			rx          *int64
			name        string
			price, cost float64
		}
		var pairs []pair
		for _, g := range in.Glasses {
			var benefParent *int64
			if err := tx.QueryRow(ctx, `SELECT parent_id FROM patients WHERE id=$1`, g.BeneficiaryID).Scan(&benefParent); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return httpx.Unprocessable("INVALID_BENEFICIARY", "beneficiário não encontrado")
				}
				return err
			}
			if g.BeneficiaryID != in.PatientID && (benefParent == nil || *benefParent != in.PatientID) {
				return httpx.Unprocessable("INVALID_BENEFICIARY", "o beneficiário deve ser o cliente ou um dependente dele")
			}
			var rx *int64
			if !g.ReadyMade {
				if g.PrescriptionID == nil {
					return httpx.Unprocessable("PRESCRIPTION_REQUIRED", "selecione a receita do beneficiário")
				}
				if err := orders.ValidPrescription(ctx, tx, *g.PrescriptionID, g.BeneficiaryID); err != nil {
					return err
				}
				rx = g.PrescriptionID
			}
			frame, err := stock.GetProduct(ctx, tx, g.FrameProductID, true)
			if err != nil {
				return err
			}
			if !frame.Active {
				return httpx.Unprocessable("INACTIVE_PRODUCT", frame.Name+" está inativo")
			}
			p := pair{frame: frame, beneficiary: g.BeneficiaryID, rx: rx, price: frame.Price, cost: frame.CostPrice}
			lensName := "Sem lente"
			if g.LensID != nil {
				l, err := stock.GetLens(ctx, tx, *g.LensID)
				if err != nil {
					return err
				}
				if !l.Active {
					return httpx.Unprocessable("INACTIVE_LENS", l.Name+" está inativa")
				}
				p.lens = &l
				p.price += l.Price
				p.cost += l.CostPrice
				lensName = l.Name
			}
			var benefName string
			if err := tx.QueryRow(ctx, `SELECT name FROM patients WHERE id=$1`, g.BeneficiaryID).Scan(&benefName); err != nil {
				return err
			}
			p.name = fmt.Sprintf("%s + %s (%s)", frame.Name, lensName, benefName)
			pairs = append(pairs, p)
		}

		chargeGlassesNow := !in.GenerateOS || in.OSPaid
		if chargeGlassesNow {
			for _, p := range pairs {
				fid, b := p.frame.ID, p.beneficiary
				var lid *int64
				if p.lens != nil {
					lid = &p.lens.ID
				}
				charged = append(charged, newItem{Kind: "glasses", ProductID: &fid, LensID: lid, BeneficiaryID: &b,
					PrescriptionID: p.rx, Name: p.name, Price: p.price, Cost: p.cost, Qty: 1})
			}
		}

		// Record the sale first (if anything is charged) so OSs can reference it.
		var sale *Sale
		if len(charged) > 0 {
			sessionID, err := cash.SessionForSale(ctx, tx, a.TenantID)
			if err != nil {
				return err
			}
			s, err := insertSale(ctx, tx, a, &in.PatientID, nil, sessionID, charged, in.Discount, in.PaymentMethod)
			if err != nil {
				return err
			}
			sale = &s
		} else if in.Discount > 0 {
			return httpx.Unprocessable("INVALID_DISCOUNT", "nada a cobrar agora: aplique o desconto no recebimento da OS")
		}

		// Products leave stock.
		for _, it := range in.Items {
			m, err := stock.Move(ctx, tx, a, it.ProductID, -it.Qty, "sale", "Venda PDV"+saleRef(sale), nil, nil, "")
			if err != nil {
				return err
			}
			res.Movements = append(res.Movements, m)
			touched[it.ProductID] = true
		}

		// Glasses: frame leaves stock; optionally one OS per pair.
		for _, p := range pairs {
			if in.GenerateOS {
				var lensID *int64
				lensDesc := ""
				if p.lens != nil {
					lensID, lensDesc = &p.lens.ID, p.lens.Name
				}
				fid := p.frame.ID
				var saleID *int64
				if in.OSPaid && sale != nil {
					saleID = &sale.ID
				}
				o, err := orders.Create(ctx, tx, a, orders.Insert{
					PatientID: p.beneficiary, PrescriptionID: p.rx, FrameProductID: &fid, LensID: lensID,
					LensDescription: lensDesc, Total: p.price, Paid: in.OSPaid, SaleID: saleID, DueDate: in.DueDate,
				})
				if err != nil {
					return err
				}
				res.Orders = append(res.Orders, o)
				m, err := stock.Move(ctx, tx, a, p.frame.ID, -1, "service_order", orders.Label(o.Number), &o.ID, p.rx, "")
				if err != nil {
					return err
				}
				res.Movements = append(res.Movements, m)
			} else {
				m, err := stock.Move(ctx, tx, a, p.frame.ID, -1, "sale", "Venda PDV (óculos)"+saleRef(sale), nil, p.rx, "")
				if err != nil {
					return err
				}
				res.Movements = append(res.Movements, m)
			}
			touched[p.frame.ID] = true
		}

		// Link the sale to its first OS (shown as "OS vinculada" in the UI).
		if sale != nil && in.OSPaid && len(res.Orders) > 0 {
			if _, err := tx.Exec(ctx, `UPDATE sales SET order_id=$2 WHERE id=$1`, sale.ID, res.Orders[0].ID); err != nil {
				return err
			}
			s, err := Get(ctx, tx, sale.ID, false)
			if err != nil {
				return err
			}
			sale = &s
		}
		res.Sale = sale

		for id := range touched {
			p, err := stock.GetProduct(ctx, tx, id, false)
			if err != nil {
				return err
			}
			res.Products = append(res.Products, p)
		}
		return nil
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func saleRef(s *Sale) string {
	if s == nil {
		return ""
	}
	return " #" + strconv.FormatInt(s.ID, 10)
}

// PayOrderInput receives an open OS.
type PayOrderInput struct {
	PaymentMethod string  `json:"paymentMethod" binding:"required"`
	Discount      float64 `json:"discount" binding:"min=0"`
}

// PayOrder charges an unpaid OS (creating a linked sale) so it can be delivered.
// POST /api/orders/:number/pay
func (h *Handler) PayOrder(c *gin.Context) {
	number, err := strconv.Atoi(strings.TrimPrefix(strings.ToUpper(c.Param("number")), "OS-"))
	if err != nil || number <= 0 {
		httpx.Fail(c, httpx.Errf(http.StatusBadRequest, "INVALID_ID", "número de OS inválido"))
		return
	}
	var in PayOrderInput
	if !httpx.Bind(c, &in) {
		return
	}
	if !validMethod(in.PaymentMethod) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_PAYMENT_METHOD", "forma de pagamento inválida"))
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var sale Sale
	var order orders.Order
	err = db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		o, err := orders.GetByNumber(ctx, tx, number, true)
		if err != nil {
			return err
		}
		if o.Status == "cancelled" {
			return httpx.Unprocessable("INVALID_STATUS", "OS cancelada")
		}
		if o.Paid {
			return httpx.Unprocessable("ORDER_PAID", "OS já está paga")
		}
		if o.Total <= 0 {
			return httpx.Unprocessable("ORDER_NO_VALUE", "OS sem valor a receber")
		}
		sessionID, err := cash.SessionForSale(ctx, tx, a.TenantID)
		if err != nil {
			return err
		}
		var patientID *int64
		if err := tx.QueryRow(ctx, `SELECT COALESCE(parent_id, id) FROM patients WHERE id=$1`, o.PatientID).Scan(&patientID); err != nil {
			return err
		}
		var cost float64
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE((SELECT cost_price FROM products WHERE id=$1), 0)
			     + COALESCE((SELECT cost_price * $3 FROM products WHERE id=$2), 0)
			     + COALESCE((SELECT cost_price FROM lenses WHERE id=$4), 0)`,
			o.FrameProductID, o.LensProductID, o.LensQtyUsed, o.LensID).Scan(&cost); err != nil {
			return err
		}
		benef := o.PatientID
		sale, err = insertSale(ctx, tx, a, patientID, &o.ID, sessionID, []newItem{{
			Kind: "service_order", BeneficiaryID: &benef, PrescriptionID: o.PrescriptionID, LensID: o.LensID,
			Name: "Recebimento " + orders.Label(o.Number), Price: o.Total, Cost: cost, Qty: 1,
		}}, in.Discount, in.PaymentMethod)
		if err != nil {
			return err
		}
		order, err = orders.Scan(tx.QueryRow(ctx, `UPDATE service_orders SET paid=true, sale_id=$2 WHERE id=$1 RETURNING `+orders.Columns, o.ID, sale.ID))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"sale": sale, "order": order})
}

// CancelInput cancels a sale.
type CancelInput struct {
	Reason string `json:"reason" binding:"required,min=3,max=300"`
}

// Cancel cancels a sale: products return to stock, OSs created by the sale are
// cancelled (frames return to stock) and an OS payment is reverted to unpaid.
// POST /api/sales/:id/cancel
func (h *Handler) Cancel(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in CancelInput
	if !httpx.Bind(c, &in) {
		return
	}
	reason := strings.TrimSpace(in.Reason)
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	res := struct {
		Sale      Sale             `json:"sale"`
		Orders    []orders.Order   `json:"orders"`
		Products  []stock.Product  `json:"products"`
		Movements []stock.Movement `json:"movements"`
	}{Orders: []orders.Order{}, Products: []stock.Product{}, Movements: []stock.Movement{}}

	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		s, err := Get(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if s.Status == "cancelled" {
			return httpx.Unprocessable("INVALID_STATUS", "venda já cancelada")
		}
		rows, err := tx.Query(ctx, `SELECT `+orders.Columns+` FROM service_orders WHERE sale_id=$1 FOR UPDATE`, s.ID)
		if err != nil {
			return err
		}
		linked, err := db.CollectRows(rows, orders.Scan)
		if err != nil {
			return err
		}
		for _, o := range linked {
			if o.Status == "delivered" {
				return httpx.Unprocessable("ORDER_DELIVERED", orders.Label(o.Number)+" já foi entregue: cancelamento não permitido")
			}
		}
		note := fmt.Sprintf("Cancelamento venda #%d: %s", s.ID, reason)
		touched := map[int64]bool{}
		isOrderPayment := len(s.Items) > 0 && s.Items[0].Kind == "service_order"

		for _, o := range linked {
			if isOrderPayment {
				// Revert payment only: the OS goes back to "a receber".
				uo, err := orders.Scan(tx.QueryRow(ctx, `UPDATE service_orders SET paid=false, sale_id=NULL WHERE id=$1 RETURNING `+orders.Columns, o.ID))
				if err != nil {
					return err
				}
				res.Orders = append(res.Orders, uo)
				continue
			}
			mv, prods, err := orders.Restock(ctx, tx, a, o, note)
			if err != nil {
				return err
			}
			res.Movements = append(res.Movements, mv...)
			for _, p := range prods {
				touched[p.ID] = true
			}
			uo, err := orders.Scan(tx.QueryRow(ctx, `
				UPDATE service_orders SET status='cancelled', paid=false, notes = TRIM(notes || ' [Venda cancelada]')
				WHERE id=$1 RETURNING `+orders.Columns, o.ID))
			if err != nil {
				return err
			}
			res.Orders = append(res.Orders, uo)
		}

		for _, it := range s.Items {
			if it.ProductID == nil {
				continue
			}
			switch it.Kind {
			case "product":
				// handled below
			case "glasses":
				if len(linked) > 0 {
					continue // frame already returned with its OS
				}
			default:
				continue
			}
			m, err := stock.Move(ctx, tx, a, *it.ProductID, it.Qty, "sale_cancel", note, nil, it.PrescriptionID, "")
			if err != nil {
				return err
			}
			res.Movements = append(res.Movements, m)
			touched[*it.ProductID] = true
		}

		if _, err := tx.Exec(ctx, `UPDATE sales SET status='cancelled', cancel_reason=$2 WHERE id=$1`, s.ID, reason); err != nil {
			return err
		}
		if res.Sale, err = Get(ctx, tx, s.ID, false); err != nil {
			return err
		}
		for pid := range touched {
			p, err := stock.GetProduct(ctx, tx, pid, false)
			if err != nil {
				return err
			}
			res.Products = append(res.Products, p)
		}
		return nil
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
