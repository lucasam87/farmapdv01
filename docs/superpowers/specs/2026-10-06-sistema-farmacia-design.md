# Spec — Sistema de Gestão para Farmácia (substituto do Nex)

- **Data:** 06/10/2026
- **Origem:** revisão de `PLANO-SISTEMA-FARMACIA.md` (plano do Lucas)
- **Status:** design aprovado em conversa; aguardando revisão do arquivo
- **Autor da revisão:** arquiteto/engenheiro sênior (sessão DSH)

---

## 1. Objetivo e critério de sucesso

Substituir o Nex (PDV) na farmácia do Lucas por um sistema próprio, simples o
suficiente para ser usado no balcão sob pressão, e confiável o suficiente para
que o dinheiro e o estoque nunca divirjam do que aconteceu de verdade.

**Sucesso da v1:** o Lucas abre o link no computador do balcão, abre o caixa,
faz uma venda inteira só com o teclado, o estoque cai, o crediário respeita o
limite, e o fechamento do dia fecha. Depois de 1–2 semanas em paralelo com o
Nex, os totais do dia batem todos os dias e ele pode abandonar o Nex.

**Sucesso não é** ter todas as funções de um ERP. É ter **poucas funções que
nunca mentem**.

---

## 2. Decisões aprovadas

| # | Decisão | Escolha | Consequência assumida |
|---|---|---|---|
| D1 | Lote e validade | **Fora da v1** | Sem alerta de vencimento. Depende de conferência física. A v2 é aditiva (ver D7) |
| D2 | Controle de caixa | **Dentro da v1**, completo | Abertura, sangria, suprimento, fechamento com diferença |
| D3 | Usuários | **Login próprio por pessoa**, com papel | Cancelamento de venda restrito ao dono; toda escrita assinada |
| D4 | Pagamento dividido | **Dentro da v1** | `venda_pagamentos`; `vendas.forma_pagamento` deixa de existir |
| D5 | Terminais | **1 ponto de venda** | Modelo já identificado por `terminal`, sem custo de UI |
| D6 | Arquitetura | **O banco manda, a tela obedece** | Toda escrita transacional em função SQL; leitura em view |
| D7 | Livro-razão de estoque | **`estoque_movimentos` é a verdade** | Lote/validade viram coluna e tabela novas, sem reescrever PDV nem histórico |
| D8 | Testes SQL | **Obrigatórios desde a Etapa 2** | Nenhuma etapa de dinheiro/estoque fecha sem a suíte passar |

