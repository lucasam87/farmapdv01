-- 013_seguranca_views.sql — fecha o vazamento das views pela chave PUBLICA.
--
-- POR QUE ISTO EXISTE (achado da revisao final do branch da Etapa 5):
--
--   1. Uma view SEM `security_invoker` roda com os privilegios do DONO (aqui,
--      `postgres`), e nao de quem consulta. A RLS e avaliada em nome do dono —
--      e o dono do banco e superusuario, entao a RLS simplesmente NAO e
--      aplicada. Foi por isso que a chave publica (`sb_publishable_...`, a que
--      vai no bundle do navegador) leu produto real de `v_estoque_baixo` sem
--      login: HTTP 200 com dados.
--   2. O Supabase concede SELECT a `anon` por DEFAULT PRIVILEGES em tudo que o
--      papel `postgres` cria em `public` — inclusive views. Nao houve grant
--      explicito em lugar nenhum; a view nasceu legivel para o mundo.
--   3. As TABELAS estao protegidas (a RLS barra `anon` desde a 001), e o
--      050_permissoes.sql provava isso. A porta ficou aberta pelas views.
--
-- A correcao da classe inteira: `security_invoker = true` faz a view rodar com
-- os privilegios de QUEM CONSULTA, entao a RLS das tabelas de base passa a
-- valer. `anon` deixa de ver linha; `authenticated` continua vendo tudo (as
-- policies `logado_tudo`/`perfis_leitura` sao `to authenticated using (true)`).
--
-- `alter view ... set (...)` e IDEMPOTENTE e nao recria a view, entao rodar de
-- novo nao quebra dependencia nenhuma.
--
-- ESCOPO: so views. Nao mexer em function/RPC — `security invoker` em funcao e
-- outro assunto (e as RPCs deste projeto sao `security definer` de proposito).

alter view public.v_caixa_atual         set (security_invoker = true);
alter view public.v_clientes_devedores  set (security_invoker = true);
alter view public.v_estoque_baixo       set (security_invoker = true);
alter view public.v_estoque_parado      set (security_invoker = true);
alter view public.v_estoque_zerado      set (security_invoker = true);
alter view public.v_formas_pagamento    set (security_invoker = true);
alter view public.v_lucro_periodo       set (security_invoker = true);
alter view public.v_mais_vendidos       set (security_invoker = true);
alter view public.v_vendas_dia          set (security_invoker = true);
alter view public.v_vendas_historico    set (security_invoker = true);
alter view public.v_vendas_lista        set (security_invoker = true);
