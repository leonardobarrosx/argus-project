package router_test

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// ─── API keys + public API ───────────────────────────────────────────────────

func apiClient(t *testing.T, key string) *client {
	c := newClient(t)
	c.token = key
	return c
}

func TestAPIKeysAndPublicAPI(t *testing.T) {
	owner, _ := register(t, "Ótica API")

	// Invalid scope and the key shown only once.
	owner.must(422, "POST", "/api/integrations/api-keys", map[string]any{"name": "Site", "scopes": []string{"tudo"}})
	created := owner.must(201, "POST", "/api/integrations/api-keys", map[string]any{
		"name": "Site", "scopes": []string{"patients:read", "patients:write", "catalog:read"}, "expiresInDays": 30,
	})
	key := created["key"].(string)
	if !strings.HasPrefix(key, "argus_sk_") || len(key) != len("argus_sk_")+32 {
		t.Fatalf("unexpected key format: %q", key)
	}
	keyID := id(created, "apiKey")
	list := owner.must(200, "GET", "/api/integrations/api-keys", nil)["apiKeys"].([]any)
	if len(list) != 1 || strings.Contains(fmt.Sprint(list), key) {
		t.Fatalf("listing must not expose the key: %v", list)
	}

	api := apiClient(t, key)
	me := api.must(200, "GET", "/api/v1/me", nil)
	if me["tenant"].(map[string]any)["name"] != "Ótica API" {
		t.Fatalf("me: %v", me)
	}
	p := api.must(201, "POST", "/api/v1/patients", map[string]any{"name": "Cliente do Site", "phone": "11 99999-0000"})
	pid := int64(p["data"].(map[string]any)["id"].(float64))
	got := api.must(200, "GET", "/api/v1/patients?q=Site", nil)
	if data := got["data"].([]any); len(data) != 1 || got["hasMore"] != false {
		t.Fatalf("patients search: %v", got)
	}
	api.must(200, "GET", fmt.Sprintf("/api/v1/patients/%d", pid), nil)
	api.must(200, "GET", "/api/v1/products?lowStock=true", nil)

	// Scope enforcement, JWT is not accepted on v1, bad keys are rejected.
	api.must(403, "GET", "/api/v1/sales", nil)
	api.must(403, "GET", "/api/v1/finance/summary", nil)
	owner.must(401, "GET", "/api/v1/me", nil)
	apiClient(t, "argus_sk_invalida").must(401, "GET", "/api/v1/me", nil)
	newClient(t).must(401, "GET", "/api/v1/me", nil)

	// Tenant isolation: another ótica's key never sees these patients.
	other, _ := register(t, "Ótica Vizinha")
	otherKey := other.must(201, "POST", "/api/integrations/api-keys", map[string]any{"name": "BI", "scopes": []string{"patients:read", "sales:read", "finance:read"}})["key"].(string)
	otherAPI := apiClient(t, otherKey)
	if data := otherAPI.must(200, "GET", "/api/v1/patients", nil)["data"].([]any); len(data) != 0 {
		t.Fatalf("isolation broken: %v", data)
	}
	otherAPI.must(404, "GET", fmt.Sprintf("/api/v1/patients/%d", pid), nil)
	otherAPI.must(200, "GET", "/api/v1/sales?from=2026-01-01", nil)
	otherAPI.must(200, "GET", "/api/v1/finance/summary", nil)
	otherAPI.must(422, "GET", "/api/v1/sales?from=ontem", nil)
	other.must(404, "POST", fmt.Sprintf("/api/integrations/api-keys/%d/revoke", keyID), nil)

	// Revoked keys stop working immediately.
	owner.must(200, "POST", fmt.Sprintf("/api/integrations/api-keys/%d/revoke", keyID), nil)
	api.must(401, "GET", "/api/v1/me", nil)
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

type received struct {
	header http.Header
	body   []byte
}

type receiver struct {
	mu     sync.Mutex
	got    []received
	status int
	srv    *httptest.Server
}

func newReceiver(status int) *receiver {
	r := &receiver{status: status}
	r.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		b, _ := io.ReadAll(req.Body)
		r.mu.Lock()
		r.got = append(r.got, received{header: req.Header.Clone(), body: b})
		st := r.status
		r.mu.Unlock()
		w.WriteHeader(st)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	return r
}

func (r *receiver) events() []received {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]received(nil), r.got...)
}

func verify(t *testing.T, secret string, rc received) map[string]any {
	t.Helper()
	sig := rc.header.Get("X-Argus-Signature")
	parts := strings.Split(sig, ",")
	if len(parts) != 2 || !strings.HasPrefix(parts[0], "t=") || !strings.HasPrefix(parts[1], "v1=") {
		t.Fatalf("bad signature header %q", sig)
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strings.TrimPrefix(parts[0], "t=") + "."))
	mac.Write(rc.body)
	if !hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(strings.TrimPrefix(parts[1], "v1="))) {
		t.Fatalf("signature mismatch")
	}
	var env map[string]any
	if err := json.Unmarshal(rc.body, &env); err != nil {
		t.Fatal(err)
	}
	return env
}

