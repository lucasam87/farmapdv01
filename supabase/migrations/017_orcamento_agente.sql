-- 017_orcamento_agente.sql — o ledger transacional do teto mensal do agente de IA
-- (etapa 8, Task 1). Todo o resto do agente decide ANTES de gastar com isto: a
-- rota reserva, chama o provedor e reconcilia.
--
-- POR QUE UMA TABELA DE MES E OUTRA DE RESERVAS, e nao uma coluna de saldo:
-- reconciliar e liberar precisam saber QUAL reserva esta sendo fechada e em que
-- estado ela esta. Uma reserva tem tres estados ('reservada' -> 'liquidada' ou
-- 'reservada' -> 'liberada') e guarda as duas pontas do dinheiro (o que foi
-- reservado e o que custou de verdade). Sem a linha da reserva, um retry da rota
-- reconciliaria a mesma chamada duas vezes em silencio — e uma falha AMBIGUA
-- (conexao caiu depois do envio) nao teria como ficar retida sem ser liberada por
-- engano, que e exatamente o que a spec proibe.
--
-- A REGRA DE OURO DO CONTADOR (e o que faz o teto nao furar): a reserva JA ENTRA
-- no `consumido_micros` do mes no instante em que e criada. Reconciliar ajusta
-- `consumido_micros += (custo_real - reservado_micros)`; liberar devolve
-- `consumido_micros -= reservado_micros` e SO pode ser chamada quando a falha for
-- comprovadamente anterior ao envio. Se o contador so subisse na reconciliacao,
-- a janela entre reservar e reconciliar deixaria varias requisicoes simultaneas
-- passarem do teto.
--
-- O QUE SERIALIZA A CONCORRENCIA e o `select ... for update` na linha do mes
-- dentro de `agente_orcamento_reservar`: a segunda sessao espera a primeira
-- commitar e so entao le um `consumido_micros` ja atualizado. E por isso que o
-- `p_mes` e PARAMETRO (ruling R1): o mesmo caminho de codigo serve para testar o
-- teto num mes isolado (2099-xx-01) sem encostar no mes real de producao.
--
-- MES DE SAO PAULO: o mes do orcamento e o primeiro dia de um mes e quem o
-- calcula e o chamador (a rota, no fuso `America/Sao_Paulo`). A funcao CONFERE
-- que `p_mes = date_trunc('month', p_mes)::date` e recusa um "mes torto": um dia
-- no meio do mes criaria uma segunda linha para o MESMO mes e o teto passaria a
-- valer duas vezes.
--
-- TETO POR CHAMADA NAO MORA AQUI (ruling R10): a reserva de 1.373 µ$ por chamada
-- e conta do `logica.ts` (Tarefa 2), dono unico da tarifa do provedor. O SQL
-- valida `p_micros > 0` e o teto do MES (5.000.000 µ$ = US$ 5); repetir a tarifa
-- aqui obrigaria a editar SQL e TypeScript na proxima mudanca de preco.
--
-- SEGURANCA — `security invoker` (o default; NAO ha `security definer` aqui) e
-- nomes de objeto QUALIFICADOS (`public.`). O ledger e dinheiro: `anon` e
-- `authenticated` nao leem nem escrevem tabela nenhuma, nao tem grant de tabela
-- NENHUM (nem SELECT) e o EXECUTE das tres funcoes e concedido APENAS a
-- `service_role`. O `revoke ... from public, anon` e obrigatorio e nao decoracao:
-- no Supabase o EXECUTE chega a `anon` por DEFAULT PRIVILEGES, direto no papel —
-- revogar so de PUBLIC nao tira nada (mesmo achado que 002_registrar_venda.sql
-- registra e que 050_permissoes.sql prova por has_function_privilege).
--
-- RLS LIGADA nas duas tabelas SEM POLICY NENHUMA de proposito: sem policy, nem
-- `anon` nem `authenticated` passam, mesmo que um grant de tabela apareca por
-- engano no futuro. O `service_role` do Supabase alcanca as tabelas por
-- `bypassrls`; as funcoes sao a porta normal.
--
-- POR QUE A `service_role` RECEBE GRANT DE TABELA (achado Important 1 da revisao
-- da Task 1): as tres funcoes sao `security invoker`, entao elas rodam com os
-- direitos de QUEM CHAMA — o privilegio de tabela do chamador e parte do
-- contrato, e nao um detalhe de ambiente. Sem estas linhas, o unico caminho que
-- faz a funcao funcionar e o DEFAULT PRIVILEGES do Supabase (que nao tem
-- `alter default privileges` em migration nenhuma deste repositorio): num projeto
-- novo, ou num endurecimento de privilegios do schema, as tres funcoes morrem com
-- `permission denied for table agente_orcamento_mensal` e a suite continua verde,
-- porque o runner dos casos roda na role privilegiada do endpoint.
--
-- O `revoke all` ANTES do `grant` NAO e decoracao — foi medido no banco de
-- producao e o ACL prova: `create table` no schema `public` nasce com
-- `service_role=arwdDxtm` (o DEFAULT PRIVILEGES do Supabase da SELECT, INSERT,
-- UPDATE, DELETE, TRUNCATE, REFERENCES e TRIGGER no papel). `delete` e `truncate`
-- num ledger append-only nao tem uso NENHUM: nenhuma funcao apaga linha. Sem o
-- `revoke all`, o `grant` seria um no-op (a entrada do ACL ja estaria la) e
-- `service_role=arw/postgres` so aparece porque o revoke tira a entrada inteira e
-- o grant a recria. E a UNICA linha desta migration que REDUZ o que o ambiente
-- concede por padrao.

