package apikeys

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
)

// keyFromRequest reads the key from "Authorization: Bearer argus_sk_…" or
// the "X-API-Key" header.
func keyFromRequest(c *gin.Context) string {
	if k := strings.TrimSpace(c.GetHeader("X-API-Key")); k != "" {
		return k
	}
	if k, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer "); ok {
		return strings.TrimSpace(k)
	}
	return ""
}

// Authenticate validates the API key and stores an API actor in the context.
func Authenticate(pool *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := keyFromRequest(c)
		if !strings.HasPrefix(key, KeyPrefix) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error": "envie a chave de API no header Authorization: Bearer argus_sk_…", "code": "UNAUTHORIZED"})
			return
		}
		ctx := c.Request.Context()
		var (
			keyID, tenantID int64
			name            string
			scopes          []string
		)
		err := pool.QueryRow(ctx, `SELECT key_id, tenant_id, name, scopes FROM auth_find_api_key($1)`, Hash(key)).
			Scan(&keyID, &tenantID, &name, &scopes)
		if errors.Is(err, pgx.ErrNoRows) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "chave de API inválida, expirada ou revogada", "code": "INVALID_API_KEY"})
			return
		}
		if err != nil {
			log.Printf("apikeys: lookup: %v", err)
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "erro interno", "code": "INTERNAL_ERROR"})
			return
		}
		// Best effort, at most once a minute per key.
		_ = db.TenantTx(ctx, pool, tenantID, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `UPDATE api_keys SET last_used_at = NOW()
				WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < NOW() - interval '1 minute')`, keyID)
			return err
		})
		middleware.SetActor(c, middleware.Actor{
			TenantID: tenantID, KeyID: keyID, Name: "API · " + name, Role: middleware.RoleAPI, Scopes: scopes,
		})
		c.Next()
	}
}

// RequireScope allows only API keys holding scope.
func RequireScope(scope string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !middleware.GetActor(c).HasScope(scope) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "a chave de API não tem a permissão " + scope, "code": "INSUFFICIENT_SCOPE"})
			return
		}
		c.Next()
	}
}
