-- 070_importacao.sql — casos de importar_produtos (Task 3 do plano 2).
--
-- A regra central e "tudo ou nada": a funcao valida TODAS as linhas antes de
-- gravar qualquer uma. O caso 8 e o caso 13 da spec secao 12, e a assercao dele
-- confere as DUAS coisas: a excecao e a ausencia da linha valida no banco. Sem a
-- segunda, uma importacao que gravasse a linha 1 e so depois abortasse passaria.
--
-- O usuario logado e simulado com request.jwt.claims, de onde auth.uid() le. Os
-- casos rodam como o dono do banco, sem trocar de role.

do $$
declare
  v_dono      uuid;
  v_atendente uuid;
  v_resumo    jsonb;
  v_antes     integer;
begin
  -- ================= cenario =================
  v_dono := criar_usuario_teste(gen_random_uuid(), 'importacao@farmacia.local');
  v_atendente := criar_usuario_teste(gen_random_uuid(), 'importacao-atendente@farmacia.local', 'atendente');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- ================= caso 1: duas linhas novas =================
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0011111', 'nome', 'IMPORTADO A', 'preco_venda', 450),
    jsonb_build_object('codigo_barras', '0022222', 'nome', 'IMPORTADO B', 'preco_venda', 990)
  ), true);
  perform teste_ok((v_resumo->>'criados')::integer = 2,
    'caso 1: criados = 2');
  perform teste_ok((v_resumo->>'atualizados')::integer = 0 and (v_resumo->>'ignorados')::integer = 0,
    'caso 1: nada foi atualizado nem ignorado');
  perform teste_ok((select count(*) = 2 from produtos
                     where codigo_barras in ('0011111', '0022222')),
    'caso 1: os dois produtos existem com o codigo de barras certo');
  perform teste_ok((select preco_venda = 990 from produtos where codigo_barras = '0022222'),
    'caso 1: o preco de venda foi gravado');

  -- ================= caso 2: estoque inicial grava movimento =================
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0033333', 'nome', 'IMPORTADO COM ESTOQUE',
                       'preco_venda', 500, 'estoque_inicial', 10, 'estoque_minimo', 5)
  ), true);
  perform teste_ok((select estoque_atual = 10 from produtos where codigo_barras = '0033333'),
    'caso 2: o produto nasceu com estoque 10');
  perform teste_ok((select count(*) = 1 from estoque_movimentos m
                     join produtos p on p.id = m.produto_id
                    where p.codigo_barras = '0033333' and m.tipo = 'entrada'
                      and m.quantidade = 10 and m.saldo_apos = 10
                      and m.motivo = 'Estoque inicial'),
    'caso 2: um movimento entrada de 10 com motivo Estoque inicial');  perform teste_ok((select estoque_minimo = 5 from produtos where codigo_barras = '0033333'),
    'caso 2: o estoque minimo foi gravado');

  -- ================= caso 3: estoque inicial zero nao grava movimento =================
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0044444', 'nome', 'IMPORTADO ZERADO',
                       'preco_venda', 100, 'estoque_inicial', 0)
  ), true);
  perform teste_ok((v_resumo->>'criados')::integer = 1,
    'caso 3: o produto foi criado');
  perform teste_ok((select estoque_atual = 0 from produtos where codigo_barras = '0044444'),
    'caso 3: nasceu com estoque 0');
  perform teste_ok((select count(*) = 0 from estoque_movimentos m
                     join produtos p on p.id = m.produto_id
                    where p.codigo_barras = '0044444'),
    'caso 3: nenhum movimento foi gravado (a constraint proibe quantidade zero)');

  -- ================= caso 4: codigo existente com atualizar = true =================
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0033333', 'nome', 'IMPORTADO COM ESTOQUE NOVO',
                       'preco_venda', 700, 'estoque_minimo', 8)
  ), true);
  perform teste_ok((v_resumo->>'atualizados')::integer = 1,
    'caso 4: atualizados = 1');
  perform teste_ok((v_resumo->>'criados')::integer = 0,
    'caso 4: nenhum produto novo foi criado');
  perform teste_ok((select count(*) = 1 from produtos where codigo_barras = '0033333'),
    'caso 4: continua existindo UM produto com esse codigo');
  perform teste_ok((select nome = 'IMPORTADO COM ESTOQUE NOVO' and preco_venda = 700
                      and estoque_minimo = 8
                    from produtos where codigo_barras = '0033333'),
    'caso 4: nome, preco e estoque minimo foram atualizados');

  -- ================= caso 5: o mesmo com atualizar = false =================
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0033333', 'nome', 'NAO DEVE ENTRAR',
                       'preco_venda', 999)
  ), false);
  perform teste_ok((v_resumo->>'ignorados')::integer = 1,
    'caso 5: ignorados = 1');
  perform teste_ok((select preco_venda = 700 and nome = 'IMPORTADO COM ESTOQUE NOVO'
                    from produtos where codigo_barras = '0033333'),
    'caso 5: com atualizar = false o produto NAO foi tocado');

  -- ================= caso 6: reimportar com estoque inicial menor =================
  -- O produto esta com 10; informar 4 tem que gravar um movimento de -6.
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0033333', 'nome', 'IMPORTADO COM ESTOQUE NOVO',
                       'preco_venda', 700, 'estoque_inicial', 4)
  ), true);
  perform teste_ok((select estoque_atual = 4 from produtos where codigo_barras = '0033333'),
    'caso 6: o estoque foi para 4');
  perform teste_ok((select count(*) = 1 from estoque_movimentos m
                     join produtos p on p.id = m.produto_id
                    where p.codigo_barras = '0033333' and m.tipo = 'entrada'
                      and m.quantidade = -6 and m.saldo_apos = 4
                      and m.motivo = 'Estoque inicial'),
    'caso 6: o movimento gravou o delta (-6) e o saldo_apos 4');

  -- ================= caso 7: reimportar SEM a chave estoque_inicial =================
  -- A ausencia da chave e diferente de valor zero: sem ela o estoque nao muda.
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0033333', 'nome', 'IMPORTADO COM ESTOQUE NOVO',
                       'preco_venda', 800)
  ), true);
  perform teste_ok((select estoque_atual = 4 from produtos where codigo_barras = '0033333'),
    'caso 7: o estoque continua 4 quando a chave estoque_inicial nao vem');
  perform teste_ok((select preco_venda = 800 from produtos where codigo_barras = '0033333'),
    'caso 7: mas o preco foi atualizado');
  perform teste_ok((select count(*) = 2 from estoque_movimentos m
                     join produtos p on p.id = m.produto_id
                    where p.codigo_barras = '0033333'),
    'caso 7: nenhum movimento novo foi gravado');

  -- ================= caso 8: uma linha valida e uma invalida -> NADA gravado =================
  -- Caso 13 da spec secao 12. As duas assercoes sao necessarias.
  v_antes := (select count(*) from produtos);
  perform teste_erro(
    $sql$select importar_produtos(jsonb_build_array(
      jsonb_build_object('codigo_barras', '0099999', 'nome', 'NAO PODE ENTRAR', 'preco_venda', 100),
      jsonb_build_object('codigo_barras', '0088888', 'nome', '', 'preco_venda', 100)
    ), true)$sql$,
    'Linha 2: informe o nome do produto.',
    'caso 8: a importacao com uma linha invalida e recusada nomeando a linha 2');
  perform teste_ok((select count(*) = 0 from produtos where codigo_barras = '0099999'),
    'caso 8: a linha 1 (valida) NAO foi gravada — tudo ou nada');
  perform teste_ok((select count(*) = v_antes from produtos),
    'caso 8: a contagem de produtos nao mudou');

  -- ================= caso 9: preco negativo =================
  perform teste_erro(
    $sql$select importar_produtos(jsonb_build_array(
      jsonb_build_object('codigo_barras', '0077777', 'nome', 'PRECO NEGATIVO', 'preco_venda', -1)
    ), true)$sql$,
    'Linha 1',
    'caso 9: preco de venda negativo e recusado nomeando a linha');

  -- ================= caso 10: estoque inicial negativo =================
  perform teste_erro(
    $sql$select importar_produtos(jsonb_build_array(
      jsonb_build_object('codigo_barras', '0066666', 'nome', 'ESTOQUE NEGATIVO',
                         'preco_venda', 100, 'estoque_inicial', -5)
    ), true)$sql$,
    'Linha 1',
    'caso 10: estoque inicial negativo e recusado nomeando a linha');

  -- ================= caso 11: o mesmo codigo de barras duas vezes =================
  perform teste_erro(
    $sql$select importar_produtos(jsonb_build_array(
      jsonb_build_object('codigo_barras', '0055555', 'nome', 'REPETIDO A', 'preco_venda', 100),
      jsonb_build_object('codigo_barras', '0055555', 'nome', 'REPETIDO B', 'preco_venda', 200)
    ), true)$sql$,
    '0055555',
    'caso 11: o codigo de barras repetido na planilha e recusado');
  perform teste_ok((select count(*) = 0 from produtos where codigo_barras = '0055555'),
    'caso 11: nada foi gravado');

  -- ================= caso 12: lista vazia =================
  perform teste_erro(
    $sql$select importar_produtos('[]'::jsonb, true)$sql$,
    'Nenhuma linha para importar.',
    'caso 12: lista vazia e recusada');

  -- ================= caso 13: lista nula =================
  perform teste_erro(
    $sql$select importar_produtos(null, true)$sql$,
    'Nenhuma linha para importar.',
    'caso 13: lista nula e recusada');

  -- ================= caso 14: permissoes =================
  perform teste_ok(not has_function_privilege('anon',
                     'importar_produtos(jsonb,boolean)', 'execute'),
    'caso 14: anon NAO pode executar importar_produtos');
  perform teste_ok(has_function_privilege('authenticated',
                     'importar_produtos(jsonb,boolean)', 'execute'),
    'caso 14: authenticated pode executar importar_produtos');

  -- Os casos 16 a 18 rodam AQUI, antes do caso 15, de proposito: o caso 15 troca
  -- o usuario logado para o atendente e a partir dali so importa o dono.

  -- ================= caso 16: reimportar SEM as chaves de preco =================
  -- "Chave ausente != valor zero" vale para PRECO tambem, e nao so para estoque.
  -- Antes da migration 009 os precos viajavam sempre (0 quando a coluna nao
  -- existia) e o UPDATE gravava zero por cima: reimportar uma planilha so com
  -- nome e codigo de barras ZERAVA o preco de venda do catalogo inteiro.
  -- Estado antes: preco_venda 800 e estoque_minimo 8 (casos 4 e 7).
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0033333', 'nome', 'IMPORTADO COM ESTOQUE NOVO')
  ), true);
  perform teste_ok((v_resumo->>'atualizados')::integer = 1,
    'caso 16: a linha sem preco atualizou o produto');
  perform teste_ok((select preco_venda = 800 from produtos where codigo_barras = '0033333'),
    'caso 16: o preco de venda NAO foi zerado pela linha sem preco');
  perform teste_ok((select estoque_minimo = 8 from produtos where codigo_barras = '0033333'),
    'caso 16: o estoque minimo NAO foi zerado pela linha sem a chave');
  perform teste_ok((select nome = 'IMPORTADO COM ESTOQUE NOVO' from produtos where codigo_barras = '0033333'),
    'caso 16: mas o nome veio e foi atualizado');

  -- ================= caso 17: preco 0 EXPLICITO zera =================
  -- A outra metade da regra: ausente nao mexe, presente com zero zera de verdade.
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0033333', 'nome', 'IMPORTADO COM ESTOQUE NOVO',
                       'preco_venda', 0)
  ), true);
  perform teste_ok((select preco_venda = 0 from produtos where codigo_barras = '0033333'),
    'caso 17: preco de venda 0 explicito ZERA — ausente e diferente de zero');

  -- ================= caso 18: produto NOVO sem preco entra com zero =================
  -- As colunas de preco sao `not null`: para produto novo o zero e obrigatorio, e
  -- a tela avisa que ele entrou sem preco.
  v_resumo := importar_produtos(jsonb_build_array(
    jsonb_build_object('codigo_barras', '0012121', 'nome', 'SEM PRECO NENHUM')
  ), true);
  perform teste_ok((v_resumo->>'criados')::integer = 1,
    'caso 18: o produto sem preco foi criado');
  perform teste_ok((select preco_venda = 0 and preco_custo = 0 and estoque_minimo = 0
                    from produtos where codigo_barras = '0012121'),
    'caso 18: produto novo sem preco nasce com zero, nao com null');

  -- ================= caso 15: so o dono importa (spec 5) =================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  perform teste_erro(
    $sql$select importar_produtos(jsonb_build_array(
      jsonb_build_object('codigo_barras', '0010101', 'nome', 'DO ATENDENTE', 'preco_venda', 100)
    ), true)$sql$,
    'Só o dono pode importar produtos.',
    'caso 15: atendente nao pode importar');
  perform teste_ok((select count(*) = 0 from produtos where codigo_barras = '0010101'),
    'caso 15: nada foi gravado pelo atendente');
end $$;
