package config

import (
	"fmt"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

// Config holds all application configuration loaded from environment variables.
type Config struct {
	DatabaseURL string
	// MigrationDatabaseURL, quando definido, é usado para aplicar migrations no
	// boot do servidor (conexão do dono das tabelas). O servidor em si roda com
	// DatabaseURL, idealmente um role sem privilégio de bypass de RLS.
	MigrationDatabaseURL   string
	AppDBRole              string
	JWTSecret              string
	JWTAccessExpiryMinutes int
	JWTRefreshExpiryDays   int
	CookieSecure           bool
	Port                   string
	GinMode                string
	CORSOrigins            string
	Timezone               string
	RateLimitRate          float64
	RateLimitBurst         int
	// Brute-force protection on public auth endpoints (per client IP).
	LoginPerMinute  int
	RegisterPerHour int
}

// Load reads configuration from environment variables (.env optional).
func Load() (*Config, error) {
	_ = godotenv.Load()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	if len(secret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}

	return &Config{
		DatabaseURL:            dbURL,
		MigrationDatabaseURL:   os.Getenv("MIGRATION_DATABASE_URL"),
		AppDBRole:              envStr("APP_DB_ROLE", "argus_app"),
		JWTSecret:              secret,
		JWTAccessExpiryMinutes: envInt("JWT_ACCESS_EXPIRY_MINUTES", 15),
		JWTRefreshExpiryDays:   envInt("JWT_REFRESH_EXPIRY_DAYS", 7),
		CookieSecure:           envBool("COOKIE_SECURE", true),
		Port:                   envStr("PORT", "8080"),
		GinMode:                envStr("GIN_MODE", "release"),
		CORSOrigins:            envStr("CORS_ORIGINS", "http://localhost:5173"),
		Timezone:               envStr("APP_TIMEZONE", "America/Sao_Paulo"),
		RateLimitRate:          envFloat("RATE_LIMIT_RATE", 20),
		RateLimitBurst:         envInt("RATE_LIMIT_BURST", 100),
		LoginPerMinute:         envInt("LOGIN_RATE_PER_MINUTE", 20),
		RegisterPerHour:        envInt("REGISTER_RATE_PER_HOUR", 10),
	}, nil
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return fallback
}
