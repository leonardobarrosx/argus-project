package secretbox

import "testing"

func TestSealOpen(t *testing.T) {
	b, err := New("uma-frase-qualquer")
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := b.Seal("whsec_123")
	if err != nil {
		t.Fatal(err)
	}
	if sealed == "whsec_123" {
		t.Fatal("not encrypted")
	}
	got, err := b.Open(sealed)
	if err != nil || got != "whsec_123" {
		t.Fatalf("open: %q %v", got, err)
	}
	other, _ := New("outra-chave")
	if _, err := other.Open(sealed); err == nil {
		t.Fatal("wrong key must fail")
	}
}