-- ============================================================
-- agente_orcamento_mensal — uma linha por mes, o contador consumido.
--
-- `consumido_micros` e a UNICA fonte do teto: e ele que a reserva soma e que a
-- reconciliacao/liberacao ajustam. O valor e INTEIRO em micros de dolar (bigint),
-- nunca ponto flutuante: centavo de dolar nao existe em representacao binaria e
-- uma soma de `real` acumularia erro em cima de dinheiro.
-- ============================================================
create table if not exists public.agente_orcamento_mensal (
  mes              date primary key,
  consumido_micros bigint not null default 0,
  atualizado_em    timestamptz not null default now()
);

-- ============================================================
-- agente_orcamento_reservas — uma linha por chamada reservada.
--
-- `reservado_micros` e o que foi reservado (o teto por chamada do `logica.ts`);
-- `custo_micros` e o custo real que o `usage` do provedor diz, e fica NULO
-- enquanto a reserva esta aberta ou foi liberada. `estado` e o ciclo de vida:
-- 'reservada' (aberta), 'liquidada' (custo real gravado) e 'liberada' (falha
-- comprovadamente anterior ao envio). O `check` e a ultima linha de defesa,
-- mesmo com as funcoes sendo a porta normal.
-- ============================================================
create table if not exists public.agente_orcamento_reservas (
  id               uuid primary key default gen_random_uuid(),
  mes              date not null references public.agente_orcamento_mensal(mes),
  estado           text not null,
  reservado_micros bigint not null,
  custo_micros     bigint,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  constraint agente_orcamento_reservas_estado_check
    check (estado in ('reservada', 'liquidada', 'liberada'))
);

-- A FK da reserva para o mes e o que impede reserva orfa. O indice por `mes`
-- serve as leituras de auditoria e a limpeza dos testes (a FK ja cria um indice
-- no lado referenciado, `agente_orcamento_mensal.mes`, mas nao neste).
create index if not exists agente_orcamento_reservas_mes_idx
  on public.agente_orcamento_reservas (mes);

-- ============================================================
-- RLS LIGADA e SEM POLICY: ninguem passa pelos papeis publicos.
-- ============================================================
alter table public.agente_orcamento_mensal   enable row level security;
alter table public.agente_orcamento_reservas enable row level security;

-- ============================================================
-- agente_orcamento_reservar — reserva ANTES da chamada paga.
--
-- Devolve o id da reserva, que a rota guarda para reconciliar (sucesso) ou
-- liberar (falha anterior ao envio). O `for update` na linha do mes e o que
-- serializa duas requisicoes simultaneas: a segunda espera e relê o consumido ja
-- somado pela primeira.
--
-- `consumido_micros + p_micros > 5000000` recusa a reserva que PASSARIA do teto;
-- a que fecha o mes exato passa (o teto e "nao passar de"). O `raise` acontece com
-- a transacao ainda sem escrita nenhuma, entao a recusa nao deixa consumido nem
-- reserva para tras.
-- ============================================================
create or replace function public.agente_orcamento_reservar(p_mes date, p_micros bigint)
returns uuid
language plpgsql
as $$
declare
  v_consumido bigint;
  v_id        uuid;
