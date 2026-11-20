// Package ai is the Argus assistant: a chat where Claude answers questions
// about the ótica (custom reports, purchase suggestions, stock and financial
// analysis) by calling read-only tools that query the tenant's data.
package ai

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
	"github.com/leonardobarrosx/argus/backend/internal/secretbox"
)

// ModelInfo is a selectable model.
type ModelInfo struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Hint  string `json:"hint"`
}

// Models the ótica can choose from.
var Models = []ModelInfo{
	{"claude-opus-5-5", "Claude Opus 5.5", "Análises mais completas (padrão)"},
	{"claude-sonnet-5-5", "Claude Sonnet 5.5", "Equilíbrio entre velocidade e profundidade"},
	{"claude-haiku-5-5", "Claude Haiku 5.5", "Respostas rápidas e mais baratas"},
}

func validModel(m string) bool {
	for _, x := range Models {
		if x.ID == m {
			return true
		}
	}
	return false
}

// Options configures the assistant.
type Options struct {
	ServerAPIKey string // ANTHROPIC_API_KEY, used when the ótica has no key of its own
	BaseURL      string // optional API base URL (tests, proxies)
	DefaultModel string
}

// Handler exposes the AI routes.
type Handler struct {
	pool *pgxpool.Pool
	box  *secretbox.Box
	opts Options
}

// NewHandler creates an ai Handler.
func NewHandler(pool *pgxpool.Pool, box *secretbox.Box, opts Options) *Handler {
	if !validModel(opts.DefaultModel) {
		opts.DefaultModel = Models[0].ID
	}
	return &Handler{pool: pool, box: box, opts: opts}
}

// Register mounts the routes (managers only: the assistant sees financial data).
func Register(rg *gin.RouterGroup, h *Handler) {
	g := rg.Group("/ai", middleware.Role(middleware.Managers...))
	g.GET("/settings", h.GetSettings)
	g.PUT("/settings", h.UpdateSettings)
	g.GET("/usage", h.Usage)
	g.GET("/conversations", h.ListConversations)
	g.GET("/conversations/:id", h.GetConversation)
	g.DELETE("/conversations/:id", h.DeleteConversation)
	g.POST("/chat", h.Chat)
}

// Settings is the ótica's AI configuration as shown to managers.
type Settings struct {
	Enabled            bool        `json:"enabled"`
	Model              string      `json:"model"`
	Effort             string      `json:"effort"`
	Instructions       string      `json:"instructions"`
	HasOwnKey          bool        `json:"hasOwnKey"`
	KeyHint            string      `json:"keyHint"`
	ServerKeyAvailable bool        `json:"serverKeyAvailable"`
	Ready              bool        `json:"ready"`
	Models             []ModelInfo `json:"models"`
	UpdatedAt          *time.Time  `json:"updatedAt"`
}

type stored struct {
	Settings
	keyEnc *string
}

func (h *Handler) load(ctx context.Context, tx pgx.Tx) (stored, error) {
	s := stored{Settings: Settings{Enabled: true, Model: h.opts.DefaultModel, Effort: "medium"}}
	err := tx.QueryRow(ctx, `SELECT enabled, model, effort, instructions, api_key_enc, api_key_hint, updated_at FROM ai_settings`).
		Scan(&s.Enabled, &s.Model, &s.Effort, &s.Instructions, &s.keyEnc, &s.KeyHint, &s.UpdatedAt)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return s, err
	}
	s.HasOwnKey = s.keyEnc != nil
	s.ServerKeyAvailable = h.opts.ServerAPIKey != ""
	s.Ready = s.Enabled && (s.HasOwnKey || s.ServerKeyAvailable)
	s.Models = Models
	return s, nil
}

// apiKey returns the key to use for this ótica.
func (h *Handler) apiKey(s stored) (string, error) {
	if s.keyEnc != nil {
		return h.box.Open(*s.keyEnc)
	}
	return h.opts.ServerAPIKey, nil
}

// GetSettings — GET /api/ai/settings
func (h *Handler) GetSettings(c *gin.Context) {
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var s stored
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		s, err = h.load(ctx, tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": s.Settings})
}

// SettingsInput updates the configuration. APIKey "" keeps the current key;
// ClearAPIKey removes it (falls back to the server key).
type SettingsInput struct {
	Enabled      bool   `json:"enabled"`
	Model        string `json:"model" binding:"required"`
	Effort       string `json:"effort" binding:"required,oneof=low medium high"`
	Instructions string `json:"instructions" binding:"max=2000"`
	APIKey       string `json:"apiKey" binding:"max=300"`
	ClearAPIKey  bool   `json:"clearApiKey"`
}

// UpdateSettings — PUT /api/ai/settings (owner or manager)
func (h *Handler) UpdateSettings(c *gin.Context) {
	var in SettingsInput
	if !httpx.Bind(c, &in) {
		return
	}
	if !validModel(in.Model) {
		httpx.Fail(c, httpx.Unprocessable("INVALID_MODEL", "modelo não suportado"))
		return
	}
	key := strings.TrimSpace(in.APIKey)
	var enc, hint *string
	if key != "" {
		if !strings.HasPrefix(key, "sk-ant-") || len(key) < 20 {
			httpx.Fail(c, httpx.Unprocessable("INVALID_API_KEY", "a chave da Anthropic começa com sk-ant-"))
			return
		}
		sealed, err := h.box.Seal(key)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		h4 := "…" + key[len(key)-4:]
		enc, hint = &sealed, &h4
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var s stored
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO ai_settings (tenant_id, enabled, model, effort, instructions, api_key_enc, api_key_hint, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, ''), NOW())
			ON CONFLICT (tenant_id) DO UPDATE SET enabled=$2, model=$3, effort=$4, instructions=$5,
			  api_key_enc = CASE WHEN $8 THEN NULL ELSE COALESCE($6, ai_settings.api_key_enc) END,
			  api_key_hint = CASE WHEN $8 THEN '' ELSE COALESCE($7, ai_settings.api_key_hint) END,
			  updated_at = NOW()`,
			a.TenantID, in.Enabled, in.Model, in.Effort, strings.TrimSpace(in.Instructions), enc, hint, in.ClearAPIKey && enc == nil)
		if err != nil {
			return err
		}
		s, err = h.load(ctx, tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": s.Settings})
}

// Usage — GET /api/ai/usage: tokens and answers this month.
func (h *Handler) Usage(c *gin.Context) {
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var answers int
	var in, out int64
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT COUNT(*), COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0)
			FROM ai_messages WHERE role = 'assistant' AND created_at >= date_trunc('month', NOW())`).Scan(&answers, &in, &out)
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"usage": gin.H{"answers": answers, "inputTokens": in, "outputTokens": out}})
}
