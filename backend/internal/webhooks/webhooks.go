package webhooks

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
	"github.com/leonardobarrosx/argus/backend/internal/secretbox"
)

// Webhook is a subscribed endpoint.
type Webhook struct {
	ID          int64      `json:"id"`
	URL         string     `json:"url"`
	Description string     `json:"description"`
	Events      []string   `json:"events"`
	Active      bool       `json:"active"`
	CreatedAt   time.Time  `json:"createdAt"`
	LastStatus  string     `json:"lastStatus"` // status of the latest delivery ("" when none)
	LastAt      *time.Time `json:"lastAt"`
	Failed24h   int        `json:"failed24h"`
	Pending     int        `json:"pending"`
}

const webhookColumns = `w.id, w.url, w.description, w.events, w.active, w.created_at,
	COALESCE((SELECT d.status FROM webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY d.id DESC LIMIT 1), ''),
	(SELECT d.created_at FROM webhook_deliveries d WHERE d.webhook_id = w.id ORDER BY d.id DESC LIMIT 1),
	(SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'failed' AND d.created_at > NOW() - interval '24 hours'),
	(SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'pending')`

func scanWebhook(row db.Row) (Webhook, error) {
	var w Webhook
	err := row.Scan(&w.ID, &w.URL, &w.Description, &w.Events, &w.Active, &w.CreatedAt, &w.LastStatus, &w.LastAt, &w.Failed24h, &w.Pending)
	if w.Events == nil {
		w.Events = []string{}
	}
	return w, err
}

func getWebhook(ctx context.Context, tx pgx.Tx, id int64) (Webhook, error) {
	return scanWebhook(tx.QueryRow(ctx, `SELECT `+webhookColumns+` FROM webhooks w WHERE w.id=$1`, id))
}

// Delivery is one attempt log entry.
type Delivery struct {
	ID             int64           `json:"id"`
	WebhookID      int64           `json:"webhookId"`
	EventID        string          `json:"eventId"`
	Event          string          `json:"event"`
	Payload        json.RawMessage `json:"payload"`
	Status         string          `json:"status"`
	Attempts       int             `json:"attempts"`
	NextAttemptAt  time.Time       `json:"nextAttemptAt"`
	ResponseStatus *int            `json:"responseStatus"`
	ResponseBody   string          `json:"responseBody"`
	Error          string          `json:"error"`
	DurationMs     *int            `json:"durationMs"`
	DeliveredAt    *time.Time      `json:"deliveredAt"`
	CreatedAt      time.Time       `json:"createdAt"`
}

const deliveryColumns = `id, webhook_id, event_id, event, payload::text, status, attempts, next_attempt_at,
	response_status, response_body, error, duration_ms, delivered_at, created_at`

func scanDelivery(row db.Row) (Delivery, error) {
	var d Delivery
	var payload string
	err := row.Scan(&d.ID, &d.WebhookID, &d.EventID, &d.Event, &payload, &d.Status, &d.Attempts, &d.NextAttemptAt,
		&d.ResponseStatus, &d.ResponseBody, &d.Error, &d.DurationMs, &d.DeliveredAt, &d.CreatedAt)
	d.Payload = json.RawMessage(payload)
	return d, err
}

// NewSecret returns a random signing secret.
func NewSecret() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return "whsec_" + hex.EncodeToString(b)
}

// Handler exposes the webhook management routes.
type Handler struct {
	pool         *pgxpool.Pool
	box          *secretbox.Box
	dispatcher   *Dispatcher
	allowPrivate bool
}

// NewHandler creates a webhooks Handler.
func NewHandler(pool *pgxpool.Pool, box *secretbox.Box, dispatcher *Dispatcher, allowPrivate bool) *Handler {
	return &Handler{pool: pool, box: box, dispatcher: dispatcher, allowPrivate: allowPrivate}
}