begin
  if p_mes is null or p_mes <> date_trunc('month', p_mes)::date then
    raise exception 'O mês do orçamento precisa ser o primeiro dia do mês.';
  end if;

  if p_micros is null or p_micros <= 0 then
    raise exception 'Micros da reserva precisam ser positivos.';
  end if;

  -- Cria a linha do mes na primeira reserva dele. O `on conflict do nothing` faz
  -- duas sessoes concorrentes nao brigarem por aqui — a serializacao de verdade
  -- e o `for update` logo abaixo.
  insert into public.agente_orcamento_mensal (mes, consumido_micros)
  values (p_mes, 0)
  on conflict (mes) do nothing;

  select m.consumido_micros into v_consumido
  from public.agente_orcamento_mensal m
  where m.mes = p_mes
  for update;

  if v_consumido + p_micros > 5000000 then
    raise exception 'Orçamento mensal do assistente esgotado.';
  end if;

  insert into public.agente_orcamento_reservas (mes, estado, reservado_micros)
  values (p_mes, 'reservada', p_micros)
  returning id into v_id;

  -- A reserva entra no contador AQUI, no mesmo instante em que nasce.
  update public.agente_orcamento_mensal
  set consumido_micros = consumido_micros + p_micros,
      atualizado_em    = now()
  where mes = p_mes;

  return v_id;
end $$;

comment on function public.agente_orcamento_reservar(date, bigint) is
  'Reserva micros no mes ANTES da chamada paga: soma no consumido do mes com a linha do mes bloqueada (for update). Recusa mes que nao seja o primeiro dia do mes, micros nao-positivos e reserva que passe do teto de 5.000.000 micros (US$ 5). Devolve o id da reserva. SECURITY INVOKER; execucao so para service_role.';

-- ============================================================
-- agente_orcamento_reconciliar — fecha a reserva com o custo REAL.
--
-- `consumido_micros += (custo_real - reservado_micros)`: o custo real normalmente
-- e menor que a reserva (ela foi dimensionada pelo pico) e a diferenca volta para
-- o mes; um custo maior que a reserva AUMENTA o consumido. Custo zero e aceito
-- (resposta que voltou sem `usage`); custo NEGATIVO nao existe — ele AUMENTARIA o
-- saldo do mes, que e o furo que o teto nao pode ter.
--
-- SO a reserva 'reservada' pode ser liquidada: reconciliar de novo uma reserva ja
-- liquidada cobraria a mesma chamada duas vezes.
-- ============================================================
create or replace function public.agente_orcamento_reconciliar(p_reserva_id uuid, p_custo_micros bigint)
returns void
language plpgsql
as $$
declare
  v_mes       date;
  v_estado    text;
  v_reservado bigint;
begin
  if p_reserva_id is null then
    raise exception 'Reserva não encontrada.';
  end if;

  if p_custo_micros is null or p_custo_micros < 0 then
    raise exception 'Custo em micros não pode ser negativo.';
  end if;

  select r.mes, r.estado, r.reservado_micros
    into v_mes, v_estado, v_reservado
  from public.agente_orcamento_reservas r
  where r.id = p_reserva_id
  for update;

  if not found then
    raise exception 'Reserva não encontrada.';
  end if;

  if v_estado <> 'reservada' then
    if v_estado = 'liquidada' then
      raise exception 'Reserva já foi liquidada.';
    end if;
    raise exception 'Reserva já foi liberada.';
  end if;

  -- A linha do mes e travada aqui, e o ajuste do contador fica serializado com as
  -- reservas concorrentes do mesmo mes. A reserva ja esta travada pelo `for
  -- update` acima: a ordem (reserva, depois mes) e a MESMA em reconciliar e
  -- liberar, e reservar so trava o mes — nao existe caminho invertido para
  -- deadlock.
  update public.agente_orcamento_mensal
  set consumido_micros = consumido_micros + (p_custo_micros - v_reservado),
      atualizado_em    = now()
  where mes = v_mes;

  if not found then
    raise exception 'Mês do orçamento não encontrado.';
  end if;

  update public.agente_orcamento_reservas
  set estado        = 'liquidada',
      custo_micros  = p_custo_micros,
      atualizado_em = now()
  where id = p_reserva_id;
