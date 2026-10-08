// Prepara o cenario dos testes de ponta a ponta (Task 13).
//
// Os testes do PDV precisam de estado REAL no banco: caixa aberto e um produto
// com estoque. Em vez de deixar isso como passo manual ("antes de rodar, abra o
// caixa"), este script faz o preparo, e o playwright.config.ts o chama como
// `globalSetup`.
//
// ISOLAMENTO: o cenario usa um terminal proprio ('e2e') e um produto com nome
// fixo, entao nada do que a farmacia tem no banco e tocado — nem o caixa real.
//
// Transporte: o mesmo do resto do projeto, o endpoint de gerenciamento com o
// SUPABASE_ACCESS_TOKEN, porque o banco nao aceita conexao `pg`.

import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'

const raiz = path.resolve(import.meta.dirname, '..', '..')
dotenv.config({ path: path.join(raiz, '.env.local'), quiet: true })

const token = process.env.SUPABASE_ACCESS_TOKEN
const urlProjeto = process.env.NEXT_PUBLIC_SUPABASE_URL
const email = process.env.USUARIO_EMAIL

if (!token || !urlProjeto || !email) {
  throw new Error('Faltam SUPABASE_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL ou USUARIO_EMAIL no .env.local')
}

const ref = new URL(urlProjeto).hostname.split('.')[0]

export const PRODUTO_E2E = 'PRODUTO E2E PARACETAMOL'
export const PRECO_E2E = 500
export const TERMINAL_E2E = 'e2e'
// Para o teste de limite de crediario: um produto caro e um cliente que nao
// alcanca o valor dele.
export const PRODUTO_CARO_E2E = 'PRODUTO E2E CARO'
export const PRECO_CARO_E2E = 4500
// Nome com VIRGULA de proposito: e o caso que quebrava a busca, porque a virgula
// e o separador de condicoes do filtro `or` do PostgREST. Nome de medicamento com
// virgula e comum ("DIPIRONA, 20 COMPRIMIDOS").
export const PRODUTO_VIRGULA_E2E = 'DIPIRONA, 20 COMPRIMIDOS'
export const CLIENTE_E2E = 'CLIENTE E2E LIMITE BAIXO'
export const LIMITE_CLIENTE_E2E = 3000
// Clientes que os TESTES criam pela tela (o e2e do crediario, Task 8: cadastro,
// recebimento parcial, recusa acima da divida, WhatsApp e cliente sem telefone).
// Eles entram no `limpar()` pelo mesmo motivo do CLIENTE_E2E: cliente orfao com
// divida fica no banco de PRODUCAO depois da rodada, e a seguinte bateria em
// 'Já existe um cliente com este CPF.' no cadastro. Os nomes estao repetidos em
// `crediario.spec.ts` (o .ts e CommonJS e este arquivo e ESM: `import` entre os
// dois nao funciona — ver o cabecalho do venda.spec.ts).
export const CLIENTES_DOS_TESTES_E2E = [
  'CLIENTE E2E CADASTRO',
  'CLIENTE E2E LIMITE DONO',
  'CLIENTE E2E PARCIAL',
  'CLIENTE E2E ACIMA',
  'CLIENTE E2E WHATSAPP',
  'CLIENTE E2E SEM TELEFONE',
]

async function consultar(query) {
  const resposta = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const texto = await resposta.text()
  if (!resposta.ok) throw new Error(`SQL falhou (HTTP ${resposta.status}): ${texto.slice(0, 400)}`)
  return texto ? JSON.parse(texto) : []
}

/**
 * Remove tudo que os testes criaram, na ordem que as chaves estrangeiras exigem:
 * movimentos e vendas ANTES do caixa e do produto. Idempotente.
 */
