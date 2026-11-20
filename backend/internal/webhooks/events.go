// Package webhooks lets each ótica subscribe HTTPS endpoints to business
// events. Events are written to an outbox (webhook_deliveries) inside the same
// transaction as the business rule, so a rolled-back sale never notifies
// anyone, and a background Dispatcher delivers them signed with HMAC-SHA256,
// retrying with exponential backoff.
package webhooks

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
)

// EventInfo documents a subscribable event.
type EventInfo struct {
	Type        string `json:"type"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// Events is the catalog of subscribable events.
var Events = []EventInfo{
	{"sale.created", "Venda registrada", "Venda finalizada no PDV ou recebimento de OS."},
	{"sale.cancelled", "Venda cancelada", "Venda cancelada pela gerência (com estorno de estoque)."},
	{"order.created", "OS aberta", "Nova ordem de serviço enviada ao laboratório."},
	{"order.status_changed", "OS mudou de etapa", "OS ficou pronta ou foi entregue ao cliente."},
	{"order.paid", "OS paga", "Pagamento de uma OS a receber foi registrado."},
	{"order.cancelled", "OS cancelada", "OS cancelada; itens voltaram ao estoque."},
	{"patient.created", "Paciente cadastrado", "Novo paciente ou dependente cadastrado."},
	{"stock.low", "Estoque baixo", "Produto atingiu o estoque mínimo após uma saída."},
	{"payable.created", "Conta a pagar lançada", "Nova conta a pagar (manual ou por entrada de NF)."},
	{"payable.paid", "Conta paga", "Conta a pagar foi quitada."},
	{"cash.closed", "Caixa fechado", "Fechamento de caixa com valores esperado e contado."},
}

// EventPing is sent by the "test" button and cannot be subscribed to.
const EventPing = "ping"

// ValidEvent reports whether t is a subscribable event type.
func ValidEvent(t string) bool {
	for _, e := range Events {
		if e.Type == t {
			return true
		}
	}
	return false
}

// Envelope is the JSON body POSTed to subscribers.
type Envelope struct {
	ID        string    `json:"id"`
	Type      string    `json:"type"`
	CreatedAt time.Time `json:"createdAt"`
	Data      any       `json:"data"`
}

func newEventID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "evt_" + hex.EncodeToString(b)
}

// Emit queues event for every active webhook of the current tenant subscribed
// to it. It must run inside a db.TenantTx: the tenant comes from
// app.tenant_id and RLS limits the webhooks it can see. When no webhook is
// subscribed it inserts nothing.
func Emit(ctx context.Context, tx pgx.Tx, event string, data any) error {
	id := newEventID()
	body, err := json.Marshal(Envelope{ID: id, Type: event, CreatedAt: time.Now().UTC(), Data: data})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO webhook_deliveries (tenant_id, webhook_id, event_id, event, payload)
		SELECT current_tenant_id(), w.id, $1, $2, $3::jsonb
		FROM webhooks w
		WHERE w.active AND $2 = ANY(w.events)`, id, event, string(body))
	return err
}
