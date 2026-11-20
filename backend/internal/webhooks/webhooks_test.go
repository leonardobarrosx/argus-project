package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"strings"
	"testing"
	"time"
)

func TestSign(t *testing.T) {
	ts := time.Unix(1700000000, 0)
	body := []byte(`{"type":"ping"}`)
	got := Sign("whsec_x", ts, body)
	mac := hmac.New(sha256.New, []byte("whsec_x"))
	mac.Write([]byte("1700000000." + string(body)))
	want := "t=1700000000,v1=" + hex.EncodeToString(mac.Sum(nil))
	if got != want {
		t.Fatalf("Sign = %q, want %q", got, want)
	}
	if Sign("other", ts, body) == got {
		t.Fatal("different secrets must give different signatures")
	}
}

func TestBackoff(t *testing.T) {
	want := []time.Duration{30 * time.Second, 2 * time.Minute, 8 * time.Minute, 32 * time.Minute}
	for i, w := range want {
		if got := Backoff(i + 1); got != w {
			t.Fatalf("Backoff(%d) = %v, want %v", i+1, got, w)
		}
	}
	if Backoff(0) != 30*time.Second {
		t.Fatal("Backoff(0) should behave like the first attempt")
	}
}

func TestPublicIP(t *testing.T) {
	for _, s := range []string{"127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.5.4", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fc00::1"} {
		if publicIP(net.ParseIP(s)) {
			t.Errorf("%s should not be public", s)
		}
	}
	for _, s := range []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"} {
		if !publicIP(net.ParseIP(s)) {
			t.Errorf("%s should be public", s)
		}
	}
}

func TestValidateURL(t *testing.T) {
	bad := []string{"", "ftp://x.com", "http://example.com/hook", "https://localhost/x", "https://db.internal/x",
		"https://10.0.0.5/x", "https://169.254.169.254/latest", "https://user:pw@example.com/x", "not a url"}
	for _, u := range bad {
		if ValidateURL(u, false) == nil {
			t.Errorf("%q should be rejected", u)
		}
	}
	if err := ValidateURL("https://hooks.example.com/argus", false); err != nil {
		t.Fatalf("public https URL rejected: %v", err)
	}
	if err := ValidateURL("http://127.0.0.1:9000/x", true); err != nil {
		t.Fatalf("allowPrivate should accept local http: %v", err)
	}
}

func TestNewSecret(t *testing.T) {
	a, b := NewSecret(), NewSecret()
	if !strings.HasPrefix(a, "whsec_") || len(a) != len("whsec_")+48 || a == b {
		t.Fatalf("bad secrets: %q %q", a, b)
	}
}
