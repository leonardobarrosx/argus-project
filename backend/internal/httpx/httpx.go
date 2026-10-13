// Package httpx holds small helpers shared by every HTTP handler.
package httpx

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// AppError is a business-rule error with an HTTP status and a stable code.
type AppError struct {
	Status  int
	Code    string
	Message string
}

func (e *AppError) Error() string { return e.Message }

// Errf builds an AppError.
func Errf(status int, code, msg string) *AppError {
	return &AppError{Status: status, Code: code, Message: msg}
}

// Common errors.
var (
	ErrNotFound  = Errf(http.StatusNotFound, "NOT_FOUND", "registro não encontrado")
	ErrForbidden = Errf(http.StatusForbidden, "FORBIDDEN", "sem permissão para esta ação")
)

// Unprocessable returns a 422 business-rule error.
func Unprocessable(code, msg string) *AppError {
	return Errf(http.StatusUnprocessableEntity, code, msg)
}

// Fail writes err as a JSON error response. AppErrors keep their status;
// pgx no-rows becomes 404; unique violations become 409; anything else is
// logged and returned as a generic 500.
func Fail(c *gin.Context, err error) {
	var appErr *AppError
	if errors.As(err, &appErr) {
		c.AbortWithStatusJSON(appErr.Status, gin.H{"error": appErr.Message, "code": appErr.Code})
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": ErrNotFound.Message, "code": ErrNotFound.Code})
		return
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			c.AbortWithStatusJSON(http.StatusConflict, gin.H{"error": "registro duplicado", "code": "CONFLICT"})
			return
		case "23503":
			c.AbortWithStatusJSON(http.StatusUnprocessableEntity, gin.H{"error": "referência inválida", "code": "INVALID_REFERENCE"})
			return
		case "23514":
			c.AbortWithStatusJSON(http.StatusUnprocessableEntity, gin.H{"error": "valor fora das regras permitidas", "code": "CHECK_VIOLATION"})
			return
		}
	}
	log.Printf("internal error on %s %s: %v", c.Request.Method, c.FullPath(), err)
	c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "erro interno", "code": "INTERNAL_ERROR"})
}

// Bind parses the JSON body into dst, writing a 400 on failure.
func Bind(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "dados inválidos: " + err.Error(), "code": "VALIDATION_ERROR"})
		return false
	}
	return true
}

// ParamID parses a positive int64 route parameter, writing a 400 on failure.
func ParamID(c *gin.Context, name string) (int64, bool) {
	id, err := strconv.ParseInt(c.Param(name), 10, 64)
	if err != nil || id <= 0 {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "id inválido", "code": "INVALID_ID"})
		return 0, false
	}
	return id, true
}

// NullIfEmpty converts "" to nil so it is stored as SQL NULL.
func NullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return strings.TrimSpace(s)
}

// ValidDate reports whether s is empty or a valid YYYY-MM-DD date.
func ValidDate(s string) bool {
	if s == "" {
		return true
	}
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

// Round2 rounds a monetary value to cents.
func Round2(v float64) float64 {
	if v < 0 {
		return -Round2(-v)
	}
	return float64(int64(v*100+0.5)) / 100
}
