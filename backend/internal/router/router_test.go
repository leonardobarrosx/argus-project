package router_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/config"
	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/router"
)

// Integration tests run against a real PostgreSQL:
//
//	TEST_DATABASE_URL       owner connection (runs migrations)            [required]
//	TEST_APP_DATABASE_URL   restricted role used by the API (RLS enforced) [optional]
//
// Without TEST_DATABASE_URL the tests are skipped.

var (
	srv     *httptest.Server
	appPool *pgxpool.Pool
	seq     atomic.Int64
)

func TestMain(m *testing.M) {
	ownerURL := os.Getenv("TEST_DATABASE_URL")
	if ownerURL == "" {
		fmt.Println("TEST_DATABASE_URL not set: skipping integration tests")
		os.Exit(0)
	}
	gin.SetMode(gin.TestMode)
	ctx := context.Background()
	owner, err := db.Connect(ctx, ownerURL, "America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	if _, err := db.Migrate(ctx, owner, "argus_app"); err != nil {
		panic(err)
	}
	owner.Close()

	appURL := os.Getenv("TEST_APP_DATABASE_URL")
	if appURL == "" {
		appURL = ownerURL
	}
	appPool, err = db.Connect(ctx, appURL, "America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	cfg := &config.Config{
		JWTSecret: "test-secret-test-secret-test-secret-123", JWTAccessExpiryMinutes: 15, JWTRefreshExpiryDays: 7,
		CookieSecure: false, GinMode: gin.TestMode, CORSOrigins: "http://localhost:5173",
		RateLimitRate: 1000, RateLimitBurst: 1000, LoginPerMinute: 10000, RegisterPerHour: 100000,
	}
	srv = httptest.NewServer(router.New(cfg, appPool))
	code := m.Run()
	srv.Close()
	appPool.Close()
	os.Exit(code)
}

// client is a logged-in API client with its own cookie jar.
type client struct {
	t     *testing.T
	http  *http.Client
	token string
}

func newClient(t *testing.T) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, http: &http.Client{Jar: jar, Timeout: 15 * time.Second}}
}

func (c *client) do(method, path string, body any) (int, map[string]any) {
	c.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, srv.URL+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	raw, _ := io.ReadAll(res.Body)
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return res.StatusCode, out
}

func (c *client) must(status int, method, path string, body any) map[string]any {
	c.t.Helper()
	got, out := c.do(method, path, body)
	if got != status {
		c.t.Fatalf("%s %s: want %d, got %d: %v", method, path, status, got, out)
	}
	return out
}

func uniqueEmail(prefix string) string {
	return fmt.Sprintf("%s-%d-%d@test.argus", prefix, time.Now().UnixNano(), seq.Add(1))
}

func register(t *testing.T, store string) (*client, string) {
	c := newClient(t)
	email := uniqueEmail("owner")
	out := c.must(201, "POST", "/api/auth/register", map[string]any{
		"storeName": store, "name": "Dona Teste", "email": email, "password": "senha-forte-1",
	})
	c.token = out["token"].(map[string]any)["accessToken"].(string)
	return c, email
}

func id(m map[string]any, key string) int64 {
	return int64(m[key].(map[string]any)["id"].(float64))
}

func num(v any) float64 { return v.(float64) }

func TestAuthLifecycle(t *testing.T) {
	c, email := register(t, "Ótica Auth")

	me := c.must(200, "GET", "/api/auth/me", nil)
	if me["user"].(map[string]any)["role"] != "proprietario" {
		t.Fatalf("owner role expected: %v", me)
	}
	if me["tenant"].(map[string]any)["name"] != "Ótica Auth" {
		t.Fatalf("tenant name: %v", me)
	}

	// Refresh uses the httpOnly cookie and rotates it.
	ref := c.must(200, "POST", "/api/auth/refresh", nil)
	c.token = ref["token"].(map[string]any)["accessToken"].(string)
	c.must(200, "GET", "/api/bootstrap", nil)

	// Wrong password and duplicated e-mail.
	anon := newClient(t)
	anon.must(401, "POST", "/api/auth/login", map[string]any{"email": email, "password": "errada-123"})
	anon.must(409, "POST", "/api/auth/register", map[string]any{"storeName": "Xy", "name": "Y Z", "email": email, "password": "senha-forte-1"})
	anon.must(200, "POST", "/api/auth/login", map[string]any{"email": email, "password": "senha-forte-1"})

	// Change password keeps this device signed in.
	c.must(401, "POST", "/api/auth/change-password", map[string]any{"currentPassword": "nope-nope", "newPassword": "nova-senha-123"})
	c.must(204, "POST", "/api/auth/change-password", map[string]any{"currentPassword": "senha-forte-1", "newPassword": "nova-senha-123"})
	c.must(200, "POST", "/api/auth/refresh", nil)
	anon.must(401, "POST", "/api/auth/refresh", nil) // other device was signed out

	// Logout revokes the refresh token.
	c.must(204, "POST", "/api/auth/logout", nil)
	c.must(401, "POST", "/api/auth/refresh", nil)

	// No token → 401.
	newClient(t).must(401, "GET", "/api/bootstrap", nil)
}

