-- 050_permissoes.sql — quem pode o que (spec 5 RPCs, 7.4 RLS).
--
-- Este e o unico arquivo que TROCA DE ROLE: roda como o dono do banco para criar
-- o cenario, depois como `authenticated` e como `anon`, para as policies de RLS
-- serem realmente avaliadas. Sem isso, apagar todas as policies manteria a suite
-- verde e ninguem perceberia.
--
-- Achado da revisao final: `revoke ... from public` NAO tira o EXECUTE de `anon`
-- no Supabase — o grant e direto para o papel, por default privileges. As
-- assercoes abaixo nasceram vermelhas por isso.
--
-- Achado da revisao final do branch da Etapa 5: as TABELAS estavam protegidas,
-- mas as VIEWS nao. View sem `security_invoker` roda com os privilegios do dono
-- (superusuario), entao a RLS nao e aplicada e o Supabase ja tinha dado SELECT a
-- `anon` por default privileges — a chave publica lia produto real pela view.
-- A migration 013 poe `security_invoker = true` nas 11 views. As quatro
-- assercoes de view abaixo nascem VERMELHAS sem ela: `anon` ve zero e
-- `authenticated` ve exatamente o que o dono ve.

do $$
declare
  v_dono    uuid;
  v_produto uuid;
  v_caixa   uuid;
  v_estoque_esperado   bigint;
  v_historico_esperado bigint;
begin
  -- ================= cenario (como dono do banco) =================
  v_dono := criar_usuario_teste(gen_random_uuid(), 'permissoes@farmacia.local');
  v_produto := criar_produto('PRODUTO PERMISSOES', 500, 10);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- O que o dono (superusuario, sem RLS) enxerga nas views: e contra este numero
  -- que a assercao de `authenticated` no fim compara. Fixar um numero magico
  -- ("4878") mediria o catalogo da farmacia, nao a correcao; a igualdade continua
  -- valendo com o banco vazio ou cheio.
  v_estoque_esperado   := (select count(*) from v_estoque_baixo);
  -- `v_vendas_historico` nao filtra status, entao equivale a contar a tabela.
  v_historico_esperado := (select count(*) from vendas);

  -- ================= quem executa as RPCs de escrita =================
  perform teste_ok(has_function_privilege('authenticated',
                     'registrar_venda(uuid,uuid,jsonb,jsonb,integer)', 'execute'),
    'authenticated pode executar registrar_venda');
  perform teste_ok(not has_function_privilege('anon',
                     'registrar_venda(uuid,uuid,jsonb,jsonb,integer)', 'execute'),
    'anon NAO pode executar registrar_venda');
  perform teste_ok(not has_function_privilege('anon', 'cancelar_venda(uuid,text)', 'execute'),
    'anon NAO pode executar cancelar_venda');
  perform teste_ok(not has_function_privilege('anon', 'abrir_caixa(integer)', 'execute'),
    'anon NAO pode executar abrir_caixa');
  perform teste_ok(not has_function_privilege('anon', 'caixa_movimento(text,integer,text)', 'execute'),
    'anon NAO pode executar caixa_movimento');
  perform teste_ok(not has_function_privilege('anon', 'fechar_caixa(integer,text)', 'execute'),
    'anon NAO pode executar fechar_caixa');

  -- ================= como authenticated =================
  execute 'set local role authenticated';

  perform teste_ok((select count(*) = 1 from perfis where id = v_dono),
    'authenticated enxerga o proprio perfil (policy perfis_leitura)');
  perform teste_ok((select count(*) = 1 from produtos where id = v_produto),
    'authenticated enxerga produto (policy logado_tudo)');

  -- a RPC roda como o dono da funcao (security definer), entao funciona mesmo
  -- tendo trocado o role de quem chama
  v_caixa := abrir_caixa(5000);
  perform teste_ok((select count(*) = 1 from caixa_sessoes where id = v_caixa),
    'authenticated abre caixa pela RPC (security definer + grant)');

  -- ================= como anon: a RLS tem que barrar =================
  execute 'set local role anon';

  perform teste_ok((select count(*) = 0 from perfis),
    'anon nao enxerga nenhum perfil (RLS)');
  perform teste_ok((select count(*) = 0 from produtos),
    'anon nao enxerga nenhum produto (RLS)');
  perform teste_ok((select count(*) = 0 from vendas),
    'anon nao enxerga nenhuma venda (RLS)');
  perform teste_ok((select count(*) = 0 from caixa_movimentos),
    'anon nao enxerga nenhum movimento de caixa (RLS)');

  -- As views sao a outra porta. `v_estoque_baixo` tem linhas no catalogo real
  -- (5689 produtos, muitos com estoque zerado) e `v_vendas_historico` e a view
  -- que ESTA etapa acrescentou: sem `security_invoker`, as duas entregam linha
  -- para `anon` e estas assercoes falham.
  perform teste_ok((select count(*) = 0 from v_estoque_baixo),
    'anon nao ve o estoque pela view');
  perform teste_ok((select count(*) = 0 from v_vendas_historico),
    'anon nao ve o historico de vendas pela view');

  -- e nao consegue nem chamar a RPC. O bloco e escrito a mao (e nao com
  -- teste_erro) porque o Postgres proibe `set role` dentro de funcao security
  -- definer — e teste_erro e definer. Aqui o role ja foi trocado acima, entao a
  -- chamada roda mesmo como anon.
  begin
    perform abrir_caixa(100);
    perform teste_ok(false, 'anon NAO consegue chamar uma RPC de escrita');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0,
      'anon NAO consegue chamar uma RPC de escrita (veio: ' || sqlerrm || ')');
  end;

  execute 'reset role';

  -- ================= de volta a authenticated =================
  -- A correcao nao pode ter fechado demais: com `security_invoker`, quem tem
  -- policy de leitura continua enxergando o MESMO conteudo de antes. Por isso a
  -- comparacao e com a contagem do dono, e nao com um numero fixo.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  perform teste_ok((select count(*) from v_estoque_baixo) = v_estoque_esperado,
    'authenticated continua vendo o estoque pela view (security_invoker)');
  perform teste_ok((select count(*) from v_vendas_historico) = v_historico_esperado,
    'authenticated continua vendo o historico de vendas pela view');

  execute 'reset role';
end $$;
