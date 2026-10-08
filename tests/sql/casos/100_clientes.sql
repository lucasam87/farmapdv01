-- 100_clientes.sql — casos de cliente_salvar e importar_clientes (Task 2 da
-- etapa 6: clientes e crediario).
--
-- O que este arquivo prova, e por que cada assercao e do tamanho que e:
--
--   * O LIMITE E DO DONO. O atendente cadastra, mas nasce sem crediario; e
--     recusado quando tenta liberar limite, bloquear ou lancar saldo devedor. A
--     assercao de recusa confere a MENSAGEM INTEIRA da RPC, e nao um pedaco dela:
--     o `check` do banco produz "clientes_limite_credito_check" /
--     "clientes_bloqueado", que contem as palavras "limite"/"bloqueado" e
--     mascararia a queda da guarda (achado Important da Task 1).
--   * A GUARDA CONTRA DOBRAR A DIVIDA tem DOIS caminhos de entrada e os dois sao
--     provados: a importacao (caso 6, que ignora o segundo saldo e conta em
--     `saldos_ignorados`) e o cadastro/edicao pela tela (caso 5b, que RECUSA com
--     'Este cliente já tem um saldo inicial lançado.').
--   * CAMPO AUSENTE NAO APAGA DADO: linha sem `limite_credito`/`telefone` nao
--     zera o que o cliente tinha (caso 6c), `p_cpf` nulo na edicao nao apaga o
--     CPF (caso 4c), e saldo ausente na edicao nao lanca nada (caso 5c).
--   * TUDO OU NADA (caso 8): uma linha sem CPF derruba o arquivo inteiro,
--     inclusive a linha 1, que era valida.
--
-- Toda leitura e escopada por cliente_id/cpf proprios: o banco e o de PRODUCAO
-- e contar a tabela inteira mediria a farmacia, nao a funcao. Por isso o caso 9
-- compara a contagem de lancamentos marcados ANTES e DEPOIS da tentativa do
-- atendente, em vez de um `count(*) = 0` global.

do $$
declare
  v_dono      uuid;
  v_atendente uuid;
  v_atend2    uuid;
  v_vazio     uuid := gen_random_uuid();
  v_novo      uuid;
  v_c1        uuid;
  v_c2        uuid;
  v_c3        uuid;
  v_c3b       uuid;
  v_antes     integer;
  v_resumo    jsonb;
  v_linhas    jsonb;