export async function limpar() {
  // Os nomes viram uma lista `in (...)` no SQL: apagar POR NOME e o que impede
  // que a limpeza leve junto cliente de verdade da farmacia. Escrever os nomes a
  // mao em dois lugares (aqui e nos testes) e o preco de nao poder importar as
  // constantes — ver o comentario de CLIENTES_DOS_TESTES_E2E.
  const nomesDosClientes = [CLIENTE_E2E, ...CLIENTES_DOS_TESTES_E2E]
    .map((nome) => `'${nome}'`)
    .join(', ')

  await consultar(`
    do $$
    declare
      v_produto uuid;
      v_caro uuid;
      v_virgula uuid;
      v_sessao uuid;
      v_vendas uuid[];
    begin
      select id into v_produto from produtos where nome = '${PRODUTO_E2E}';
      select id into v_caro from produtos where nome = '${PRODUTO_CARO_E2E}';
      select id into v_virgula from produtos where nome = '${PRODUTO_VIRGULA_E2E}';
      select id into v_sessao from caixa_sessoes where terminal = '${TERMINAL_E2E}';

      -- Todas as vendas que a suite pode ter deixado: as da sessao e2e e as que
      -- contem os produtos e2e, mesmo que tenham caido em outra sessao.
      select coalesce(array_agg(id), '{}') into v_vendas
        from vendas
       where (v_sessao is not null and caixa_sessao_id = v_sessao)
          or id in (select venda_id from venda_itens where produto_id in (v_produto, v_caro, v_virgula));

      -- ORDEM OBRIGATORIA. caixa_movimentos, estoque_movimentos e
      -- crediario_lancamentos apontam para vendas(id) SEM on delete cascade
      -- (001_base.sql, linhas 149, 167 e 181): apagar vendas antes delas falha
      -- com 23503, que foi o defeito da primeira rodada de verdade.
      delete from caixa_movimentos
       where venda_id = any(v_vendas)
          or (v_sessao is not null and sessao_id = v_sessao);

      delete from estoque_movimentos
       where venda_id = any(v_vendas)
          or produto_id in (v_produto, v_caro, v_virgula);

      -- O lancamento de PAGAMENTO nao tem venda (venda_id e nulo): so o
      -- cliente_id o encontra. Sem esta lista, o recebimento do e2e ficaria
      -- apontando para um cliente que o delete abaixo tenta apagar, e a FK sem
      -- cascade (001:180) faria o limpar() inteiro estourar — deixando o caixa
      -- aberto para a suite SQL.
      delete from crediario_lancamentos
       where venda_id = any(v_vendas)
          or cliente_id in (select id from clientes where nome in (${nomesDosClientes}));

      -- venda_itens e venda_pagamentos saem por on delete cascade.
      delete from vendas where id = any(v_vendas);

      delete from produtos where id in (v_produto, v_caro, v_virgula);
      delete from clientes where nome in (${nomesDosClientes});

      if v_sessao is not null then
        delete from caixa_sessoes where id = v_sessao;
      end if;
    end $$;
  `)
}

/**
 * Cria (ou restaura) o cenario. Restaura o estoque para 20 em vez de recriar o
 * produto, para o teste poder rodar varias vezes seguidas sem limpeza manual.
 */
export async function preparar() {
  await limpar()
  await consultar(`
    do $$
    declare v_dono uuid;
    begin
      select id into v_dono from perfis where papel = 'dono' order by criado_em limit 1;
      if v_dono is null then
        raise exception 'Nao existe usuario com papel dono em perfis para os testes e2e';
      end if;

      insert into produtos (nome, codigo_barras, preco_custo, preco_venda, estoque_atual, estoque_minimo)
      values ('${PRODUTO_E2E}', '999000111', 200, ${PRECO_E2E}, 20, 1);

      -- Produto caro: existe para o caso do crediario acima do limite.
      insert into produtos (nome, codigo_barras, preco_custo, preco_venda, estoque_atual, estoque_minimo)
      values ('${PRODUTO_CARO_E2E}', '999000222', 2000, ${PRECO_CARO_E2E}, 20, 1);

      -- Nome com virgula: e o caso que quebrava a busca (virgula e o separador de
      -- condicoes do filtro or do PostgREST).
      insert into produtos (nome, codigo_barras, preco_custo, preco_venda, estoque_atual, estoque_minimo)
      values ('${PRODUTO_VIRGULA_E2E}', '999000333', 200, ${PRECO_E2E}, 20, 1);

      -- Cliente com limite MENOR que o produto caro: o crediario tem que recusar.
      insert into clientes (nome, telefone, limite_credito, bloqueado)
      values ('${CLIENTE_E2E}', '11000000000', ${LIMITE_CLIENTE_E2E}, false);

      -- abrir_caixa recusa se ja houver sessao aberta em qualquer terminal, entao
      -- o insert e direto: em teste precisamos do cenario, nao da regra de balcao.
      insert into caixa_sessoes (aberto_por, status, terminal, valor_inicial)
      values (v_dono, 'aberto', '${TERMINAL_E2E}', 0);
    end $$;
  `)
}

export default async function globalSetup() {
  await preparar()
  console.log('[e2e] cenario pronto: produto com estoque 20 e caixa aberto no terminal e2e')
}
