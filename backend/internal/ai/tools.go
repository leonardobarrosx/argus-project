package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/leonardobarrosx/argus/backend/internal/db"
	"github.com/leonardobarrosx/argus/backend/internal/finance"
	"github.com/leonardobarrosx/argus/backend/internal/httpx"
)

// Tool is a read-only query the assistant can run over the ótica's data.
// Every property is required (strict tool use); "optional" values use "" or 0.
type Tool struct {
	Name        string
	Label       string // shown in the UI while it runs
	Description string
	Properties  map[string]any
	Run         func(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error)
}

func str(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
func integer(desc string) map[string]any {
	return map[string]any{"type": "integer", "description": desc}
}
func enum(desc string, values ...string) map[string]any {
	return map[string]any{"type": "string", "enum": values, "description": desc}
}

const dateDesc = "Data no formato YYYY-MM-DD, ou \"\" para o padrão."

// Tools is the assistant's toolbox.
var Tools = []Tool{
	{
		Name:  "resumo_financeiro",
		Label: "Analisando o financeiro",
		Description: "DRE simplificado do período: receita, descontos, CMV, lucro bruto e margem, despesas pagas por categoria, " +
			"compras de mercadoria, resultado, contas a receber (OS não pagas), contas a pagar pendentes e vencidas, " +
			"receita por forma de pagamento, fluxo de caixa diário (até 62 dias) e comissões por vendedor. " +
			"Padrão: do dia 1 do mês atual até hoje.",
		Properties: map[string]any{"data_inicio": str(dateDesc), "data_fim": str(dateDesc)},
		Run:        runFinanceSummary,
	},
	{
		Name:  "vendas_agrupadas",
		Label: "Consultando as vendas",
		Description: "Vendas concluídas do período agrupadas por dia, semana, mês, vendedor, forma de pagamento, produto " +
			"ou categoria, com total, quantidade de vendas, itens e custo. Use para tendências, rankings e comparações.",
		Properties: map[string]any{
			"data_inicio": str(dateDesc), "data_fim": str(dateDesc),
			"agrupar_por": enum("Como agrupar.", "dia", "semana", "mes", "vendedor", "forma_pagamento", "produto", "categoria"),
		},
		Run: runSalesGrouped,
	},
	{
		Name:  "estoque_atual",
		Label: "Lendo o estoque",
		Description: "Produtos com quantidade, mínimo, custo, preço, fornecedor e valor em estoque. Filtros: todos, baixo " +
			"(no mínimo ou abaixo), zerado, parado (sem saída nos últimos 90 dias).",
		Properties: map[string]any{
			"filtro":    enum("Quais produtos.", "todos", "baixo", "zerado", "parado"),
			"categoria": str("Categoria exata (ex.: Armações, Lentes, Acessórios) ou \"\" para todas."),
		},
		Run: runStock,
	},
	{
		Name:  "sugestao_de_compra",
		Label: "Calculando sugestões de compra",
		Description: "Giro de estoque e sugestão de compra por produto ativo: saídas por venda/OS no histórico, média " +
			"diária, cobertura atual em dias e quantidade sugerida para cobrir o período pedido mais o estoque mínimo, " +
			"com custo estimado, fornecedor e prazo de pagamento. Ordenado por urgência.",
		Properties: map[string]any{
			"dias_historico": integer("Dias de histórico de saídas para calcular o giro (7 a 365). 0 = 90."),
			"dias_cobertura": integer("Para quantos dias a compra deve cobrir (7 a 180). 0 = 30."),
		},
		Run: runPurchaseSuggestions,
	},
	{
		Name:  "movimentacoes_estoque",
		Label: "Analisando movimentações de estoque",
		Description: "Movimentações de estoque do período: totais de entrada e saída por motivo (venda, OS, compra, ajuste, " +
			"contagem, estorno), por produto, e as 60 movimentações mais recentes com responsável e observação. " +
			"Use para auditoria, perdas e divergências.",
		Properties: map[string]any{
			"data_inicio": str(dateDesc), "data_fim": str(dateDesc),
			"produto": str("Parte do nome do produto para filtrar, ou \"\" para todos."),
		},
		Run: runMovements,
	},
	{
		Name:  "ordens_de_servico",
		Label: "Consultando o laboratório",
		Description: "Ordens de serviço: contagem por status e lista (até 100) com paciente, valor, se está paga, previsão " +
			"de entrega e dias em produção. atrasadas_apenas=true traz só OS com previsão vencida e não entregues.",
		Properties: map[string]any{
			"status":           enum("Status.", "todas", "production", "ready", "delivered", "cancelled"),
			"atrasadas_apenas": map[string]any{"type": "boolean", "description": "Só OS atrasadas."},
		},
		Run: runOrders,
	},
	{
		Name:  "contas_a_pagar",
		Label: "Consultando contas a pagar",
		Description: "Contas a pagar com fornecedor, categoria, valor, vencimento e status, além dos totais. O período " +
			"filtra pelo vencimento; use \"\" para não filtrar.",
		Properties: map[string]any{
			"status":      enum("Status.", "todas", "pending", "paid", "cancelled"),
			"data_inicio": str(dateDesc), "data_fim": str(dateDesc),
		},
		Run: runPayables,
	},
	{
		Name:        "caixa",
		Label:       "Conferindo o caixa",
		Description: "Sessões de caixa do período com abertura, fechamento, valor esperado, valor contado e diferença (quebra de caixa).",
		Properties:  map[string]any{"data_inicio": str(dateDesc), "data_fim": str(dateDesc)},
		Run:         runCash,
	},
	{
		Name:  "pacientes",
		Label: "Consultando pacientes",
		Description: "Listas de pacientes para relacionamento: receitas_vencendo (receitas que vencem nos próximos N dias, " +
			"sem receita mais nova), aniversariantes (próximos N dias), sem_compra (última compra há mais de N dias), " +
			"busca (por nome, CPF ou telefone usando termo). Também traz o total de pacientes.",
		Properties: map[string]any{
			"consulta": enum("Tipo de lista.", "receitas_vencendo", "aniversariantes", "sem_compra", "busca"),
			"dias":     integer("Janela em dias (0 = 30)."),
			"termo":    str("Texto da busca, ou \"\"."),
		},
		Run: runPatients,
	},
	{
		Name:        "fornecedores",
		Label:       "Consultando fornecedores",
		Description: "Fornecedores com prazo de pagamento, quantidade de produtos, valor em estoque e contas em aberto.",
		Properties:  map[string]any{},
		Run:         runSuppliers,
	},
}

// ToolByName finds a tool.
func ToolByName(name string) (Tool, bool) {
	for _, t := range Tools {
		if t.Name == name {
			return t, true
		}
	}
	return Tool{}, false
}

// ─── input helpers ───────────────────────────────────────────────────────────

func argStr(in map[string]any, key string) string {
	v, _ := in[key].(string)
	return strings.TrimSpace(v)
}

func argInt(in map[string]any, key string, def, lo, hi int) int {
	var n int
	switch v := in[key].(type) {
	case float64:
		n = int(v)
	case json.Number:
		i, _ := v.Int64()
		n = int(i)
	}
	if n == 0 {
		return def
	}
	return max(lo, min(hi, n))
}

func period(in map[string]any) (string, string, error) {
	return finance.Period(argStr(in, "data_inicio"), argStr(in, "data_fim"))
}

func round2(v float64) float64 { return httpx.Round2(v) }

// ─── tools ───────────────────────────────────────────────────────────────────

func runFinanceSummary(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error) {
	from, to, err := period(in)
	if err != nil {
		return nil, err
	}
	s, err := finance.ComputeSummary(ctx, tx, from, to)
	if err != nil {
		return nil, err
	}
	if len(s.Daily) > 62 {
		s.Daily = nil // keep the payload small; ask vendas_agrupadas for longer series
	}
	return s, nil
}

func runSalesGrouped(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error) {
	from, to, err := period(in)
	if err != nil {
		return nil, err
	}
	group := argStr(in, "agrupar_por")
	var key, join string
	switch group {
	case "dia":
		key = `to_char(s.created_at, 'YYYY-MM-DD')`
	case "semana":
		key = `to_char(date_trunc('week', s.created_at), 'YYYY-MM-DD')`
	case "mes":
		key = `to_char(s.created_at, 'YYYY-MM')`
	case "vendedor":
		key = `COALESCE(NULLIF(s.seller_name, ''), 'Sem vendedor')`
	case "forma_pagamento":
		key = `s.payment_method`
	case "produto":
		key, join = `i.name`, ` JOIN sale_items i ON i.sale_id = s.id`
	case "categoria":
		key = `COALESCE(p.category, CASE i.kind WHEN 'glasses' THEN 'Óculos completos' WHEN 'service_order' THEN 'Recebimento de OS' ELSE 'Outros' END)`
		join = ` JOIN sale_items i ON i.sale_id = s.id LEFT JOIN products p ON p.id = i.product_id`
	default:
		return nil, httpx.Unprocessable("INVALID_GROUP", "agrupar_por inválido")
	}
	type row struct {
		Chave  string  `json:"chave"`
		Total  float64 `json:"total"`
		Vendas int     `json:"vendas"`
		Itens  int     `json:"itens"`
		Custo  float64 `json:"custo"`
		Lucro  float64 `json:"lucro_bruto"`
	}
	var q string
	if join == "" {
		q = `SELECT ` + key + `, SUM(s.total), COUNT(*),
			COALESCE(SUM((SELECT SUM(qty) FROM sale_items x WHERE x.sale_id = s.id)), 0),
			COALESCE(SUM((SELECT SUM(unit_cost * qty) FROM sale_items x WHERE x.sale_id = s.id)), 0)
			FROM sales s`
	} else {
		// Item-level grouping: revenue is the item value (before the sale discount).
		q = `SELECT ` + key + `, SUM(i.unit_price * i.qty), COUNT(DISTINCT s.id), SUM(i.qty), SUM(i.unit_cost * i.qty)
			FROM sales s` + join
	}
	q += ` WHERE s.status = 'completed' AND s.created_at::date BETWEEN $1::date AND $2::date
		GROUP BY 1 ORDER BY ` + map[bool]string{true: "1", false: "2 DESC"}[group == "dia" || group == "semana" || group == "mes"] + ` LIMIT 200`
	rows, err := tx.Query(ctx, q, from, to)
	if err != nil {
		return nil, err
	}
	out, err := db.CollectRows(rows, func(r db.Row) (row, error) {
		var x row
		err := r.Scan(&x.Chave, &x.Total, &x.Vendas, &x.Itens, &x.Custo)
		x.Total, x.Custo = round2(x.Total), round2(x.Custo)
		x.Lucro = round2(x.Total - x.Custo)
		return x, err
	})
	if err != nil {
		return nil, err
	}
	note := ""
	if join != "" {
		note = "Agrupamento por item: total é o valor dos itens antes do desconto da venda."
	}
	return map[string]any{"periodo": []string{from, to}, "agrupado_por": group, "linhas": out, "observacao": note}, nil
}

func runStock(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error) {
	cond := `p.active`
	switch argStr(in, "filtro") {
	case "baixo":
		cond += ` AND p.qty <= p.min_qty`
	case "zerado":
		cond += ` AND p.qty = 0`
	case "parado":
		cond += ` AND p.qty > 0 AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.product_id = p.id AND m.type = 'out'
			AND m.reason IN ('sale', 'service_order') AND m.created_at > NOW() - interval '90 days')`
	}
	type row struct {
		ID         int64   `json:"id"`
		Nome       string  `json:"nome"`
		Categoria  string  `json:"categoria"`
		SKU        string  `json:"sku"`
		Qtd        int     `json:"qtd"`
		Minimo     int     `json:"minimo"`
		Custo      float64 `json:"custo"`
		Preco      float64 `json:"preco"`
		Fornecedor string  `json:"fornecedor"`
		ValorCusto float64 `json:"valor_em_estoque_custo"`
	}
	rows, err := tx.Query(ctx, `SELECT p.id, p.name, p.category, p.sku, p.qty, p.min_qty, p.cost_price, p.price, p.supplier_name
		FROM products p WHERE `+cond+` AND ($1 = '' OR p.category = $1) ORDER BY p.category, p.name LIMIT 300`, argStr(in, "categoria"))
	if err != nil {
		return nil, err
	}
	out, err := db.CollectRows(rows, func(r db.Row) (row, error) {
		var x row
		err := r.Scan(&x.ID, &x.Nome, &x.Categoria, &x.SKU, &x.Qtd, &x.Minimo, &x.Custo, &x.Preco, &x.Fornecedor)
		x.ValorCusto = round2(float64(x.Qtd) * x.Custo)
		return x, err
	})
	if err != nil {
		return nil, err
	}
	var total float64
	units := 0
	for _, r := range out {
		total += r.ValorCusto
		units += r.Qtd
	}
	return map[string]any{"produtos": out, "total_produtos": len(out), "unidades": units, "valor_total_custo": round2(total),
		"observacao": "Lista limitada a 300 produtos ativos."}, nil
}

func runPurchaseSuggestions(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error) {
	hist := argInt(in, "dias_historico", 90, 7, 365)
	cover := argInt(in, "dias_cobertura", 30, 7, 180)
	type row struct {
		ID            int64    `json:"id"`
		Nome          string   `json:"nome"`
		Categoria     string   `json:"categoria"`
		Fornecedor    string   `json:"fornecedor"`
		PrazoFornec   *int     `json:"prazo_fornecedor_dias"`
		Qtd           int      `json:"qtd_atual"`
		Minimo        int      `json:"minimo"`
		Saidas        int      `json:"saidas_no_periodo"`
		MediaDiaria   float64  `json:"media_diaria"`
		CoberturaDias *float64 `json:"cobertura_atual_dias"`
		Sugestao      int      `json:"comprar"`
		CustoUnit     float64  `json:"custo_unitario"`
		CustoTotal    float64  `json:"custo_estimado"`
		Urgencia      string   `json:"urgencia"`
	}
	rows, err := tx.Query(ctx, `
		SELECT p.id, p.name, p.category, p.supplier_name, s.credit_term, p.qty, p.min_qty, p.cost_price,
		       COALESCE((SELECT SUM(CASE WHEN m.type = 'out' THEN m.qty ELSE -m.qty END) FROM stock_movements m
		                 WHERE m.product_id = p.id AND m.created_at > NOW() - make_interval(days => $1)
		                   AND (m.reason IN ('sale', 'service_order') OR m.reason = 'sale_cancel')), 0)
		FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
		WHERE p.active`, hist)
	if err != nil {
		return nil, err
	}
	all, err := db.CollectRows(rows, func(r db.Row) (row, error) {
		var x row
		err := r.Scan(&x.ID, &x.Nome, &x.Categoria, &x.Fornecedor, &x.PrazoFornec, &x.Qtd, &x.Minimo, &x.CustoUnit, &x.Saidas)
		return x, err
	})
	if err != nil {
		return nil, err
	}
	out := make([]row, 0)
	var total float64
	for _, x := range all {
		x.Saidas = max(x.Saidas, 0)
		x.MediaDiaria = math.Round(float64(x.Saidas)/float64(hist)*1000) / 1000
		if x.MediaDiaria > 0 {
			c := math.Round(float64(x.Qtd)/x.MediaDiaria*10) / 10
			x.CoberturaDias = &c
		}
		need := math.Ceil(x.MediaDiaria*float64(cover)) + float64(x.Minimo) - float64(x.Qtd)
		x.Sugestao = int(math.Max(0, need))
		switch {
		case x.Qtd == 0 && (x.Saidas > 0 || x.Minimo > 0):
			x.Urgencia = "ruptura"
		case x.Qtd <= x.Minimo && x.Minimo > 0:
			x.Urgencia = "abaixo_do_minimo"
		case x.CoberturaDias != nil && *x.CoberturaDias < float64(cover):
			x.Urgencia = "cobertura_insuficiente"
		default:
			x.Urgencia = "ok"
		}
		if x.Sugestao == 0 && x.Urgencia == "ok" {
			continue
		}
		x.CustoTotal = round2(float64(x.Sugestao) * x.CustoUnit)
		total += x.CustoTotal
		out = append(out, x)
	}
	rank := map[string]int{"ruptura": 0, "abaixo_do_minimo": 1, "cobertura_insuficiente": 2, "ok": 3}
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if rank[a.Urgencia] != rank[b.Urgencia] {
			return rank[a.Urgencia] < rank[b.Urgencia]
		}
		return a.MediaDiaria > b.MediaDiaria
	})
	if len(out) > 150 {
		out = out[:150]
	}
	return map[string]any{
		"metodo": fmt.Sprintf("comprar = ceil(média diária × %d dias) + mínimo − estoque atual; média sobre os últimos %d dias "+
			"de saídas por venda e OS (estornos descontados).", cover, hist),
		"dias_historico": hist, "dias_cobertura": cover, "itens": out, "custo_total_estimado": round2(total),
		"produtos_ativos_analisados": len(all),
	}, nil
}

