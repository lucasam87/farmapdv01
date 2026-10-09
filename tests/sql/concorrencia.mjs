// Testes de concorrencia: dois clientes do banco disputando o mesmo recurso.
//
//   1. ultimo item do estoque  — a segunda venda nao pode perder saldo
//   2. limite de crediario     — duas vendas simultaneas para o MESMO cliente
//                                nao podem passar as duas do limite
//   3. teto do orcamento do agente — duas reservas simultaneas que juntas
//                                passariam dos US$ 5 nao podem passar as duas
//
// Sao os unicos testes que gravam FORA de transacao (duas conexoes concorrentes
// nao cabem num rollback comum). Eles criam usuario, caixa, produtos, cliente e
// mes de orcamento proprios, limpam tudo no fim (antes e depois, para poder rodar
// de novo) e FALHAM se a limpeza nao funcionar.
//
// Transporte: duas requisicoes HTTP simultaneas ao endpoint /database/query.
// Sonda comprovou que ele atende em conexoes diferentes (uma tomou lock timeout
// enquanto a outra segurava o lock). A senha do banco (SUPABASE_DB_URL) nunca
// autenticou, entao nao da para abrir dois `pg`.
//
// O criterio de tempo ("B bloqueada por pelo menos 200 ms") e medido DENTRO do
// banco, com clock_timestamp(): o endpoint leva ~1,5 s de overhead por
// requisicao, o que tornaria qualquer medicao no Node uma prova falsa.

import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'

const raiz = path.resolve(import.meta.dirname, '..', '..')
dotenv.config({ path: path.join(raiz, '.env.local'), quiet: true })

const EMAIL = 'concorrencia@farmacia.local'
const TERMINAL = 'teste-concorrencia'
const PRODUTO = 'PRODUTO CONCORRENCIA'
const PRECO = 1000
// Cenario 2: produtos DIFERENTES de proposito — se as duas vendas disputassem o
// mesmo produto, o lock da linha de produtos serializaria as duas e o teste do
// limite de crediario passaria sem testar nada.
const PRODUTO_A = 'PRODUTO CREDITO A'
const PRODUTO_B = 'PRODUTO CREDITO B'
const CLIENTE = 'CLIENTE CONCORRENCIA'
const PRECO_CREDITO = 4500
const LIMITE_CREDITO = 5000
// Cenario 3: o mes do orcamento do agente. MES DEDICADO (2099-12-01), nunca um mes
// real: o teto e um numero unico e encostar no mes corrente apagaria a evidencia
// de producao. O cenario deixa 1.000 µ$ de folga e dispara DUAS reservas de
// 1.000 µ$: as duas juntas fariam 5.001.000 (acima dos US$ 5 = 5.000.000 µ$), e a
// segunda tem que ser recusada.
const MES_ORCAMENTO = '2099-12-01'
const CONSUMIDO_INICIAL_ORCAMENTO = 4999000
const RESERVA_MICROS = 1000
const TETO_MICROS = 5000000

const token = process.env.SUPABASE_ACCESS_TOKEN
const urlProjeto = process.env.NEXT_PUBLIC_SUPABASE_URL

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const resultados = []
function checar(condicao, nome, detalhe) {
  resultados.push({ ok: Boolean(condicao), nome, detalhe })
  console.log((condicao ? 'OK    ' : 'FALHOU') + ' ' + nome + (condicao ? '' : ' — ' + detalhe))
}

