// Package apikeys manages the ótica's API keys and authenticates requests to
// the public API (/api/v1) made with them.
package apikeys

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"math/big"
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

// ScopeInfo documents a permission an API key can hold.
type ScopeInfo struct {
	Scope       string `json:"scope"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// Scopes is the catalog of API key permissions.
var Scopes = []ScopeInfo{
	{"patients:read", "Ler pacientes", "Lista e consulta pacientes e receitas."},
	{"patients:write", "Cadastrar pacientes", "Cria pacientes (ex.: formulário do site ou agendamento)."},
	{"catalog:read", "Ler catálogo", "Produtos, estoque atual e lentes."},
	{"stock:read", "Ler movimentações", "Trilha de entradas e saídas de estoque."},
	{"orders:read", "Ler ordens de serviço", "OS do laboratório e seus status."},
	{"sales:read", "Ler vendas", "Vendas do PDV com itens."},
	{"finance:read", "Ler financeiro", "Contas a pagar e resumo financeiro (DRE)."},
}

// ValidScope reports whether s is a known scope.
func ValidScope(s string) bool {
	for _, sc := range Scopes {
		if sc.Scope == s {
			return true
		}
	}
	return false
}

// KeyPrefix starts every API key so leaked keys are easy to spot by scanners.
const KeyPrefix = "argus_sk_"

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// Generate returns a new random key (~190 bits) and its SHA-256 hash.
func Generate() (key, hash string) {
	var sb strings.Builder
	sb.WriteString(KeyPrefix)
	max := big.NewInt(int64(len(alphabet)))
	for i := 0; i < 32; i++ {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(err)
		}
		sb.WriteByte(alphabet[n.Int64()])
	}
	key = sb.String()
	return key, Hash(key)
}

// Hash returns the hex SHA-256 of key.
func Hash(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// Key is an API key as listed (never includes the secret).
type Key struct {
	ID            int64      `json:"id"`
	Name          string     `json:"name"`
	Prefix        string     `json:"prefix"`
	Scopes        []string   `json:"scopes"`
	CreatedByName string     `json:"createdByName"`
	LastUsedAt    *time.Time `json:"lastUsedAt"`
	ExpiresAt     *time.Time `json:"expiresAt"`
	RevokedAt     *time.Time `json:"revokedAt"`
	CreatedAt     time.Time  `json:"createdAt"`
}

const columns = `id, name, prefix, scopes, created_by_name, last_used_at, expires_at, revoked_at, created_at`

func scan(row db.Row) (Key, error) {
	var k Key
	err := row.Scan(&k.ID, &k.Name, &k.Prefix, &k.Scopes, &k.CreatedByName, &k.LastUsedAt, &k.ExpiresAt, &k.RevokedAt, &k.CreatedAt)
	if k.Scopes == nil {
		k.Scopes = []string{}
	}
	return k, err
}

// Handler exposes the API key management routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates an apikeys Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the routes (managers only).
func Register(rg *gin.RouterGroup, h *Handler) {
	g := rg.Group("/integrations", middleware.Role(middleware.Managers...))
	g.GET("/scopes", h.ListScopes)
	g.GET("/api-keys", h.List)
	g.POST("/api-keys", h.Create)
	g.POST("/api-keys/:id/revoke", h.Revoke)
}

// ListScopes — GET /api/integrations/scopes
func (h *Handler) ListScopes(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"scopes": Scopes})
}

// List — GET /api/integrations/api-keys
func (h *Handler) List(c *gin.Context) {
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var out []Key
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT `+columns+` FROM api_keys ORDER BY (revoked_at IS NULL) DESC, created_at DESC`)
		if err != nil {
			return err
		}
		out, err = db.CollectRows(rows, scan)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"apiKeys": out})
}

// CreateInput is the create payload. ExpiresInDays 0 = never expires.
type CreateInput struct {
	Name          string   `json:"name" binding:"required,min=2,max=80"`
	Scopes        []string `json:"scopes" binding:"required,min=1,max=20"`
	ExpiresInDays int      `json:"expiresInDays" binding:"min=0,max=730"`
}

// Create issues a key. The plain key is returned only in this response.
// POST /api/integrations/api-keys
func (h *Handler) Create(c *gin.Context) {
	var in CreateInput
	if !httpx.Bind(c, &in) {
		return
	}
	scopes := make([]string, 0, len(in.Scopes))
	seen := map[string]bool{}
	for _, s := range in.Scopes {
		if !ValidScope(s) {
			httpx.Fail(c, httpx.Unprocessable("INVALID_SCOPE", "permissão desconhecida: "+s))
			return
		}
		if !seen[s] {
			seen[s] = true
			scopes = append(scopes, s)
		}
	}
	var expires *time.Time
	if in.ExpiresInDays > 0 {
		t := time.Now().Add(time.Duration(in.ExpiresInDays) * 24 * time.Hour)
		expires = &t
	}
	key, hash := Generate()
	prefix := key[:len(KeyPrefix)+6]
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var k Key
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL`).Scan(&n); err != nil {
			return err
		}
		if n >= 25 {
			return httpx.Unprocessable("LIMIT_REACHED", "limite de 25 chaves ativas por ótica")
		}
		var err error
		k, err = scan(tx.QueryRow(ctx, `
			INSERT INTO api_keys (tenant_id, name, prefix, key_hash, scopes, created_by, created_by_name, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING `+columns,
			a.TenantID, strings.TrimSpace(in.Name), prefix, hash, scopes, a.UserID, a.Name, expires))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"apiKey": k, "key": key})
}

// Revoke — POST /api/integrations/api-keys/:id/revoke
func (h *Handler) Revoke(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var k Key
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		k, err = scan(tx.QueryRow(ctx, `
			UPDATE api_keys SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id=$1 RETURNING `+columns, id))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"apiKey": k})
}
