// Package team manages the ótica staff (users), including system access.
package team

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
)

// Member is a staff member as returned by the API (never includes the hash).
type Member struct {
	ID            int64      `json:"id"`
	Name          string     `json:"name"`
	Email         string     `json:"email"`
	Phone         string     `json:"phone"`
	Role          string     `json:"role"`
	CommissionPct float64    `json:"commissionPct"`
	Active        bool       `json:"active"`
	HasAccess     bool       `json:"hasAccess"`
	LastLoginAt   *time.Time `json:"lastLoginAt"`
	CreatedAt     time.Time  `json:"createdAt"`
}

// Columns is the SELECT list matching Scan.
const Columns = `id, name, email, phone, role, commission_pct, active, password_hash IS NOT NULL, last_login_at, created_at`

// Scan reads a Member from a row selected with Columns.
func Scan(row db.Row) (Member, error) {
	var m Member
	err := row.Scan(&m.ID, &m.Name, &m.Email, &m.Phone, &m.Role, &m.CommissionPct, &m.Active, &m.HasAccess, &m.LastLoginAt, &m.CreatedAt)
	return m, err
}

// Get loads one member.
func Get(ctx context.Context, tx pgx.Tx, id int64) (Member, error) {
	return Scan(tx.QueryRow(ctx, `SELECT `+Columns+` FROM users WHERE id = $1`, id))
}

// List returns every member of the tenant, ordered by name.
func List(ctx context.Context, tx pgx.Tx) ([]Member, error) {
	rows, err := tx.Query(ctx, `SELECT `+Columns+` FROM users ORDER BY active DESC, name`)
	if err != nil {
		return nil, err
	}
	return db.CollectRows(rows, Scan)
}

// Input is the create/update payload. Password is optional: when set, the
// member gets (or keeps) system access with that password.
type Input struct {
	Name          string  `json:"name" binding:"required,min=2,max=120"`
	Email         string  `json:"email" binding:"omitempty,email,max=160"`
	Phone         string  `json:"phone" binding:"max=30"`
	Role          string  `json:"role" binding:"required,oneof=proprietario gerente optometrista vendedor montador atendente"`
	CommissionPct float64 `json:"commissionPct" binding:"min=0,max=100"`
	Password      string  `json:"password" binding:"omitempty,min=8,max=72"`
	RevokeAccess  bool    `json:"revokeAccess"`
}

// Handler exposes the team routes.
type Handler struct{ pool *pgxpool.Pool }

// NewHandler creates a team Handler.
func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

// Register mounts the team routes.
func Register(rg *gin.RouterGroup, h *Handler) {
	g := rg.Group("/users")
	g.GET("", h.List)
	g.POST("", middleware.Role(middleware.Managers...), h.Create)
	g.PUT("/:id", middleware.Role(middleware.Managers...), h.Update)
	g.POST("/:id/toggle-active", middleware.Role(middleware.Managers...), h.ToggleActive)
}

// Only the owner can create or edit owners/managers.
func canManageRole(actor middleware.Actor, role string) bool {
	if role == middleware.RoleOwner || role == middleware.RoleManager {
		return actor.Role == middleware.RoleOwner
	}
	return actor.IsManager()
}