// Register mounts the routes (managers only).
func Register(rg *gin.RouterGroup, h *Handler) {
	g := rg.Group("/integrations", middleware.Role(middleware.Managers...))
	g.GET("/events", h.ListEvents)
	g.GET("/webhooks", h.List)
	g.POST("/webhooks", h.Create)
	g.PUT("/webhooks/:id", h.Update)
	g.DELETE("/webhooks/:id", h.Delete)
	g.GET("/webhooks/:id/secret", h.Secret)
	g.POST("/webhooks/:id/rotate-secret", h.RotateSecret)
	g.POST("/webhooks/:id/test", h.Test)
	g.GET("/webhooks/:id/deliveries", h.Deliveries)
	g.POST("/deliveries/:id/retry", h.Retry)
}

// Input is the create/update payload.
type Input struct {
	URL         string   `json:"url" binding:"required,max=500"`
	Description string   `json:"description" binding:"max=200"`
	Events      []string `json:"events" binding:"required,min=1,max=20"`
	Active      *bool    `json:"active"`
}

// ValidateURL checks the endpoint. Without allowPrivate it must be https and
// must not name a private address (the dialer re-checks after DNS).
func ValidateURL(raw string, allowPrivate bool) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || u.User != nil {
		return httpx.Unprocessable("INVALID_URL", "URL inválida")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !allowPrivate {
			return httpx.Unprocessable("INVALID_URL", "use uma URL https://")
		}
	default:
		return httpx.Unprocessable("INVALID_URL", "use uma URL https://")
	}
	if allowPrivate {
		return nil
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".local") {
		return httpx.Unprocessable("INVALID_URL", "o endereço precisa ser público")
	}
	if ip := net.ParseIP(host); ip != nil && !publicIP(ip) {
		return httpx.Unprocessable("INVALID_URL", "o endereço precisa ser público")
	}
	return nil
}

func normalizeEvents(in []string) ([]string, error) {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, e := range in {
		e = strings.TrimSpace(e)
		if !ValidEvent(e) {
			return nil, httpx.Unprocessable("INVALID_EVENT", "evento desconhecido: "+e)
		}
		if !seen[e] {
			seen[e] = true
			out = append(out, e)
		}
	}
	return out, nil
}

// ListEvents — GET /api/integrations/events
func (h *Handler) ListEvents(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"events": Events})
}

// List — GET /api/integrations/webhooks
func (h *Handler) List(c *gin.Context) {
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var out []Webhook
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+webhookColumns+` FROM webhooks w ORDER BY w.created_at DESC`)
		if err != nil {
			return err
		}
		out, err = db.CollectRows(rows, scanWebhook)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"webhooks": out})
}

// Create — POST /api/integrations/webhooks. The signing secret is returned.
func (h *Handler) Create(c *gin.Context) {
	var in Input
	if !httpx.Bind(c, &in) {
		return
	}
	if err := ValidateURL(in.URL, h.allowPrivate); err != nil {
		httpx.Fail(c, err)
		return
	}
	events, err := normalizeEvents(in.Events)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	secret := NewSecret()
	enc, err := h.box.Seal(secret)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var w Webhook
	err = db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM webhooks`).Scan(&n); err != nil {
			return err
		}
		if n >= 20 {
			return httpx.Unprocessable("LIMIT_REACHED", "limite de 20 webhooks por ótica")
		}
		var id int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO webhooks (tenant_id, url, description, events, secret_enc, created_by)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
			a.TenantID, strings.TrimSpace(in.URL), strings.TrimSpace(in.Description), events, enc, a.UserID).Scan(&id); err != nil {
			return err
		}
		w, err = getWebhook(ctx, tx, id)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"webhook": w, "secret": secret})
}

// Update — PUT /api/integrations/webhooks/:id
func (h *Handler) Update(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in Input
	if !httpx.Bind(c, &in) {
		return
	}
	if err := ValidateURL(in.URL, h.allowPrivate); err != nil {
		httpx.Fail(c, err)
		return
	}
	events, err := normalizeEvents(in.Events)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var w Webhook
	err = db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE webhooks SET url=$2, description=$3, events=$4, active=COALESCE($5, active), updated_at=NOW()
			WHERE id=$1`, id, strings.TrimSpace(in.URL), strings.TrimSpace(in.Description), events, in.Active)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.ErrNotFound
		}
		w, err = getWebhook(ctx, tx, id)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"webhook": w})
}

