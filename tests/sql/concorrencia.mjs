// Teste de concorrencia: prova que duas vendas simultaneas do ULTIMO item nao
// vendem duas vezes.
//
// Este e o unico teste que grava FORA de transacao — duas conexoes concorrentes
// nao cabem num rollback comum. Ele cria usuario, caixa e produto proprios,
// limpa tudo no fim (antes e depois, para poder rodar de novo) e FALHA se a
// limpeza nao funcionar.
//
// Transporte: duas requisicoes HTTP simultaneas ao endpoint /database/query.
// Sonda comprovou que ele atende em conexoes diferentes (uma tomou lock timeout
// enquanto a outra segurava o lock). A senha do banco (SUPABASE_DB_URL) nunca
// autenticou, entao nao da para abrir dois `pg`.
//
// O criterio de tempo do plano ("B bloqueada por pelo menos 200 ms") e medido
// DENTRO do banco, com clock_timestamp(): o endpoint leva ~1,5 s de overhead por
// requisicao, o que tornaria qualquer medicao no Node uma prova falsa.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'

const raiz = path.resolve(import.meta.dirname, '..', '..')
dotenv.config({ path: path.join(raiz, '.env.local'), quiet: true })

const EMAIL = 'concorrencia@farmacia.local'
const TERMINAL = 'teste-concorrencia'
const PRODUTO = 'PRODUTO CONCORRENCIA'
const PRECO = 1000

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
delete from estoque_movimentos where produto_id in (select id from produtos where nome = '${PRODUTO}');
delete from crediario_lancamentos where venda_id in (
  select v.id from vendas v join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}');
delete from venda_pagamentos where venda_id in (
  select v.id from vendas v join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}');
delete from venda_itens where venda_id in (
  select v.id from vendas v join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}');
delete from vendas where usuario_id in (select id from perfis where nome = '${EMAIL}');
delete from caixa_sessoes where terminal = '${TERMINAL}';
delete from produtos where nome = '${PRODUTO}';
delete from perfis where nome = '${EMAIL}';
delete from auth.users where email = '${EMAIL}';
`

  const sobrou = `
select jsonb_build_object(
  'usuarios',   (select count(*) from auth.users where email = '${EMAIL}'),
  'perfis',     (select count(*) from perfis where nome = '${EMAIL}'),
  'produtos',   (select count(*) from produtos where nome = '${PRODUTO}'),
  'caixas',     (select count(*) from caixa_sessoes where terminal = '${TERMINAL}'),
  'vendas',     (select count(*) from vendas v join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}'),
  'itens',      (select count(*) from venda_itens i join vendas v on v.id = i.venda_id
                  join perfis p on p.id = v.usuario_id where p.nome = '${EMAIL}'),
  'mov_estoque',(select count(*) from estoque_movimentos m join produtos pr on pr.id = m.produto_id
                  where pr.nome = '${PRODUTO}'),
  'mov_caixa',  (select count(*) from caixa_movimentos m join caixa_sessoes c on c.id = m.sessao_id
                  where c.terminal = '${TERMINAL}')
) as restou;
`

  let ids = null
  let respostaA = null
  let respostaB = null
  let esperouMs = -1
  let mensagemB = ''
  let vendeuB = true
  let waitersA = -1
  let estoqueFinal = -1
  let vendasDoProduto = -1
  let limpezaOk = true

  try {
    await sql(limpeza)

    // ------------------------------ cenario ------------------------------
    // Uma unica instrucao com CTEs modificadoras: as tres linhas nascem juntas
    // ou nao nasce nenhuma.
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
), novo_caixa as (
  insert into caixa_sessoes (aberto_por, status, terminal, valor_inicial)
  select id, 'aberto', '${TERMINAL}', 0 from novo_usuario
  returning id
)
select jsonb_build_object(
  'usuario', (select id from novo_usuario),
  'produto', (select id from novo_produto),
  'caixa',   (select id from novo_caixa)) as ids;
`)
    ids = cenario[0].ids
    console.log('cenario: usuario ' + ids.usuario.slice(0, 8) + '..., produto com estoque 1, caixa aberto no terminal ' + TERMINAL)
    console.log('')

    const claims = JSON.stringify({ sub: ids.usuario, role: 'authenticated' })
    const itens = JSON.stringify([{ produto_id: ids.produto, quantidade: 1 }])
    const pagamentos = JSON.stringify([{ forma: 'dinheiro', valor: PRECO }])
    const chaveA = crypto.randomUUID()
    const chaveB = crypto.randomUUID()

    // A: vende, segura o lock ate ver B bloqueada, espera 1 s e so entao commit.
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
  v_venda := registrar_venda('${chaveA}', null, '${itens}'::jsonb, '${pagamentos}'::jsonb, 0);
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

    // B: tenta vender o mesmo ultimo item. Tem que ficar bloqueada e, quando A
    // commitar, falhar por estoque. Nada e gravado: o rollback fecha a conta.
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
    perform registrar_venda('${chaveB}', null, '${itens}'::jsonb, '${pagamentos}'::jsonb, 0);
    insert into _conc_b
    values (true, round(extract(epoch from (clock_timestamp() - v_inicio)) * 1000)::integer, null);
  exception when others then
    insert into _conc_b
    values (false, round(extract(epoch from (clock_timestamp() - v_inicio)) * 1000)::integer, sqlerrm);
  end;