end $$;

comment on function public.agente_orcamento_reconciliar(uuid, bigint) is
  'Fecha uma reserva com o custo real em micros: consumido_micros += (custo_real - reservado_micros). Recusa reserva inexistente, reserva ja liquidada/liberada e custo negativo. SECURITY INVOKER; execucao so para service_role.';

-- ============================================================
-- agente_orcamento_liberar — devolve a reserva de uma falha PRE-ENVIO.
--
-- SO serve para a falha comprovadamente anterior ao envio: quando a conexao cai
-- DEPOIS do envio e o custo e desconhecido, a reserva maxima tem que ficar
-- consumida ate o fim do mes (e a reconciliacao com o `usage` que a fecha). Dizer
-- isso em codigo e simples: so 'reservada' pode ser liberada.
-- ============================================================
create or replace function public.agente_orcamento_liberar(p_reserva_id uuid)
returns void
language plpgsql
as $$
declare
  v_mes       date;
  v_estado    text;
  v_reservado bigint;
begin
  if p_reserva_id is null then
    raise exception 'Reserva não encontrada.';
  end if;

  select r.mes, r.estado, r.reservado_micros into v_mes, v_estado, v_reservado
  from public.agente_orcamento_reservas r
  where r.id = p_reserva_id
  for update;

  if not found then
    raise exception 'Reserva não encontrada.';
  end if;

  if v_estado <> 'reservada' then
    if v_estado = 'liquidada' then
      raise exception 'Reserva já foi liquidada.';
    end if;
    raise exception 'Reserva já foi liberada.';
  end if;

  update public.agente_orcamento_mensal
  set consumido_micros = consumido_micros - v_reservado,
      atualizado_em    = now()
  where mes = v_mes;

  if not found then
    raise exception 'Mês do orçamento não encontrado.';
  end if;

  update public.agente_orcamento_reservas
  set estado        = 'liberada',
      atualizado_em = now()
  where id = p_reserva_id;
end $$;

comment on function public.agente_orcamento_liberar(uuid) is
  'Libera uma reserva de falha COMPROVADAMENTE anterior ao envio: consumido_micros -= reservado_micros e estado = liberada. Reserva inexistente, ja liquidada ou ja liberada e recusada (falha ambigua NAO devolve saldo). SECURITY INVOKER; execucao so para service_role.';

-- ============================================================
-- Permissoes: o ledger e so do `service_role`.
--
-- Sem grant de tabela NENHUM para `anon`/`authenticated`/`PUBLIC` (nem SELECT): a
-- rota nunca le o orcamento pelo cliente da sessao do usuario, so pela instancia
-- privilegiada. E o EXECUTE sai de `public` E de `anon` (o grant chega a `anon`
-- por DEFAULT PRIVILEGES no Supabase).
--
-- O grant explicito a `service_role` fecha o contrato das funcoes `security
-- invoker` (ver o cabecalho). O `revoke all` que vem antes e o que tira `delete` e
-- `truncate` que o DEFAULT PRIVILEGES do Supabase poe no papel: sem ele o grant
-- seria no-op, e o ledger nasceria com duas operacoes destrutivas que funcao
-- nenhuma usa.
-- ============================================================
revoke all on table public.agente_orcamento_mensal   from public, anon, authenticated;
revoke all on table public.agente_orcamento_reservas from public, anon, authenticated;

revoke all on table public.agente_orcamento_mensal   from service_role;
revoke all on table public.agente_orcamento_reservas from service_role;

-- `.` e nao `,` entre as linhas: e a lista de tabelas do MESMO grant.
grant select, insert, update on table
  public.agente_orcamento_mensal,
  public.agente_orcamento_reservas
  to service_role;

revoke all on function public.agente_orcamento_reservar(date, bigint)      from public, anon, authenticated;
revoke all on function public.agente_orcamento_reconciliar(uuid, bigint)   from public, anon, authenticated;
revoke all on function public.agente_orcamento_liberar(uuid)               from public, anon, authenticated;

grant execute on function public.agente_orcamento_reservar(date, bigint)    to service_role;
grant execute on function public.agente_orcamento_reconciliar(uuid, bigint) to service_role;
grant execute on function public.agente_orcamento_liberar(uuid)             to service_role;