func TestSaleOrderPaymentDeliveryFlow(t *testing.T) {
	c, _ := register(t, "Ótica Fluxo")

	sup := c.must(201, "POST", "/api/suppliers", map[string]any{"name": "Luxottica", "creditTerm": 30})
	supID := id(sup, "supplier")
	frame := c.must(201, "POST", "/api/products", map[string]any{
		"name": "Armação Teste", "category": "Armações", "price": 300, "costPrice": 100, "min": 2, "supplierId": supID,
	})
	frameID := id(frame, "product")
	acc := c.must(201, "POST", "/api/products", map[string]any{"name": "Estojo", "category": "Acessórios", "price": 40, "costPrice": 10})
	accID := id(acc, "product")

	entry := c.must(201, "POST", "/api/stock/entries", map[string]any{
		"invoiceNumber": "NF-1", "supplierId": supID, "createPayable": true,
		"items": []map[string]any{{"productId": frameID, "qty": 5, "costPrice": 110}, {"productId": accID, "qty": 10}},
	})
	payable := entry["payable"].(map[string]any)
	if num(payable["amount"]) != 5*110+10*10 || payable["category"] != "Mercadorias" {
		t.Fatalf("payable from entry: %v", payable)
	}

	client := c.must(201, "POST", "/api/patients", map[string]any{"name": "Cliente Titular", "cpf": "111.222.333-44"})
	clientID := id(client, "patient")
	c.must(409, "POST", "/api/patients", map[string]any{"name": "Outro", "cpf": "111.222.333-44"})
	dep := c.must(201, "POST", "/api/patients", map[string]any{"name": "Filho Dependente", "parentId": clientID})
	depID := id(dep, "patient")

	today := time.Now().Format("2006-01-02")
	rx := c.must(201, "POST", "/api/prescriptions", map[string]any{
		"patientId": depID, "examDate": today, "lensType": "Simples",
		"rxOD": map[string]string{"sph": "-1.00"}, "rxOE": map[string]string{"sph": "-1.25"},
	})
	rxBody := rx["prescription"].(map[string]any)
	if rxBody["expiresAt"] != time.Now().AddDate(1, 0, 0).Format("2006-01-02") {
		t.Fatalf("default validity should be 12 months: %v", rxBody)
	}
	rxID := int64(num(rxBody["id"]))

	boot := c.must(200, "GET", "/api/bootstrap", nil)
	lensID := int64(num(boot["lenses"].([]any)[0].(map[string]any)["id"]))
	lensPrice := num(boot["lenses"].([]any)[0].(map[string]any)["price"])

	sale := map[string]any{
		"patientId":     clientID,
		"items":         []map[string]any{{"productId": accID, "qty": 2}},
		"glasses":       []map[string]any{{"beneficiaryId": depID, "frameProductId": frameID, "lensId": lensID, "prescriptionId": rxID}},
		"generateOs":    true,
		"osPaid":        false,
		"paymentMethod": "Dinheiro",
	}
	// Cash register closed → blocked.
	got, out := c.do("POST", "/api/sales", sale)
	if got != 422 || out["code"] != "CASH_CLOSED" {
		t.Fatalf("expected CASH_CLOSED, got %d %v", got, out)
	}
	c.must(201, "POST", "/api/cash/open", map[string]any{"openingAmount": 100})
	c.must(422, "POST", "/api/cash/open", map[string]any{"openingAmount": 100})

	res := c.must(201, "POST", "/api/sales", sale)
	s := res["sale"].(map[string]any)
	if num(s["total"]) != 80 {
		t.Fatalf("unpaid OS glasses must not be charged now; sale total = %v", s["total"])
	}
	ords := res["orders"].([]any)
	if len(ords) != 1 {
		t.Fatalf("one OS expected: %v", res)
	}
	os := ords[0].(map[string]any)
	if os["paid"] != false || num(os["total"]) != 300+lensPrice {
		t.Fatalf("OS should be unpaid with glasses value: %v", os)
	}
	number := int(num(os["number"]))

	// Beneficiary must belong to the client.
	stranger := c.must(201, "POST", "/api/patients", map[string]any{"name": "Estranho"})
	bad := map[string]any{"patientId": clientID, "paymentMethod": "PIX", "generateOs": true, "osPaid": true,
		"glasses": []map[string]any{{"beneficiaryId": id(stranger, "patient"), "frameProductId": frameID, "readyMade": true}}}
	if got, out := c.do("POST", "/api/sales", bad); got != 422 || out["code"] != "INVALID_BENEFICIARY" {
		t.Fatalf("expected INVALID_BENEFICIARY, got %d %v", got, out)
	}

	// Advance → ready; delivery blocked until paid.
	c.must(200, "POST", fmt.Sprintf("/api/orders/%d/advance", number), nil)
	if got, out := c.do("POST", fmt.Sprintf("/api/orders/%d/advance", number), nil); got != 422 || out["code"] != "ORDER_UNPAID" {
		t.Fatalf("expected ORDER_UNPAID, got %d %v", got, out)
	}
	pay := c.must(201, "POST", fmt.Sprintf("/api/orders/OS-%d/pay", number), map[string]any{"paymentMethod": "PIX"})
	if pay["order"].(map[string]any)["paid"] != true || num(pay["sale"].(map[string]any)["total"]) != 300+lensPrice {
		t.Fatalf("pay order: %v", pay)
	}
	c.must(422, "POST", fmt.Sprintf("/api/orders/%d/pay", number), map[string]any{"paymentMethod": "PIX"})
	delivered := c.must(200, "POST", fmt.Sprintf("/api/orders/%d/advance", number), nil)
	if delivered["order"].(map[string]any)["status"] != "delivered" {
		t.Fatalf("delivered expected: %v", delivered)
	}

	// Stock: frame 5-1 = 4, accessory 10-2 = 8.
	boot = c.must(200, "GET", "/api/bootstrap", nil)
	qty := map[int64]float64{}
	for _, p := range boot["products"].([]any) {
		pm := p.(map[string]any)
		qty[int64(num(pm["id"]))] = num(pm["qty"])
	}
	if qty[frameID] != 4 || qty[accID] != 8 {
		t.Fatalf("stock after sale: frame=%v acc=%v", qty[frameID], qty[accID])
	}

	// Cash: sangria above available cash is refused; closing stores expected.
	c.must(422, "POST", "/api/cash/movements", map[string]any{"type": "withdrawal", "amount": 1000, "reason": "teste"})
	c.must(201, "POST", "/api/cash/movements", map[string]any{"type": "withdrawal", "amount": 50, "reason": "Troco banco"})
	closed := c.must(200, "POST", "/api/cash/close", map[string]any{"closingAmount": 130})
	cs := closed["session"].(map[string]any)
	if num(cs["expectedAmount"]) != 100+80-50 {
		t.Fatalf("expected cash = opening + cash sales - withdrawals: %v", cs)
	}

	// Cancelling the accessory sale returns products to stock.
	saleID := int64(num(s["id"]))
	cancel := c.must(200, "POST", fmt.Sprintf("/api/sales/%d/cancel", saleID), map[string]any{"reason": "Cliente desistiu"})
	if cancel["sale"].(map[string]any)["status"] != "cancelled" {
		t.Fatalf("cancel: %v", cancel)
	}
	c.must(422, "POST", fmt.Sprintf("/api/sales/%d/cancel", saleID), map[string]any{"reason": "de novo"})
	for _, p := range cancel["products"].([]any) {
		pm := p.(map[string]any)
		if int64(num(pm["id"])) == accID && num(pm["qty"]) != 10 {
			t.Fatalf("accessory should be back to 10: %v", pm)
		}
	}

	// Finance summary counts the OS payment and the cancelled sale is excluded.
	sum := c.must(200, "GET", "/api/finance/summary", nil)["summary"].(map[string]any)
	if num(sum["revenue"]) != 300+lensPrice || num(sum["salesCount"]) != 1 {
		t.Fatalf("summary revenue: %v", sum)
	}
	if num(sum["payablesPending"]) != 650 {
		t.Fatalf("summary payables: %v", sum)
	}
}

