-- 020_fechar_custo_venda.sql — fecha a leitura DIRETA do custo da venda, sem
-- quebrar o relatorio de lucro (Task 2 do plano do agente de margem).
--
-- O QUE ESTAVA ABERTO (divida que o PROGRESSO.md:114 ja registrava, MEDIDA em
-- 14/10/2026 contra este banco):
--   * `has_column_privilege('authenticated','venda_itens','preco_custo','select')` = true
--     — qualquer usuario logado (inclusive ATENDENTE) lia o custo de cada item pelo
--     PostgREST, e o custo e a metade que a farmacia nao mostra ao balcao.
--   * `has_table_privilege('authenticated','v_lucro_periodo','select')` = true — a
--     view devolvia 2 linhas de LUCRO REAL para `authenticated`.
-- `produtos.preco_custo` NAO entra aqui: a tela do produto
-- (`app/(app)/produtos/[id]/page.tsx:52`) e o formulario de edicao leem essa coluna,
-- e e leitura legitima do atendente.
--
-- A ARMADILHA, e por isso a ORDEM deste arquivo e o ponto e nao detalhe:
--   `relatorio_lucro` (016_relatorios.sql:87) e `security invoker`. Ela so enxergava
--   `venda_itens.preco_custo` porque QUEM CHAMA tambem enxergava. Revogar a coluna
--   com a funcao ainda invoker deixaria o relatorio de lucro da tela estourando
--   `permission denied for table venda_itens` em producao, EM SILENCIO. Por isso:
--     (1) PRIMEIRO a funcao e recriada como `security definer` (copia literal de 016,
--         mudando so isso, mais o `search_path` fixo que definer exige);
--     (2) e SO DEPOIS a coluna e a view sao revogadas.
--   A prova esta em tests/sql/casos/150_permissoes_custo.sql: o vermelho contra a
--   definicao antiga (`git show` do commit BASE) e o verde contra esta.
--
-- O PRECO DO `security definer`, escrito para nao ser esquecido: ele roda como o dono
-- do banco e a RLS simplesmente NAO e aplicada. A checagem de papel que ja existia no
-- corpo (`if v_papel is distinct from 'dono' then raise`) deixa de ser redundante e
-- passa a ser a UNICA barreira entre o atendente e o custo. Ela foi mantida LITERAL, e
-- o caso 4 do 150 a prova chamando a funcao com o role trocado para `authenticated`.
--
-- SEM DDL PESADO EM TABELA QUENTE: este arquivo so mexe em FUNCAO (o `create or
-- replace` de `relatorio_lucro` toma lock apenas dela) e em PERMISSAO de `venda_itens`
-- (`revoke`/`grant`, que sao DDL de catalogo de ACL e nao reescrevem tabela) e no SELECT
-- da view. Nenhum `drop constraint`, nenhum `alter table` e nenhum `alter column` na
-- tabela de vendas — foi o defeito da task anterior.
--
-- ESTE ARQUIVO RODA DUAS VEZES SEM ESTRAGAR: a funcao e `create or replace`, o revoke
-- da view e idempotente e o bloco de coluna tem guarda `if` (ver a secao 2).

