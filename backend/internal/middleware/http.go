package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// CORS validates the origin against a comma-separated allowlist.
func CORS(allowedOrigins string) gin.HandlerFunc {
	originSet := make(map[string]struct{})
	for _, o := range strings.Split(allowedOrigins, ",") {
		if o = strings.TrimSpace(o); o != "" {
			originSet[o] = struct{}{}
		}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if _, ok := originSet[origin]; ok {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Max-Age", "86400")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// SecurityHeaders adds hardened HTTP response headers (pure JSON API).
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}

type limiterSet struct {
	mu       sync.Mutex
	limiters map[string]*entry
	rps      rate.Limit
	burst    int
}

type entry struct {
	lim  *rate.Limiter
	seen time.Time
}

func newLimiterSet(rps float64, burst int) *limiterSet {
	ls := &limiterSet{limiters: map[string]*entry{}, rps: rate.Limit(rps), burst: burst}
	go func() {
		for range time.Tick(5 * time.Minute) {
			ls.mu.Lock()
			for k, e := range ls.limiters {
				if time.Since(e.seen) > 10*time.Minute {
					delete(ls.limiters, k)
				}
			}
			ls.mu.Unlock()
		}
	}()
	return ls
}

func (ls *limiterSet) allow(key string) bool {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	e, ok := ls.limiters[key]
	if !ok {
		e = &entry{lim: rate.NewLimiter(ls.rps, ls.burst)}
		ls.limiters[key] = e
	}
	e.seen = time.Now()
	return e.lim.Allow()
}

// IPRateLimit limits requests per client IP (token bucket).
func IPRateLimit(rps float64, burst int) gin.HandlerFunc {
	ls := newLimiterSet(rps, burst)
	return func(c *gin.Context) {
		if !ls.allow(c.ClientIP()) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "muitas requisições, tente novamente em instantes", "code": "RATE_LIMITED"})
			return
		}
		c.Next()
	}
}

// UserRateLimit limits requests per authenticated user (falls back to IP).
func UserRateLimit(rps float64, burst int) gin.HandlerFunc {
	ls := newLimiterSet(rps, burst)
	return func(c *gin.Context) {
		key := c.ClientIP()
		if a := GetActor(c); a.UserID > 0 {
			key = "u:" + strconv.FormatInt(a.UserID, 10)
		}
		if !ls.allow(key) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "muitas requisições, tente novamente em instantes", "code": "RATE_LIMITED"})
			return
		}
		c.Next()
	}
}
