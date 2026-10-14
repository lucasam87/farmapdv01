-- 150_permissoes_custo.sql — casos do FECHAMENTO da leitura direta do custo
-- (migration 020_fechar_custo_venda.sql, Task 2 do plano do agente de margem).
--
-- O que este arquivo prova, e por que cada assercao e do tamanho que e:
--
--   * A PORTA LATERAL FECHOU: `authenticated` nao le mais `venda_itens.preco_custo`
--     direto (PostgREST), e `service_role` continua lendo — o servidor precisa.
--   * O RELATORIO DE LUCRO CONTINUA FUNCIONANDO, e esta e a razao do arquivo
--     existir. `relatorio_lucro` era `security invoker`: ela so enxergava
--     `venda_itens.preco_custo` porque QUEM CHAMA tambem enxergava. Revogar a
--     coluna sem recriar a funcao zeraria (ou estouraria) o lucro da tela em
--     producao, em silencio. Por isso as assercoes do lucro rodam com o role
--     TROCADO para `authenticated`: rodando como o dono do banco elas passariam
--     antes e depois, e nao provariam nada (o dono sempre le tudo).
--   * O ATENDENTE CONTINUA SEM VER O LUCRO pela funcao. Com `security definer` a
--     RLS deixa de valer dentro dela, entao a checagem de papel no corpo passa a
--     ser a UNICA barreira — se ela cair, o atendente ve o custo.
--   * `produtos.preco_custo` NAO FOI MEXIDO: a tela do produto
--     (`app/(app)/produtos/[id]/page.tsx:52`) e o formulario de edicao leem essa
--     coluna, e a correcao nao pode virar defeito.
--
-- MEDIDO ANTES (14/10/2026, contra o banco de PRODUCAO):
--   has_column_privilege('authenticated','venda_itens','preco_custo','select') = true
--   has_table_privilege('authenticated','v_lucro_periodo','select')           = true
--   `v_lucro_periodo` devolvia 2 linhas de lucro REAL para `authenticated`.
--
-- A JANELA DAS VENDAS SEMEADAS E NO FUTURO (padrao do 140_margem.sql): o banco e o
-- de PRODUCAO e a farmacia esta vendendo agora. Janela no passado mede as vendas
-- REAIS da farmacia; dias no futuro nao podem ter venda registrada, e o caso 0
-- PROVA que a janela esta vazia antes das vendas do cenario. O caso 6 usa a janela
-- do brief (`HOJE - 30` a `HOJE`) so para provar que a funcao de margem continua
-- EXECUTANDO depois do fechamento — o numero dela e o da farmacia, de proposito,
-- e o que se afirma ali e "nao estourou e veio linha", nunca um valor exato.
--
-- TRECHOS DE MENSAGEM SAO COMPARADOS SEM ACENTO (aviso do plano, medido no caso
-- 030 em 14/10/2026), MAS O TRECHO PRECISA EXISTIR NA MENSAGEM REAL. MEDIDO nesta
-- rodada, com `encode(convert_to(sqlerrm,'UTF8'),'hex')` (bytes, e nao texto, para o
-- transporte nao mentir):
--   * a mensagem viva no banco e `53c3b3206f20646f6e6f2076c3aa206f206c7563726f2e`
--     = "Só o dono vê o lucro." com acento CORRETO, e o literal de
--     `supabase/migrations/016_relatorios.sql:105` tem os MESMOS bytes — ou seja, o
--     texto NAO esta corrompido hoje e a recriacao da migration 020 nao o altera
--     (o "corrompido" que circulou nao se confirma contra o banco, ver o relatorio);
--   * `lower()` do Postgres NAO tira acento neste banco (`lower('Só o dono vê o lucro.')`
--     sai `só o dono vê o lucro.`): um trecho "sem acento" escrito por extenso
--     ('So o dono ve o lucro') NUNCA casa com a mensagem acentuada. Por isso o trecho
--     comparado aqui e `o dono v`, que fica FORA das vogais acentuadas e casa nos dois
--     estados — o mesmo trecho de 110_relatorios.sql:270 e 140_margem.sql.
--
-- Tudo roda na transacao do caso e morre no ROLLBACK.

