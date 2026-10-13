// Command migrate applies pending database migrations (embedded in the binary).
//
//	DATABASE_URL=postgres://owner@localhost/argus go run ./cmd/migrate
//
// Run it with the table owner (not the restricted app role). APP_DB_ROLE
// (default argus_app), when it exists, receives DML grants afterwards.
package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/joho/godotenv"

	"github.com/leonardobarrosx/argus/backend/internal/db"
)

func main() {
	_ = godotenv.Load()
	dsn := os.Getenv("MIGRATION_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		log.Fatal("MIGRATION_DATABASE_URL or DATABASE_URL is required")
	}
	role := os.Getenv("APP_DB_ROLE")
	if role == "" {
		role = "argus_app"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	pool, err := db.Connect(ctx, dsn, "")
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()
	n, err := db.Migrate(ctx, pool, role)
	if err != nil {
		log.Fatalf("migrate: %v", err)
	}
	log.Printf("%d migration(s) applied", n)
}