func TestLabOrderAndCancellation(t *testing.T) {
	c, _ := register(t, "Ótica Lab")
	frame := id(c.must(201, "POST", "/api/products", map[string]any{"name": "Armação", "category": "Armações", "price": 200}), "product")
	lens := id(c.must(201, "POST", "/api/products", map[string]any{"name": "Lente estoque", "category": "Lentes", "price": 150}), "product")
	c.must(201, "POST", "/api/stock/entries", map[string]any{"items": []map[string]any{{"productId": frame, "qty": 2}, {"productId": lens, "qty": 4}}})

	// Manual adjustment needs a reason; physical count doesn't.
	c.must(422, "POST", "/api/stock/adjust", map[string]any{"productId": lens, "newQty": 3, "type": "adjust"})
	adj := c.must(200, "POST", "/api/stock/adjust", map[string]any{"productId": lens, "newQty": 3, "type": "adjust", "reason": "Quebra"})
	if mv := adj["movements"].([]any); len(mv) != 1 || mv[0].(map[string]any)["type"] != "out" {
		t.Fatalf("adjust movement: %v", adj)
	}
	c.must(200, "POST", "/api/stock/adjust", map[string]any{"productId": lens, "newQty": 4, "type": "count"})

	p := id(c.must(201, "POST", "/api/patients", map[string]any{"name": "Paciente Lab"}), "patient")
	today := time.Now().Format("2006-01-02")
	rx := id(c.must(201, "POST", "/api/prescriptions", map[string]any{"patientId": p, "examDate": today}), "prescription")
	old := id(c.must(201, "POST", "/api/prescriptions", map[string]any{
		"patientId": p, "examDate": time.Now().AddDate(-2, 0, 0).Format("2006-01-02"),
		"expiresAt": time.Now().AddDate(-1, 0, 0).Format("2006-01-02"),
	}), "prescription")

	body := map[string]any{"prescriptionId": rx, "frameProductId": frame, "lensProductId": lens, "lensQty": 2}
	created := c.must(201, "POST", "/api/orders", body)
	order := created["order"].(map[string]any)
	if num(order["total"]) != 350 || order["paid"] != false {
		t.Fatalf("lab OS defaults to frame+lens price, unpaid: %v", order)
	}
	if got, out := c.do("POST", "/api/orders", body); got != 422 || out["code"] != "ACTIVE_ORDER" {
		t.Fatalf("expected ACTIVE_ORDER, got %d %v", got, out)
	}
	body["prescriptionId"] = old
	if got, out := c.do("POST", "/api/orders", body); got != 422 || out["code"] != "EXPIRED_PRESCRIPTION" {
		t.Fatalf("expected EXPIRED_PRESCRIPTION, got %d %v", got, out)
	}

	number := int(num(order["number"]))
	cancelled := c.must(200, "POST", fmt.Sprintf("/api/orders/%d/cancel", number), map[string]any{"reason": "Erro de medida"})
	if cancelled["order"].(map[string]any)["status"] != "cancelled" {
		t.Fatalf("cancel: %v", cancelled)
	}
	qty := map[int64]float64{}
	for _, it := range cancelled["products"].([]any) {
		pm := it.(map[string]any)
		qty[int64(num(pm["id"]))] = num(pm["qty"])
	}
	if qty[frame] != 2 || qty[lens] != 4 {
		t.Fatalf("stock must be restored after cancel: %v", qty)
	}
	c.must(422, "POST", fmt.Sprintf("/api/orders/%d/advance", number), nil)

	// Insufficient stock is refused atomically.
	body["prescriptionId"] = rx
	body["lensQty"] = 2
	c.must(201, "POST", "/api/orders", body)
	rx2 := id(c.must(201, "POST", "/api/prescriptions", map[string]any{"patientId": p, "examDate": today}), "prescription")
	rx3 := id(c.must(201, "POST", "/api/prescriptions", map[string]any{"patientId": p, "examDate": today}), "prescription")
	body["prescriptionId"] = rx2
	c.must(201, "POST", "/api/orders", body)
	body["prescriptionId"] = rx3
	if got, out := c.do("POST", "/api/orders", body); got != 422 || out["code"] != "INSUFFICIENT_STOCK" {
		t.Fatalf("expected INSUFFICIENT_STOCK, got %d %v", got, out)
	}
}