**Regra 8 do plano original** ("se uma decisão técnica puder travar o projeto
mais adiante, avise antes de seguir") foi aplicada: D1, D4 e D6 foram
levantadas antes de qualquer código, porque mudá-las depois custaria refazer
venda, caixa e relatórios.

---

## 3. Escopo

**Dentro da v1:** vendas (PDV + histórico), produtos e estoque, clientes e
crediário, caixa, relatórios, agente de IA somente leitura, importação CSV,
publicação.

**Fora da v1:** nota fiscal (NFC-e/NF-e), SNGPC/controlados, catálogo online,
multi-loja, lote/validade, impressora de cupom, leitor com cadastro próprio,
agente com permissão de escrita.

> **Aviso legal que acompanha o projeto:** sem NFC-e e sem SNGPC este sistema
> **não substitui legalmente** o Nex. Ele é um sistema de controle interno. O
> uso paralelo da Etapa 11 não é opcional.

---

## 4. Arquitetura em camadas

```
Navegador (React Server/Client Components)
   │  lê view · chama RPC · NUNCA calcula dinheiro
   ▼
Next.js na Vercel
   │  autentica · checa papel · transporta · única rota de IA: /api/agente
   ▼
Postgres (Supabase, sa-east-1)
   ├─ tabelas  → fatos
   ├─ funções  → autoridade de escrita (transacional)
   └─ views    → autoridade de leitura (somas, fuso, filtros)
```

**Fronteiras, em regras verificáveis:**

1. O navegador envia **intenção** (`produto_id`, `quantidade`, `forma`,
   `valor`), nunca preço, nunca total.
2. O Next.js não faz aritmética de dinheiro nem decide regra de negócio.
3. O Postgres decide preço, desconto, limite, estoque, troco e caixa. É o
   único lugar com regra.
4. O agente de IA só lê, pelas mesmas views. Nunca SQL livre.
5. A chave secreta (`DEEPSEEK_API_KEY`) existe apenas no servidor.

---

## 5. Contrato de RPCs

Estas são as únicas escritas que o front pode provocar:

| RPC | Papel | Efeito |
|---|---|---|
| `abrir_caixa(p_valor_inicial)` | dono, atendente | Abre a sessão; recusa se já houver uma aberta |
| `caixa_movimento(p_tipo, p_valor, p_motivo)` | dono, atendente | `sangria` ou `suprimento` |
| `fechar_caixa(p_valor_contado, p_observacao)` | dono | Calcula `esperado_dinheiro` e `diferenca`; torna a sessão imutável |
| `registrar_venda(p_chave_idempotencia, p_cliente_id, p_itens, p_pagamentos, p_desconto)` | dono, atendente | Venda + itens + pagamentos + estoque + caixa + crediário, atômico. Devolve `jsonb {id, numero, total, troco}` |
| `cancelar_venda(p_venda_id, p_motivo)` | **dono** | Devolve estoque, estorna caixa e crediário |
| `receber_pagamento(p_cliente_id, p_valor, p_forma)` | dono, atendente | Baixa parcial no crediário |
| `produto_entrada(p_produto_id, p_quantidade, p_custo, p_motivo)` | dono, atendente | Soma estoque, grava movimento |
| `produto_ajuste(p_produto_id, p_novo_saldo, p_motivo)` | dono, atendente | Grava o **delta** com motivo obrigatório |
| `importar_produtos(p_linhas jsonb, p_atualizar_existentes boolean)` | dono | Tudo ou nada |

Todas as funções: `security definer`, `set search_path = public, pg_temp`, e
verificação de papel no início.

---

## 6. Views de leitura

Todas já embutem `status = 'concluida'` e o fuso `America/Sao_Paulo`. Ninguém
precisa lembrar dessas duas coisas ao escrever tela.

| View | Entrega |
|---|---|
| `v_caixa_atual` | Sessão aberta, valor inicial, vendas em dinheiro, sangrias, suprimentos, esperado até agora |
| `v_vendas_dia` | Vendas por dia (fuso SP): total, quantidade, ticket médio |
| `v_vendas_lista` | Histórico paginado com resumo dos itens e formas de pagamento |
| `v_estoque_baixo` | `estoque_atual <= estoque_minimo` e `ativo` |
| `v_estoque_zerado` | `estoque_atual = 0` e `ativo` |
| `v_clientes_devedores` | Saldo por cliente (compra − pagamento), maior primeiro |
| `v_mais_vendidos` | Ranking por período |
| `v_lucro_periodo` | `(preco_unitario − preco_custo) × quantidade` |
| `v_estoque_parado` | Ativos sem venda há 60 dias |
| `v_formas_pagamento` | Totais por forma no período, a partir de `venda_pagamentos` |

> A parcela lançada em `crediario` aparece em `venda_pagamentos` (composição do
> pagamento) **e** em `crediario_lancamentos` (a dívida em si). São dois ângulos
> do mesmo fato, não duplicidade: `v_formas_pagamento` mostra composição, e o
> saldo devedor do cliente vem sempre de `crediario_lancamentos`. O crediário
> **nunca** entra em `esperado_dinheiro`.

---

## 7. Modelo de dados

Este capítulo descreve o **estado final** do banco. A migration `001_base.sql`
já cria as tabelas nessa forma final; as seções 7.2 e 7.3 destacam o que é novo
ou diferente em relação ao SQL do plano original, para rastreabilidade.

**Ordem de criação** (as chaves estrangeiras exigem): `perfis` → `produtos` →
`clientes` → `caixa_sessoes` → `vendas` → `venda_itens` → `venda_pagamentos` →
`caixa_movimentos` → `estoque_movimentos` → `crediario_lancamentos`.

### 7.1 Tabelas mantidas (com correções)

```sql
-- PERFIS: espelha auth.users. Papel decide permissão.
create table perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  papel text not null check (papel in ('dono','atendente')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- PRODUTOS
create table produtos (
  id uuid primary key default gen_random_uuid(),
  codigo_barras text unique,
  nome text not null,
  categoria text,
  unidade text not null default 'un',
  preco_custo integer not null default 0 check (preco_custo >= 0),
  preco_venda integer not null default 0 check (preco_venda >= 0),
  estoque_atual integer not null default 0 check (estoque_atual >= 0),
  estoque_minimo integer not null default 0 check (estoque_minimo >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index produtos_nome_trgm on produtos using gin (nome gin_trgm_ops);
create index produtos_codigo on produtos (codigo_barras);
create index produtos_ativo on produtos (ativo);

-- CLIENTES
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  cpf text unique,
  limite_credito integer not null default 0 check (limite_credito >= 0),
  bloqueado boolean not null default false,
  observacao text,
  criado_em timestamptz not null default now()
);
```

### 7.2 Tabelas novas

```sql
-- CAIXA: uma sessão aberta por terminal, garantido por índice único parcial
create table caixa_sessoes (
  id uuid primary key default gen_random_uuid(),
  terminal text not null default 'balcao',
  status text not null default 'aberto' check (status in ('aberto','fechado')),
  aberto_por uuid not null references perfis(id),
  aberto_em timestamptz not null default now(),
  valor_inicial integer not null default 0 check (valor_inicial >= 0),
  fechado_por uuid references perfis(id),
  fechado_em timestamptz,
  valor_contado integer,
  esperado_dinheiro integer,
  diferenca integer,
  observacao text
);
create unique index caixa_um_aberto_por_terminal
  on caixa_sessoes (terminal) where status = 'aberto';

create table caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references caixa_sessoes(id),
  tipo text not null check (tipo in
    ('venda','recebimento_crediario','sangria','suprimento','cancelamento','ajuste')),
  forma text check (forma in ('dinheiro','pix','debito','credito','crediario')),
  valor integer not null,          -- positivo entra no caixa, negativo sai
  venda_id uuid references vendas(id),
  motivo text,
  usuario_id uuid not null references perfis(id),
  criado_em timestamptz not null default now()
);
create index caixa_movimentos_sessao on caixa_movimentos (sessao_id);

-- PAGAMENTOS: uma venda, N pagamentos
create table venda_pagamentos (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references vendas(id) on delete cascade,
  forma text not null check (forma in ('dinheiro','pix','debito','credito','crediario')),
  valor integer not null check (valor > 0)
);
create index venda_pagamentos_venda on venda_pagamentos (venda_id);
```

### 7.3 Tabelas alteradas

```sql
-- VENDAS: forma_pagamento sai; caixa, autoria, idempotência e cancelamento entram
alter table vendas
  add column chave_idempotencia uuid not null unique,
  add column caixa_sessao_id uuid not null references caixa_sessoes(id),
  add column usuario_id uuid not null references perfis(id),
  add column cancelado_em timestamptz,
  add column cancelado_por uuid references perfis(id),
  add column motivo_cancelamento text,
  add constraint vendas_desconto_ok check (desconto >= 0 and desconto <= subtotal),
  add constraint vendas_total_ok check (total = subtotal - desconto),
  add constraint vendas_troco_ok check (troco >= 0);

create index vendas_criado_em on vendas (criado_em desc);
create index vendas_caixa on vendas (caixa_sessao_id);
create index vendas_cliente on vendas (cliente_id);

-- ITENS: garante que o carrinho foi agregado por produto
alter table venda_itens
  add constraint venda_itens_produto_unico unique (venda_id, produto_id);

-- ESTOQUE: auditoria completa (livro-razão — base da v2 com lote/validade)
alter table estoque_movimentos
  add column saldo_apos integer not null,
  add column usuario_id uuid not null references perfis(id),
  add constraint estoque_movimentos_qtd_nao_zero check (quantidade <> 0);

-- CREDIÁRIO: autoria, forma do pagamento e estorno rastreável
alter table crediario_lancamentos
  add column forma_pagamento text,
  add column estorna_lancamento_id uuid references crediario_lancamentos(id),
  add column usuario_id uuid not null references perfis(id);
```

### 7.4 RLS

- RLS ativado em **todas** as tabelas, sem exceção.
- Políticas **idempotentes**: `drop policy if exists` antes de `create policy`.
- `perfis`: leitura para autenticados; escrita só pelo painel/SQL.
- Demais tabelas: `for all to authenticated using (true) with check (true)` na
  v1 (loja única, todos os usuários são da farmácia).
- **A restrição de papel não fica só na RLS.** "Só o dono cancela" é checado
  dentro da função, onde a intenção é legível e testável.

---

## 8. Regras de negócio

### 8.1 `registrar_venda` — ordem exata

1. Papel autorizado. **Chave de idempotência já usada?** Então devolve a venda
   existente e encerra — antes de qualquer outra validação.
2. **Caixa aberto?** Não → `Abra o caixa para começar a vender.` Nada gravado.
3. `p_itens` não vazio.
4. **Agregar itens por `produto_id`** (×3 + ×4 → ×7). ← corrige A1.
5. Cada item: produto existe, `ativo`, quantidade inteira `> 0`. ← corrige A2.
6. Travar linhas com `for update` em **ordem fixa** (`order by produto_id`) —
   evita deadlock entre vendas simultâneas.
7. Estoque suficiente para o total agregado.
8. `subtotal` = Σ `preco_venda` (do banco) × quantidade.
9. Desconto `>= 0` e `<= subtotal`.
10. Pagamentos:
    - `pix`, `debito`, `credito`: **não podem exceder** o total.
    - `crediario`: exige cliente, cliente não bloqueado, `limite_credito > 0`,
      e a dívida + parcela `<= limite`.
    - `dinheiro`: cobre o que falta e pode exceder.
    - `troco = dinheiro − (total − crediario − pix − debito − credito)`.
    - Σ pagamentos `>=` total.
11. Grava venda, itens, pagamentos, baixa de estoque + movimentos, movimento de
    caixa (um por forma) e lançamento de crediário.

### 8.2 `cancelar_venda` — matriz de decisão

| Situação | Resultado |
|---|---|
| Quem não é dono | recusa: `Só o dono pode cancelar vendas.` |
| Venda já cancelada | recusa informando data e hora do cancelamento |
| Caixa da venda **aberto** | cancela: estoque de volta (`cancelamento`), estorno no caixa, estorno no crediário |
| Caixa da venda **fechado** | **bloqueia**: `Venda do dia dd/mm com caixa já fechado. Registre um estorno no caixa de hoje (sangria com motivo).` |
| Cliente pagou parte da dívida **depois** da venda | **bloqueia**: `O cliente já fez pagamento após esta venda. Estorne o pagamento antes.` |

Bloquear é preferível a inventar: reescrever um fechamento assinado ou gerar
saldo credor por engano é pior que um telefonema. **Ponto a revisar** se
incomodar o balcão na prática.

### 8.3 Caixa

```
esperado_dinheiro = valor_inicial
                  + vendas em dinheiro (líquidas de troco)
                  + recebimentos de crediário em dinheiro
                  + suprimentos
                  − sangrias
                  − cancelamentos em dinheiro
diferenca = valor_contado − esperado_dinheiro
```

- Diferença diferente de zero **não bloqueia** o fechamento, mas **exige
  observação**.
- Sessão fechada é **imutável**.
- Uma sessão aberta por terminal (índice único parcial).

### 8.4 Crediário

- `limite_credito = 0` significa **não faz crediário**. Não significa ilimitado.
- Pagamento parcial permitido; pagamento **maior** que a dívida é recusado.
  Nunca gerar saldo credor.
- Saldo = Σ `compra` − Σ `pagamento`, sempre por view.
- Cobrança no WhatsApp apenas **abre** o link `wa.me`; nunca envia nada.
- `receber_pagamento` **exige caixa aberto**: é dinheiro entrando no balcão. Sem
  caixa, a mensagem é a mesma da venda.

### 8.5 Primeiro acesso e perfis

- Não existe autocadastro. O usuário é criado no Supabase Auth e, logo depois, a
  linha correspondente entra em `perfis` com `papel = 'dono'` (painel ou SQL).
- Usuário logado **sem** linha em `perfis` → acesso negado com
  `Usuário sem perfil cadastrado. Fale com o responsável.`
- Cadastro público (sign-ups) desativado; em produção, confirmado na Etapa 9.

### 8.6 Estoque

- **Ajuste** grava o **delta** (não o saldo novo) com motivo obrigatório.
- **Entrada** soma ao estoque e atualiza `preco_custo` quando informado.
- `estoque_atual >= 0` é garantido no banco. Se o sistema diz 0 e a prateleira
  tem 3, o caminho é ajuste de inventário — não venda forçada.
- Produto com venda nunca é apagado: só `ativo = false`.

### 8.7 Importação CSV

- Nada é gravado até confirmação explícita; importação é tudo ou nada.
- Prévia das 5 primeiras linhas.
- Mostra linhas válidas/inválidas **e a soma dos preços da planilha ao lado da
  soma do que será gravado** — divergência é sinal de decimal lido errado
  (erro de fator 100).
- Regras explícitas de leitura: separador `;` ou `,` detectado; decimal com
  vírgula **ou** ponto; encoding detectado, com aviso quando Latin-1.
- Código de barras existente **atualiza**; vazio vira `null`.

---

## 9. Mensagens de erro

Todas em português, sem termo técnico, dizendo o que fazer.

| Situação | Mensagem |
|---|---|
| Caixa fechado | Abra o caixa para começar a vender. |
| Estoque insuficiente | Estoque insuficiente para DIPIRONA 500mg (sistema: 5, pedido: 7). Faça um ajuste de inventário. |
| Cliente bloqueado | Este cliente está bloqueado para crediário. |
| Sem crediário | Este cliente não tem crediário liberado. |
| Limite excedido | Limite excedido. Dívida atual R$ 120,00 + esta venda R$ 45,00 = R$ 165,00 (limite R$ 150,00). |
| Cartão acima do total | O valor no cartão não pode ser maior que o total. |
| Falta pagamento | Faltam R$ 12,00 para fechar a venda. |
| Desconto inválido | O desconto não pode ser maior que o subtotal. |
| Pagamento acima da dívida | O valor é maior que a dívida (R$ 47,50). |
| Cancelamento sem permissão | Só o dono pode cancelar vendas. |
| Cancelamento tardio | Venda do dia 05/10 com caixa já fechado. Registre um estorno no caixa de hoje (sangria com motivo). |

---

## 10. Interface (regra 9 do plano original: usuário com TDAH)

- Menu lateral fixo com 9 entradas, nomes curtos: Vendas, Nova venda, Produtos,
  Estoque, Clientes, Crediário, Caixa, Relatórios, Agente.
- Uma tarefa por tela. Poucos botões. Fontes grandes. Cores calmas.
- Sem tabela lotada: lista enxuta, detalhe ao clicar.
- **PDV só com teclado:** F3 abre `/vendas/nova` de qualquer tela **com
  `preventDefault()`** (senão o Chrome intercepta), busca sempre focada, Enter
  adiciona, setas escolhem quando houver mais de um resultado, total grande e
  em destaque.
- Após finalizar: confirmação, tela limpa, foco de volta na busca.
- Ocultar valores no histórico (como no Nex).

---

## 11. Erros corrigidos no plano original

Rastreabilidade: o que foi encontrado na revisão de `PLANO-SISTEMA-FARMACIA.md`.

### 11.1 Bugs de SQL

| ID | Problema | Correção |
|---|---|---|
| A1 | Mesmo produto repetido no carrinho passava na validação linha a linha → estoque negativo | Agregar por `produto_id` antes de validar; constraint `estoque_atual >= 0`; teste dedicado |
| A2 | Quantidade negativa/zero não era validada → estoque aumentava e subtotal ficava negativo | Validação explícita de inteiro `> 0` por item |
| A3 | `criado_em::date` agrupa em UTC → venda após 21h cai no dia seguinte | Todas as agregações usam `(criado_em at time zone 'America/Sao_Paulo')::date`, dentro das views |
| A4 | Desconto negativo e `valor_pago` incoerente não eram checados; troco calculado em PIX | Constraints + regra de pagamentos por forma + troco só sobre dinheiro |
| A5 | `create policy` não idempotente → reaplicar migration quebra | `drop policy if exists` antes de criar |
| A6 | `cancelar_venda` só descrita, sem tratar crediário já pago | Função especificada com matriz de decisão (§8.2) |
| A7 | Venda cancelada entrava no faturamento | `cancelado_em`/`cancelado_por`/`motivo_cancelamento` + `status='concluida'` embutido nas views |
| A8 | `registrar_venda` devolvia só o uuid | Devolve `jsonb {id, numero, total, troco}` |
| A9 | `p_itens` vazio gerava venda de R$ 0; sem `security definer`/`search_path` | Guarda de carrinho vazio + `security definer` com `search_path` fixo |

### 11.2 Lacunas de domínio

| ID | Lacuna | Tratamento |
|---|---|---|
| B1 | Sem lote/validade | **Decisão D1**: fora da v1, com livro-razão preservado para v2 aditiva |
| B2 | Saldo do crediário não era migrado; não havia importação de cliente | Etapa 6 passa a incluir importação de cliente **com saldo devedor inicial**; Etapa 10 confere os saldos |
| B3 | CSV pt-BR (`;`, vírgula decimal, Latin-1) erraria preço por fator 100 | Parser com regras explícitas + conferência de soma antes de gravar |
| B4 | Caixa fora do escopo | **Decisão D2**: dentro da v1 |
| B5 | Nenhuma venda tinha autor | **Decisão D3**: perfis + `usuario_id` em toda escrita |
| B6 | "Ativar backup" pode não existir no plano Free | `pg_dump` agendado; restauração testada como critério de aceite |

### 11.3 Travas de stack

| ID | Trava | Decisão |
|---|---|---|
| C1 | Next.js 15: `cookies()` é assíncrono e o middleware do `@supabase/ssr` mudou | Usar o padrão novo; sessão sobrevivendo a refresh é critério de aceite da Etapa 1 |
| C2 | Tailwind v3 × v4 mudam a configuração do shadcn/ui | Escolher e **fixar versões** (sem `latest`) |
| C3 | Função da Vercel por padrão nos EUA | Fixar região `gru1` |
| C4 | F3 é atalho do navegador | `preventDefault()` obrigatório |
| C5 | SQL colado no painel não tem histórico | Migrations via CLI (`npx supabase db push`) |
| C6 | Índice GIN de `to_tsvector` não ajuda código de barras nem busca parcial | `pg_trgm` |
| C7 | Nomes de chave do Supabase podem aparecer como publishable/secret | Documentar no `.env.example` |
| C8 | Vercel Hobby não é para uso comercial | Decidir antes da Etapa 9 (Pro ou outro host) |

### 11.4 Acréscimos menores ao plano original

Colunas que não existiam no plano e que não trazem risco, adicionadas agora para
evitar migration extra depois: `produtos.unidade`, `produtos.atualizado_em`,
`clientes.observacao`, `vendas.motivo_cancelamento`, `perfis.ativo`.

---

## 12. Estratégia de testes

| Nível | Cobre | Ferramenta | Desde |
|---|---|---|---|
| 1 | Funções SQL | pgTAP (`npx supabase test db`, requer Docker Desktop) ou script SQL em transação com `rollback` contra projeto de teste | Etapa 2 |
| 2 | Dinheiro, datas, parser CSV | Vitest | Etapa 1 / 3 |
| 3 | PDV de ponta a ponta | Playwright | Etapa 4 |
| 4 | Critério "Pronto quando" com evidência | manual + `PROGRESSO.md` | Etapa 0 |

O nível 1 é **obrigatório**. Se o Docker não estiver disponível, uso o fallback
declarado acima — e digo qual foi usado.

**Casos obrigatórios do nível 1:**

1. Venda simples baixa estoque.
2. Mesmo produto repetido (×3 + ×4, estoque 5) → recusada, estoque intacto. (A1)
3. Quantidade negativa ou zero → recusada. (A2)
4. Venda às 22h de 05/10 aparece em 05/10, não em 06/10. (A3)
5. Desconto negativo e desconto > subtotal → recusados. (A4)
6. Venda sem caixa aberto → recusada, nada gravado.
7. Finalizar clicado duas vezes → uma única venda. (idempotência)
8. PIX acima do total recusado; PIX 30 + dinheiro 25 numa venda de 50 → troco 5.
9. Crediário: dentro do limite passa; acima recusa; bloqueado recusa; limite 0 recusa.
10. Venda cancelada não entra em `v_vendas_dia` nem em `v_lucro_periodo`. (A7)
11. Cancelamento devolve estoque e estorna crediário; com caixa fechado recusa; por não-dono recusa.
12. Fechamento de caixa: `esperado_dinheiro` bate com a soma manual.
13. Importação com uma linha inválida → nada gravado.

---

## 13. Etapas, aceite e marcação

Marcação em `PROGRESSO.md`, na raiz: ⬜ pendente · 🟡 em andamento ·
✅ concluída com evidência · ⛔ bloqueada. **Etapa só vira ✅ com a evidência
colada.** Cada etapa fechada = 1 commit `etapa-N: <descrição>`.

| # | Etapa | Pronto quando | Evidência |
|---|---|---|---|
| 0 | Decisões e ambiente | Versões fixadas, repositório iniciado, `PROGRESSO.md` criado | `git log`, arquivos |
| 1 | Base + login | Logo, vejo o menu, sem login vou para `/login`, sessão sobrevive a refresh | print + teste de sessão |
| 2 | Banco + funções | Tabelas com RLS ativo; `registrar_venda`, `cancelar_venda` e caixa funcionando | 13 testes do nível 1 passando |
| 3 | Produtos e estoque | Importo a planilha real (soma confere), busco produto, dou entrada | soma planilha × soma gravada |
| 4 | PDV | Venda completa só com teclado; estoque cai; clique duplo não duplica | Playwright |
| 5 | Histórico de vendas | Vejo o dia, abro uma venda, cancelo, estoque volta | venda noturna no dia certo |
| 6 | Clientes e crediário | Saldo importado aparece, pagamento parcial atualiza, WhatsApp abre | testes do nível 1 |
| 7 | Relatórios | Números batem com o PDV em 3 dias, incluindo venda após 21h | 3 dias conferidos |
| 8 | Agente de IA | As 4 perguntas respondem certo; pergunta clínica é recusada | transcrição das perguntas |
| 9 | Publicar na Vercel | Venda real em produção; sign-ups desativados; **restauração de backup testada** | venda + restore |
| 10 | Migração de dados | Produtos, clientes e saldos conferidos contra o Nex | contagem e somas |
| 11 | Uso paralelo e corte | Totais batendo vários dias seguidos antes de abandonar o Nex | comparativo diário |

Etapa 10 e 11 vieram separadas da Etapa 9: migrar dados e operar em paralelo
são trabalhos distintos, com riscos distintos.

---

## 14. Riscos assumidos

| Risco | Gravidade | Mitigação |
|---|---|---|
| Sem NFC-e/SNGPC não substitui o Nex legalmente | Alta | Uso paralelo obrigatório; corte só com totais batendo |
| Sem validade/lote pode vender vencido sem avisar | Média | Conferência física periódica; v2 aditiva (D7) |
| Internet cai e não vende | Média | 4G no celular como rota alternativa; ou voltar ao Nex |
| Estoque negativo bloqueado trava o balcão | Média | Fluxo de ajuste rápido e obrigatório |
| Backup pode não existir no Free | Alta | `pg_dump` agendado; backup só conta com restore testado |
| Vercel Hobby não é para uso comercial | Média | Decidir antes da Etapa 9 |
| Latência EUA × Brasil | Baixa | Região `gru1` |
| Custo da API do DeepSeek | Baixa | Tetos de uso, 50 linhas por ferramenta, agente sem escrita |
| CPF/telefone de clientes (LGPD) | Média | Login obrigatório, RLS, backup protegido, repositório privado |
| Vazamento de chave | Alta | `.env.local` fora do git desde o primeiro commit |

---

## 15. Dependências do Lucas (o agente não faz sozinho)

1. Projeto Supabase novo em `sa-east-1` → URL + chave pública.
2. Chave da API do DeepSeek (Etapa 8).
3. Repositório no GitHub (push exige o login dele).
4. `user.name` / `user.email` no git — **hoje vazio, bloqueia o primeiro commit**.
5. Decidir Supabase Free × Pro (backup) e Vercel Hobby × Pro (uso comercial).

Etapas 0 a 2 rodam sem essas contas, exceto o Supabase, necessário na Etapa 2.

---

## 16. Decisões adiadas (v2)

- Lote e validade, com FEFO e alerta de vencimento (aditivo sobre o livro-razão).
- NFC-e via serviço fiscal terceirizado; SNGPC/controlados.
- Agente com ações (**sempre** com aprovação humana).
- Impressora de cupom não fiscal.
- Importação de XML de nota de compra.
- Catálogo online; multi-loja.

---

## 17. Registro das três decisões conscientes

Ficam registradas como escolha, não como esquecimento:

1. **v1 sem lote/validade.**
2. **v1 sem nota fiscal e sem SNGPC** — uso paralelo com o Nex é obrigatório.
3. **Cancelamento bloqueado depois do fechamento do caixa.**