func TestWebhooksDelivery(t *testing.T) {
	ctx := context.Background()
	c, _ := register(t, "Ótica Webhooks")
	ok := newReceiver(200)
	defer ok.srv.Close()

	c.must(422, "POST", "/api/integrations/webhooks", map[string]any{"url": ok.srv.URL, "events": []string{"nao.existe"}})
	c.must(422, "POST", "/api/integrations/webhooks", map[string]any{"url": "ftp://x", "events": []string{"sale.created"}})
	created := c.must(201, "POST", "/api/integrations/webhooks", map[string]any{
		"url": ok.srv.URL, "description": "ERP", "events": []string{"patient.created", "stock.low", "sale.created"},
	})
	secret := created["secret"].(string)
	whID := id(created, "webhook")
	if got := c.must(200, "GET", fmt.Sprintf("/api/integrations/webhooks/%d/secret", whID), nil)["secret"]; got != secret {
		t.Fatalf("secret reveal: %v", got)
	}

	// Ping is delivered synchronously and signed.
	test := c.must(200, "POST", fmt.Sprintf("/api/integrations/webhooks/%d/test", whID), nil)["delivery"].(map[string]any)
	if test["status"] != "delivered" || num(test["responseStatus"]) != 200 {
		t.Fatalf("ping: %v", test)
	}
	if env := verify(t, secret, ok.events()[0]); env["type"] != "ping" {
		t.Fatalf("ping envelope: %v", env)
	}

	// Business events go through the outbox and the dispatcher.
	c.must(201, "POST", "/api/patients", map[string]any{"name": "Paciente Webhook"})
	prod := c.must(201, "POST", "/api/products", map[string]any{"name": "Estojo", "category": "Acessórios", "price": 40, "costPrice": 10, "min": 2})
	prodID := id(prod, "product")
	c.must(201, "POST", "/api/stock/entries", map[string]any{"invoiceNumber": "NF-W", "items": []map[string]any{{"productId": prodID, "qty": 3}}})
	client := c.must(201, "POST", "/api/patients", map[string]any{"name": "Comprador"})
	c.must(201, "POST", "/api/cash/open", map[string]any{"openingAmount": 50})
	c.must(201, "POST", "/api/sales", map[string]any{
		"patientId": id(client, "patient"), "items": []map[string]any{{"productId": prodID, "qty": 1}}, "paymentMethod": "PIX",
	})
	if _, err := dispatcher.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	types := map[string]int{}
	for _, rc := range ok.events()[1:] {
		env := verify(t, secret, rc)
		types[env["type"].(string)]++
		if rc.header.Get("X-Argus-Event") != env["type"] {
			t.Fatalf("event header mismatch")
		}
	}
	// 2 patients, 1 sale, stock went 3 → 2 (= min) → stock.low.
	if types["patient.created"] != 2 || types["sale.created"] != 1 || types["stock.low"] != 1 {
		t.Fatalf("delivered events: %v", types)
	}

	// Failing endpoint: delivery is rescheduled with backoff, then retried.
	bad := newReceiver(500)
	defer bad.srv.Close()
	c.must(200, "PUT", fmt.Sprintf("/api/integrations/webhooks/%d", whID), map[string]any{
		"url": bad.srv.URL, "description": "ERP", "events": []string{"patient.created"},
	})
	c.must(201, "POST", "/api/patients", map[string]any{"name": "Paciente Falha"})
	if _, err := dispatcher.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	dels := c.must(200, "GET", fmt.Sprintf("/api/integrations/webhooks/%d/deliveries", whID), nil)["deliveries"].([]any)
	last := dels[0].(map[string]any)
	if last["status"] != "pending" || num(last["attempts"]) != 1 || num(last["responseStatus"]) != 500 {
		t.Fatalf("failed delivery: %v", last)
	}
	if next, _ := time.Parse(time.RFC3339Nano, last["nextAttemptAt"].(string)); time.Until(next) < 20*time.Second {
		t.Fatalf("backoff not applied: %v", last["nextAttemptAt"])
	}
	if n, _ := dispatcher.RunOnce(ctx); n != 0 {
		t.Fatalf("delivery retried before backoff")
	}
	bad.mu.Lock()
	bad.status = 204
	bad.mu.Unlock()
	c.must(200, "POST", fmt.Sprintf("/api/integrations/deliveries/%d/retry", int64(num(last["id"]))), nil)
	if _, err := dispatcher.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	dels = c.must(200, "GET", fmt.Sprintf("/api/integrations/webhooks/%d/deliveries", whID), nil)["deliveries"].([]any)
	if dels[0].(map[string]any)["status"] != "delivered" {
		t.Fatalf("retry: %v", dels[0])
	}

	// Other óticas cannot see or touch this webhook; deleting removes it.
	other, _ := register(t, "Ótica Curiosa")
	other.must(404, "GET", fmt.Sprintf("/api/integrations/webhooks/%d/deliveries", whID), nil)
	other.must(404, "DELETE", fmt.Sprintf("/api/integrations/webhooks/%d", whID), nil)
	c.must(204, "DELETE", fmt.Sprintf("/api/integrations/webhooks/%d", whID), nil)
	if l := c.must(200, "GET", "/api/integrations/webhooks", nil)["webhooks"].([]any); len(l) != 0 {
		t.Fatalf("delete: %v", l)
	}
}