do $$
declare
  -- HOJE em Sao Paulo: a MESMA expressao de dia de 005_views.sql, 016 e 019.
  hoje        date := (now() at time zone 'America/Sao_Paulo')::date;
  -- A janela das vendas SEMEADAS, no futuro (ver o cabecalho). 30 de intervalo e o
  -- teto de `margem_produtos`, entao a mesma janela serve para as duas funcoes.
  v_dia       date := hoje + 100;
  v_de        date := v_dia - 30;
  v_ate       date := v_dia;
  -- A janela do brief, no passado: usada SO no caso 6 (a margem continua executando).
  v_de_real   date := hoje - 30;
  v_dono      uuid;
  v_atendente uuid;
  v_caixa     uuid;
  v_produto   uuid;
  v_venda     uuid;
  v_papel     text;
begin
  -- ================= cenario =================
  -- Dono e atendente: o segundo existe para provar que o lucro continua sendo do dono.
  v_dono := criar_usuario_teste(gen_random_uuid(), 'custo@farmacia.local');
  v_atendente := criar_usuario_teste(gen_random_uuid(), 'custo-atendente@farmacia.local', 'atendente');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- Terminal PROPRIO (uuid): os casos irmaos usam 'balcao', e o indice unico parcial
  -- `caixa_um_aberto_por_terminal` faz a criacao estourar quando o CAIXA REAL DA
  -- FARMACIA esta aberto — que e o estado normal deste banco. Nada le este terminal.
  v_caixa := criar_caixa_aberto(v_dono, 'teste-custo-' || gen_random_uuid()::text);

  -- Custo conhecido: 100 a unidade, 2 unidades -> receita 2000, custo 200, lucro 1800.
  -- O produto nasce com o custo no CADASTRO e a venda passa pela RPC, que grava esse
  -- custo em `venda_itens.preco_custo` (002_registrar_venda.sql:180).
  v_produto := criar_produto('PRODUTO CUSTO FECHADO', 1000, 100);
  update produtos set preco_custo = 100 where id = v_produto;

  -- A venda e registrada com o role TROCADO para `authenticated`, de proposito: e
  -- este o caminho real do PDV depois do fechamento (o atendente/authenticated nao
  -- tem mais a coluna e mesmo assim vende — a RPC e `security definer`).
  execute 'set local role authenticated';
  v_venda := (registrar_venda(gen_random_uuid(), null,
    jsonb_build_array(jsonb_build_object('produto_id', v_produto, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 2000)),
    0)->>'id')::uuid;
  execute 'reset role';

  -- A venda nasce com `now()` e vai para o dia da janela FUTURA do caso.
  update vendas set criado_em = (v_dia + time '12:00')::timestamptz where id = v_venda;

  -- ================= caso 0: o cenario esta montado =================
  -- Sem estas duas, as assercoes de lucro poderiam passar por ausencia de dado.
  perform teste_ok((select count(*) = 1 from venda_itens
                     where produto_id = v_produto and preco_custo = 100 and quantidade = 2),
    'caso 0: a venda do cenario gravou o custo no item (2 un com preco_custo 100)');
  -- A CANARIA DA JANELA: se qualquer venda real da farmacia cair no periodo do
  -- cenario, todo valor exato abaixo vira medicao da farmacia. Esta assercao denuncia.
  perform teste_ok((select count(distinct i.produto_id) = 1
                      from venda_itens i
                      join vendas v on v.id = i.venda_id
                     where v.status = 'concluida'
                       and (v.criado_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate),
    'caso 0: a janela futura do caso tem SO o produto do cenario (nenhuma venda real caiu nela)');

  -- ================= caso 1 e 2: a porta lateral, pelo catalogo =================
  perform teste_ok(not has_column_privilege('authenticated', 'venda_itens', 'preco_custo', 'select'),
    'caso 1: authenticated NAO le preco_custo de venda_itens direto');
  perform teste_ok(has_column_privilege('service_role', 'venda_itens', 'preco_custo', 'select'),
    'caso 2: service_role continua lendo (o servidor precisa)');
  -- A GUARDA DO MECANISMO, e ela e a licao mais cara desta task: o Supabase concede
  -- SELECT em NIVEL DE TABELA a `authenticated` (DEFAULT PRIVILEGES) e privilegio de
  -- TABELA COBRE COLUNA — um `revoke select (preco_custo)` sozinho NAO fecha nada
  -- (MEDIDO: depois dele `has_column_privilege(...)` continuou `true`). O que fecha e
  -- tirar o SELECT de tabela e devolver o resto POR COLUNA. Se alguem reverter a 020
  -- para o revoke de coluna sozinho, a assercao abaixo fica vermelha — e a de cima
  -- tambem, porque o SELECT de tabela volta a cobrir `preco_custo`.
  perform teste_ok(not has_table_privilege('authenticated', 'venda_itens', 'select'),
    'caso 1: authenticated NAO tem mais SELECT de TABELA em venda_itens (o grant de tabela cobria a coluna)');
  -- O CONTRAPESO: o que a tela de venda le (`app/(app)/vendas/[id]/page.tsx:45` pede
  -- `id, nome_produto, quantidade, preco_unitario, total`) continua legivel, coluna por
  -- coluna, e a linha continua sendo lida de verdade com o role trocado.
  perform teste_ok(has_column_privilege('authenticated', 'venda_itens', 'id', 'select')
                   and has_column_privilege('authenticated', 'venda_itens', 'nome_produto', 'select')
                   and has_column_privilege('authenticated', 'venda_itens', 'quantidade', 'select')
                   and has_column_privilege('authenticated', 'venda_itens', 'preco_unitario', 'select')
                   and has_column_privilege('authenticated', 'venda_itens', 'total', 'select'),
    'caso 1: as colunas que a tela de venda le continuam legiveis (o fechamento nao fechou de mais)');
  execute 'set local role authenticated';
  perform teste_ok((select count(*) = 1 from venda_itens
                     where venda_id = v_venda and nome_produto = 'PRODUTO CUSTO FECHADO'),
    'caso 1: authenticated LE a linha do item (as colunas da tela) e nao a coluna de custo');
  execute 'reset role';

  -- ================= caso 3: o lucro do dono, com o role TROCADO =================
  -- Este e o caso que faz a Task 2 existir. Com o role em `authenticated` (o mesmo
  -- estado do PostgREST), `relatorio_lucro` so responde se ela for `security definer`.
  -- Como `security invoker` ela estoura `permission denied for table venda_itens` —
  -- foi o vermelho medido contra a definicao antiga (ver o relatorio da Task 2).
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform teste_ok((select receita = 2000 and custo = 200 and lucro = 1800
                      from relatorio_lucro(v_de, v_ate)),
    'caso 3: o DONO segue lendo o lucro pela funcao depois do fechamento (2000 - 200 = 1800)');
  execute 'reset role';

  -- ================= caso 4: o atendente continua sem ver o lucro =================
  -- A funcao e `security definer`, entao a RLS nao vale dentro dela e esta checagem
  -- de papel no corpo e a UNICA barreira. Se ela cair, o atendente ve o custo.
  -- O bloco e escrito A MAO (e nao com `teste_erro`) porque a chamada precisa rodar
  -- com o role trocado: `teste_erro` e `security definer` e o Postgres proibe `set
  -- role` dentro de funcao definer (mesma nota de 050_permissoes.sql e 140_margem.sql).
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform (select count(*) from relatorio_lucro(v_de, v_ate));
    perform teste_ok(false, 'caso 4: o atendente continua sem ver o lucro (nada foi recusado)');
  exception when others then
    -- TRECHO SEM ACENTO, como o plano manda — e o trecho escolhido e o que existe nos
    -- DOIS estados da mensagem, porque MEDIDO nesta rodada: `lower()` do Postgres NAO
    -- tira acento no collate `en_US.UTF-8` deste banco (`lower('Só o dono vê o lucro.')`
    -- sai `só o dono vê o lucro.`, bytes `73c3b3...76c3aa...`). Um trecho sem acento que
    -- caia FORA das vogais acentuadas casa nos dois estados; um trecho como
    -- 'So o dono ve o lucro' NUNCA casa com a mensagem acentuada, e ficaria vermelho
    -- por causa do acento e nao por causa do comportamento. `o dono v` e o mesmo trecho
    -- de 110_relatorios.sql:270 e 140_margem.sql.
    perform teste_ok(position(lower('o dono v') in lower(sqlerrm)) > 0,
      'caso 4: o atendente e recusado pela checagem de papel (veio: ' || sqlerrm || ')');
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- ================= caso 5: o custo do CADASTRO segue legivel =================
  -- A guarda contra o conserto virar defeito: a tela do produto le
  -- `produtos.preco_custo` e nao pode ser fechada junto.
  perform teste_ok(has_column_privilege('authenticated', 'produtos', 'preco_custo', 'select'),
    'caso 5: produtos.preco_custo continua legivel (a tela do produto depende)');

  -- ================= caso 6: a margem continua funcionando =================
  -- Rodado com o role REAL (`authenticated`), porque e ele que consulta a margem no
  -- app. A janela e a do brief (`HOJE - 30` a `HOJE`, no passado): ela mede as vendas
  -- REAIS da farmacia de proposito — o que se afirma aqui e que a funcao continua
  -- EXECUTANDO e devolvendo linha depois do fechamento, nunca um valor exato.
  execute 'set local role authenticated';
  perform teste_ok((select count(*) >= 1 from margem_produtos(v_de_real, hoje, 10)),
    'caso 6: a margem continua funcionando depois do fechamento (janela do brief, com os dados da farmacia)');
  execute 'reset role';

  -- ================= caso 7: a segunda porta do mesmo custo =================
  -- `v_lucro_periodo` e `security_invoker = true` (013) e calcula
  -- `sum(i.preco_custo * i.quantidade)`: depois do fechamento da COLUNA ela nao roda
  -- mais para `authenticated`. MEDIDO antes de 020: `authenticated` lia 2 linhas de
  -- lucro REAL por ela (o `v_lucro_periodo` do PROGRESSO.md:114). Por isso a 020
  -- fecha tambem o SELECT da view — e nao a torna `security_invoker = false`, que
  -- faria QUALQUER autenticado (inclusive atendente) ver o lucro: isso e o
  -- vazamento, nao o conserto. Nenhuma tela le esta view (varredura de `app/`,
  -- `lib/` e `components/`: unica mencao fora dos testes e a definicao/013).
  --
  -- A leitura como `authenticated` e feita com o role TROCADO: os casos de
  -- `040_views.sql:99` e `:113` leem a view com o role PADRAO do runner (o dono do
  -- banco, MEDIDO: `current_user = postgres` mesmo depois do `set_config` do JWT),
  -- e por isso continuam verdes — o dono nao perde o SELECT.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform (select count(*) from v_lucro_periodo);
    perform teste_ok(false, 'caso 7: authenticated continua lendo v_lucro_periodo (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0,
      'caso 7: authenticated NAO le o lucro pela view (a recusa e de permissao, veio: ' || sqlerrm || ')');
  end;
  execute 'reset role';

  -- O dono do banco continua lendo a view: e o que mantem os casos 040 verdes.
  perform teste_ok((select count(*) >= 0 from v_lucro_periodo),
    'caso 7: o dono do banco continua lendo a view (o SELECT foi revogado so de authenticated)');

  -- ================= permissoes: o par das duas linhas de sempre =================
  -- `from anon` e obrigatorio e nao decoracao: no Supabase o EXECUTE chega a `anon`
  -- por DEFAULT PRIVILEGES, direto no papel (achado de 002 e 016, provado por 050).
  perform teste_ok(not has_function_privilege('anon', 'relatorio_lucro(date,date)', 'execute'),
    'permissoes: anon NAO executa relatorio_lucro');
  perform teste_ok(has_function_privilege('authenticated', 'relatorio_lucro(date,date)', 'execute')
                   and has_function_privilege('service_role', 'relatorio_lucro(date,date)', 'execute'),
    'permissoes: authenticated e service_role executam relatorio_lucro');

  -- ================= seguranca: a funcao do lucro E definer =================
  -- A inversao (voltar a `security invoker`) tem de ficar vermelha aqui: e ela que
  -- quebraria o relatorio de lucro depois do fechamento.
  perform teste_ok((select prosecdef from pg_proc where oid = 'relatorio_lucro(date,date)'::regprocedure),
    'seguranca: relatorio_lucro E security definer (a leitura do custo passa por dentro dela)');
  -- `search_path` fixo e obrigatorio em definer (mesma regra de 002, 019 e das
  -- fixtures): sem ele, um schema no caminho do chamador poderia sequestrar a funcao.
  perform teste_ok((select array_to_string(proconfig, ',') like '%search_path=%'
                      from pg_proc where oid = 'relatorio_lucro(date,date)'::regprocedure),
    'seguranca: relatorio_lucro fixa search_path (obrigatorio em security definer)');

  -- ================= caso 4b: sem claims de JWT a funcao tambem recusa =================
  -- A checagem de papel e por `auth.uid()`: sem claims, `auth.uid()` e nulo, o papel
  -- nao e 'dono' e a funcao recusa. E a prova de que a barreira nao depende de a
  -- chamada vir da tela nem de a RLS estar valendo (ela NAO valeria: a funcao e definer).
  perform set_config('request.jwt.claims', null, true);
  begin
    perform (select count(*) from relatorio_lucro(v_de, v_ate));
    perform teste_ok(false, 'caso 4: sem claims de JWT a funcao do lucro recusa (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('o dono v') in lower(sqlerrm)) > 0,
      'caso 4: sem claims de JWT a funcao do lucro recusa (veio: ' || sqlerrm || ')');
  end;
end $$;