func runMovements(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error) {
	from, to, err := period(in)
	if err != nil {
		return nil, err
	}
	product := argStr(in, "produto")
	const where = ` m.created_at::date BETWEEN $1::date AND $2::date AND ($3 = '' OR p.name ILIKE '%' || $3 || '%')`
	type byReason struct {
		Motivo string `json:"motivo"`
		Tipo   string `json:"tipo"`
		Qtd    int    `json:"qtd"`
		Movs   int    `json:"movimentacoes"`
	}
	rows, err := tx.Query(ctx, `SELECT m.reason, m.type, SUM(m.qty), COUNT(*) FROM stock_movements m
		JOIN products p ON p.id = m.product_id WHERE`+where+` GROUP BY 1, 2 ORDER BY 3 DESC`, from, to, product)
	if err != nil {
		return nil, err
	}
	reasons, err := db.CollectRows(rows, func(r db.Row) (byReason, error) {
		var x byReason
		return x, r.Scan(&x.Motivo, &x.Tipo, &x.Qtd, &x.Movs)
	})
	if err != nil {
		return nil, err
	}
	type byProduct struct {
		Produto  string `json:"produto"`
		Entradas int    `json:"entradas"`
		Saidas   int    `json:"saidas"`
		Ajustes  int    `json:"ajustes_e_contagens_liquido"`
		Atual    int    `json:"qtd_atual"`
	}
	rows, err = tx.Query(ctx, `SELECT p.name,
			COALESCE(SUM(m.qty) FILTER (WHERE m.type = 'in'), 0), COALESCE(SUM(m.qty) FILTER (WHERE m.type = 'out'), 0),
			COALESCE(SUM(CASE WHEN m.type = 'in' THEN m.qty ELSE -m.qty END) FILTER (WHERE m.reason IN ('manual_adjustment', 'physical_count')), 0),
			p.qty
		FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE`+where+`
		GROUP BY p.id, p.name, p.qty ORDER BY 3 DESC LIMIT 80`, from, to, product)
	if err != nil {
		return nil, err
	}
	products, err := db.CollectRows(rows, func(r db.Row) (byProduct, error) {
		var x byProduct
		return x, r.Scan(&x.Produto, &x.Entradas, &x.Saidas, &x.Ajustes, &x.Atual)
	})
	if err != nil {
		return nil, err
	}
	type recent struct {
		Data     string `json:"data"`
		Produto  string `json:"produto"`
		Tipo     string `json:"tipo"`
		Motivo   string `json:"motivo"`
		Qtd      int    `json:"qtd"`
		Antes    *int   `json:"antes"`
		Depois   *int   `json:"depois"`
		Usuario  string `json:"usuario"`
		Obs      string `json:"observacao"`
		NotaFisc string `json:"nota_fiscal"`
	}
	rows, err = tx.Query(ctx, `SELECT to_char(m.created_at, 'YYYY-MM-DD HH24:MI'), p.name, m.type, m.reason, m.qty,
			m.previous_qty, m.new_qty, m.performed_by_name, m.notes, m.invoice_number
		FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE`+where+`
		ORDER BY m.created_at DESC, m.id DESC LIMIT 60`, from, to, product)
	if err != nil {
		return nil, err
	}
	latest, err := db.CollectRows(rows, func(r db.Row) (recent, error) {
		var x recent
		return x, r.Scan(&x.Data, &x.Produto, &x.Tipo, &x.Motivo, &x.Qtd, &x.Antes, &x.Depois, &x.Usuario, &x.Obs, &x.NotaFisc)
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"periodo": []string{from, to}, "por_motivo": reasons, "por_produto": products, "recentes": latest,
		"legenda_motivos": map[string]string{"sale": "venda", "service_order": "OS", "purchase": "compra (NF)",
			"manual_adjustment": "ajuste manual", "physical_count": "contagem física", "sale_cancel": "estorno de venda/OS"},
	}, nil
}

func runOrders(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error) {
	status := argStr(in, "status")
	if status == "todas" {
		status = ""
	}
	late, _ := in["atrasadas_apenas"].(bool)
	counts := map[string]int{}
	rows, err := tx.Query(ctx, `SELECT status, COUNT(*) FROM service_orders GROUP BY status`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s string
		var n int
		if err := rows.Scan(&s, &n); err != nil {
			rows.Close()
			return nil, err
		}
		counts[s] = n
	}
	rows.Close()
	type row struct {
		Numero    int     `json:"numero"`
		Paciente  string  `json:"paciente"`
		Status    string  `json:"status"`
		Total     float64 `json:"total"`
		Paga      bool    `json:"paga"`
		Previsao  string  `json:"previsao_entrega"`
		Aberta    string  `json:"aberta_em"`
		DiasProd  int     `json:"dias_desde_abertura"`
		Atrasada  bool    `json:"atrasada"`
		Descricao string  `json:"lente"`
	}
	rows, err = tx.Query(ctx, `SELECT o.number, p.name, o.status, o.total, o.paid,
			COALESCE(to_char(o.due_date, 'YYYY-MM-DD'), ''), to_char(o.created_at, 'YYYY-MM-DD'),
			(CURRENT_DATE - o.created_at::date), (o.due_date IS NOT NULL AND o.due_date < CURRENT_DATE AND o.status IN ('production', 'ready')),
			o.lens_description
		FROM service_orders o JOIN patients p ON p.id = o.patient_id
		WHERE ($1 = '' OR o.status = $1)
		  AND (NOT $2 OR (o.due_date IS NOT NULL AND o.due_date < CURRENT_DATE AND o.status IN ('production', 'ready')))
		ORDER BY o.number DESC LIMIT 100`, status, late)
	if err != nil {
		return nil, err
	}
	list, err := db.CollectRows(rows, func(r db.Row) (row, error) {
		var x row
		return x, r.Scan(&x.Numero, &x.Paciente, &x.Status, &x.Total, &x.Paga, &x.Previsao, &x.Aberta, &x.DiasProd, &x.Atrasada, &x.Descricao)
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"contagem_por_status": counts, "ordens": list,
		"legenda_status": map[string]string{"production": "em produção", "ready": "pronta", "delivered": "entregue", "cancelled": "cancelada"}}, nil
}

func runPayables(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error) {
	status := argStr(in, "status")
	if status == "todas" {
		status = ""
	}
	from, to := argStr(in, "data_inicio"), argStr(in, "data_fim")
	if !httpx.ValidDate(from) || !httpx.ValidDate(to) {
		return nil, httpx.Unprocessable("INVALID_DATE", "datas devem ser YYYY-MM-DD")
	}
	rows, err := tx.Query(ctx, finance.PayableSelect+`
		WHERE ($1 = '' OR p.status = $1)
		  AND ($2 = '' OR p.due_date >= NULLIF($2, '')::date) AND ($3 = '' OR p.due_date <= NULLIF($3, '')::date)
		ORDER BY p.due_date LIMIT 200`, status, from, to)
	if err != nil {
		return nil, err
	}
	list, err := db.CollectRows(rows, finance.ScanPayable)
	if err != nil {
		return nil, err
	}
	today := time.Now().Format("2006-01-02")
	var pending, overdue, paid float64
	for _, p := range list {
		switch p.Status {
		case "pending":
			pending += p.Amount
			if p.DueDate < today {
				overdue += p.Amount
			}
		case "paid":
			if p.PaidAmount != nil {
				paid += *p.PaidAmount
			}
		}
	}
	return map[string]any{"contas": list, "total_pendente": round2(pending), "total_vencido": round2(overdue),
		"total_pago": round2(paid), "hoje": today}, nil
}

func runCash(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error) {
	from, to, err := period(in)
	if err != nil {
		return nil, err
	}
	type row struct {
		ID        int64    `json:"id"`
		Abertura  string   `json:"abertura"`
		Fechament string   `json:"fechamento"`
		AbertoPor string   `json:"aberto_por"`
		Troco     float64  `json:"troco_inicial"`
		Esperado  *float64 `json:"esperado"`
		Contado   *float64 `json:"contado"`
		Diferenca *float64 `json:"diferenca"`
		Obs       string   `json:"observacoes"`
	}
	rows, err := tx.Query(ctx, `SELECT id, to_char(opened_at, 'YYYY-MM-DD HH24:MI'), COALESCE(to_char(closed_at, 'YYYY-MM-DD HH24:MI'), 'aberto'),
			opened_by_name, opening_amount, expected_amount, closing_amount, closing_amount - expected_amount, notes
		FROM cash_sessions WHERE opened_at::date BETWEEN $1::date AND $2::date ORDER BY opened_at DESC LIMIT 120`, from, to)
	if err != nil {
		return nil, err
	}
	list, err := db.CollectRows(rows, func(r db.Row) (row, error) {
		var x row
		return x, r.Scan(&x.ID, &x.Abertura, &x.Fechament, &x.AbertoPor, &x.Troco, &x.Esperado, &x.Contado, &x.Diferenca, &x.Obs)
	})
	if err != nil {
		return nil, err
	}
	var diff float64
	for _, s := range list {
		if s.Diferenca != nil {
			diff += *s.Diferenca
		}
	}
	return map[string]any{"periodo": []string{from, to}, "sessoes": list, "diferenca_acumulada": round2(diff)}, nil
}

func runPatients(ctx context.Context, tx pgx.Tx, in map[string]any) (any, error) {
	days := argInt(in, "dias", 30, 1, 730)
	term := argStr(in, "termo")
	var total int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM patients`).Scan(&total); err != nil {
		return nil, err
	}
	type row struct {
		ID       int64  `json:"id"`
		Nome     string `json:"nome"`
		Telefone string `json:"telefone"`
		Email    string `json:"email"`
		Detalhe  string `json:"detalhe"`
	}
	var q string
	args := []any{days}
	switch argStr(in, "consulta") {
	case "receitas_vencendo":
		q = `SELECT p.id, p.name, p.phone, p.email, 'receita vence em ' || to_char(r.expires_at, 'DD/MM/YYYY')
			FROM prescriptions r JOIN patients p ON p.id = r.patient_id
			WHERE r.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
			  AND NOT EXISTS (SELECT 1 FROM prescriptions r2 WHERE r2.patient_id = r.patient_id AND r2.expires_at > r.expires_at)
			ORDER BY r.expires_at LIMIT 150`
	case "aniversariantes":
		q = `SELECT id, name, phone, email, 'aniversário em ' || to_char(birth_date, 'DD/MM')
			FROM patients WHERE birth_date IS NOT NULL
			  AND to_char(birth_date, 'MM-DD') IN (
			      SELECT to_char(d, 'MM-DD') FROM generate_series(CURRENT_DATE, CURRENT_DATE + $1::int, interval '1 day') d)
			ORDER BY to_char(birth_date, 'MM-DD') < to_char(CURRENT_DATE, 'MM-DD'), to_char(birth_date, 'MM-DD') LIMIT 150`
	case "sem_compra":
		q = `SELECT p.id, p.name, p.phone, p.email, 'última compra em ' || to_char(MAX(s.created_at), 'DD/MM/YYYY')
			FROM patients p JOIN sales s ON s.patient_id = p.id AND s.status = 'completed'
			GROUP BY p.id HAVING MAX(s.created_at) < NOW() - make_interval(days => $1)
			ORDER BY MAX(s.created_at) LIMIT 150`
	case "busca":
		if term == "" {
			return nil, httpx.Unprocessable("INVALID_TERM", "informe o termo da busca")
		}
		q = `SELECT id, name, phone, email, COALESCE('nascimento ' || to_char(birth_date, 'DD/MM/YYYY'), '')
			FROM patients WHERE $1::int > 0 AND (name ILIKE '%' || $2 || '%' OR cpf = $2 OR phone ILIKE '%' || $2 || '%')
			ORDER BY name LIMIT 50`
		args = append(args, term)
	default:
		return nil, httpx.Unprocessable("INVALID_QUERY", "consulta inválida")
	}
	rows, err := tx.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	list, err := db.CollectRows(rows, func(r db.Row) (row, error) {
		var x row
		return x, r.Scan(&x.ID, &x.Nome, &x.Telefone, &x.Email, &x.Detalhe)
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"total_pacientes": total, "pacientes": list, "dias": days}, nil
}

func runSuppliers(ctx context.Context, tx pgx.Tx, _ map[string]any) (any, error) {
	type row struct {
		Nome          string  `json:"nome"`
		Prazo         int     `json:"prazo_dias"`
		Ativo         bool    `json:"ativo"`
		Produtos      int     `json:"produtos"`
		ValorEstoque  float64 `json:"valor_em_estoque_custo"`
		ContasAbertas float64 `json:"contas_em_aberto"`
		Contato       string  `json:"contato"`
	}
	rows, err := tx.Query(ctx, `SELECT s.name, s.credit_term, s.active,
			(SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id),
			COALESCE((SELECT SUM(p.qty * p.cost_price) FROM products p WHERE p.supplier_id = s.id), 0),
			COALESCE((SELECT SUM(amount) FROM payables y WHERE y.supplier_id = s.id AND y.status = 'pending'), 0),
			TRIM(s.contact || ' ' || s.phone)
		FROM suppliers s ORDER BY s.active DESC, s.name LIMIT 200`)
	if err != nil {
		return nil, err
	}
	list, err := db.CollectRows(rows, func(r db.Row) (row, error) {
		var x row
		return x, r.Scan(&x.Nome, &x.Prazo, &x.Ativo, &x.Produtos, &x.ValorEstoque, &x.ContasAbertas, &x.Contato)
	})
	return map[string]any{"fornecedores": list}, err
}