// ─── AI assistant (against a fake Messages API) ──────────────────────────────

var fakeClaudeRequests struct {
	sync.Mutex
	bodies []map[string]any
	keys   []string
}

// fakeClaudeHandler mimics POST /v1/messages: the first call asks for the
// estoque_atual tool; once a tool_result arrives it answers with text quoting it.
func fakeClaudeHandler(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	fakeClaudeRequests.Lock()
	fakeClaudeRequests.bodies = append(fakeClaudeRequests.bodies, body)
	key := r.Header.Get("X-Api-Key")
	if key == "" {
		key = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	fakeClaudeRequests.keys = append(fakeClaudeRequests.keys, key)
	fakeClaudeRequests.Unlock()

	msgs, _ := body["messages"].([]any)
	last := msgs[len(msgs)-1].(map[string]any)
	toolResult := ""
	if content, ok := last["content"].([]any); ok {
		for _, b := range content {
			if bm, _ := b.(map[string]any); bm["type"] == "tool_result" {
				switch c := bm["content"].(type) {
				case string:
					toolResult = c
				case []any:
					for _, x := range c {
						if xm, _ := x.(map[string]any); xm["type"] == "text" {
							toolResult += xm["text"].(string)
						}
					}
				}
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	if toolResult == "" {
		fmt.Fprint(w, `{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5",
			"content":[{"type":"tool_use","id":"toolu_1","name":"estoque_atual","input":{"filtro":"baixo","categoria":""}}],
			"stop_reason":"tool_use","stop_sequence":null,"usage":{"input_tokens":120,"output_tokens":30}}`)
		return
	}
	answer, _ := json.Marshal("## Estoque baixo\n\nDados: " + toolResult)
	fmt.Fprintf(w, `{"id":"msg_2","type":"message","role":"assistant","model":"claude-opus-5-5",
		"content":[{"type":"text","text":%s}],
		"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":300,"output_tokens":80}}`, answer)
}

// chat posts a message and parses the SSE stream into (event, data) pairs.
func chat(t *testing.T, c *client, body map[string]any) []struct {
	Event string
	Data  map[string]any
} {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", srv.URL+"/api/ai/chat", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)
	res, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("chat: %d %s", res.StatusCode, raw)
	}
	var out []struct {
		Event string
		Data  map[string]any
	}
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	event := ""
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			var d map[string]any
			if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data:"))), &d); err != nil {
				t.Fatalf("bad SSE data %q: %v", line, err)
			}
			out = append(out, struct {
				Event string
				Data  map[string]any
			}{event, d})
		}
	}
	return out
}

