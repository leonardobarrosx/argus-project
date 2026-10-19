// Command seed creates a demo ótica with realistic data so the app can be
// explored right away.
//
//	DATABASE_URL=... go run ./cmd/seed            # creates if missing
//	DATABASE_URL=... go run ./cmd/seed -reset     # drops and recreates the demo
//
// Login: demo@argus.app / argus123 (override with -email / -password).
package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/middleware"
	"github.com/leonardobarrosx/argus/backend/internal/orders"
	"github.com/leonardobarrosx/argus/backend/internal/stock"
)

func main() {
	email := flag.String("email", "demo@argus.app", "owner login e-mail")
	password := flag.String("password", "argus123", "owner password (min 8 chars)")
	reset := flag.Bool("reset", false, "delete the existing demo ótica first")
	flag.Parse()
	_ = godotenv.Load()

	dsn := os.Getenv("MIGRATION_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, dsn, envOr("APP_TIMEZONE", "America/Sao_Paulo"))
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	var existing *int64
	_ = pool.QueryRow(ctx, `SELECT tenant_id FROM auth_find_login($1)`, *email).Scan(&existing)
	if existing != nil {
		if !*reset {
			log.Printf("demo já existe (tenant %d). Use -reset para recriar.", *existing)
			return
		}
		if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if err := db.SetTenant(ctx, tx, *existing); err != nil {
				return err
			}
			// Orders reference patients with RESTRICT: drop them before the tenant cascade.
			if _, err := tx.Exec(ctx, `DELETE FROM sales WHERE tenant_id=$1`, *existing); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM service_orders WHERE tenant_id=$1`, *existing); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `DELETE FROM tenants WHERE id=$1`, *existing)
			return err
		}); err != nil {
			log.Fatalf("reset: %v", err)
		}
		log.Printf("demo anterior removida")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(*password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal(err)
	}

	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var tid int64
		if err := tx.QueryRow(ctx, `SELECT nextval('tenants_id_seq')`).Scan(&tid); err != nil {
			return err
		}
		if err := db.SetTenant(ctx, tx, tid); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO tenants (id, name, slug, cnpj, phone, email, address, city, state, plan, os_seq, receipt_footer)
			VALUES ($1, 'Ótica Argus Demo', $3, '12.345.678/0001-90', '(11) 3333-4444',
			        $2, 'Av. Paulista, 1000 — Bela Vista', 'São Paulo', 'SP', 'pro', 1467,
			        'Garantia de 90 dias contra defeitos de fabricação. Volte sempre!')`, tid, *email, "otica-argus-demo-"+itoa64(tid)); err != nil {
			return err
		}

		var ownerID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO users (tenant_id, name, email, phone, password_hash, role)
			VALUES ($1, 'Dra. Eliza Silva', $2, '(11) 99999-0001', $3, 'proprietario') RETURNING id`,
			tid, *email, string(hash)).Scan(&ownerID); err != nil {
			return err
		}
		owner := middleware.Actor{TenantID: tid, UserID: ownerID, Name: "Dra. Eliza Silva", Role: middleware.RoleOwner}
		var sellerID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO users (tenant_id, name, email, phone, password_hash, role, commission_pct)
			VALUES ($1, 'Julia Santos', 'julia@argus.app', '(11) 99999-0003', $2, 'vendedor', 8) RETURNING id`,
			tid, string(hash)).Scan(&sellerID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO users (tenant_id, name, email, phone, password_hash, role, commission_pct) VALUES
			  ($1, 'Carlos Mendes', 'carlos@argus.app', '(11) 99999-0002', $2, 'optometrista', 3),
			  ($1, 'Rafael Lima', '', '(11) 99999-0004', NULL, 'montador', 0)`, tid, string(hash)); err != nil {
			return err
		}
		seller := middleware.Actor{TenantID: tid, UserID: sellerID, Name: "Julia Santos", Role: middleware.RoleSeller}

		if err := stock.SeedDefaultLenses(ctx, tx, tid); err != nil {
			return err
		}

		// Suppliers
		sup := map[string]int64{}
		for _, s := range []struct {
			name, cnpj, contact string
			term                int
		}{
			{"Luxottica Brasil", "11.111.111/0001-11", "Marcos — (11) 4000-1000", 30},
			{"Essilor", "22.222.222/0001-22", "Patrícia — (11) 4000-2000", 45},
			{"Zeiss Brasil", "33.333.333/0001-33", "Renato — (11) 4000-3000", 30},
			{"Distribuidora Ótica Geral", "44.444.444/0001-44", "Ana — (11) 4000-4000", 15},
		} {
			var id int64
			if err := tx.QueryRow(ctx, `INSERT INTO suppliers (tenant_id, name, cnpj, contact, credit_term) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
				tid, s.name, s.cnpj, s.contact, s.term).Scan(&id); err != nil {
				return err
			}
			sup[s.name] = id
		}

		// Products + purchase entries (movements with NF)
		type prod struct {
			name, category, supplier string
			qty, min                 int
			price, cost, comm        float64
		}
		products := []prod{
			{"Lentes Blue Light 1.59 (par)", "Lentes", "Zeiss Brasil", 12, 10, 189.90, 85, 5},
			{"Armação Titan Slim M", "Armações", "Luxottica Brasil", 4, 8, 320, 120, 8},
			{"Lente Progres. Office (par)", "Lentes", "Essilor", 6, 5, 350, 150, 5},
			{"Armação Classic Round G", "Armações", "Luxottica Brasil", 22, 10, 280, 95, 8},
			{"Armação Aviador Metal", "Armações", "Luxottica Brasil", 9, 5, 390, 140, 8},
			{"Óculos Solar Polarizado", "Solar", "Luxottica Brasil", 7, 4, 450, 180, 10},
			{"Lentes Transitions Gen8 (par)", "Lentes", "Essilor", 7, 6, 450, 200, 5},
			{"Flanela de microfibra", "Acessórios", "Distribuidora Ótica Geral", 48, 20, 15, 3.5, 0},
			{"Antirreflexo Premium", "Tratamentos", "Zeiss Brasil", 18, 8, 120, 45, 5},
			{"Estojo rígido premium", "Acessórios", "Distribuidora Ótica Geral", 30, 15, 35, 12, 0},
			{"Spray limpa-lentes 60ml", "Produtos de limpeza", "Distribuidora Ótica Geral", 25, 10, 22, 6, 0},
			{"Lente de contato mensal (cx)", "Lentes de contato", "Essilor", 14, 6, 140, 70, 5},
		}
		prodID := map[string]int64{}
		for i, p := range products {
			id := sup[p.supplier]
			var pid int64
			if err := tx.QueryRow(ctx, `
				INSERT INTO products (tenant_id, name, category, min_qty, price, cost_price, commission_pct, supplier_id, supplier_name)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
				tid, p.name, p.category, p.min, p.price, p.cost, p.comm, id, p.supplier).Scan(&pid); err != nil {
				return err
			}
			prodID[p.name] = pid
			nf := "NF-" + itoa(10230+i)
			if _, err := stock.Move(ctx, tx, owner, pid, p.qty, "purchase", "Entrada NF: "+nf+" · "+p.supplier, nil, nil, nf); err != nil {
				return err
			}
		}

		// Patients
		today := time.Now()
		date := func(daysAgo int) string { return today.AddDate(0, 0, -daysAgo).Format("2006-01-02") }
		birthIn := func(days, age int) string {
			return today.AddDate(-age, 0, days).Format("2006-01-02")
		}
		type pat struct {
			name, cpf, phone, birth string
			parent                  string
		}
		pats := []pat{
			{"Marina Costa", "412.522.891-91", "(11) 98765-4321", birthIn(3, 35), ""},
			{"Diego Nunes", "321.118.442-44", "(11) 91234-5678", "1985-06-22", ""},
			{"Lucia Ramos", "155.300.123-12", "(21) 99876-5432", "1978-09-14", ""},
			{"Carla Mendes", "289.455.672-67", "(21) 98765-1234", birthIn(0, 33), ""},
			{"Tiago Costa", "567.789.231-23", "(11) 97654-3210", "1988-08-05", ""},
			{"Pedro Costa", "", "(11) 98765-4321", "2014-04-10", "Marina Costa"},
			{"Sofia Nunes", "", "(11) 91234-5678", "2016-11-02", "Diego Nunes"},
		}
		patID := map[string]int64{}
		for _, p := range pats {
			var parent *int64
			if p.parent != "" {
				v := patID[p.parent]
				parent = &v
			}
			var id int64
			if err := tx.QueryRow(ctx, `
				INSERT INTO patients (tenant_id, parent_id, name, cpf, phone, birth_date) VALUES ($1,$2,$3,$4,$5,$6::date) RETURNING id`,
				tid, parent, p.name, p.cpf, p.phone, p.birth).Scan(&id); err != nil {
				return err
			}
			patID[p.name] = id
		}

		// Prescriptions
		rx := func(sph, cyl, axis, add, dnp, h string) []byte {
			b, _ := json.Marshal(map[string]string{"sph": sph, "cyl": cyl, "axis": axis, "add": add, "dnp": dnp, "height": h})
			return b
		}
		type rxIn struct {
			patient, lens string
			od, oe        []byte
			examAgo       int
			validDays     int
		}
		rxs := []rxIn{
			{"Marina Costa", "Blue Light", rx("-1.25", "-0.50", "90", "", "31.5", "18"), rx("-1.00", "-0.25", "85", "", "31.0", "17"), 350, 365},
			{"Diego Nunes", "Progressiva", rx("-2.75", "-1.00", "180", "+2.00", "32", "20"), rx("-2.50", "-0.75", "175", "+2.00", "31.5", "19"), 40, 365},
			{"Lucia Ramos", "Transitions", rx("+1.50", "-0.25", "45", "", "30", "17"), rx("+1.75", "-0.50", "135", "", "30.5", "17"), 25, 365},
			{"Carla Mendes", "Blue Light", rx("-0.50", "", "", "", "31", "16"), rx("-0.75", "-0.25", "90", "", "31", "16"), 30, 365},
			{"Pedro Costa", "Simples", rx("-0.75", "", "", "", "28", "15"), rx("-0.50", "", "", "", "28", "15"), 10, 365},
			{"Tiago Costa", "Simples", rx("-1.00", "", "", "", "32", "18"), rx("-1.25", "", "", "", "32", "18"), 400, 365},
		}
		rxID := map[string]int64{}
		for _, r := range rxs {
			var id int64
			if err := tx.QueryRow(ctx, `
				INSERT INTO prescriptions (tenant_id, patient_id, rx_od, rx_oe, exam_date, expires_at, lens_type, prescriber, created_by)
				VALUES ($1,$2,$3,$4,$5::date, $5::date + $6::int, $7, 'Carlos Mendes', $8) RETURNING id`,
				tid, patID[r.patient], r.od, r.oe, date(r.examAgo), r.validDays, r.lens, ownerID).Scan(&id); err != nil {
				return err
			}
			rxID[r.patient] = id
		}

		// A closed cash session yesterday and an open one today.
		var closedSession, openSession int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO cash_sessions (tenant_id, opened_by, opened_by_name, closed_by, closed_by_name, opening_amount,
			                           closing_amount, expected_amount, opened_at, closed_at)
			VALUES ($1, $2, 'Julia Santos', $2, 'Julia Santos', 200, 280, 280, NOW() - INTERVAL '1 day 8 hours', NOW() - INTERVAL '1 day')
			RETURNING id`, tid, sellerID).Scan(&closedSession); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO cash_sessions (tenant_id, opened_by, opened_by_name, opening_amount, opened_at)
			VALUES ($1, $2, 'Julia Santos', 200, date_trunc('day', NOW()) + INTERVAL '9 hours') RETURNING id`, tid, sellerID).Scan(&openSession); err != nil {
			return err
		}

		lensIDs := map[string]int64{}
		rows, err := tx.Query(ctx, `SELECT id, name FROM lenses`)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id int64
			var n string
			if err := rows.Scan(&id, &n); err != nil {
				return err
			}
			lensIDs[n] = id
		}
		rows.Close()

		// Historical sales over the last 60 days (for reports and finance).
		hist := []struct {
			daysAgo int
			patient string
			product string
			qty     int
			method  string
		}{
			{58, "Tiago Costa", "Óculos Solar Polarizado", 1, "Cartão crédito"},
			{45, "Lucia Ramos", "Estojo rígido premium", 2, "PIX"},
			{33, "Carla Mendes", "Lente de contato mensal (cx)", 2, "Cartão débito"},
			{20, "Diego Nunes", "Spray limpa-lentes 60ml", 1, "Dinheiro"},
			{12, "Marina Costa", "Óculos Solar Polarizado", 1, "PIX"},
			{1, "Tiago Costa", "Flanela de microfibra", 3, "Dinheiro"},
			{1, "Lucia Ramos", "Estojo rígido premium", 1, "Dinheiro"},
		}
		for _, hs := range hist {
			var price, cost float64
			if err := tx.QueryRow(ctx, `SELECT price, cost_price FROM products WHERE id=$1`, prodID[hs.product]).Scan(&price, &cost); err != nil {
				return err
			}
			total := price * float64(hs.qty)
			session := &closedSession
			if hs.daysAgo != 1 {
				session = nil
			}
			var sid int64
			if err := tx.QueryRow(ctx, `
				INSERT INTO sales (tenant_id, patient_id, session_id, seller_id, seller_name, subtotal, total, payment_method, created_at)
				VALUES ($1,$2,$3,$4,'Julia Santos',$5,$5,$6, NOW() - make_interval(days => $7) + INTERVAL '2 hours') RETURNING id`,
				tid, patID[hs.patient], session, sellerID, total, hs.method, hs.daysAgo).Scan(&sid); err != nil {
				return err
			}
			pid := prodID[hs.product]
			if _, err := tx.Exec(ctx, `
				INSERT INTO sale_items (tenant_id, sale_id, kind, product_id, name, unit_price, unit_cost, qty)
				VALUES ($1,$2,'product',$3,$4,$5,$6,$7)`, tid, sid, pid, hs.product, price, cost, hs.qty); err != nil {
				return err
			}
			if _, err := stock.Move(ctx, tx, seller, pid, -hs.qty, "sale", "Venda PDV #"+itoa64(sid), nil, nil, ""); err != nil {
				return err
			}
		}

		// Service orders in different stages.
		mkOrder := func(patient, frame, lens string, total float64, paid bool, status string, daysAgo int) error {
			fid := prodID[frame]
			lid := lensIDs[lens]
			r := rxID[patient]
			o, err := orders.Create(ctx, tx, seller, orders.Insert{
				PatientID: patID[patient], PrescriptionID: &r, FrameProductID: &fid, LensID: &lid, LensDescription: lens,
				Total: total, Paid: paid, DueDate: today.AddDate(0, 0, 7-daysAgo).Format("2006-01-02"),
			})
			if err != nil {
				return err
			}
			if _, err := stock.Move(ctx, tx, seller, fid, -1, "service_order", orders.Label(o.Number), &o.ID, &r, ""); err != nil {
				return err
			}
			if paid {
				var sid int64
				if err := tx.QueryRow(ctx, `
					INSERT INTO sales (tenant_id, patient_id, order_id, seller_id, seller_name, subtotal, total, payment_method, created_at)
					VALUES ($1, (SELECT COALESCE(parent_id, id) FROM patients WHERE id=$2), $3, $4, 'Julia Santos', $5, $5, 'Cartão crédito',
					        NOW() - make_interval(days => $6)) RETURNING id`,
					tid, patID[patient], o.ID, sellerID, total, daysAgo).Scan(&sid); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO sale_items (tenant_id, sale_id, kind, product_id, lens_id, beneficiary_id, prescription_id, name, unit_price, unit_cost, qty)
					VALUES ($1,$2,'glasses',$3,$4,$5,$6,$7,$8,
					        (SELECT cost_price FROM products WHERE id=$3) + (SELECT cost_price FROM lenses WHERE id=$4), 1)`,
					tid, sid, fid, lid, patID[patient], r, frame+" + "+lens, total); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `UPDATE service_orders SET sale_id=$2 WHERE id=$1`, o.ID, sid); err != nil {
					return err
				}
			}
			_, err = tx.Exec(ctx, `
				UPDATE service_orders SET status=$2,
				       created_at = NOW() - make_interval(days => $3),
				       production_started_at = NOW() - make_interval(days => $3),
				       ready_at = CASE WHEN $2 IN ('ready','delivered') THEN NOW() - make_interval(days => GREATEST($3 - 4, 0)) END,
				       delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() - make_interval(days => GREATEST($3 - 6, 0)) END
				WHERE id=$1`, o.ID, status, daysAgo)
			return err
		}
		if err := mkOrder("Marina Costa", "Armação Classic Round G", "Blue Light 1.56", 469.90, true, "delivered", 15); err != nil {
			return err
		}
		if err := mkOrder("Carla Mendes", "Armação Titan Slim M", "Blue Light 1.56", 509.90, false, "ready", 8); err != nil {
			return err
		}
		if err := mkOrder("Diego Nunes", "Armação Classic Round G", "Progressiva Premium 1.67", 930, true, "production", 3); err != nil {
			return err
		}
		if err := mkOrder("Lucia Ramos", "Armação Aviador Metal", "Transitions Gen8 1.56", 840, false, "production", 2); err != nil {
			return err
		}

		// Accounts payable
		for _, p := range []struct {
			supplier, desc, category string
			amount                   float64
			dueIn                    int
			paid                     bool
		}{
			{"", "Aluguel da loja", "Aluguel", 4500, -10, true},
			{"", "Energia elétrica", "Energia/Água/Internet", 380.45, -5, true},
			{"Luxottica Brasil", "Compra de mercadorias — NF 10231 · Luxottica Brasil", "Mercadorias", 3240, 12, false},
			{"Essilor", "Compra de mercadorias — NF 10232 · Essilor", "Mercadorias", 2380, -2, false},
			{"", "Impulsionamento Instagram", "Marketing", 300, 5, false},
			{"", "Contador", "Serviços", 650, 20, false},
		} {
			var supID *int64
			if p.supplier != "" {
				v := sup[p.supplier]
				supID = &v
			}
			status, paidAt := "pending", any(nil)
			if p.paid {
				status, paidAt = "paid", today.AddDate(0, 0, p.dueIn).Format("2006-01-02")
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO payables (tenant_id, supplier_id, description, category, amount, due_date, status, paid_at, paid_amount, created_by)
				VALUES ($1,$2,$3,$4,$5::numeric, CURRENT_DATE + $6::int, $7, $8::date, CASE WHEN $7='paid' THEN $5::numeric END, $9)`,
				tid, supID, p.desc, p.category, p.amount, p.dueIn, status, paidAt, ownerID); err != nil {
				return err
			}
		}
		log.Printf("demo criada: tenant %d — login %s / %s (vendedora: julia@argus.app, mesma senha)", tid, *email, *password)
		return nil
	})
	if err != nil {
		log.Fatalf("seed: %v", err)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func itoa(n int) string { return itoa64(int64(n)) }

func itoa64(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}
