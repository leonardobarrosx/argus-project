package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/leonardobarrosx/argus/backend/internal/config"
	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/router"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	gin.SetMode(cfg.GinMode)
	ctx := context.Background()

	if cfg.MigrationDatabaseURL != "" {
		owner, err := db.Connect(ctx, cfg.MigrationDatabaseURL, cfg.Timezone)
		if err != nil {
			log.Fatalf("migration database: %v", err)
		}
		n, err := db.Migrate(ctx, owner, cfg.AppDBRole)
		owner.Close()
		if err != nil {
			log.Fatalf("migrate: %v", err)
		}
		log.Printf("migrations: %d applied", n)
	}

	pool, err := db.Connect(ctx, cfg.DatabaseURL, cfg.Timezone)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router.New(cfg, pool),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	go func() {
		log.Printf("argus api listening on :%s (mode=%s)", cfg.Port, cfg.GinMode)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("shutdown: %v", err)
	}
}
