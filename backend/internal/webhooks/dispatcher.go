package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/secretbox"
)

// MaxAttempts is how many times a delivery is tried before it is marked failed.
const MaxAttempts = 6

// Backoff returns the wait before the next attempt (30s, 2m, 8m, 32m, ~2h).
func Backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	d := 30 * time.Second
	for i := 1; i < attempt; i++ {
		d *= 4
	}
	return d
}

// Sign returns the X-Argus-Signature header value for body sent at ts:
// "t=<unix>,v1=<hex(HMAC-SHA256(secret, "<unix>.<body>"))>". Receivers must
// recompute it and reject old timestamps to block replays.
func Sign(secret string, ts time.Time, body []byte) string {
	t := strconv.FormatInt(ts.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(t))
	mac.Write([]byte("."))
	mac.Write(body)
	return "t=" + t + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

var errBlockedAddress = errors.New("endereço de destino bloqueado (rede privada)")

// publicIP reports whether ip is routable on the public internet.
func publicIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		// 0.0.0.0/8, 100.64.0.0/10 (CGNAT) and 169.254.0.0/16 (cloud metadata).
		if v4[0] == 0 || (v4[0] == 100 && v4[1]&0xC0 == 64) || (v4[0] == 169 && v4[1] == 254) {
			return false
		}
	}
	return true
}

// NewHTTPClient builds the client used for deliveries. Unless allowPrivate is
// set, the dialer refuses any non-public IP after DNS resolution, so a webhook
// cannot be pointed at internal services (SSRF), not even through DNS
// rebinding or redirects (redirects are not followed).
func NewHTTPClient(allowPrivate bool) *http.Client {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			if allowPrivate {
				return nil
			}
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip == nil || !publicIP(ip) {
				return errBlockedAddress
			}
			return nil
		},
	}
	return &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           dialer.DialContext,
			TLSHandshakeTimeout:   5 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxIdleConns:          20,
			IdleConnTimeout:       60 * time.Second,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// Dispatcher delivers queued events.
type Dispatcher struct {
	pool     *pgxpool.Pool
	box      *secretbox.Box
	client   *http.Client
	Interval time.Duration
	Batch    int
}

// NewDispatcher creates a Dispatcher.
func NewDispatcher(pool *pgxpool.Pool, box *secretbox.Box, client *http.Client) *Dispatcher {
	return &Dispatcher{pool: pool, box: box, client: client, Interval: 3 * time.Second, Batch: 20}
}

// Run polls for due deliveries until ctx is cancelled.
func (d *Dispatcher) Run(ctx context.Context) {
	t := time.NewTicker(d.Interval)
	defer t.Stop()
	for {
		if _, err := d.RunOnce(ctx); err != nil && ctx.Err() == nil {
			log.Printf("webhooks: dispatch: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// RunOnce claims and delivers one batch of due deliveries, returning how many
// were attempted.
func (d *Dispatcher) RunOnce(ctx context.Context) (int, error) {
	rows, err := d.pool.Query(ctx, `SELECT delivery_id, tenant_id FROM webhook_claim_deliveries($1, $2)`, d.Batch, 120)
	if err != nil {
		return 0, err
	}
	type claim struct{ id, tenant int64 }
	var claims []claim
	for rows.Next() {
		var c claim
		if err := rows.Scan(&c.id, &c.tenant); err != nil {
			rows.Close()
			return 0, err
		}
		claims = append(claims, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, c := range claims {
		if _, err := d.Deliver(ctx, c.tenant, c.id); err != nil {
			log.Printf("webhooks: delivery %d: %v", c.id, err)
		}
	}
	return len(claims), nil
}

type pending struct {
	payload   string
	event     string
	eventID   string
	attempts  int
	url       string
	secretEnc string
	active    bool
}

// Deliver sends one delivery now and records the outcome.
func (d *Dispatcher) Deliver(ctx context.Context, tenantID, deliveryID int64) (Delivery, error) {
	var p pending
	err := db.TenantTx(ctx, d.pool, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT d.payload::text, d.event, d.event_id, d.attempts, w.url, w.secret_enc, w.active
			FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
			WHERE d.id = $1`, deliveryID).
			Scan(&p.payload, &p.event, &p.eventID, &p.attempts, &p.url, &p.secretEnc, &p.active)
	})
	if err != nil {
		return Delivery{}, err
	}

	attempt := p.attempts + 1
	var (
		status   *int
		respBody string
		errMsg   string
		elapsed  time.Duration
	)
	if !p.active {
		errMsg = "webhook desativado"
	} else if secret, oerr := d.box.Open(p.secretEnc); oerr != nil {
		errMsg = "não foi possível ler o segredo do webhook"
	} else {
		status, respBody, elapsed, errMsg = d.send(ctx, p, secret, deliveryID)
	}

	ok := status != nil && *status >= 200 && *status < 300
	var out Delivery
	err = db.TenantTx(ctx, d.pool, tenantID, func(tx pgx.Tx) error {
		var q string
		switch {
		case ok:
			q = `status='delivered', delivered_at=NOW()`
		case attempt >= MaxAttempts || !p.active:
			q = `status='failed'`
		default:
			q = fmt.Sprintf(`status='pending', next_attempt_at=NOW() + interval '%d seconds'`, int(Backoff(attempt).Seconds()))
		}
		var dur *int
		if elapsed > 0 {
			ms := int(elapsed.Milliseconds())
			dur = &ms
		}
		var err error
		out, err = scanDelivery(tx.QueryRow(ctx, `
			UPDATE webhook_deliveries SET `+q+`, attempts=$2, locked_until=NULL,
			       response_status=$3, response_body=$4, error=$5, duration_ms=$6
			WHERE id=$1 RETURNING `+deliveryColumns,
			deliveryID, attempt, status, respBody, errMsg, dur))
		return err
	})
	return out, err
}

func (d *Dispatcher) send(ctx context.Context, p pending, secret string, deliveryID int64) (*int, string, time.Duration, string) {
	body := []byte(p.payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.url, bytes.NewReader(body))
	if err != nil {
		return nil, "", 0, "URL inválida"
	}
	now := time.Now()
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Argus-Webhooks/1.0")
	req.Header.Set("X-Argus-Event", p.event)
	req.Header.Set("X-Argus-Event-Id", p.eventID)
	req.Header.Set("X-Argus-Delivery", strconv.FormatInt(deliveryID, 10))
	req.Header.Set("X-Argus-Signature", Sign(secret, now, body))

	res, err := d.client.Do(req)
	elapsed := time.Since(now)
	if err != nil {
		if errors.Is(err, errBlockedAddress) {
			return nil, "", elapsed, errBlockedAddress.Error()
		}
		return nil, "", elapsed, truncate("falha de conexão: "+err.Error(), 300)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
	code := res.StatusCode
	msg := ""
	if code < 200 || code >= 300 {
		msg = "resposta HTTP " + strconv.Itoa(code)
	}
	return &code, truncate(string(raw), 1000), elapsed, msg
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	s = s[:n]
	for !utf8.ValidString(s) && len(s) > 0 {
		s = s[:len(s)-1]
	}
	return s + "…"
}
