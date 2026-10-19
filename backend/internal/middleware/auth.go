package middleware

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// Roles.
const (
	RoleOwner       = "proprietario"
	RoleManager     = "gerente"
	RoleOptometrist = "optometrista"
	RoleSeller      = "vendedor"
	RoleLab         = "montador"
	RoleAttendant   = "atendente"
)

// Role groups used by route guards.
var (
	Managers = []string{RoleOwner, RoleManager}
	Sellers  = []string{RoleOwner, RoleManager, RoleSeller, RoleAttendant}
	Clinical = []string{RoleOwner, RoleManager, RoleOptometrist, RoleSeller, RoleAttendant}
	AllRoles = []string{RoleOwner, RoleManager, RoleOptometrist, RoleSeller, RoleLab, RoleAttendant}
)

// Claims holds the JWT payload.
type Claims struct {
	TenantID int64  `json:"tid,string"`
	UserID   int64  `json:"uid,string"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// Actor is the authenticated user performing a request.
type Actor struct {
	TenantID int64
	UserID   int64
	Name     string
	Role     string
}

// IsManager reports whether the actor is owner or manager.
func (a Actor) IsManager() bool { return a.Role == RoleOwner || a.Role == RoleManager }

const actorKey = "argus_actor"

// Auth validates the Bearer JWT and stores the Actor in the gin context.
func Auth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
		if !ok || tokenStr == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token de autenticação ausente", "code": "UNAUTHORIZED"})
			return
		}
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(secret), nil
		})
		if err != nil || !token.Valid || claims.TenantID <= 0 || claims.UserID <= 0 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token inválido ou expirado", "code": "UNAUTHORIZED"})
			return
		}
		c.Set(actorKey, Actor{TenantID: claims.TenantID, UserID: claims.UserID, Name: claims.Name, Role: claims.Role})
		c.Next()
	}
}

// Role allows only requests whose role is in allowed.
func Role(allowed ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role := GetActor(c).Role
		for _, r := range allowed {
			if r == role {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "sem permissão para esta ação", "code": "FORBIDDEN"})
	}
}

// GetActor returns the authenticated actor (zero value if absent).
func GetActor(c *gin.Context) Actor {
	v, _ := c.Get(actorKey)
	a, _ := v.(Actor)
	return a
}

// SignAccessToken issues a signed HS256 access token.
func SignAccessToken(secret string, a Actor, claims jwt.RegisteredClaims) (string, error) {
	if claims.Subject == "" {
		claims.Subject = strconv.FormatInt(a.UserID, 10)
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{
		TenantID: a.TenantID, UserID: a.UserID, Name: a.Name, Role: a.Role, RegisteredClaims: claims,
	})
	return tok.SignedString([]byte(secret))
}
