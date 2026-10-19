package db

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type queryCtxKey struct{}

// slowQueryTracer logs queries taking longer than 100ms.
type slowQueryTracer struct{}

func (t *slowQueryTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, queryCtxKey{}, time.Now())
}

func (t *slowQueryTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	start, ok := ctx.Value(queryCtxKey{}).(time.Time)
	if !ok {
		return
	}
	if dur := time.Since(start); dur > 100*time.Millisecond {
		log.Printf("[SLOW QUERY] %v : %v", dur, data.CommandTag.String())
	}
}

// Connect creates and validates a pgxpool connection pool. timezone is applied
// to every connection so CURRENT_DATE and date formatting follow the ótica's
// local time.
func Connect(ctx context.Context, dsn, timezone string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.ConnConfig.Tracer = &slowQueryTracer{}
	if timezone != "" {
		cfg.ConnConfig.RuntimeParams["timezone"] = timezone
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// TenantTx wraps fn in a transaction with app.tenant_id set (RLS).
// set_config(..., true) scopes the setting to the transaction, so it is safe
// with connection pooling.
func TenantTx(ctx context.Context, pool *pgxpool.Pool, tenantID int64, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := SetTenant(ctx, tx, tenantID); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// SetTenant sets app.tenant_id for the current transaction.
func SetTenant(ctx context.Context, tx pgx.Tx, tenantID int64) error {
	if _, err := tx.Exec(ctx, "SELECT set_config('app.tenant_id', $1, true)", strconv.FormatInt(tenantID, 10)); err != nil {
		return fmt.Errorf("set tenant id: %w", err)
	}
	return nil
}

// Row is satisfied by pgx.Row and pgx.Rows.
type Row interface {
	Scan(dest ...any) error
}

// CollectRows scans every row with scan and returns the resulting slice
// (never nil, so it serializes as [] instead of null).
func CollectRows[T any](rows pgx.Rows, scan func(Row) (T, error)) ([]T, error) {
	defer rows.Close()
	out := make([]T, 0)
	for rows.Next() {
		v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
