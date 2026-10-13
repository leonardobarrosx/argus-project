# ARGUS — Gestão para óticas

SaaS multi-tenant para óticas: PDV com montagem de óculos (armação + lente + receita),
ordens de serviço do laboratório, pacientes e dependentes, prescrições, estoque com
trilha de auditoria fiscal/gerencial/física, caixa, financeiro, fornecedores, equipe com
perfis de acesso e relatórios.

A arquitetura segue o padrão dos projetos **VESTA** e **meuchamado**: API em Go
(Gin + pgx + JWT), PostgreSQL com Row Level Security por tenant e front-end React + Vite.

---

## Stack

| Camada    | Tecnologia |
|-----------|------------|
| Backend   | Go 1.23, Gin, pgx/v5, JWT HS256 + refresh token rotativo (cookie httpOnly) |
| Banco     | PostgreSQL 16 — schema compartilhado com `tenant_id` + **RLS** |
| Frontend  | React 19, Vite, TypeScript, Tailwind CSS |
| Testes    | Testes de integração Go contra Postgres real (rodando sob role restrito) |
| Deploy    | Dockerfiles (API e web/nginx) + `docker-compose.yml` |

```
.
├── backend/                 API Go
│   ├── cmd/server           servidor HTTP (aplica migrations no boot se MIGRATION_DATABASE_URL)
│   ├── cmd/migrate          aplica migrations embutidas
│   ├── cmd/seed             cria a ótica de demonstração
│   └── internal/
│       ├── db/migrations    SQL (embed) — schema, RLS e funções de auth
│       ├── auth, team, tenant, patients, suppliers, stock,
│       ├── orders, sales, cash, finance, bootstrap
│       └── router           monta as rotas + testes de integração
├── src/                     front-end React
│   ├── api/                 cliente HTTP (refresh automático), DTOs e mapeadores
│   ├── pages/               telas (PDV, Caixa, Laboratório, Financeiro, …)
│   └── lib/                 permissões por perfil, impressão de recibo/OS
├── deploy/                  nginx do front e init do role do banco
└── docker-compose.yml
```

## Rodando com Docker

```bash
docker compose up -d --build
# cria a ótica de demonstração (login demo@argus.app / argus123)
docker compose exec api argus-seed
```

- Front: http://localhost:8081
- API: http://localhost:8080 (`/health`)

## Rodando em desenvolvimento

Pré-requisitos: Go 1.23+, Node 20+, PostgreSQL 16.

```bash
# 1. Banco + role restrito da API (sem bypass de RLS)
createdb argus
psql -d argus -c "CREATE ROLE argus_app LOGIN PASSWORD 'argus_app';"

# 2. API
cp backend/.env.example backend/.env   # ajuste as URLs do banco
cd backend
go run ./cmd/migrate                    # usa MIGRATION_DATABASE_URL (dono das tabelas)
go run ./cmd/seed                       # opcional: dados de demonstração
go run ./cmd/server                     # :8080

# 3. Front (outro terminal, na raiz)
npm install
npm run dev                             # :5173 — /api é encaminhado para :8080
```

Logins da demonstração: `demo@argus.app` (proprietária) e `julia@argus.app`
(vendedora), ambos com a senha `argus123`. Recrie a demo com `go run ./cmd/seed -reset`.

### Testes

```bash
cd backend
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/argus_test?sslmode=disable \
TEST_APP_DATABASE_URL=postgres://argus_app:argus_app@localhost:5432/argus_test?sslmode=disable \
go test ./...
```

Os testes cobrem autenticação (login, refresh, troca de senha, logout), o fluxo
PDV → OS a receber → recebimento → entrega, caixa (sangria e fechamento), OS do
laboratório com cancelamento e estorno, permissões por perfil e isolamento entre óticas
(inclusive validando o RLS com o role restrito).

Front: `npx tsc -b && npm run lint && npm run build`.

---

## Multi-tenant e segurança

- Toda query de negócio roda em `db.TenantTx`, que faz `set_config('app.tenant_id', …)`
  na transação. As policies de RLS (`006_rls.sql`) garantem o isolamento mesmo que uma
  query esqueça o filtro — **desde que a API use um role que não seja dono das tabelas**
  (`argus_app`). Migrations e seed rodam com o dono.
