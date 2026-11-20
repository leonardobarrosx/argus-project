package apikeys

import (
	"strings"
	"testing"
)

func TestGenerate(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		key, hash := Generate()
		if !strings.HasPrefix(key, KeyPrefix) || len(key) != len(KeyPrefix)+32 {
			t.Fatalf("bad key %q", key)
		}
		if hash != Hash(key) || len(hash) != 64 {
			t.Fatalf("hash mismatch for %q", key)
		}
		if seen[key] {
			t.Fatal("duplicate key")
		}
		seen[key] = true
	}
}
