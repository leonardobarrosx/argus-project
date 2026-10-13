// Package auth handles registration, login, refresh-token rotation and
// password changes.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
	"github.com/leonardobarrosx/argus/backend/internal/stock"
	"github.com/leonardobarrosx/argus/backend/internal/team"
	"github.com/leonardobarrosx/argus/backend/internal/tenant"
)

const (
	refreshCookieName = "argus_refresh"
	refreshCookiePath = "/api/auth"
)

var errInvalidCredentials = httpx.Errf(http.StatusUnauthorized, "INVALID_CREDENTIALS", "e-mail ou senha inválidos")
var errSessionExpired = httpx.Errf(http.StatusUnauthorized, "SESSION_EXPIRED", "sessão expirada, entre novamente")

// Handler exposes the auth routes.
type Handler struct {
	pool          *pgxpool.Pool
	secret        string
	accessExpiry  time.Duration
	refreshExpiry time.Duration
	cookieSecure  bool
	loginPerMin   int
	registerPerHr int
}

// Options configures the auth Handler.
type Options struct {
	Secret          string
	AccessExpiry    time.Duration
	RefreshExpiry   time.Duration
	CookieSecure    bool
	LoginPerMinute  int
	RegisterPerHour int
}

// NewHandler creates an auth Handler.
func NewHandler(pool *pgxpool.Pool, o Options) *Handler {
	return &Handler{pool: pool, secret: o.Secret, accessExpiry: o.AccessExpiry, refreshExpiry: o.RefreshExpiry,
		cookieSecure: o.CookieSecure, loginPerMin: max(o.LoginPerMinute, 1), registerPerHr: max(o.RegisterPerHour, 1)}
}

// Register mounts the auth routes on the public and authenticated groups.
func Register(pub, authed *gin.RouterGroup, h *Handler) {
	pub.POST("/auth/register", middleware.IPRateLimit(float64(h.registerPerHr)/3600, h.registerPerHr), h.RegisterTenant)
	pub.POST("/auth/login", middleware.IPRateLimit(float64(h.loginPerMin)/60, h.loginPerMin), h.Login)
	pub.POST("/auth/refresh", h.Refresh)
	pub.POST("/auth/logout", h.Logout)

	authed.GET("/auth/me", h.Me)
	authed.POST("/auth/change-password", h.ChangePassword)
}

// RegisterInput creates a new ótica and its owner.
type RegisterInput struct {
	StoreName string `json:"storeName" binding:"required,min=2,max=120"`
	Name      string `json:"name" binding:"required,min=2,max=120"`
	Email     string `json:"email" binding:"required,email,max=160"`
	Password  string `json:"password" binding:"required,min=8,max=72"`
}

// LoginInput authenticates a user.
type LoginInput struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,max=72"`
}

type tokenResponse struct {
	AccessToken string `json:"accessToken"`
	ExpiresIn   int    `json:"expiresIn"`
}

