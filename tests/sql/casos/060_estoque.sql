-- 060_estoque.sql — casos de produto_salvar (Task 1 do plano 2).
--
-- produto_salvar e a UNICA porta de cadastro e edicao de produto e, de
-- proposito, nao tem parametro de estoque: quem move estoque e produto_entrada
-- e produto_ajuste (Task 2). Os casos 1 e 10 existem para provar que o estoque
-- nao se move por aqui.
--
-- O usuario logado e simulado com request.jwt.claims, que e de onde auth.uid()
-- le o usuario_id. Os casos rodam como o dono do banco, sem trocar de role
-- (mesmo ruling de 010_venda.sql).

do $$
declare
  v_dono        uuid;
  v_atendente   uuid;
  v_sem_perfil  uuid;
  v_desativado  uuid;
  v_produto     uuid;
  v_id          uuid;
  v_id2         uuid;
begin
  -- ================= cenario =================
  v_dono := criar_usuario_teste(gen_random_uuid(), 'produtos@farmacia.local');
  v_atendente := criar_usuario_teste(gen_random_uuid(), 'produtos-atendente@farmacia.local', 'atendente');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- ================= caso 1: cadastro =================
  v_produto := produto_salvar(null, '0012345', 'DIPIRONA 500mg', 'Analgésico', 'un', 250, 450, 5, true);
  perform teste_ok((select codigo_barras = '0012345' from produtos where id = v_produto),
    'caso 1: codigo de barras gravado com os zeros a esquerda');
  perform teste_ok((select estoque_atual = 0 from produtos where id = v_produto),
    'caso 1: produto nasce com estoque 0 (a funcao nao mexe no estoque)');
  perform teste_ok((select nome = 'DIPIRONA 500mg' and categoria = 'Analgésico' and unidade = 'un'
                      and preco_custo = 250 and preco_venda = 450 and estoque_minimo = 5 and ativo
                    from produtos where id = v_produto),
    'caso 1: nome, categoria, unidade, precos, estoque minimo e ativo gravados');
  perform teste_ok((select count(*) = 0 from estoque_movimentos where produto_id = v_produto),
    'caso 1: nenhum movimento de estoque foi gravado');

  -- ================= caso 2: codigo de barras vazio, duas vezes =================
  -- A coluna e unique e o Postgres aceita varios nulls: '' tem que virar null,
  -- senao o segundo cadastro brigaria com o indice. O TERCEIRO e o que prova de
  -- verdade: se o codigo vazio fosse gravado como '', o primeiro produto pegaria
  -- a string vazia e o terceiro estouraria o indice unico — sem este caso, gravar
  -- '' em vez de null passaria despercebido.
  v_id  := produto_salvar(null, '', 'PRODUTO SEM CODIGO A', null, 'un', 0, 100, 0, true);
  v_id2 := produto_salvar(null, '', 'PRODUTO SEM CODIGO B', null, 'un', 0, 100, 0, true);
  perform teste_ok((select codigo_barras is null from produtos where id = v_id),
    'caso 2: codigo de barras vazio vira null');
  perform teste_ok((select codigo_barras is null from produtos where id = v_id2),
    'caso 2: o segundo produto com codigo vazio tambem e criado');
  perform teste_ok((produto_salvar(null, '', 'PRODUTO SEM CODIGO B2', null, 'un', 0, 100, 0, true)) is not null,
    'caso 2: um terceiro produto com codigo vazio tambem e criado (prova que nao gravou string vazia)');

  -- ================= caso 3: '' e depois '   ' =================
  v_id  := produto_salvar(null, '', 'PRODUTO SEM CODIGO C', null, 'un', 0, 100, 0, true);
  v_id2 := produto_salvar(null, '   ', 'PRODUTO SEM CODIGO D', null, 'un', 0, 100, 0, true);
  perform teste_ok((select codigo_barras is null from produtos where id = v_id),
    'caso 3: o primeiro produto sem codigo tem codigo nulo');
  perform teste_ok((select codigo_barras is null from produtos where id = v_id2),
    'caso 3: codigo de barras so com espacos vira null e o produto e criado');

  -- ================= caso 4: edicao do produto do caso 1 =================
  -- now() e o relogio da TRANSACAO: sem envelhecer o produto, criado_em e
  -- atualizado_em nasceriam iguais e o `>` nao provaria nada.
  update produtos
     set criado_em = now() - interval '1 day',
         atualizado_em = now() - interval '1 day'
   where id = v_produto;

  v_id := produto_salvar(v_produto, '0012345', 'DIPIRONA 500mg NOVO', 'Analgésico', 'un', 250, 500, 5, true);
  perform teste_ok(v_id = v_produto,
    'caso 4: editar devolve o mesmo id');
  perform teste_ok((select nome = 'DIPIRONA 500mg NOVO' and preco_venda = 500
                    from produtos where id = v_produto),
    'caso 4: nome e preco de venda novos');
  perform teste_ok((select atualizado_em > criado_em from produtos where id = v_produto),
    'caso 4: atualizado_em ficou depois de criado_em');

  -- ================= caso 5: nome obrigatorio =================
  perform teste_erro(
    format('select produto_salvar(%L, %L, null, null, %L, 250, 450, 5, true)', v_produto, '0012345', 'un'),
    'Informe o nome do produto.',
    'caso 5a: nome nulo e recusado');
  perform teste_erro(
    format('select produto_salvar(%L, %L, %L, null, %L, 250, 450, 5, true)', v_produto, '0012345', '   ', 'un'),
    'Informe o nome do produto.',
    'caso 5b: nome so com espacos e recusado');
  perform teste_ok((select nome = 'DIPIRONA 500mg NOVO' from produtos where id = v_produto),
    'caso 5: o produto ficou intacto');

  -- ================= caso 6: numeros negativos =================
  perform teste_erro(
    format('select produto_salvar(%L, %L, %L, null, %L, 250, -1, 5, true)',
      v_produto, '0012345', 'DIPIRONA 500mg NOVO', 'un'),
    'O preço não pode ser negativo.',
    'caso 6a: preco de venda negativo e recusado');
  perform teste_erro(
    format('select produto_salvar(%L, %L, %L, null, %L, -1, 450, 5, true)',
      v_produto, '0012345', 'DIPIRONA 500mg NOVO', 'un'),
    'O preço não pode ser negativo.',
    'caso 6b: preco de custo negativo e recusado');
  perform teste_erro(
    format('select produto_salvar(%L, %L, %L, null, %L, 250, 450, -1, true)',
      v_produto, '0012345', 'DIPIRONA 500mg NOVO', 'un'),
    'O estoque mínimo não pode ser negativo.',
    'caso 6c: estoque minimo negativo e recusado');
  perform teste_ok((select preco_custo = 250 and preco_venda = 500 from produtos where id = v_produto),
    'caso 6: os precos do produto ficaram intactos');

  -- ================= caso 7: unidade padrao =================
  perform produto_salvar(v_produto, '0012345', 'DIPIRONA 500mg NOVO', 'Analgésico', null, 250, 500, 5, true);
  perform teste_ok((select unidade = 'un' from produtos where id = v_produto),
    'caso 7: unidade nula vira un');

  -- ================= caso 8: codigo de barras ja usado por outro produto =================
  v_id := produto_salvar(null, '0099999', 'PRODUTO DONO DO CODIGO', null, 'un', 0, 100, 0, true);
  perform teste_erro(
    format('select produto_salvar(null, %L, %L, null, %L, 0, 100, 0, true)', '0099999', 'PRODUTO INVASOR', 'un'),
    'Já existe um produto com o código de barras 0099999 (PRODUTO DONO DO CODIGO).',
    'caso 8a: cadastrar com o codigo de barras de outro produto e recusado');
  perform teste_erro(
    format('select produto_salvar(%L, %L, %L, null, %L, 0, 100, 0, true)',
      v_produto, '0099999', 'DIPIRONA 500mg NOVO', 'un'),
    'Já existe um produto com o código de barras 0099999 (PRODUTO DONO DO CODIGO).',
    'caso 8b: editar um produto para um codigo ja usado tambem e recusado');
  perform teste_ok((select count(*) = 0 from produtos where nome = 'PRODUTO INVASOR'),
    'caso 8: nada foi gravado');
  perform teste_ok((select codigo_barras = '0012345' from produtos where id = v_produto),
    'caso 8: o produto editado continua com o codigo que ja tinha');

  -- ================= caso 9: produto inexistente =================
  perform teste_erro(
    format('select produto_salvar(%L, null, %L, null, %L, 0, 100, 0, true)',
      gen_random_uuid(), 'PRODUTO FANTASMA', 'un'),
    'Produto não encontrado.',
    'caso 9: editar produto inexistente e recusado');
  perform teste_ok((select count(*) = 0 from produtos where nome = 'PRODUTO FANTASMA'),
    'caso 9: nada foi criado');

  -- ================= caso 10: a funcao nao tem como mexer no estoque =================
  v_id := criar_produto_completo('PRODUTO COM ESTOQUE', 1000, 500, '0077777', 7, 2);
  perform teste_ok((select estoque_atual = 7 from produtos where id = v_id),
    'caso 10: a fixture criou o produto com estoque 7');
  perform produto_salvar(v_id, '0077777', 'PRODUTO COM ESTOQUE EDITADO', null, 'un', 500, 1200, 3, true);
  perform teste_ok((select estoque_atual = 7 from produtos where id = v_id),
    'caso 10: editar um produto com estoque 7 mantem o estoque em 7');
  perform teste_ok((select nome = 'PRODUTO COM ESTOQUE EDITADO' and estoque_minimo = 3
                    from produtos where id = v_id),
    'caso 10: a edicao aconteceu de verdade (nome e estoque minimo novos)');

  -- ================= caso 11/12: o papel de quem chama =================
  -- As assercoes de NOME nao provam quem chamou: o nome vem do produto, e a
  -- funcao continuaria funcionando se ignorasse o usuario. O que prova e trocar
  -- as claims para o atendente e conferir auth.uid() junto das permissoes.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  perform teste_ok(auth.uid() = v_atendente,
    'caso 11: as claims foram trocadas para o atendente');
  v_id := produto_salvar(null, '0055555', 'PRODUTO DO ATENDENTE', null, 'un', 0, 300, 0, true);
  perform teste_ok((select nome = 'PRODUTO DO ATENDENTE' from produtos where id = v_id),
    'caso 11: atendente cadastra produto');
  perform produto_salvar(v_id, '0055555', 'PRODUTO DO ATENDENTE EDITADO', null, 'un', 0, 400, 0, true);
  perform teste_ok((select nome = 'PRODUTO DO ATENDENTE EDITADO' and preco_venda = 400
                    from produtos where id = v_id),
    'caso 11: atendente edita produto');

  -- O `from anon` do rodape da migration e obrigatorio: no Supabase o EXECUTE
  -- chega a anon por default privileges, e revogar so de PUBLIC nao tira nada.
  -- `has_function_privilege` responde sobre o PAPEL, nao sobre quem chama agora,
  -- entao estas duas continuam validas depois da troca de claims.
  perform teste_ok(not has_function_privilege('anon',
                     'produto_salvar(uuid,text,text,text,text,integer,integer,integer,boolean)', 'execute'),
    'caso 12: anon NAO pode executar produto_salvar');
  perform teste_ok(has_function_privilege('authenticated',
                     'produto_salvar(uuid,text,text,text,text,integer,integer,integer,boolean)', 'execute'),
    'caso 12: authenticated pode executar produto_salvar');

  -- ================= caso 13: sessao e perfil =================
  -- Extra ao brief: o bloco de verificacao de usuario e copiado de
  -- 004_caixa.sql e nao tinha nenhuma assercao na suite ate aqui.
  perform set_config('request.jwt.claims', '', true);
  perform teste_erro(
    format('select produto_salvar(null, null, %L, null, %L, 0, 100, 0, true)',
      'PRODUTO SEM SESSAO', 'un'),
    'Sessão expirada. Entre novamente.',
    'caso 13: sem sessao e recusado');

  v_sem_perfil := gen_random_uuid();
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_sem_perfil, 'role', 'authenticated')::text, true);
  perform teste_erro(
    format('select produto_salvar(null, null, %L, null, %L, 0, 100, 0, true)',
      'PRODUTO SEM PERFIL', 'un'),
    'Usuário sem perfil cadastrado. Fale com o responsável.',
    'caso 13: usuario sem perfil e recusado');

  v_desativado := criar_usuario_teste(gen_random_uuid(), 'produtos-desativado@farmacia.local');
  update perfis set ativo = false where id = v_desativado;
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_desativado, 'role', 'authenticated')::text, true);
  perform teste_erro(
    format('select produto_salvar(null, null, %L, null, %L, 0, 100, 0, true)',
      'PRODUTO DE USUARIO DESATIVADO', 'un'),
    'Usuário desativado. Fale com o responsável.',
    'caso 13: usuario desativado e recusado');
end $$;