-- ============================================================
-- 1) relatorio_lucro como `security definer` — ANTES de qualquer revogacao.
--
-- Copia LITERAL do corpo de `supabase/migrations/016_relatorios.sql:87-116`, com DUAS
-- mudancas e nenhuma outra:
--   * `security definer` (era o default `invoker`), para a funcao continuar lendo
--     `venda_itens.preco_custo` depois que a coluna for revogada de `authenticated`;
--   * `set search_path = public, pg_temp`, obrigatorio em `security definer` (mesma
--     regra de 002, 019 e das fixtures): sem ele, um schema no caminho do chamador
--     poderia sequestrar a funcao.
-- A checagem de papel, a ordem (periodo ANTES do papel), o `stable`, o plpgsql e os
-- zeros para periodo torto continuam exatamente como estavam — `relatorio_lucro`
-- continua devolvendo zeros para periodo nulo/invertido, e nao erro (ruling aceito).
--
-- A clausula `set search_path` vai junto das outras opcoes da funcao, e nao depois do
-- corpo: e ali que ela vira `proconfig` (`alter function ... set search_path` faz o
-- mesmo depois). O caso do 150 le `proconfig` para prender isso.
-- ============================================================
create or replace function public.relatorio_lucro(p_de date, p_ate date)
returns table (receita bigint, custo bigint, lucro bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_papel text;
begin
  if p_de is null or p_ate is null or p_de > p_ate then
    receita := 0;
    custo := 0;
    lucro := 0;
    return next;
    return;
  end if;

  select p.papel into v_papel from public.perfis p where p.id = auth.uid();
  if v_papel is distinct from 'dono' then
    raise exception 'Só o dono vê o lucro.';
  end if;

  return query
    select coalesce(sum(i.preco_unitario * i.quantidade), 0)::bigint,
           coalesce(sum(i.preco_custo * i.quantidade), 0)::bigint,
           coalesce(sum((i.preco_unitario - i.preco_custo) * i.quantidade), 0)::bigint
    from public.venda_itens i
    join public.vendas v on v.id = i.venda_id
    where v.status = 'concluida'
      and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate;
end $$;

comment on function public.relatorio_lucro(date, date) is
  'Receita, custo e lucro das vendas concluidas do periodo (fuso de Sao Paulo). SO O DONO: qualquer outro papel recebe "So o dono ve o lucro.". security definer: le venda_itens.preco_custo, que e fechado para authenticated.';

-- ============================================================
-- 2) As DUAS portas do mesmo custo, agora que a funcao ja le por dentro.
--
-- (a) `venda_itens.preco_custo`: e a coluna que o PostgREST expunha.
--
--     ATENCAO — O `revoke select (preco_custo)` SOZINHO NAO FECHA NADA, e isto foi
--     MEDIDO nesta rodada contra este banco: o Supabase concede SELECT em NIVEL DE
--     TABELA a `anon` e `authenticated` por DEFAULT PRIVILEGES
--     (`information_schema.table_privileges` de `venda_itens` mostra
--     `authenticated`/`anon` com SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER,
--     TRUNCATE — a mesma origem registrada em 013_seguranca_views.sql:11). Um privilegio
--     de COLUNA nao subtrai nada de um privilegio de TABELA: depois do revoke de coluna o
--     `has_column_privilege('authenticated','venda_itens','preco_custo','select')`
--     continuou `true` (esta migration foi aplicada e o caso 150 seguiu VERMELHO).
--     Para fechar a coluna e preciso TIRAR o SELECT de tabela e devolver, por COLUNA,
--     todo o resto — a lista abaixo enumera as 8 colunas de 001_base.sql:115-125 menos
--     `preco_custo`.
--
--     POR QUE ISSO NAO QUEBRA A TELA: a unica leitura de `venda_itens` que o app faz
--     pelo PostgREST e `app/(app)/vendas/[id]/page.tsx:45`, que pede exatamente
--     `id, nome_produto, quantidade, preco_unitario, total` — todos na lista.
--
--     O QUE **NAO** FOI FECHADO — escrito aqui porque o silencio ja fez alguem concluir
--     o contrario (achado da revisao da Task 2, MEDIDO): a porta de ESCRITA continua
--     ABERTA, e ja estava antes desta migration. `has_table_privilege('authenticated',
--     'venda_itens','insert'/'update'/'delete')` = `true` nos tres (o DEFAULT PRIVILEGES
--     do Supabase concede INSERT/UPDATE/DELETE/TRUNCATE em nivel de tabela) e a policy
--     `logado_tudo` e `for all to authenticated using (true) with check (true)`
--     (001_base.sql:233-235). Ou seja: depois desta migration o ATENDENTE nao LE o
--     custo, mas continua podendo ESCREVER em `venda_itens` pelo PostgREST. Esta
--     migration fecha LEITURA e nao toca em escrita — nao porque a escrita seja segura,
--     mas porque fecha-la e outra decisao (mexe no PDV, no cancelamento e na policy
--     `logado_tudo`) e merece analise propria. A frase "as escritas passam por RPC
--     definer" descreve os caminhos NORMAIS do app; ela NAO diz que o grant nao existe,
--     e era assim que a versao anterior deste comentario podia ser lida.
--
--     CONSEQUENCIA DECLARADA para quem mexer depois: grant por COLUNA nao cobre coluna
--     que nascer depois, entao uma coluna nova em `venda_itens` nasce ILEGIVEL para
--     `authenticated` ate alguem acrescenta-la a esta lista. Foi escolhido o lado que
--     falha para o lado SEGURO (a tela quebra visivelmente, o custo nao vaza em silencio)
--     — se um dia a coluna nova for necessaria no app, ela entra na lista, e a decisao
--     fica registrada aqui.
--
--     O `revoke select (preco_custo)` fica junto de proposito, mesmo sendo coberto pelo
--     `revoke select` de tabela: ele e idempotente e deixa escrito, em uma linha, qual
--     coluna e o alvo — e e a linha que o brief pedia.
--
-- (b) `v_lucro_periodo`: a view e `security_invoker = true`
--     (013_seguranca_views.sql:34) e calcula `sum(i.preco_custo * i.quantidade)`
--     (005_views.sql:46-55). Depois de (a) ela deixaria de RODAR para
--     `authenticated` de qualquer forma (a permissao da coluna de base e checada ao
--     consultar a view com `security_invoker`), e o SELECT direto dela e a segunda
--     porta do mesmo dado. Conferido ANTES de fechar (a spec exige a conferencia):
--     NENHUMA tela do app le esta view — a varredura de `app/`, `lib/` e `components/`
--     so encontra a mencao em `PROGRESSO.md`, na spec, nas migrations 005/013 e nos
--     testes `040_views.sql:99` e `:113`.
--
--     O CAMINHO ERRADO, registrado para nao ser tentado: `security_invoker = false`
--     na view a faria rodar como o dono, e qualquer autenticado (INCLUSIVE ATENDENTE)
--     veria o lucro — isso e o vazamento, nao o conserto. Uma view nao tem checagem de
--     papel no corpo (nao ha corpo), entao a unica correcao coerente e tirar o SELECT
--     de `authenticated` e deixar a leitura do lucro pela FUNCAO, que tem a guarda.
--
--     Os dois casos que leem a view (`040_views.sql:99` e `:113`) rodam com o role
--     PADRAO do runner — MEDIDO: `current_user = postgres`, mesmo depois do
--     `set_config('request.jwt.claims', ...)`, porque trocar os CLAIMS do JWT nao troca
--     o ROLE da sessao. O dono do banco nao perde o SELECT, entao o 040 continua verde
--     e a prova de A7 (venda cancelada fora da view) nao se perde.
--
-- SEM DDL EM TABELA QUENTE, tambem aqui: `grant`/`revoke` mexem so no catalogo de
-- permissoes (nao ha reescrita de tabela nem `access exclusive`), entao o PDV segue
-- vendendo. A guarda `if` existe para o arquivo poder rodar de novo: na segunda
-- aplicacao o SELECT de tabela ja nao existe e o bloco inteiro nao repete o trabalho.
-- ============================================================
do $$
begin
  if has_table_privilege('authenticated', 'public.venda_itens', 'select') then
    revoke select (preco_custo) on public.venda_itens from authenticated;
    revoke select on public.venda_itens from authenticated;
    grant select (id, venda_id, produto_id, nome_produto, quantidade,
                  preco_unitario, total)
      on public.venda_itens to authenticated;
  end if;
end $$;

revoke select on public.v_lucro_periodo from authenticated;

-- ============================================================
-- 3) As duas linhas de permissao da funcao recriada.
--
-- `create or replace` PRESERVA os privilegios ja concedidos, mas repetir e obrigatorio
-- do mesmo jeito: `from anon` nao e decoracao — no Supabase o EXECUTE chega a `anon` por
-- DEFAULT PRIVILEGES, direto no papel, e revogar so de PUBLIC nao tira nada (mesmo
-- achado de 002 e 016, provado por 050_permissoes.sql). E `service_role` fica com o
-- EXECUTE porque e o papel do servidor: sem ele, a leitura do lucro no Next pararia de
-- funcionar (a RLS nao socorre um `definer`).
-- ============================================================
revoke all on function public.relatorio_lucro(date, date) from public, anon;
grant execute on function public.relatorio_lucro(date, date) to authenticated, service_role;