// Delete — DELETE /api/integrations/webhooks/:id (its deliveries go too).
func (h *Handler) Delete(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM webhooks WHERE id=$1`, id)
		if err == nil && tag.RowsAffected() == 0 {
			return httpx.ErrNotFound
		}
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) readSecret(ctx context.Context, tenantID, id int64) (string, error) {
	var enc string
	err := db.TenantTx(ctx, h.pool, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT secret_enc FROM webhooks WHERE id=$1`, id).Scan(&enc)
	})
	if err != nil {
		return "", err
	}
	return h.box.Open(enc)
}

// Secret — GET /api/integrations/webhooks/:id/secret
func (h *Handler) Secret(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	secret, err := h.readSecret(c.Request.Context(), middleware.GetActor(c).TenantID, id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"secret": secret})
}

// RotateSecret — POST /api/integrations/webhooks/:id/rotate-secret
func (h *Handler) RotateSecret(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	secret := NewSecret()
	enc, err := h.box.Seal(secret)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	err = db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE webhooks SET secret_enc=$2, updated_at=NOW() WHERE id=$1`, id, enc)
		if err == nil && tag.RowsAffected() == 0 {
			return httpx.ErrNotFound
		}
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"secret": secret})
}

// Test sends a "ping" event right away and returns the delivery result.
// POST /api/integrations/webhooks/:id/test
func (h *Handler) Test(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var deliveryID int64
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var url string
		if err := tx.QueryRow(ctx, `SELECT url FROM webhooks WHERE id=$1`, id).Scan(&url); err != nil {
			return err
		}
		evtID := newEventID()
		body, err := json.Marshal(Envelope{ID: evtID, Type: EventPing, CreatedAt: time.Now().UTC(),
			Data: gin.H{"message": "Teste de webhook do Argus", "webhookId": id, "requestedBy": a.Name}})
		if err != nil {
			return err
		}
		// locked_until keeps the background dispatcher away while we deliver it here.
		return tx.QueryRow(ctx, `
			INSERT INTO webhook_deliveries (tenant_id, webhook_id, event_id, event, payload, locked_until)
			VALUES ($1, $2, $3, $4, $5::jsonb, NOW() + interval '2 minutes') RETURNING id`,
			a.TenantID, id, evtID, EventPing, string(body)).Scan(&deliveryID)
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	d, err := h.dispatcher.Deliver(ctx, a.TenantID, deliveryID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"delivery": d})
}

// Deliveries — GET /api/integrations/webhooks/:id/deliveries (latest 50)
func (h *Handler) Deliveries(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var out []Delivery
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		if _, err := getWebhook(ctx, tx, id); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT `+deliveryColumns+` FROM webhook_deliveries WHERE webhook_id=$1 ORDER BY id DESC LIMIT 50`, id)
		if err != nil {
			return err
		}
		out, err = db.CollectRows(rows, scanDelivery)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"deliveries": out})
}

// Retry puts a failed delivery back in the queue for an immediate attempt.
// POST /api/integrations/deliveries/:id/retry
func (h *Handler) Retry(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var d Delivery
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		d, err = scanDelivery(tx.QueryRow(ctx, `
			UPDATE webhook_deliveries SET status='pending', next_attempt_at=NOW(), locked_until=NULL,
			       attempts = LEAST(attempts, $2 - 1)
			WHERE id=$1 AND status <> 'delivered' RETURNING `+deliveryColumns, id, MaxAttempts))
		if err == pgx.ErrNoRows {
			return httpx.Unprocessable("INVALID_STATUS", "entrega não encontrada ou já entregue")
		}
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"delivery": d})
}