func emailTaken(ctx context.Context, tx pgx.Tx, email string, exceptID int64) (bool, error) {
	if email == "" {
		return false, nil
	}
	var taken bool
	// auth_email_taken ignores RLS: login e-mails are unique across óticas.
	if err := tx.QueryRow(ctx, `SELECT auth_email_taken($1)`, email).Scan(&taken); err != nil {
		return false, err
	}
	if !taken || exceptID == 0 {
		return taken, nil
	}
	var same bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE id=$1 AND lower(email)=lower($2) AND password_hash IS NOT NULL)`, exceptID, email).Scan(&same)
	return taken && !same, err
}

// List returns the team.
// GET /api/users
func (h *Handler) List(c *gin.Context) {
	a := middleware.GetActor(c)
	var members []Member
	err := db.TenantTx(c.Request.Context(), h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		members, err = List(c.Request.Context(), tx)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"users": members})
}

// Create adds a team member.
// POST /api/users
func (h *Handler) Create(c *gin.Context) {
	var in Input
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	if !canManageRole(a, in.Role) {
		httpx.Fail(c, httpx.Errf(http.StatusForbidden, "FORBIDDEN", "apenas o proprietário pode cadastrar gerentes ou proprietários"))
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if in.Password != "" && in.Email == "" {
		httpx.Fail(c, httpx.Unprocessable("EMAIL_REQUIRED", "informe o e-mail para dar acesso ao sistema"))
		return
	}
	var hash any
	if in.Password != "" {
		h, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		hash = string(h)
	}

	ctx := c.Request.Context()
	var m Member
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		if hash != nil {
			taken, err := emailTaken(ctx, tx, in.Email, 0)
			if err != nil {
				return err
			}
			if taken {
				return httpx.Errf(http.StatusConflict, "EMAIL_TAKEN", "e-mail já utilizado por outro acesso")
			}
		}
		var err error
		m, err = Scan(tx.QueryRow(ctx, `
			INSERT INTO users (tenant_id, name, email, phone, role, commission_pct, password_hash)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING `+Columns,
			a.TenantID, strings.TrimSpace(in.Name), in.Email, strings.TrimSpace(in.Phone), in.Role, in.CommissionPct, hash))
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"user": m})
}

// Update edits a team member (and optionally sets/revokes their access).
// PUT /api/users/:id
func (h *Handler) Update(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	var in Input
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	ctx := c.Request.Context()

	var newHash string
	if in.Password != "" {
		h, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		newHash = string(h)
	}

	var m Member
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		current, err := Get(ctx, tx, id)
		if err != nil {
			return err
		}
		if !canManageRole(a, current.Role) || !canManageRole(a, in.Role) {
			return httpx.Errf(http.StatusForbidden, "FORBIDDEN", "apenas o proprietário pode alterar gerentes ou proprietários")
		}
		if id == a.UserID && in.Role != current.Role {
			return httpx.Unprocessable("SELF_ROLE", "você não pode alterar a própria função")
		}
		if id == a.UserID && in.RevokeAccess {
			return httpx.Unprocessable("SELF_ACCESS", "você não pode remover o próprio acesso")
		}
		willHaveAccess := (current.HasAccess && !in.RevokeAccess) || newHash != ""
		if willHaveAccess && in.Email == "" {
			return httpx.Unprocessable("EMAIL_REQUIRED", "informe o e-mail para dar acesso ao sistema")
		}
		if willHaveAccess {
			taken, err := emailTaken(ctx, tx, in.Email, id)
			if err != nil {
				return err
			}
			if taken {
				return httpx.Errf(http.StatusConflict, "EMAIL_TAKEN", "e-mail já utilizado por outro acesso")
			}
		}

		hashExpr := "password_hash"
		args := []any{id, strings.TrimSpace(in.Name), in.Email, strings.TrimSpace(in.Phone), in.Role, in.CommissionPct}
		switch {
		case newHash != "":
			hashExpr = "$7"
			args = append(args, newHash)
		case in.RevokeAccess:
			hashExpr = "NULL"
		}
		m, err = Scan(tx.QueryRow(ctx, `
			UPDATE users SET name=$2, email=$3, phone=$4, role=$5, commission_pct=$6,
			       password_hash=`+hashExpr+`, updated_at=NOW()
			WHERE id=$1 RETURNING `+Columns, args...))
		if err != nil {
			return err
		}
		if newHash != "" || in.RevokeAccess {
			// Changing credentials ends the member's active sessions.
			_, err = tx.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id=$1`, id)
		}
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": m})
}

// ToggleActive activates/deactivates a member.
// POST /api/users/:id/toggle-active
func (h *Handler) ToggleActive(c *gin.Context) {
	id, ok := httpx.ParamID(c, "id")
	if !ok {
		return
	}
	a := middleware.GetActor(c)
	if id == a.UserID {
		httpx.Fail(c, httpx.Unprocessable("SELF_DEACTIVATE", "você não pode desativar o próprio usuário"))
		return
	}
	ctx := c.Request.Context()
	var m Member
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		current, err := Get(ctx, tx, id)
		if err != nil {
			return err
		}
		if !canManageRole(a, current.Role) {
			return httpx.Errf(http.StatusForbidden, "FORBIDDEN", "apenas o proprietário pode alterar gerentes ou proprietários")
		}
		m, err = Scan(tx.QueryRow(ctx, `UPDATE users SET active = NOT active, updated_at=NOW() WHERE id=$1 RETURNING `+Columns, id))
		if err != nil {
			return err
		}
		if !m.Active {
			_, err = tx.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id=$1`, id)
		}
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": m})
}
