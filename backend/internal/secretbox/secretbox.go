// Package secretbox encrypts small secrets at rest (webhook signing secrets,
// per-ótica AI keys) with AES-256-GCM.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
)

// Box seals and opens secrets with a fixed 32-byte key.
type Box struct{ aead cipher.AEAD }

// New builds a Box. key may be 64 hex chars (32 bytes); any other non-empty
// string is stretched with SHA-256 so a passphrase also works.
func New(key string) (*Box, error) {
	if key == "" {
		return nil, errors.New("secretbox: empty key")
	}
	raw, err := hex.DecodeString(key)
	if err != nil || len(raw) != 32 {
		sum := sha256.Sum256([]byte(key))
		raw = sum[:]
	}
	block, err := aes.NewCipher(raw)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Seal encrypts plaintext and returns base64(nonce || ciphertext).
func (b *Box) Seal(plaintext string) (string, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	out := b.aead.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(out), nil
}

// Open decrypts a value produced by Seal.
func (b *Box) Open(sealed string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(sealed)
	if err != nil {
		return "", fmt.Errorf("secretbox: decode: %w", err)
	}
	n := b.aead.NonceSize()
	if len(raw) < n {
		return "", errors.New("secretbox: ciphertext too short")
	}
	plain, err := b.aead.Open(nil, raw[:n], raw[n:], nil)
	if err != nil {
		return "", errors.New("secretbox: invalid key or corrupted data")
	}
	return string(plain), nil
}