func TestPermissionsAndIsolation(t *testing.T) {
	owner, _ := register(t, "Ótica A")
	other, _ := register(t, "Ótica B")

	pA := id(owner.must(201, "POST", "/api/patients", map[string]any{"name": "Paciente da A"}), "patient")

	// Ótica B cannot see or edit Ótica A's data.
	bootB := other.must(200, "GET", "/api/bootstrap", nil)
	if len(bootB["patients"].([]any)) != 0 {
		t.Fatalf("tenant B must not see tenant A patients: %v", bootB["patients"])
	}
	other.must(404, "PUT", fmt.Sprintf("/api/patients/%d", pA), map[string]any{"name": "Invasão"})
	other.must(422, "POST", "/api/prescriptions", map[string]any{"patientId": pA, "examDate": time.Now().Format("2006-01-02")})

	// RLS: with tenant B in the session the restricted role sees nothing of A.
	if os.Getenv("TEST_APP_DATABASE_URL") != "" {
		var tenantB int64 = int64(num(bootB["tenant"].(map[string]any)["id"]))
		var count int
		err := db.TenantTx(context.Background(), appPool, tenantB, func(tx pgx.Tx) error {
			return tx.QueryRow(context.Background(), `SELECT COUNT(*) FROM patients WHERE id=$1`, pA).Scan(&count)
		})
		if err != nil || count != 0 {
			t.Fatalf("RLS leak: count=%d err=%v", count, err)
		}
	}

	// A seller has restricted access.
	sellerEmail := uniqueEmail("seller")
	owner.must(201, "POST", "/api/users", map[string]any{"name": "Vendedor", "email": sellerEmail, "role": "vendedor", "password": "senha-vend-1", "commissionPct": 5})
	seller := newClient(t)
	out := seller.must(200, "POST", "/api/auth/login", map[string]any{"email": sellerEmail, "password": "senha-vend-1"})
	seller.token = out["token"].(map[string]any)["accessToken"].(string)
	seller.must(403, "POST", "/api/products", map[string]any{"name": "X", "category": "Acessórios", "price": 1})
	seller.must(403, "GET", "/api/payables", nil)
	seller.must(403, "PUT", "/api/tenant", map[string]any{"name": "Hack", "rxValidityMonths": 12})
	seller.must(403, "POST", "/api/users", map[string]any{"name": "Outro", "role": "gerente"})
	seller.must(201, "POST", "/api/patients", map[string]any{"name": "Cliente do vendedor"})
	if b := seller.must(200, "GET", "/api/bootstrap", nil); len(b["payables"].([]any)) != 0 {
		t.Fatalf("seller must not receive payables")
	}

	// A manager cannot create an owner; the owner cannot deactivate itself.
	mgrEmail := uniqueEmail("mgr")
	owner.must(201, "POST", "/api/users", map[string]any{"name": "Gerente", "email": mgrEmail, "role": "gerente", "password": "senha-ger-12"})
	mgr := newClient(t)
	out = mgr.must(200, "POST", "/api/auth/login", map[string]any{"email": mgrEmail, "password": "senha-ger-12"})
	mgr.token = out["token"].(map[string]any)["accessToken"].(string)
	mgr.must(403, "POST", "/api/users", map[string]any{"name": "Novo Dono", "role": "proprietario"})
	ownerID := int64(num(owner.must(200, "GET", "/api/auth/me", nil)["user"].(map[string]any)["id"]))
	owner.must(422, "POST", fmt.Sprintf("/api/users/%d/toggle-active", ownerID), nil)

	// The same login e-mail cannot be reused across óticas.
	other.must(409, "POST", "/api/users", map[string]any{"name": "Clone", "email": sellerEmail, "role": "vendedor", "password": "senha-vend-1"})
}
