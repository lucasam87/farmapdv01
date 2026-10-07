// Testes de concorrencia: dois clientes do banco disputando o mesmo recurso.
//
//   1. ultimo item do estoque  — a segunda venda tem que falhar por estoque
//   2. limite de crediario     — duas vendas simultaneas para o MESMO cliente
//                                nao podem passar as duas do limite
//
// Sao os unicos testes que gravam FORA de transacao (duas conexoes concorrentes
// nao cabem num rollback comum). Eles criam usuario, caixa, produtos e cliente
// proprios, limpam tudo no fim (antes e depois, para poder rodar de novo) e
// FALHAM se a limpeza nao funcionar.
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
  // execucao anterior falhou no meio.
  const limpeza = `
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
                  where c.terminal = '${TERMINAL}')
) as restou;
`

  // Dispara A e B em paralelo e devolve o que cada lado viu. A segura a
  // transacao ate ver, no banco, alguem esperando lock; entao espera 1 s e
  // commita. B e cronometrado dentro do banco em volta da chamada.
  async function disputar({ rotulo, claims, cliente, chaveA, chaveB, itensA, itensB, pagamentos }) {
    const clienteSql = cliente ? `'${cliente}'` : 'null'

    const sqlA = `
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

    const sqlB = `
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
-- B COMMITA de proposito quando consegue vender: e isso que deixa o dano
-- visivel no estado final (estoque negativo / divida acima do limite), que e o
-- que o teste verifica depois. Quando B falha — o caso correto — nada e gravado.
-- A limpeza no fim remove o que B tiver gravado.
commit;
`

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
    }
    return saida
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
      claims,
      cliente: null,
      chaveA: crypto.randomUUID(),
      chaveB: crypto.randomUUID(),
      itensA: itens(ids.produto),
      itensB: itens(ids.produto),
      pagamentos: pagamentosDinheiro,
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
      claims,
      cliente: ids.cliente,
      chaveA: crypto.randomUUID(),
      chaveB: crypto.randomUUID(),
      itensA: itens(ids.produtoA),
      itensB: itens(ids.produtoB),
      pagamentos: pagamentosCrediario,
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