begin
  -- ================= cenario =================
  v_dono := criar_usuario_teste(gen_random_uuid(), 'clientes@farmacia.local');
  v_atendente := criar_usuario_teste(gen_random_uuid(), 'clientes-atendente@farmacia.local', 'atendente');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- As fixtures entram por insert direto: quem testa a RPC nao monta o cenario
  -- com ela. v_c1 e v_c2 existem ANTES da importacao, que e o caso interessante
  -- (cliente que ja foi cadastrado no balcao e depois entra na planilha).
  v_c1 := criar_cliente('JOSE DA DIVIDA ANTIGA', 0, false);
  update clientes set cpf = '11111111111' where id = v_c1;
  v_c2 := criar_cliente('MARIA JA CADASTRADA', 0, false);
  update clientes set cpf = '22222222222' where id = v_c2;

  -- ================= caso 1: cadastro pelo atendente nasce com limite 0 =================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  v_novo := cliente_salvar(null, 'ATENDIDO PELO ATENDENTE', '11999998888', null,
                           0, false, null, 0);
  perform teste_ok((select limite_credito = 0 and not bloqueado and nome = 'ATENDIDO PELO ATENDENTE'
                      from clientes where id = v_novo),
    'caso 1: cliente cadastrado por atendente nasce sem crediario');

  -- ================= caso 2: atendente que tenta limite > 0 e recusado =================
  perform teste_erro(
    $sql$select cliente_salvar(null, 'LIMITE DE GRACA', null, null, 5000, false, null, 0)$sql$,
    'Só o dono pode mudar o limite de crédito.',
    'caso 2: atendente nao libera limite e a recusa e a mensagem da RPC, nao o check do banco');
  perform teste_ok((select count(*) = 0 from clientes where nome = 'LIMITE DE GRACA'),
    'caso 2: a recusa nao criou o cliente');

  -- O bloqueio tem mensagem propria, pelo mesmo motivo do caso 2.
  perform teste_erro(
    format($sql$select cliente_salvar(%L, 'JOSE DA DIVIDA ANTIGA', null, null, 0, true, null, 0)$sql$, v_c1),
    'Só o dono pode bloquear um cliente.',
    'caso 2: atendente nao bloqueia cliente e a mensagem e a da RPC');

  -- ================= caso 2b: saldo devedor e do dono (spec 5) =================
  -- Esta guarda nunca era exercitada: so o dono conseguia passar saldo e os casos
  -- anteriores recusavam antes, no limite. O atendente manda limite 0 (igual ao
  -- gravado) e saldo POSITIVO, para a recusa que aparece ser a do saldo.
  perform teste_erro(
    format($sql$select cliente_salvar(%L, 'ATENDIDO PELO ATENDENTE', '11999998888', null, 0, false, null, 5000)$sql$, v_novo),
    'Só o dono pode lançar saldo devedor.',
    'caso 2b: atendente nao lanca saldo devedor e a mensagem e a da RPC, nao a do check');
  perform teste_ok((select count(*) = 0 from crediario_lancamentos
                     where cliente_id = v_novo and tipo = 'compra' and venda_id is null),
    'caso 2b: a recusa do saldo nao gravou lancamento nenhum');

  -- ================= caso 3: o dono muda o limite =================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  perform teste_ok(cliente_salvar(v_novo, 'ATENDIDO PELO ATENDENTE', '11999998888', null,
                                  5000, false, null, 0) = v_novo,
    'caso 3: o dono edita o cliente e a RPC devolve o mesmo id');
  perform teste_ok((select limite_credito = 5000 from clientes where id = v_novo),
    'caso 3: o dono liberou R$ 50,00 de credito');

  -- O dono passando o saldo numa EDICAO e aceito enquanto o cliente nao tem
  -- lancamento de saldo (o par positivo do caso 2b, e a PRIMEIRA chamada do par
  -- que o caso 5b fecha).
  perform cliente_salvar(v_novo, 'ATENDIDO PELO ATENDENTE', '11999998888', null,
                         5000, false, null, 1000);
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                     where cliente_id = v_novo and tipo = 'compra' and venda_id is null
                       and valor = 1000
                       and observacao = 'Saldo importado do sistema antigo')
                     and (select saldo = 1000 from v_clientes_devedores where cliente_id = v_novo),
    'caso 3: o dono lanca o saldo inicial na edicao e ele vira UM lancamento marcado');

  -- ================= caso 5b: a edicao NAO relanca o saldo inicial =================
  -- A guarda tem de valer para o SEGUNDO caminho: cadastrar/editar pela tela. Sem
  -- ela, repetir a edicao com o mesmo saldo dobrava a divida.
  perform teste_erro(
    format($sql$select cliente_salvar(%L, 'ATENDIDO PELO ATENDENTE', '11999998888', null, 5000, false, null, 1000)$sql$, v_novo),
    'Este cliente já tem um saldo inicial lançado.',
    'caso 5b: editar de novo com saldo inicial e recusado, e nao ignorado em silencio');
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                     where cliente_id = v_novo and tipo = 'compra' and venda_id is null),
    'caso 5b: a recusa deixou UM lancamento, nunca dois');
  -- Saldo ausente na edicao nao lanca nada nem recusa.
  perform cliente_salvar(v_novo, 'ATENDIDO PELO ATENDENTE', '11999998888', null,
                         5000, false, 'sem saldo', null);
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                     where cliente_id = v_novo and tipo = 'compra' and venda_id is null),
    'caso 5c: editar com saldo ausente nao lanca nem recusa');
  -- Saldo negativo e recusado com mensagem propria (antes era ignorado em silencio).
  perform teste_erro(
    format($sql$select cliente_salvar(%L, 'ATENDIDO PELO ATENDENTE', '11999998888', null, 5000, false, null, -100)$sql$, v_novo),
    'O saldo inicial não pode ser negativo.',
    'caso 5c: saldo inicial negativo e recusado com a mensagem da RPC');

  -- ================= caso 4: CPF repetido e recusado =================
  -- v_c1 ja tem o CPF 11111111111 (colocado pelo cenario, sem passar pela RPC),
  -- entao a guarda da RPC e a unica coisa que pode recusar aqui.
  perform teste_erro(
    $sql$select cliente_salvar(null, 'CPF REPETIDO', null, '11111111111', 0, false, null, 0)$sql$,
    'Já existe um cliente com este CPF.',
    'caso 4: CPF repetido e recusado com a mensagem da RPC');
  perform teste_ok((select count(*) = 0 from clientes where nome = 'CPF REPETIDO'),
    'caso 4: o cliente com CPF repetido nao foi criado');

  -- ================= caso 4b: as recusas de nome, limite e id inexistente =================
  perform teste_erro(
    $sql$select cliente_salvar(null, '   ', null, null, 0, false, null, 0)$sql$,
    'Escreva o nome do cliente.',
    'caso 4b: nome vazio e recusado');
  perform teste_erro(
    $sql$select cliente_salvar(null, 'LIMITE NEGATIVO', null, null, -1, false, null, 0)$sql$,
    'O limite de crédito não pode ser negativo.',
    'caso 4b: limite negativo e recusado com a mensagem da RPC');
  perform teste_erro(
    format($sql$select cliente_salvar(%L, 'CLIENTE QUE NAO EXISTE', null, null, 0, false, null, 0)$sql$, v_vazio),
    'Cliente não encontrado.',
    'caso 4b: editar id inexistente e recusado');

  -- ================= caso 4c: edicao sem CPF NAO apaga o CPF =================
  -- CPF nulo na edicao herda o gravado: e a chave de casamento da importacao, e
  -- apaga-lo faria o cliente ser criado de novo e o saldo lancado duas vezes.
  perform cliente_salvar(v_c2, 'MARIA JA CADASTRADA', null, null, 0, false, null, 0);
  perform teste_ok((select cpf = '22222222222' from clientes where id = v_c2),
    'caso 4c: editar sem CPF mantem o CPF gravado (campo ausente nao apaga)');

  -- ================= caso 5: saldo inicial do dono vira lancamento marcado =================
  v_c3 := cliente_salvar(null, 'JOSE DO SISTEMA ANTIGO', null, '33333333333',
                         20000, false, 'veio do sistema antigo', 12050);
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                     where cliente_id = v_c3 and tipo = 'compra' and venda_id is null
                       and valor = 12050
                       and observacao = 'Saldo importado do sistema antigo'),
    'caso 5: saldo inicial do dono grava UM lancamento marcado como importado');
  -- A marca e literal e unica: a tela da Task 4/Task 6 mostra o mesmo texto, e
  -- uma variacao aqui faria a guarda do caso 6 parar de reconhecer o saldo.
  perform teste_ok((select saldo = 12050 from v_clientes_devedores where cliente_id = v_c3),
    'caso 5: o saldo inicial aparece no saldo devedor do cliente');

  -- ================= caso 6: A GUARDA. Reimportar nao dobra a divida. =================
  -- As linhas cobrem os dois caminhos: CPF ja existente (atualiza + guarda) e
  -- CPF novo (cria + lanca). Todo o resto do arquivo e escopado por esses CPFs.
  v_linhas := jsonb_build_array(
    jsonb_build_object('nome', 'MARIA JA CADASTRADA', 'telefone', '11888887777',
                       'cpf', '22222222222', 'limite_credito', 3000, 'saldo', 7000),
    jsonb_build_object('nome', 'JOSE DO SISTEMA ANTIGO', 'cpf', '33333333333', 'saldo', 12050),
    jsonb_build_object('nome', 'IMPORTADO NOVO', 'cpf', '44444444444', 'limite_credito', 1000, 'saldo', 2500)
  );

  -- A 1a importacao: os DOIS clientes que ja existiam (CPF 22222222222 e o que o
  -- caso 5 acabou de cadastrar, 33333333333) sao atualizados, e o CPF
  -- 44444444444 nasce. Sao DOIS saldos lancados: o do cliente novo e o do
  -- 22222222222, que estava cadastrado no balcao e ainda nao devia nada — o
  -- saldo de 33333333333 e ignorado, porque o caso 5 ja o lancou.
  v_resumo := importar_clientes(v_linhas, true);
  perform teste_ok((v_resumo->>'criados')::int = 1 and (v_resumo->>'atualizados')::int = 2
                     and (v_resumo->>'ignorados')::int = 0,
    'caso 6: a importacao casa por CPF e conta criados/atualizados');
  perform teste_ok((v_resumo->>'saldos_lancados')::int = 2 and (v_resumo->>'saldos_ignorados')::int = 1,
    'caso 6: os saldos novos sao lancados e o que ja existia e ignorado');
  perform teste_ok((select limite_credito = 3000 and telefone = '11888887777'
                      from clientes where cpf = '22222222222'),
    'caso 6: o cliente existente foi atualizado com o limite e o telefone da planilha');
  v_c3b := (select id from clientes where cpf = '44444444444');

  -- A 2a importacao do MESMO arquivo: aqui a guarda tem de aparecer. Agora os
  -- TRES CPFs existem (o 44444444444 nasceu na 1a), entao sao 3 atualizados; e a
  -- guarda segura os TRES saldos — nenhum vira segundo lancamento. O `for update`
  -- na leitura do cliente e o que faz a guarda valer tambem com dois imports
  -- simultaneos: o lock serializa, e a segunda transacao (snapshot novo, depois
  -- do commit da primeira) enxerga o lancamento gravado.
  v_resumo := importar_clientes(v_linhas, true);
  perform teste_ok((v_resumo->>'criados')::int = 0 and (v_resumo->>'atualizados')::int = 3,
    'caso 6: reimportar nao cria ninguem de novo');
  perform teste_ok((v_resumo->>'saldos_lancados')::int = 0 and (v_resumo->>'saldos_ignorados')::int = 3,
    'caso 6: a segunda importacao conta todos os saldos como ignorados em vez de relancar');
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                     where cliente_id = v_c3b and tipo = 'compra' and venda_id is null
                       and observacao = 'Saldo importado do sistema antigo'),
    'caso 6: o cliente novo da planilha tem UM lancamento de saldo marcado');
  perform teste_ok((select saldo = 2500 from v_clientes_devedores where cliente_id = v_c3b),
    'caso 6: a divida do cliente importado e 2500, nao 5000');

  -- ================= caso 6c: campo ausente nao apaga limite nem telefone =================
  -- A linha aqui nao manda `limite_credito` nem `telefone`. Sem a regra do campo
  -- ausente, isto gravava `limite_credito = 0` e `telefone = null` por cima do
  -- limite de R$ 200,00 e do telefone do cliente: o dono perderia o credito
  -- liberado so por subir a planilha de novo.
  perform cliente_salvar(v_c2, 'MARIA JA CADASTRADA', '11777776666', '22222222222',
                         20000, false, null, 0);
  v_resumo := importar_clientes(jsonb_build_array(
    jsonb_build_object('nome', 'MARIA JA CADASTRADA', 'cpf', '22222222222', 'saldo', 7000)
  ), true);
  perform teste_ok((v_resumo->>'saldos_ignorados')::int = 1,
    'caso 6c: o saldo do cliente que ja tem a marca continua ignorado');
  perform teste_ok((select limite_credito = 20000 and telefone = '11777776666'
                      from clientes where cpf = '22222222222'),
    'caso 6c: a linha sem limite e sem telefone NAO apagou o que o cliente tinha');
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                     where cliente_id = v_c2 and tipo = 'compra' and venda_id is null
                       and valor = 7000),
    'caso 6c: continua UM lancamento de saldo para o cliente');

  -- ================= caso 6b: existente SEM a flag =================
  -- O saldo continua sendo avaliado (o cliente pode estar sem lancamento): a
  -- importacao existe para trazer os saldos, e suprimi-los por uma flag cadastral
  -- sumiria com o entregavel principal. O que a flag desliga e a ATUALIZACAO dos
  -- dados cadastrais.
  v_resumo := importar_clientes(v_linhas, false);
  perform teste_ok((v_resumo->>'ignorados')::int = 3 and (v_resumo->>'atualizados')::int = 0,
    'caso 6b: sem atualizar_existentes o cliente existente conta como ignorado');
  -- O limite gravado neste ponto e 20000 (o caso 6c mudou de proposito): se a
  -- importacao com a flag falsa tocasse o cliente, ele voltaria para 3000.
  perform teste_ok((select limite_credito = 20000 from clientes where cpf = '22222222222'),
    'caso 6b: com a flag falsa o cliente existente NAO foi tocado');

  -- ================= caso 7: saldo da tela + importacao = UM lancamento so =================
  -- v_c1 foi cadastrado pelo balcao e recebeu o saldo pela tela (so dono). A
  -- planilha chega depois com o mesmo saldo: a guarda tem de reconhecer a marca
  -- e nao relancar nem aqui.
  perform cliente_salvar(v_c1, 'JOSE DA DIVIDA ANTIGA', null, '11111111111', 0, false, null, 4000);
  v_resumo := importar_clientes(jsonb_build_array(
    jsonb_build_object('nome', 'JOSE DA DIVIDA ANTIGA', 'cpf', '11111111111', 'saldo', 4000)
  ), true);
  perform teste_ok((v_resumo->>'saldos_lancados')::int = 0 and (v_resumo->>'saldos_ignorados')::int = 1,
    'caso 7: a importacao reconhece o saldo lancado pela tela e o ignora');
  perform teste_ok((select count(*) = 1 from crediario_lancamentos
                     where cliente_id = v_c1 and tipo = 'compra' and venda_id is null
                       and observacao = 'Saldo importado do sistema antigo'),
    'caso 7: saldo da tela + reimportacao deixam UM lancamento marcado, nunca dois');
  perform teste_ok((select saldo = 4000 from v_clientes_devedores where cliente_id = v_c1),
    'caso 7: a divida do cliente continua 4000');

  -- ================= caso 8: linha sem CPF derruba o arquivo inteiro =================
  -- A linha 1 e valida e a 2 nao: nada do arquivo pode ter sido gravado. O CPF
  -- 55555555555 nao existe antes nem depois, e nenhum lancamento marcado aponta
  -- para ele.
  perform teste_erro(
    $sql$select importar_clientes(jsonb_build_array(
      jsonb_build_object('nome', 'ENTRARIA', 'cpf', '55555555555', 'saldo', 11000),
      jsonb_build_object('nome', 'SEM CPF', 'saldo', 500)
    ), true)$sql$,
    'Linha 2: informe o CPF do cliente.',
    'caso 8: linha sem CPF e recusada nomeando a linha 2');
  perform teste_ok((select count(*) = 0 from clientes where cpf = '55555555555'),
    'caso 8: a linha 1 (valida) NAO foi gravada — tudo ou nada');
  perform teste_ok((select count(*) = 0 from crediario_lancamentos l
                     join clientes c on c.id = l.cliente_id
                    where c.cpf = '55555555555'
                      and l.observacao = 'Saldo importado do sistema antigo'),
    'caso 8: nenhum lancamento marcado aponta para o cliente da linha 1');

  -- nome vazio e CPF repetido DENTRO do arquivo seguem a mesma regra.
  perform teste_erro(
    $sql$select importar_clientes(jsonb_build_array(
      jsonb_build_object('nome', '', 'cpf', '66666666666')
    ), true)$sql$,
    'Linha 1: informe o nome do cliente.',
    'caso 8: linha sem nome e recusada nomeando a linha');
  perform teste_erro(
    $sql$select importar_clientes(jsonb_build_array(
      jsonb_build_object('nome', 'REPETIDO A', 'cpf', '66666666666'),
      jsonb_build_object('nome', 'REPETIDO B', 'cpf', '66666666666')
    ), true)$sql$,
    'O CPF 66666666666 aparece mais de uma vez na planilha.',
    'caso 8: o CPF repetido dentro da planilha e recusado com a mensagem inteira');
  perform teste_ok((select count(*) = 0 from clientes where cpf = '66666666666'),
    'caso 8: nada foi gravado com o CPF repetido');
  perform teste_erro(
    $sql$select importar_clientes(jsonb_build_array(
      jsonb_build_object('nome', 'SALDO NEGATIVO', 'cpf', '77777777777', 'saldo', -100)
    ), true)$sql$,
    'Linha 1: o campo saldo não pode ser negativo.',
    'caso 8: saldo negativo e recusado nomeando a linha e o campo');
  perform teste_erro(
    $sql$select importar_clientes('[]'::jsonb, true)$sql$,
    'Nenhuma linha para importar.',
    'caso 8: lista vazia e recusada');

  -- ================= caso 9: atendente NAO importa (spec 5: e do dono) =================
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  -- A contagem e lida ANTES e DEPOIS: um `count(*) = 0` global mediria a farmacia.
  v_antes := (select count(*) from crediario_lancamentos
               where observacao = 'Saldo importado do sistema antigo');
  perform teste_erro(
    $sql$select importar_clientes(jsonb_build_array(
      jsonb_build_object('nome', 'CLIENTE DO ATENDENTE', 'cpf', '88888888888', 'saldo', 1000)
    ), true)$sql$,
    'Só o dono pode importar clientes.',
    'caso 9: atendente nao importa e a recusa e a mensagem da RPC');
  perform teste_ok((select count(*) = 0 from clientes where cpf = '88888888888'),
    'caso 9: importacao recusada para atendente nao criou o cliente da linha');
  perform teste_ok((select count(*) = 0 from crediario_lancamentos l
                     join clientes c on c.id = l.cliente_id
                    where c.cpf = '88888888888'
                      and l.observacao = 'Saldo importado do sistema antigo'),
    'caso 9: nenhum lancamento marcado aponta para a linha do atendente');
  perform teste_ok((select count(*) = v_antes from crediario_lancamentos
                     where observacao = 'Saldo importado do sistema antigo'),
    'caso 9: a tentativa do atendente nao mudou a contagem de lancamentos marcados');

  -- O MESMO arquivo que o atendente mandou e aceito pelo dono: prova que a recusa
  -- do caso 9 foi de papel, e nao do conteudo da linha.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  v_resumo := importar_clientes(jsonb_build_array(
    jsonb_build_object('nome', 'CLIENTE DO ATENDENTE', 'cpf', '88888888888', 'saldo', 1000)
  ), true);
  perform teste_ok((v_resumo->>'criados')::int = 1 and (v_resumo->>'saldos_lancados')::int = 1
                     and (select saldo = 1000 from v_clientes_devedores
                           where cliente_id = (select id from clientes where cpf = '88888888888')),
    'caso 9c: o MESMO arquivo que o atendente nao pudo importar passa pelo dono — a recusa era de papel');

  -- O atendente editar o cliente sem mexer em limite nem bloqueio continua
  -- permitido (spec 5): prova que a guarda nao virou "so o dono salva cliente".
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  perform cliente_salvar(v_novo, 'ATENDIDO PELO ATENDENTE', '11999998888', null,
                         5000, false, 'observacao do atendente', 0);
  perform teste_ok((select observacao = 'observacao do atendente' and limite_credito = 5000
                      from clientes where id = v_novo),
    'caso 9b: atendente edita nome/telefone/observacao sem tocar no limite');

  -- Um terceiro atendente confirma que a recusa do caso 2 nao veio do perfil
  -- "errado": o papel e o mesmo e a recusa se repete.
  v_atend2 := criar_usuario_teste(gen_random_uuid(), 'clientes-atendente2@farmacia.local', 'atendente');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atend2, 'role', 'authenticated')::text, true);
  perform teste_erro(
    $sql$select cliente_salvar(null, 'OUTRO ATENDENTE', null, null, 100, false, null, 0)$sql$,
    'Só o dono pode mudar o limite de crédito.',
    'caso 9b: a recusa do limite vale para qualquer atendente');

  -- ================= permissoes (padrao das RPCs de escrita) =================
  perform teste_ok(not has_function_privilege('anon',
                     'cliente_salvar(uuid,text,text,text,integer,boolean,text,integer)', 'execute'),
    'permissoes: anon NAO executa cliente_salvar');
  perform teste_ok(has_function_privilege('authenticated',
                     'cliente_salvar(uuid,text,text,text,integer,boolean,text,integer)', 'execute'),
    'permissoes: authenticated executa cliente_salvar');
  perform teste_ok(not has_function_privilege('anon',
                     'importar_clientes(jsonb,boolean)', 'execute'),
    'permissoes: anon NAO executa importar_clientes');
  perform teste_ok(has_function_privilege('authenticated',
                     'importar_clientes(jsonb,boolean)', 'execute'),
    'permissoes: authenticated executa importar_clientes');
end $$;