if (!token || !urlProjeto) {
  console.error('Faltam SUPABASE_ACCESS_TOKEN ou NEXT_PUBLIC_SUPABASE_URL no .env.local')
  process.exitCode = 1
} else {
  const ref = new URL(urlProjeto).hostname.split('.')[0]
  const endpoint = 'https://api.supabase.com/v1/projects/' + ref + '/database/query'

  async function sql(query) {
    const resposta = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    const texto = await resposta.text()
    return { ok: resposta.ok, status: resposta.status, texto }
  }

  async function linhas(query) {
    const r = await sql(query)
    if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + r.texto.slice(0, 300))
    return JSON.parse(r.texto)
  }

  // ------------------------------ limpeza ------------------------------
  // Idempotente de proposito: rodar antes deixa o teste repetivel mesmo se uma
  // execucao anterior falhou no meio. O orcamento vem PRIMEIRO e na ordem certa:
  // a reserva referencia o mes (FK), entao apagar o mes antes da reserva daria
  // erro de chave estrangeira.
  const limpeza = `
delete from agente_orcamento_reservas where mes = date '${MES_ORCAMENTO}';
delete from agente_orcamento_mensal where mes = date '${MES_ORCAMENTO}';
delete from caixa_movimentos where sessao_id in (select id from caixa_sessoes where terminal = '${TERMINAL}');
delete from estoque_movimentos where produto_id in (
  select id from produtos where nome in ('${PRODUTO}', '${PRODUTO_A}', '${PRODUTO_B}'));
delete from crediario_lancamentos where cliente_id in (select id from clientes where nome = '${CLIENTE}')
   or venda_id in (select v.id from vendas v join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}');
delete from venda_pagamentos where venda_id in (
  select v.id from vendas v join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}');
delete from venda_itens where venda_id in (
  select v.id from vendas v join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}');
delete from vendas where usuario_id in (select id from perfis where nome = '${EMAIL}');
delete from caixa_sessoes where terminal = '${TERMINAL}';
delete from produtos where nome in ('${PRODUTO}', '${PRODUTO_A}', '${PRODUTO_B}');
delete from clientes where nome = '${CLIENTE}';
delete from perfis where nome = '${EMAIL}';
delete from auth.users where email = '${EMAIL}';
`

  const sobrou = `
select jsonb_build_object(
  'usuarios',   (select count(*) from auth.users where email = '${EMAIL}'),
  'perfis',     (select count(*) from perfis where nome = '${EMAIL}'),
  'produtos',   (select count(*) from produtos where nome in ('${PRODUTO}', '${PRODUTO_A}', '${PRODUTO_B}')),
  'clientes',   (select count(*) from clientes where nome = '${CLIENTE}'),
  'caixas',     (select count(*) from caixa_sessoes where terminal = '${TERMINAL}'),
  'vendas',     (select count(*) from vendas v join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}'),
  'itens',      (select count(*) from venda_itens i join vendas v on v.id = i.venda_id
                  join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}'),
  'mov_estoque',(select count(*) from estoque_movimentos m join produtos pr on pr.id = m.produto_id
                  where pr.nome in ('${PRODUTO}', '${PRODUTO_A}', '${PRODUTO_B}')),
  'mov_caixa',  (select count(*) from caixa_movimentos m join caixa_sessoes c on c.id = m.sessao_id
                  where c.terminal = '${TERMINAL}'),
  'orc_mes',    (select count(*) from agente_orcamento_mensal where mes = date '${MES_ORCAMENTO}'),
  'orc_reservas',(select count(*) from agente_orcamento_reservas where mes = date '${MES_ORCAMENTO}')
) as restou;
`

  // Dispara A e B em paralelo e devolve o que cada lado viu. A segura a
  // transacao ate ver, no banco, alguem esperando lock; entao espera 1 s e
  // commita. B e cronometrado dentro do banco em volta da chamada.
  //
  // O que A e B FAZEM e passado em `sqlA`/`sqlB` (strings SQL prontas): os tres
  // cenarios precisam da MESMA orquestracao de lock e so mudam o corpo. As
  // colunas que ele le de volta sao as comuns a todo cenario.
  async function disputar({ rotulo, sqlA, sqlB }) {
    console.log('')
    console.log('--- ' + rotulo + ' ---')
    // A sai primeiro; B entra depois que A com certeza ja pegou o lock (o
    // endpoint leva ~1,5 s de overhead por requisicao).
    const promessaA = sql(sqlA)
    await dormir(2000)
    const respostaB = await sql(sqlB)
    const respostaA = await promessaA

    const saida = { a: respostaA, b: respostaB, locks: -1, vendas: -1 }
    if (respostaA.ok) {
      saida.locks = JSON.parse(respostaA.texto)[0].resultado.locks
      saida.vendas = JSON.parse(respostaA.texto)[0].resultado.venda_id
    }
    if (respostaB.ok) {
      const b = JSON.parse(respostaB.texto)[0].resultado
      saida.vendeu = b.vendeu
      saida.esperouMs = b.esperou_ms
      saida.mensagem = b.mensagem ?? ''
      saida.reservaId = b.reserva_id ?? null
      saida.consumido = b.consumido ?? null
    }
    return saida
  }

  // O lado A dos cenarios de VENDA: registra a venda e so COMMITA depois de ver
  // alguem esperando o lock que a propria venda pegou.
  function sqlVendaA(claims, clienteSql, chaveA, itensA, pagamentos) {
    return `
begin;
drop table if exists _conc_a;
create temp table _conc_a (locks integer, esperando integer, esperou_ms integer, venda_id text) on commit drop;
do $$
declare
  v_venda jsonb;
  v_locks integer := 0;
  v_esperando integer := 0;
  v_tentativas integer := 0;
  v_inicio timestamptz;
begin
  perform set_config('request.jwt.claims', '${claims}', true);
  v_venda := registrar_venda('${chaveA}', ${clienteSql}, '${itensA}'::jsonb, '${pagamentos}'::jsonb, 0);
  v_inicio := clock_timestamp();
  loop
    -- pg_locks e a fonte confiavel: qualquer sessao enxerga os locks nao
    -- concedidos. pg_stat_activity, neste projeto, nao mostrou a sessao de B.
    select count(*) into v_locks from pg_locks where not granted;
    select count(*) into v_esperando
    from pg_stat_activity
    where pid <> pg_backend_pid() and wait_event_type = 'Lock';
    exit when v_locks > 0 or v_esperando > 0;
    v_tentativas := v_tentativas + 1;
    exit when v_tentativas > 100;
    perform pg_sleep(0.1);
  end loop;
  if v_locks > 0 or v_esperando > 0 then
    perform pg_sleep(1);
  end if;
  insert into _conc_a
  values (v_locks, v_esperando, round(extract(epoch from (clock_timestamp() - v_inicio)) * 1000)::integer, v_venda->>'id');
end $$;
select jsonb_build_object('locks', locks, 'esperando', esperando, 'esperou_ms', esperou_ms, 'venda_id', venda_id) as resultado
from _conc_a;
commit;
`
  }

  // O lado B dos cenarios de VENDA: tenta a venda e e cronometrado dentro do
  // banco. COMMITA de proposito quando consegue: e isso que deixa o dano visivel
  // no estado final (estoque negativo / divida acima do limite), que e o que o
  // teste verifica depois. Quando B falha — o caso correto — nada e gravado.
  function sqlVendaB(claims, clienteSql, chaveB, itensB, pagamentos) {
    return `
begin;
drop table if exists _conc_b;
create temp table _conc_b (vendeu boolean, esperou_ms integer, mensagem text) on commit drop;
do $$
declare
  v_inicio timestamptz;
begin
  perform set_config('request.jwt.claims', '${claims}', true);
  v_inicio := clock_timestamp();
  begin
    perform registrar_venda('${chaveB}', ${clienteSql}, '${itensB}'::jsonb, '${pagamentos}'::jsonb, 0);
    insert into _conc_b
    values (true, round(extract(epoch from (clock_timestamp() - v_inicio)) * 1000)::integer, null);
  exception when others then
    insert into _conc_b
    values (false, round(extract(epoch from (clock_timestamp() - v_inicio)) * 1000)::integer, sqlerrm);
  end;
end $$;
select jsonb_build_object('vendeu', vendeu, 'esperou_ms', esperou_ms, 'mensagem', mensagem) as resultado
from _conc_b;
commit;
`
  }

  // O lado A do cenario do ORCAMENTO: reserva os micros (o que trava a linha do
  // mes) e SO COMMITA depois de ver alguem esperando lock — e o que garante que a
  // medicao de tempo de B tinha um lock para esperar. Sem isso, A commitava antes
  // de B chegar e o teste passaria sem disputa nenhuma.
  //
  // POR QUE `set role service_role`: o cenario tem que entrar pela PORTA DA
  // PRODUCAO. `anon` e `authenticated` nao tem privilegio nenhum na tabela do
  // ledger (migrations 001 e 017), entao a unica role que alcanca o orcamento e
  // `service_role` — e e ele que a Tarefa 3 vai usar.
  //
  // POR QUE O `grant` NA TEMPORARIA CONTINUA AQUI (tentado e revertido no fix
  // round 1): trocar de role tambem troca quem escreve no `_conc_a`, e o grant de
  // tabela que a 017 faz e do LEDGER (objeto permanente), nao de uma tabela
  // temporaria da sessao. Removido, o lado A morre em "permission denied for table
  // _conc_a" — medido, e a suite la ficou 20 OK / 8 FALHOU. O grant aqui NAO e o
  // que sustenta a producao: e o minimo para o teste conseguir REGISTRAR a saida
  // enquanto roda como a role de producao.
  function sqlReservaA(valorMicros) {
    return `
begin;
drop table if exists _conc_a;
create temp table _conc_a (locks integer, esperando integer, esperou_ms integer, reserva_id text) on commit drop;
grant insert, select on _conc_a to service_role;
set local role service_role;
do $$
declare
  v_reserva uuid;
  v_locks integer := 0;
  v_esperando integer := 0;
  v_tentativas integer := 0;
  v_inicio timestamptz;
begin
  v_reserva := public.agente_orcamento_reservar(date '${MES_ORCAMENTO}', ${valorMicros});
  v_inicio := clock_timestamp();
  loop
    select count(*) into v_locks from pg_locks where not granted;
    select count(*) into v_esperando
    from pg_stat_activity
    where pid <> pg_backend_pid() and wait_event_type = 'Lock';
    exit when v_locks > 0 or v_esperando > 0;
    v_tentativas := v_tentativas + 1;
    exit when v_tentativas > 100;
    perform pg_sleep(0.1);
  end loop;
  if v_locks > 0 or v_esperando > 0 then
    perform pg_sleep(1);
  end if;
  insert into _conc_a
  values (v_locks, v_esperando, round(extract(epoch from (clock_timestamp() - v_inicio)) * 1000)::integer, v_reserva::text);
end $$;
select jsonb_build_object('locks', locks, 'esperando', esperando, 'esperou_ms', esperou_ms, 'venda_id', reserva_id) as resultado
from _conc_a;
commit;
`
  }

  // O lado B do cenario do ORCAMENTO: tenta reservar e e cronometrado DENTRO do
  // banco (o endpoint leva ~1,5 s de overhead e mediria a rede, nao o lock).
  // `reserva_id` e `consumido` ficam na saida para o teste conferir o estado final
  // pelo caminho de quem perdeu. O `grant` na temporaria e pelo mesmo motivo do
  // lado A (o `insert` do `_conc_b` roda como `service_role`).
  function sqlReservaB(valorMicros) {
    return `
begin;
drop table if exists _conc_b;
create temp table _conc_b (vendeu boolean, esperou_ms integer, mensagem text, reserva_id text, consumido bigint) on commit drop;
grant insert on _conc_b to service_role;
set local role service_role;
do $$
declare
  v_inicio timestamptz;
  v_id uuid;
begin
  v_inicio := clock_timestamp();
  begin
    v_id := public.agente_orcamento_reservar(date '${MES_ORCAMENTO}', ${valorMicros});
    insert into _conc_b
    values (true, round(extract(epoch from (clock_timestamp() - v_inicio)) * 1000)::integer, null, v_id::text,
            (select consumido_micros from public.agente_orcamento_mensal where mes = date '${MES_ORCAMENTO}'));
  exception when others then
    insert into _conc_b
    values (false, round(extract(epoch from (clock_timestamp() - v_inicio)) * 1000)::integer, sqlerrm, null,
            (select consumido_micros from public.agente_orcamento_mensal where mes = date '${MES_ORCAMENTO}'));
  end;
end $$;
reset role;
select jsonb_build_object('vendeu', vendeu, 'esperou_ms', esperou_ms, 'mensagem', mensagem,
                          'reserva_id', reserva_id, 'consumido', consumido) as resultado
from _conc_b;
-- B COMMITA de proposito quando consegue: e isso que deixa o dano visivel no
-- estado final. Quando B falha — o caso correto — nada e gravado. A limpeza no
-- fim remove o que B tiver gravado.
commit;
`
  }

  let ids = null
  let limpezaOk = true

  try {
    await sql(limpeza)

    // ------------------------------ cenario ------------------------------
    // Uma unica instrucao com CTEs modificadoras: as linhas nascem juntas ou
    // nao nasce nenhuma.
    const cenario = await linhas(`
with novo_usuario as (
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', '${EMAIL}', '', now(), now(), now())
  returning id
), novo_perfil as (
  insert into perfis (id, nome, papel)
  select id, '${EMAIL}', 'dono' from novo_usuario
  returning id
), novo_produto as (
  insert into produtos (nome, preco_venda, estoque_atual)
  values ('${PRODUTO}', ${PRECO}, 1)
  returning id
), novo_produto_a as (
  insert into produtos (nome, preco_venda, estoque_atual)
  values ('${PRODUTO_A}', ${PRECO_CREDITO}, 100)
  returning id
), novo_produto_b as (
  insert into produtos (nome, preco_venda, estoque_atual)
  values ('${PRODUTO_B}', ${PRECO_CREDITO}, 100)
  returning id
), novo_cliente as (
  insert into clientes (nome, limite_credito, bloqueado)
  values ('${CLIENTE}', ${LIMITE_CREDITO}, false)
  returning id
), novo_caixa as (
  insert into caixa_sessoes (aberto_por, status, terminal, valor_inicial)
  select id, 'aberto', '${TERMINAL}', 0 from novo_usuario
  returning id
)
select jsonb_build_object(
  'usuario',  (select id from novo_usuario),
  'produto',  (select id from novo_produto),
  'produtoA', (select id from novo_produto_a),
  'produtoB', (select id from novo_produto_b),
  'cliente',  (select id from novo_cliente),
  'caixa',    (select id from novo_caixa)) as ids;
`)
    ids = cenario[0].ids
    console.log('cenario: usuario ' + ids.usuario.slice(0, 8) + '..., produto com estoque 1,')
    console.log('         produtos de crediario de R$ 45,00 e cliente com limite de R$ 50,00,')
    console.log('         caixa aberto no terminal ' + TERMINAL)

    const claims = JSON.stringify({ sub: ids.usuario, role: 'authenticated' })
    const itens = (produto) => JSON.stringify([{ produto_id: produto, quantidade: 1 }])
    const pagamentosDinheiro = JSON.stringify([{ forma: 'dinheiro', valor: PRECO }])
    const pagamentosCrediario = JSON.stringify([{ forma: 'crediario', valor: PRECO_CREDITO }])

    // ============ cenario 1: duas vendas do ultimo item ============
    const ultimo = await disputar({
      rotulo: 'cenario 1: duas vendas simultaneas do ultimo item',
      sqlA: sqlVendaA(claims, 'null', crypto.randomUUID(), itens(ids.produto), pagamentosDinheiro),
      sqlB: sqlVendaB(claims, 'null', crypto.randomUUID(), itens(ids.produto), pagamentosDinheiro),
    })

    checar(ultimo.a.ok, 'ultimo item: A conseguiu vender',
      'HTTP ' + ultimo.a.status + ': ' + ultimo.a.texto.slice(0, 200))
    checar(ultimo.locks > 0,
      'ultimo item: A viu uma sessao esperando lock enquanto segurava a linha',
      'pg_locks = ' + ultimo.locks + ' (prova de que B ficou presa)')
    checar(ultimo.b.ok, 'ultimo item: B respondeu',
      'HTTP ' + ultimo.b.status + ': ' + ultimo.b.texto.slice(0, 200))

    // O ESTOQUE PASSOU A SER INFORMATIVO (migration 011, decisao do Lucas): B NAO
    // e mais recusada por estoque. O que este cenario prova agora e o que o `for
    // update` sempre protegeu de verdade — SALDO PERDIDO. Sem ele, as duas vendas
    // leriam o mesmo estoque (1) e gravariam o mesmo saldo_apos (0), e uma das
    // baixas sumiria: o estoque final mentiria.
    checar(ultimo.vendeu, 'ultimo item: B TAMBEM vendeu — estoque nao bloqueia mais',
      'B nao vendeu; mensagem: ' + ultimo.mensagem)
    checar(ultimo.esperouMs >= 200,
      'ultimo item: B ficou bloqueada por pelo menos 200 ms, medido dentro do banco',
      'esperou_ms = ' + ultimo.esperouMs)

    const estado1 = await linhas(`
select jsonb_build_object(
  'estoque', (select estoque_atual from produtos where id = '${ids.produto}'),
  'vendas',  (select count(*) from vendas where usuario_id = '${ids.usuario}'
                and id in (select venda_id from venda_itens where produto_id = '${ids.produto}')),
  'itens',   (select count(*) from venda_itens where produto_id = '${ids.produto}'),
  'saldos_distintos', (select count(distinct saldo_apos) from estoque_movimentos
                        where produto_id = '${ids.produto}')
) as estado;
`)
    checar(estado1[0].estado.estoque === -1,
      'ultimo item: o estoque final e -1 (vendeu 2 com 1 em estoque, sem bloqueio)',
      'estoque = ' + estado1[0].estado.estoque)
    checar(estado1[0].estado.vendas === 2, 'ultimo item: as DUAS vendas existem',
      'vendas = ' + estado1[0].estado.vendas)
    checar(estado1[0].estado.itens === 2, 'ultimo item: dois itens vendidos',
      'itens = ' + estado1[0].estado.itens)
    // A PROVA do saldo perdido: os dois movimentos tem de ter saldo_apos
    // DIFERENTES (0 e -1). Se o lock nao funcionasse, sairiam iguais.
    checar(estado1[0].estado.saldos_distintos === 2,
      'ultimo item: os dois movimentos tem saldo_apos DIFERENTES (0 e -1) — sem saldo perdido',
      'saldos distintos = ' + estado1[0].estado.saldos_distintos + ' (1 seria saldo perdido)')

    // ============ cenario 2: limite de crediario ============
    const credito = await disputar({
      rotulo: 'cenario 2: duas vendas simultaneas para o mesmo cliente no crediario',
      sqlA: sqlVendaA(claims, `'${ids.cliente}'`, crypto.randomUUID(), itens(ids.produtoA), pagamentosCrediario),
      sqlB: sqlVendaB(claims, `'${ids.cliente}'`, crypto.randomUUID(), itens(ids.produtoB), pagamentosCrediario),
    })

    checar(credito.a.ok, 'crediario: A conseguiu vender',
      'HTTP ' + credito.a.status + ': ' + credito.a.texto.slice(0, 200))
    checar(credito.locks > 0,
      'crediario: A viu uma sessao esperando lock enquanto segurava o cliente',
      'pg_locks = ' + credito.locks + ' (prova de que B ficou presa)')
    checar(credito.b.ok, 'crediario: B respondeu (mesmo recusando)',
      'HTTP ' + credito.b.status + ': ' + credito.b.texto.slice(0, 200))
    checar(!credito.vendeu,
      'crediario: B NAO vendeu — as duas vendas juntas passariam do limite',
      'B vendeu: o cliente ficou devendo R$ 90,00 com limite de R$ 50,00')
    checar(/Limite excedido/i.test(credito.mensagem),
      'crediario: B falhou com "Limite excedido"', 'mensagem: ' + credito.mensagem)
    checar(credito.esperouMs >= 200,
      'crediario: B ficou bloqueada por pelo menos 200 ms, medido dentro do banco',
      'esperou_ms = ' + credito.esperouMs)

    const estado2 = await linhas(`
select jsonb_build_object(
  'vendas',  (select count(*) from vendas where usuario_id = '${ids.usuario}'
                and id in (select venda_id from venda_itens
                            where produto_id in ('${ids.produtoA}', '${ids.produtoB}'))),
  'divida',  (select coalesce(sum(case when tipo = 'compra' then valor else -valor end), 0)
                from crediario_lancamentos where cliente_id = '${ids.cliente}'),
  'limite',  (select limite_credito from clientes where id = '${ids.cliente}')
) as estado;
`)
    checar(estado2[0].estado.vendas === 1, 'crediario: existe exatamente uma venda no crediario',
      'vendas = ' + estado2[0].estado.vendas)
    checar(estado2[0].estado.divida <= estado2[0].estado.limite,
      'crediario: a divida do cliente nao passa do limite',
      'divida = ' + estado2[0].estado.divida + ', limite = ' + estado2[0].estado.limite)

    // ============ cenario 3: o teto do orcamento do agente ============
    // A prova de que o `for update` da linha do mes vale: duas reservas
    // SIMULTANEAS que juntas passariam dos US$ 5 nao podem passar as duas.
    //
    // O cenario e montado com o MES DEDICADO `2099-12-01` ja com 4.999.000 µ$
    // consumidos — sobram 1.000 µ$. As duas reservas sao de 1.000 µ$: cada uma
    // cabe sozinha, mas juntas fariam 5.001.000. E o desenho que separa "o lock
    // funciona" de "o teto funciona": sem o `for update`, as duas sessoes leriam
    // 4.999.000 e as DUAS passariam.
    //
    // Sem testar o orcamento pelo `service_role`: medido no Preflight (migration
    // 001_base.sql:207-209), `anon` e `authenticated` nao tem privilegio de tabela
    // nenhum no schema — so `service_role` alcanca o ledger, e o teste concorda
    // com a producao em vez de contornar o controle.
    await sql(`
insert into agente_orcamento_mensal (mes, consumido_micros)
values (date '${MES_ORCAMENTO}', ${CONSUMIDO_INICIAL_ORCAMENTO});
`)
    console.log('')
    console.log('cenario 3: mes dedicado ' + MES_ORCAMENTO + ' com ' + CONSUMIDO_INICIAL_ORCAMENTO +
      ' micros consumidos (folga de ' + (TETO_MICROS - CONSUMIDO_INICIAL_ORCAMENTO) + ' micros)')

    const orcamento = await disputar({
      rotulo: 'cenario 3: duas reservas simultaneas que juntas passariam dos US$ 5',
      sqlA: sqlReservaA(RESERVA_MICROS),
      sqlB: sqlReservaB(RESERVA_MICROS),
    })

    checar(orcamento.a.ok, 'orcamento: A conseguiu reservar',
      'HTTP ' + orcamento.a.status + ': ' + orcamento.a.texto.slice(0, 200))
    checar(orcamento.locks > 0,
      'orcamento: A viu uma sessao esperando lock enquanto segurava a linha do mes',
      'pg_locks = ' + orcamento.locks + ' (prova de que B ficou presa)')
    checar(orcamento.b.ok, 'orcamento: B respondeu (mesmo recusando)',
      'HTTP ' + orcamento.b.status + ': ' + orcamento.b.texto.slice(0, 200))
    checar(orcamento.vendas && orcamento.vendas.length > 0,
      'orcamento: A criou uma reserva de verdade',
      'reserva_id = ' + orcamento.vendas)
    checar(!orcamento.vendeu,
      'orcamento: B NAO reservou — as duas reservas juntas passariam dos US$ 5',
      'B reservou: o mes ficou com mais de 5.000.000 micros consumidos')
    checar(/esgotado/i.test(orcamento.mensagem),
      'orcamento: B falhou com a mensagem de orcamento esgotado',
      'mensagem: ' + orcamento.mensagem)
    checar(orcamento.esperouMs >= 200,
      'orcamento: B ficou bloqueada por pelo menos 200 ms, medido dentro do banco',
      'esperou_ms = ' + orcamento.esperouMs)

    const estado3 = await linhas(`
select jsonb_build_object(
  'consumido', (select consumido_micros from agente_orcamento_mensal where mes = date '${MES_ORCAMENTO}'),
  'reservas',  (select count(*) from agente_orcamento_reservas where mes = date '${MES_ORCAMENTO}'),
  'reservadas',(select count(*) from agente_orcamento_reservas
                 where mes = date '${MES_ORCAMENTO}' and estado = 'reservada')
) as estado;
`)
    checar(estado3[0].estado.consumido === TETO_MICROS,
      'orcamento: o consumido final e exatamente os US$ 5 (5.000.000 micros)',
      'consumido = ' + estado3[0].estado.consumido)
    checar(estado3[0].estado.consumido <= TETO_MICROS,
      'orcamento: o consumido final NAO passa do teto',
      'consumido = ' + estado3[0].estado.consumido + ', teto = ' + TETO_MICROS)
    checar(estado3[0].estado.reservas === 1 && estado3[0].estado.reservadas === 1,
      'orcamento: sobrou exatamente UMA reserva, a de A (B nao gravou nada)',
      'reservas = ' + estado3[0].estado.reservas + ', abertas = ' + estado3[0].estado.reservadas)
  } catch (erro) {
    checar(false, 'os testes rodaram ate o fim', erro.message)
  } finally {
    // ------------------------------ limpeza ------------------------------
    try {
      await sql(limpeza)
      const restou = await linhas(sobrou)
      const r = restou[0].restou
      const total = Object.values(r).reduce((soma, n) => soma + Number(n), 0)
      limpezaOk = total === 0
      checar(limpezaOk, 'a limpeza removeu todas as linhas criadas', JSON.stringify(r))
    } catch (erro) {
      limpezaOk = false
      checar(false, 'a limpeza removeu todas as linhas criadas', erro.message)
    }
  }

  const falhas = resultados.filter((r) => !r.ok).length
  console.log('')
  console.log(resultados.length - falhas + ' OK, ' + falhas + ' FALHOU de ' + resultados.length + ' verificacoes')
  // process.exit() logo apos um fetch derruba o processo no Node 24.
  process.exitCode = falhas > 0 || !limpezaOk ? 1 : 0
}