type session struct {
	User   team.Member   `json:"user"`
	Tenant tenant.Tenant `json:"tenant"`
	Token  tokenResponse `json:"token"`
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	replacer := strings.NewReplacer("á", "a", "à", "a", "â", "a", "ã", "a", "é", "e", "ê", "e", "í", "i",
		"ó", "o", "ô", "o", "õ", "o", "ú", "u", "ç", "c")
	s = slugRe.ReplaceAllString(replacer.Replace(strings.ToLower(s)), "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "otica"
	}
	return s
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// RegisterTenant creates an ótica + owner and starts a session.
// POST /api/auth/register
func (h *Handler) RegisterTenant(c *gin.Context) {
	var in RegisterInput
	if !httpx.Bind(c, &in) {
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	ctx := c.Request.Context()
	var s session
	err = pgx.BeginFunc(ctx, h.pool, func(tx pgx.Tx) error {
		var taken bool
		if err := tx.QueryRow(ctx, `SELECT auth_email_taken($1)`, in.Email).Scan(&taken); err != nil {
			return err
		}
		if taken {
			return httpx.Errf(http.StatusConflict, "EMAIL_TAKEN", "e-mail já cadastrado")
		}
		var tenantID int64
		if err := tx.QueryRow(ctx, `SELECT nextval('tenants_id_seq')`).Scan(&tenantID); err != nil {
			return err
		}
		if err := db.SetTenant(ctx, tx, tenantID); err != nil {
			return err
		}
		slug := slugify(in.StoreName) + "-" + strconv.FormatInt(tenantID, 10)
		if _, err := tx.Exec(ctx, `
			INSERT INTO tenants (id, name, slug, email, plan, trial_ends_at)
			VALUES ($1, $2, $3, $4, 'trial', NOW() + INTERVAL '14 days')`,
			tenantID, strings.TrimSpace(in.StoreName), slug, in.Email); err != nil {
			return err
		}
		user, err := team.Scan(tx.QueryRow(ctx, `
			INSERT INTO users (tenant_id, name, email, password_hash, role, last_login_at)
			VALUES ($1, $2, $3, $4, 'proprietario', NOW()) RETURNING `+team.Columns,
			tenantID, strings.TrimSpace(in.Name), in.Email, string(hash)))
		if err != nil {
			return err
		}
		if err := stock.SeedDefaultLenses(ctx, tx, tenantID); err != nil {
			return err
		}
		s, err = h.startSession(ctx, c, tx, tenantID, user)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, s)
}

// Login authenticates by e-mail/password.
// POST /api/auth/login
func (h *Handler) Login(c *gin.Context) {
	var in LoginInput
	if !httpx.Bind(c, &in) {
		return
	}
	ctx := c.Request.Context()

	var userID, tenantID int64
	var hash string
	err := h.pool.QueryRow(ctx, `SELECT user_id, tenant_id, password_hash FROM auth_find_login($1)`, strings.TrimSpace(in.Email)).
		Scan(&userID, &tenantID, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		// Constant-ish time: still run bcrypt so timing doesn't reveal unknown e-mails.
		_ = bcrypt.CompareHashAndPassword([]byte("$2a$10$7EqJtq98hPqEX7fNZaFWoO5ZQ1Z6Q4b0p1xvPpH5x0p4YQ2JQ8bX."), []byte(in.Password))
		httpx.Fail(c, errInvalidCredentials)
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		httpx.Fail(c, errInvalidCredentials)
		return
	}

	var s session
	err = db.TenantTx(ctx, h.pool, tenantID, func(tx pgx.Tx) error {
		user, err := team.Scan(tx.QueryRow(ctx, `UPDATE users SET last_login_at=NOW() WHERE id=$1 RETURNING `+team.Columns, userID))
		if err != nil {
			return err
		}
		s, err = h.startSession(ctx, c, tx, tenantID, user)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

// Refresh rotates the refresh-token cookie and issues a new access token.
// POST /api/auth/refresh
func (h *Handler) Refresh(c *gin.Context) {
	raw, err := c.Cookie(refreshCookieName)
	if err != nil || raw == "" {
		httpx.Fail(c, errSessionExpired)
		return
	}
	ctx := c.Request.Context()
	oldHash := hashToken(raw)

	var userID, tenantID int64
	var expiresAt time.Time
	err = h.pool.QueryRow(ctx, `SELECT user_id, tenant_id, expires_at FROM auth_find_refresh($1)`, oldHash).
		Scan(&userID, &tenantID, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		h.clearCookie(c)
		httpx.Fail(c, errSessionExpired)
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	var s session
	err = db.TenantTx(ctx, h.pool, tenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM refresh_tokens WHERE token_hash=$1`, oldHash)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 || time.Now().After(expiresAt) {
			return errSessionExpired
		}
		user, err := team.Scan(tx.QueryRow(ctx, `SELECT `+team.Columns+` FROM users WHERE id=$1 AND active AND password_hash IS NOT NULL`, userID))
		if errors.Is(err, pgx.ErrNoRows) {
			return errSessionExpired
		}
		if err != nil {
			return err
		}
		s, err = h.startSession(ctx, c, tx, tenantID, user)
		return err
	})
	if err != nil {
		if errors.Is(err, errSessionExpired) {
			h.clearCookie(c)
		}
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

// Logout revokes the current refresh token and clears the cookie.
// POST /api/auth/logout
func (h *Handler) Logout(c *gin.Context) {
	if raw, err := c.Cookie(refreshCookieName); err == nil && raw != "" {
		ctx := c.Request.Context()
		var userID, tenantID int64
		var exp time.Time
		hash := hashToken(raw)
		if err := h.pool.QueryRow(ctx, `SELECT user_id, tenant_id, expires_at FROM auth_find_refresh($1)`, hash).
			Scan(&userID, &tenantID, &exp); err == nil {
			_ = db.TenantTx(ctx, h.pool, tenantID, func(tx pgx.Tx) error {
				_, err := tx.Exec(ctx, `DELETE FROM refresh_tokens WHERE token_hash=$1`, hash)
				return err
			})
		}
	}
	h.clearCookie(c)
	c.Status(http.StatusNoContent)
}

// Me returns the authenticated user and ótica.
// GET /api/auth/me
func (h *Handler) Me(c *gin.Context) {
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	var user team.Member
	var t tenant.Tenant
	err := db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var err error
		if user, err = team.Get(ctx, tx, a.UserID); err != nil {
			return err
		}
		t, err = tenant.Get(ctx, tx, a.TenantID)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"user": user, "tenant": t})
}

// ChangePasswordInput changes the authenticated user's password.
type ChangePasswordInput struct {
	CurrentPassword string `json:"currentPassword" binding:"required,max=72"`
	NewPassword     string `json:"newPassword" binding:"required,min=8,max=72"`
}

// ChangePassword updates the user's own password and revokes other sessions.
// POST /api/auth/change-password
func (h *Handler) ChangePassword(c *gin.Context) {
	var in ChangePasswordInput
	if !httpx.Bind(c, &in) {
		return
	}
	a := middleware.GetActor(c)
	ctx := c.Request.Context()
	newHash, err := bcrypt.GenerateFromPassword([]byte(in.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	err = db.TenantTx(ctx, h.pool, a.TenantID, func(tx pgx.Tx) error {
		var hash *string
		if err := tx.QueryRow(ctx, `SELECT password_hash FROM users WHERE id=$1`, a.UserID).Scan(&hash); err != nil {
			return err
		}
		if hash == nil || bcrypt.CompareHashAndPassword([]byte(*hash), []byte(in.CurrentPassword)) != nil {
			return httpx.Errf(http.StatusUnauthorized, "INVALID_CREDENTIALS", "senha atual incorreta")
		}
		if _, err := tx.Exec(ctx, `UPDATE users SET password_hash=$2, updated_at=NOW() WHERE id=$1`, a.UserID, string(newHash)); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id=$1`, a.UserID); err != nil {
			return err
		}
		// Other devices are signed out; this one keeps a fresh refresh token.
		user, err := team.Get(ctx, tx, a.UserID)
		if err != nil {
			return err
		}
		_, err = h.startSession(ctx, c, tx, a.TenantID, user)
		return err
	})
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func (h *Handler) startSession(ctx context.Context, c *gin.Context, tx pgx.Tx, tenantID int64, user team.Member) (session, error) {
	t, err := tenant.Get(ctx, tx, tenantID)
	if err != nil {
		return session{}, err
	}
	now := time.Now()
	access, err := middleware.SignAccessToken(h.secret,
		middleware.Actor{TenantID: tenantID, UserID: user.ID, Name: user.Name, Role: user.Role},
		jwt.RegisteredClaims{IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(h.accessExpiry))})
	if err != nil {
		return session{}, err
	}
	raw, err := randomToken()
	if err != nil {
		return session{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO refresh_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
		tenantID, user.ID, hashToken(raw), now.Add(h.refreshExpiry)); err != nil {
		return session{}, err
	}
	// Housekeeping: drop this user's expired tokens.
	if _, err := tx.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id=$1 AND expires_at < NOW()`, user.ID); err != nil {
		return session{}, err
	}
	h.setCookie(c, raw)
	return session{User: user, Tenant: t, Token: tokenResponse{AccessToken: access, ExpiresIn: int(h.accessExpiry.Seconds())}}, nil
}

func (h *Handler) setCookie(c *gin.Context, raw string) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(refreshCookieName, raw, int(h.refreshExpiry.Seconds()), refreshCookiePath, "", h.cookieSecure, true)
}

func (h *Handler) clearCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(refreshCookieName, "", -1, refreshCookiePath, "", h.cookieSecure, true)
}