- Login e rotação de refresh token usam funções `SECURITY DEFINER` mínimas
  (`auth_find_login`, `auth_find_refresh`, `auth_email_taken`).
- Access token JWT curto (15 min) apenas em memória no front; refresh token aleatório,
  armazenado como hash SHA-256, rotacionado a cada uso, em cookie `httpOnly` +
  `SameSite=Strict`. Trocar senha encerra as demais sessões.
- Rate limit por IP nas rotas públicas (login/cadastro) e por usuário nas autenticadas;
  headers de segurança e CORS por allowlist.

## Perfis de acesso

| Perfil        | Acesso |
|---------------|--------|
| Proprietário  | Tudo, inclusive cadastrar gerentes |
| Gerente       | Tudo, exceto gerenciar proprietários/gerentes |
| Vendedor / Atendente | PDV, caixa, pacientes, receitas, laboratório (consulta e avanço) |
| Optometrista  | Pacientes, receitas, abertura de OS, laboratório |
| Montador      | Laboratório (avançar OS), consulta de estoque |

Colaboradores podem existir **sem acesso** ao sistema (aparecem em equipe e comissões).

## Regras de negócio principais

- **PDV**: produtos avulsos saem do estoque na hora. Cada óculos consome a armação do
  estoque e pode gerar uma OS. Com “OS já paga” o valor entra na venda; sem isso os
  óculos ficam **a receber** na OS e são cobrados na entrega.
- **OS**: produção → pronto → entregue. A entrega exige a OS paga. Receita vencida não
  abre OS e cada receita só tem uma OS ativa. Cancelar OS (não paga) devolve o estoque.
- **Caixa**: vendas e recebimentos exigem caixa aberto (configurável). Fechamento compara
  o dinheiro contado com o esperado (troco + vendas em dinheiro + suprimentos − sangrias).
- **Cancelamento de venda** (gerência): devolve produtos ao estoque, cancela as OS
  geradas pela venda e reverte recebimentos de OS para “a receber”.
- **Estoque**: quantidade só muda por entrada de NF (que pode lançar a conta a pagar no
  prazo do fornecedor), venda, OS, ajuste justificado, contagem física ou estorno — tudo
  registrado na trilha de auditoria.
- **Financeiro**: contas a pagar, contas a receber (OS), DRE simplificado (receita, CMV
  pelo custo registrado em cada venda, despesas), fluxo de caixa diário, formas de
  pagamento e comissões por vendedor.

## API (resumo)

Todas as rotas abaixo de `/api` exigem `Authorization: Bearer <token>`, exceto auth pública.

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/auth/register` · `/auth/login` · `/auth/refresh` · `/auth/logout` | Sessão |
| GET  | `/auth/me` · POST `/auth/change-password` | Conta |
| GET  | `/bootstrap` | Todos os dados da ótica para o app |
| GET/PUT | `/tenant` | Dados e regras da ótica |
| GET/POST/PUT | `/users`, `/users/:id`, POST `/users/:id/toggle-active` | Equipe |
| GET/POST/PUT | `/patients`, `/patients/:id` · GET/POST `/prescriptions` | Pacientes e receitas |
| GET/POST/PUT | `/suppliers`, `/suppliers/:id` | Fornecedores |
| GET/POST/PUT | `/products`, `/products/:id` · `/lenses`, `/lenses/:id` | Catálogo |
| POST | `/stock/adjust` · `/stock/entries` · GET `/stock/movements` | Estoque |
| GET/POST | `/orders` · POST `/orders/:n/advance` · `/orders/:n/pay` · `/orders/:n/cancel` | OS |
| GET/POST | `/sales` · POST `/sales/:id/cancel` | PDV |
| GET | `/cash/current` · `/cash/sessions` · POST `/cash/open` · `/cash/close` · `/cash/movements` | Caixa |
| GET/POST | `/payables` · POST `/payables/:id/pay` · `/payables/:id/cancel` · GET `/finance/summary` | Financeiro |

Erros seguem `{ "error": "mensagem", "code": "CODIGO" }` (ex.: `CASH_CLOSED`,
`ORDER_UNPAID`, `INSUFFICIENT_STOCK`, `EXPIRED_PRESCRIPTION`).
