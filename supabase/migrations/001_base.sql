-- 001_base.sql
-- Estado inicial do banco da farmácia: 10 tabelas, índices, constraints e RLS.
-- Corresponde à spec docs/superpowers/specs/2026-10-06-sistema-farmacia-design.md §7.
--
-- Ordem de criação (as chaves estrangeiras exigem):
--   perfis -> produtos -> clientes -> caixa_sessoes -> vendas -> venda_itens
--   -> venda_pagamentos -> caixa_movimentos -> estoque_movimentos
--   -> crediario_lancamentos
--
-- Dinheiro SEMPRE em centavos inteiros.

-- Busca por pedaço do nome do produto (a busca por código de barras usa o
-- índice único da coluna).
create extension if not exists pg_trgm;

-- ============================================================
-- PERFIS: espelha auth.users. O papel decide a permissão.
-- ============================================================
create table if not exists perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  papel text not null check (papel in ('dono','atendente')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ============================================================
-- PRODUTOS
-- ============================================================
create table if not exists produtos (
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
create index if not exists produtos_nome_trgm on produtos using gin (nome gin_trgm_ops);
create index if not exists produtos_ativo on produtos (ativo);

-- ============================================================
-- CLIENTES
-- ============================================================
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  cpf text unique,
  limite_credito integer not null default 0 check (limite_credito >= 0),
  bloqueado boolean not null default false,
  observacao text,
  criado_em timestamptz not null default now()
);

-- ============================================================
-- CAIXA: uma sessão aberta por terminal, garantida por índice único parcial
-- ============================================================
create table if not exists caixa_sessoes (
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
create unique index if not exists caixa_um_aberto_por_terminal
  on caixa_sessoes (terminal) where status = 'aberto';

-- ============================================================
-- VENDAS
-- forma_pagamento NÃO existe aqui: os pagamentos vão em venda_pagamentos
-- ============================================================
create table if not exists vendas (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  chave_idempotencia uuid not null unique,
  cliente_id uuid references clientes(id),
  caixa_sessao_id uuid not null references caixa_sessoes(id),
  usuario_id uuid not null references perfis(id),
  subtotal integer not null check (subtotal >= 0),
  desconto integer not null default 0 check (desconto >= 0),
  total integer not null check (total >= 0),
  valor_pago integer not null default 0,
  troco integer not null default 0 check (troco >= 0),
  status text not null default 'concluida' check (status in ('concluida','cancelada')),
  cancelado_em timestamptz,
  cancelado_por uuid references perfis(id),
  motivo_cancelamento text,
  criado_em timestamptz not null default now(),
  constraint vendas_desconto_ok check (desconto <= subtotal),
  constraint vendas_total_ok check (total = subtotal - desconto),
  constraint vendas_total_positivo check (total > 0)
);
create index if not exists vendas_criado_em on vendas (criado_em desc);
create index if not exists vendas_caixa on vendas (caixa_sessao_id);
create index if not exists vendas_cliente on vendas (cliente_id);

-- ============================================================
-- ITENS DA VENDA
-- O unique (venda_id, produto_id) é o que garante que o carrinho foi
-- agregado por produto antes de validar estoque (bug A1).
-- ============================================================
create table if not exists venda_itens (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references vendas(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  nome_produto text not null,
  quantidade integer not null check (quantidade > 0),
  preco_unitario integer not null check (preco_unitario >= 0),
  preco_custo integer not null default 0 check (preco_custo >= 0),
  total integer not null check (total >= 0),
  constraint venda_itens_produto_unico unique (venda_id, produto_id)
);

-- ============================================================
-- PAGAMENTOS: uma venda, N pagamentos (pagamento dividido)
-- ============================================================
create table if not exists venda_pagamentos (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references vendas(id) on delete cascade,
  forma text not null check (forma in ('dinheiro','pix','debito','credito','crediario')),
  valor integer not null check (valor > 0)
);
create index if not exists venda_pagamentos_venda on venda_pagamentos (venda_id);

-- ============================================================
-- MOVIMENTOS DE CAIXA: lastro do fechamento
-- valor positivo entra no caixa, negativo sai
-- ============================================================
create table if not exists caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  sessao_id uuid not null references caixa_sessoes(id),
  tipo text not null check (tipo in
    ('venda','recebimento_crediario','sangria','suprimento','cancelamento','ajuste')),
  forma text check (forma in ('dinheiro','pix','debito','credito','crediario')),
  valor integer not null,
  venda_id uuid references vendas(id),
  motivo text,
  usuario_id uuid not null references perfis(id),
  criado_em timestamptz not null default now()
);
create index if not exists caixa_movimentos_sessao on caixa_movimentos (sessao_id);

-- ============================================================
-- MOVIMENTAÇÃO DE ESTOQUE: livro-razão de tudo que entra e sai.
-- É esta tabela que permite lote/validade numa v2 sem reescrever nada.
-- ============================================================
create table if not exists estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id),
  tipo text not null check (tipo in ('entrada','venda','ajuste','cancelamento')),
  quantidade integer not null,
  saldo_apos integer not null,
  motivo text,
  venda_id uuid references vendas(id),
  usuario_id uuid not null references perfis(id),
  criado_em timestamptz not null default now(),
  constraint estoque_movimentos_qtd_nao_zero check (quantidade <> 0)
);
create index if not exists estoque_movimentos_produto on estoque_movimentos (produto_id, criado_em desc);
create index if not exists estoque_movimentos_venda on estoque_movimentos (venda_id);