end $$;
select jsonb_build_object('vendeu', vendeu, 'esperou_ms', esperou_ms, 'mensagem', mensagem) as resultado
from _conc_b;
rollback;
`

    // A sai primeiro; B entra depois que A com certeza ja pegou o lock (o
    // endpoint leva ~1,5 s de overhead por requisicao).
    const promessaA = sql(sqlA)
    await dormir(2000)
    respostaB = await sql(sqlB)
    respostaA = await promessaA

    checar(respostaA.ok, 'A conseguiu vender o ultimo item',
      'HTTP ' + respostaA.status + ': ' + respostaA.texto.slice(0, 200))

    if (respostaA.ok) {
      const resultadoA = JSON.parse(respostaA.texto)[0].resultado
      waitersA = resultadoA.locks
      checar(waitersA > 0,
        'A viu uma sessao esperando lock enquanto segurava a linha (prova de que B ficou presa)',
        'pg_locks = ' + resultadoA.locks + ', pg_stat_activity = ' + resultadoA.esperando +
          ' (A esperou ' + resultadoA.esperou_ms + ' ms)')
    }

    if (respostaB.ok) {
      const resultadoB = JSON.parse(respostaB.texto)[0].resultado
      vendeuB = resultadoB.vendeu
      esperouMs = resultadoB.esperou_ms
      mensagemB = resultadoB.mensagem ?? ''
    }

    checar(respostaB.ok, 'B respondeu (mesmo recusando)', 'HTTP ' + respostaB.status + ': ' + respostaB.texto.slice(0, 200))
    checar(!vendeuB, 'B NAO vendeu o ultimo item (o bug que este teste existe para pegar)',
      'B vendeu — o estoque de 1 item foi vendido duas vezes')
    checar(/Estoque insuficiente/i.test(mensagemB),
      'B falhou com "Estoque insuficiente"', 'mensagem: ' + mensagemB)
    checar(esperouMs >= 200,
      'B ficou bloqueada por pelo menos 200 ms, medido dentro do banco',
      'esperou_ms = ' + esperouMs)

    const estado = await linhas(`
select jsonb_build_object(
  'estoque', (select estoque_atual from produtos where id = '${ids.produto}'),
  'vendas',  (select count(*) from vendas where usuario_id = '${ids.usuario}'),
  'itens',   (select count(*) from venda_itens where produto_id = '${ids.produto}')
) as estado;
`)
    estoqueFinal = estado[0].estado.estoque
    vendasDoProduto = estado[0].estado.vendas
    checar(estoqueFinal === 0, 'o estoque final do produto e 0', 'estoque = ' + estoqueFinal)
    checar(vendasDoProduto === 1, 'existe exatamente uma venda', 'vendas = ' + vendasDoProduto)
    checar(estado[0].estado.itens === 1, 'existe exatamente um item vendido', 'itens = ' + estado[0].estado.itens)
  } catch (erro) {
    checar(false, 'o teste rodou ate o fim', erro.message)
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

  if (respostaA) {
    console.log('')
    console.log('evidencia: A vendeu; B esperou ' + esperouMs + ' ms no lock e recebeu "' + mensagemB + '"')
  }

  const falhas = resultados.filter((r) => !r.ok).length
  console.log('')
  console.log(resultados.length - falhas + ' OK, ' + falhas + ' FALHOU de ' + resultados.length + ' verificacoes')
  // process.exit() logo apos um fetch derruba o processo no Node 24.
  process.exitCode = falhas > 0 || !limpezaOk ? 1 : 0
}