func TestAIAssistant(t *testing.T) {
	c, _ := register(t, "Ótica IA")
	prod := c.must(201, "POST", "/api/products", map[string]any{"name": "Armação Rara", "category": "Armações", "price": 500, "costPrice": 200, "min": 3})
	_ = prod

	// No key yet: settings say so and chat refuses with a clear code.
	st := c.must(200, "GET", "/api/ai/settings", nil)["settings"].(map[string]any)
	if st["ready"] != false || st["model"] != "claude-opus-5-5" {
		t.Fatalf("settings: %v", st)
	}
	code, out := c.do("POST", "/api/ai/chat", map[string]any{"message": "oi"})
	if code != 422 || out["code"] != "AI_NOT_CONFIGURED" {
		t.Fatalf("expected AI_NOT_CONFIGURED: %d %v", code, out)
	}
	c.must(422, "PUT", "/api/ai/settings", map[string]any{"enabled": true, "model": "gpt-5", "effort": "medium"})
	c.must(422, "PUT", "/api/ai/settings", map[string]any{"enabled": true, "model": "claude-opus-5-5", "effort": "medium", "apiKey": "chave-errada"})
	ownKey := "sk-ant-test-0123456789abcdef"
	st = c.must(200, "PUT", "/api/ai/settings", map[string]any{
		"enabled": true, "model": "claude-opus-5-5", "effort": "high", "apiKey": ownKey, "instructions": "Fale de forma objetiva.",
	})["settings"].(map[string]any)
	if st["ready"] != true || st["hasOwnKey"] != true || st["keyHint"] != "…cdef" {
		t.Fatalf("settings after key: %v", st)
	}
	if strings.Contains(fmt.Sprint(st), ownKey) {
		t.Fatal("settings must never return the key")
	}

	events := chat(t, c, map[string]any{"message": "Quais produtos estão com estoque baixo?"})
	var kinds []string
	var final map[string]any
	var convID int64
	for _, e := range events {
		kinds = append(kinds, e.Event)
		switch e.Event {
		case "conversation":
			convID = int64(e.Data["conversation"].(map[string]any)["id"].(float64))
		case "message":
			final = e.Data["message"].(map[string]any)
		case "error":
			t.Fatalf("chat error: %v", e.Data)
		}
	}
	if strings.Join(kinds, ",") != "conversation,status,message" {
		t.Fatalf("event sequence: %v", kinds)
	}
	if !strings.Contains(final["content"].(string), "Armação Rara") {
		t.Fatalf("answer should use tool data: %v", final["content"])
	}
	tools := final["tools"].([]any)
	if len(tools) != 1 || tools[0].(map[string]any)["name"] != "estoque_atual" {
		t.Fatalf("tools: %v", tools)
	}
	if num(final["inputTokens"]) != 420 || num(final["outputTokens"]) != 110 {
		t.Fatalf("usage: %v", final)
	}

	// The request used the ótica's own key, strict tools, effort and fallbacks.
	fakeClaudeRequests.Lock()
	first := fakeClaudeRequests.bodies[len(fakeClaudeRequests.bodies)-2]
	usedKey := fakeClaudeRequests.keys[len(fakeClaudeRequests.keys)-1]
	fakeClaudeRequests.Unlock()
	if usedKey != ownKey {
		t.Fatalf("api key sent: %q", usedKey)
	}
	if first["model"] != "claude-opus-5-5" || first["fallbacks"] != "default" {
		t.Fatalf("request: model=%v fallbacks=%v", first["model"], first["fallbacks"])
	}
	if oc := first["output_config"].(map[string]any); oc["effort"] != "high" {
		t.Fatalf("effort: %v", oc)
	}
	for _, tl := range first["tools"].([]any) {
		tm := tl.(map[string]any)
		schema := tm["input_schema"].(map[string]any)
		if tm["strict"] != true || schema["additionalProperties"] != false {
			t.Fatalf("tool %v must be strict", tm["name"])
		}
		if props, _ := schema["properties"].(map[string]any); len(props) != len(toSlice(schema["required"])) {
			t.Fatalf("tool %v: every property must be required", tm["name"])
		}
	}
	if sys := fmt.Sprint(first["system"]); !strings.Contains(sys, "Ótica IA") || !strings.Contains(sys, "Fale de forma objetiva.") {
		t.Fatalf("system prompt: %v", sys)
	}

	// Follow-up in the same conversation sends the history.
	chat(t, c, map[string]any{"conversationId": convID, "message": "E agora?"})
	fakeClaudeRequests.Lock()
	followUp := fakeClaudeRequests.bodies[len(fakeClaudeRequests.bodies)-2]
	fakeClaudeRequests.Unlock()
	if msgs := followUp["messages"].([]any); len(msgs) != 3 {
		t.Fatalf("history should have user, assistant, user: %d", len(msgs))
	}

	conv := c.must(200, "GET", fmt.Sprintf("/api/ai/conversations/%d", convID), nil)
	if msgs := conv["messages"].([]any); len(msgs) != 4 {
		t.Fatalf("stored messages: %d", len(msgs))
	}
	if list := c.must(200, "GET", "/api/ai/conversations", nil)["conversations"].([]any); len(list) != 1 {
		t.Fatalf("conversations: %v", list)
	}
	if u := c.must(200, "GET", "/api/ai/usage", nil)["usage"].(map[string]any); num(u["answers"]) != 2 {
		t.Fatalf("usage: %v", u)
	}

	// Conversations are private to their author and to the ótica.
	other, _ := register(t, "Ótica Outra IA")
	other.must(404, "GET", fmt.Sprintf("/api/ai/conversations/%d", convID), nil)
	c.must(204, "DELETE", fmt.Sprintf("/api/ai/conversations/%d", convID), nil)
	c.must(404, "GET", fmt.Sprintf("/api/ai/conversations/%d", convID), nil)
}

func toSlice(v any) []any {
	s, _ := v.([]any)
	return s
}
