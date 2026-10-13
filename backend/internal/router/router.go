// Package router wires every module into the Gin engine.
package router

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/leonardobarrosx/argus/backend/internal/auth"
	"github.com/leonardobarrosx/argus/backend/internal/bootstrap"
	"github.com/leonardobarrosx/argus/backend/internal/cash"
	"github.com/leonardobarrosx/argus/backend/internal/config"
	"github.com/leonardobarrosx/argus/backend/internal/finance"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
	"github.com/leonardobarrosx/argus/backend/internal/orders"
	"github.com/leonardobarrosx/argus/backend/internal/patients"
	"github.com/leonardobarrosx/argus/backend/internal/sales"
	"github.com/leonardobarrosx/argus/backend/internal/stock"
	"github.com/leonardobarrosx/argus/backend/internal/suppliers"
	"github.com/leonardobarrosx/argus/backend/internal/team"
	"github.com/leonardobarrosx/argus/backend/internal/tenant"
)

// New builds the configured Gin engine.
func New(cfg *config.Config, pool *pgxpool.Pool) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	if cfg.GinMode != gin.TestMode {
		r.Use(gin.Logger())
	}
	r.Use(middleware.CORS(cfg.CORSOrigins))
	r.Use(middleware.SecurityHeaders())
	_ = r.SetTrustedProxies(nil)

	r.GET("/health", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unhealthy", "error": "database connection failed"})
			return
		}
		st := pool.Stat()
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"ts":     time.Now().UTC(),
			"pool":   gin.H{"acquired": st.AcquiredConns(), "idle": st.IdleConns(), "total": st.TotalConns()},
		})
	})

	pub := r.Group("/api", middleware.IPRateLimit(cfg.RateLimitRate, cfg.RateLimitBurst))
	authed := r.Group("/api",
		middleware.Auth(cfg.JWTSecret),
		middleware.UserRateLimit(cfg.RateLimitRate, cfg.RateLimitBurst),
	)

	auth.Register(pub, authed, auth.NewHandler(pool, auth.Options{
		Secret:          cfg.JWTSecret,
		AccessExpiry:    time.Duration(cfg.JWTAccessExpiryMinutes) * time.Minute,
		RefreshExpiry:   time.Duration(cfg.JWTRefreshExpiryDays) * 24 * time.Hour,
		CookieSecure:    cfg.CookieSecure,
		LoginPerMinute:  cfg.LoginPerMinute,
		RegisterPerHour: cfg.RegisterPerHour,
	}))
	bootstrap.Register(authed, bootstrap.NewHandler(pool))
	tenant.Register(authed, tenant.NewHandler(pool))
	team.Register(authed, team.NewHandler(pool))
	patients.Register(authed, patients.NewHandler(pool))
	suppliers.Register(authed, suppliers.NewHandler(pool))
	stock.Register(authed, stock.NewHandler(pool))
	orders.Register(authed, orders.NewHandler(pool))
	sales.Register(authed, sales.NewHandler(pool))
	cash.Register(authed, cash.NewHandler(pool))
	finance.Register(authed, finance.NewHandler(pool))

	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "rota não encontrada", "code": "NOT_FOUND"})
	})
	return r
}
