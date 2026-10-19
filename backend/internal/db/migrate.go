package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Migrate applies every pending embedded migration in lexicographic order,
// recording applied versions in schema_migrations. When appRole exists in the
// database it is granted DML access to every table/sequence, so the server can
// run as a role that does not bypass RLS.
func Migrate(ctx context.Context, pool *pgxpool.Pool, appRole string) (int, error) {
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS public.schema_migrations (
			version     TEXT        PRIMARY KEY,
			applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return 0, fmt.Errorf("ensure schema_migrations: %w", err)
	}

	names, err := fs.Glob(migrationsFS, "migrations/*.sql")
	if err != nil {
		return 0, err
	}
	sort.Strings(names)

	applied := map[string]bool{}
	rows, err := pool.Query(ctx, `SELECT version FROM public.schema_migrations`)
	if err != nil {
		return 0, err
	}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			rows.Close()
			return 0, err
		}
		applied[v] = true
	}
	rows.Close()

	ran := 0
	for _, name := range names {
		version := strings.TrimSuffix(strings.TrimPrefix(name, "migrations/"), ".sql")
		if applied[version] {
			continue
		}
		sqlBytes, err := migrationsFS.ReadFile(name)
		if err != nil {
			return ran, err
		}
		log.Printf("migrate: applying %s", version)
		err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `INSERT INTO public.schema_migrations (version) VALUES ($1)`, version)
			return err
		})
		if err != nil {
			return ran, fmt.Errorf("apply %s: %w", version, err)
		}
		ran++
	}

	if appRole != "" {
		if err := grantAppRole(ctx, pool, appRole); err != nil {
			return ran, err
		}
	}
	return ran, nil
}

func grantAppRole(ctx context.Context, pool *pgxpool.Pool, role string) error {
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)`, role).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return nil
	}
	ident := pgx.Identifier{role}.Sanitize()
	stmts := []string{
		"GRANT USAGE ON SCHEMA public TO " + ident,
		"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO " + ident,
		"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO " + ident,
		"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO " + ident,
	}
	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			return fmt.Errorf("grant %s: %w", role, err)
		}
	}
	return nil
}