-- ============================================================
-- CREDIÁRIO: lançamentos de dívida e pagamentos
-- ============================================================
create table if not exists crediario_lancamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  venda_id uuid references vendas(id),
  tipo text not null check (tipo in ('compra','pagamento')),
  valor integer not null check (valor > 0),
  forma_pagamento text,
  estorna_lancamento_id uuid references crediario_lancamentos(id),
  observacao text,
  usuario_id uuid not null references perfis(id),
  criado_em timestamptz not null default now()
);
create index if not exists crediario_cliente on crediario_lancamentos (cliente_id);
create index if not exists crediario_venda on crediario_lancamentos (venda_id);

-- ============================================================
-- RLS: ativado em TODAS as tabelas, sem exceção (regra 7 do plano).
-- Políticas idempotentes: drop antes de create (bug A5).
-- ============================================================
alter table perfis enable row level security;
alter table produtos enable row level security;
alter table clientes enable row level security;
alter table caixa_sessoes enable row level security;
alter table vendas enable row level security;
alter table venda_itens enable row level security;
alter table venda_pagamentos enable row level security;
alter table caixa_movimentos enable row level security;
alter table estoque_movimentos enable row level security;
alter table crediario_lancamentos enable row level security;

-- perfis: só leitura para quem está logado. Escrita apenas por SQL/painel,
-- senão um atendente poderia se promover a dono.
drop policy if exists perfis_leitura on perfis;
create policy perfis_leitura on perfis
  for select to authenticated using (true);

-- v1 é loja única: todo usuário da farmácia acessa tudo.
-- (O login é restrito a quem tem linha em perfis, e o cadastro público está
-- desativado no projeto.)
drop policy if exists logado_tudo on produtos;
create policy logado_tudo on produtos
  for all to authenticated using (true) with check (true);

drop policy if exists logado_tudo on clientes;
create policy logado_tudo on clientes
  for all to authenticated using (true) with check (true);

drop policy if exists logado_tudo on caixa_sessoes;
create policy logado_tudo on caixa_sessoes
  for all to authenticated using (true) with check (true);

drop policy if exists logado_tudo on vendas;
create policy logado_tudo on vendas
  for all to authenticated using (true) with check (true);

drop policy if exists logado_tudo on venda_itens;
create policy logado_tudo on venda_itens
  for all to authenticated using (true) with check (true);

drop policy if exists logado_tudo on venda_pagamentos;
create policy logado_tudo on venda_pagamentos
  for all to authenticated using (true) with check (true);

drop policy if exists logado_tudo on caixa_movimentos;
create policy logado_tudo on caixa_movimentos
  for all to authenticated using (true) with check (true);

drop policy if exists logado_tudo on estoque_movimentos;
create policy logado_tudo on estoque_movimentos
  for all to authenticated using (true) with check (true);

drop policy if exists logado_tudo on crediario_lancamentos;
create policy logado_tudo on crediario_lancamentos
  for all to authenticated using (true) with check (true);
