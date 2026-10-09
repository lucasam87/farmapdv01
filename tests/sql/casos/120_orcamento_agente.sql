-- 120_orcamento_agente.sql — casos do ledger transacional do orcamento mensal
-- do agente de IA (migration 017_orcamento_agente.sql, Task 1 da etapa 8).
--
-- O que este arquivo prova, e por que cada assercao e do tamanho que e:
--
--   * PERMISSAO E A FRONTEIRA DURA: o ledger e dinheiro. `anon` e `authenticated`
--     nao podem ler, escrever nem executar as tres funcoes; so `service_role`
--     executa. As assercoes de permissao sao do CATALOGO
--     (has_table_privilege/has_function_privilege) E de verdade (troca de role e
--     tenta ler/escrever/chamar) — as duas coisas, porque catalogo sem tentativa
--     real nao prova que a porta esta fechada.
--   * RLS LIGADA nas duas tabelas, mesmo sem policy nenhuma: e a policy ausente
--     que fecha a tabela para os papeis publicos, e a RLS ligada que garante que
--     um `grant` futuro por engano nao abra tudo.
--   * O CONTADOR JA SOBE NA RESERVA. `reservar` soma `reservado_micros` ao
--     `consumido_micros` do mes no mesmo instante em que cria a reserva. E isto
--     que faz o teto nao furar: entre reservar e reconciliar, o dinheiro ja esta
--     contado. As assercoes seguem o consumido depois de CADA passo, e nao so no
--     fim — foi o que separou as provas.
--   * RECONCILIAR AJUSTA PELO LADO DO CUSTO REAL, nos dois sentidos: custo maior
--     que a reserva sobe o consumido, custo menor devolve a diferenca.
--   * LIBERAR SO EXISTE PARA FALHA PRE-ENVIO, e devolve o saldo. O caso prova o
--     ciclo completo: com o saldo curto, a reserva que passaria do teto e
--     recusada; depois da liberacao, a MESMA reserva passa.
--   * RESERVA JA LIQUIDADA NAO SE MEXE: reconciliar ou liberar de novo tem que
--     falhar e deixar o consumido parado (sem isso, um segundo `liberar` devolveria
--     dinheiro ja gasto e o mes voltaria a aceitar chamada paga).
--   * O TETO SEQUENCIAL: reserva ate o limite (5.000.000 µ$ = US$ 5) e a proxima e
--     recusada com a mensagem que a Tarefa 3 casa. A prova de concorrencia REAL
--     (duas sessoes) nao cabe aqui: cada arquivo de `casos/` roda numa UNICA
--     transacao com ROLLBACK, entao nao existem duas sessoes — ela vive no
--     cenario 3 de `tests/sql/concorrencia.mjs`.
--
-- MES DEDICADO: todo cenario usa meses de 2099 (nunca o mes real). O banco e o de
-- PRODUCAO e o teto e um numero unico: encostar no mes corrente apagaria a
-- evidencia de producao. As assercoes contam so as reservas que este arquivo cria.
--
-- ATENCAO ao que este caso NAO prova: a tarifa de 1.373 µ$ por chamada e do
-- `logica.ts` (Tarefa 2, ruling R10) — o SQL valida `p_micros > 0` e o teto do
-- mes, e nao repete numero de tarifa nenhum. E o proprio `p_mes` e parametro de
-- proposito (ruling R1): e o que permite testar o teto sem tocar o mes real.

do $$
declare
  v_mes        date := date '2099-12-01';  -- mes dedicado do arquivo inteiro
  v_mes_cheio  date := date '2099-11-01';  -- cenario do teto no limite exato
  v_mes_recon  date := date '2099-10-01';  -- cenario da reconciliacao
  v_mes_lib    date := date '2099-09-01';  -- cenario da liberacao
  v_mes_estado date := date '2099-08-01';  -- cenario das transicoes de estado
  v_mes_limpo  date := date '2099-07-01';  -- cenario dos parametros tortos
  v_mes_serv   date := date '2099-06-01';  -- cenario do service_role (e so ele)
  v_r1 uuid;
  v_r2 uuid;
begin
  -- ================= cenario =================
  -- Uma linha de mes por cenario, com o consumido inicial conhecido. Nenhum
  -- `consumido_micros` do mes real e lido ou tocado em assercao nenhuma.
  insert into public.agente_orcamento_mensal (mes, consumido_micros)
  values (v_mes, 1000000), (v_mes_cheio, 0), (v_mes_recon, 1000),
         (v_mes_lib, 4000000), (v_mes_estado, 500), (v_mes_limpo, 0),
         (v_mes_serv, 0);

  -- ================= caso 1: a reserva ja consome =================
  -- Reserva de 1.373 µ$ (o valor que a Tarefa 2 usa por chamada) num mes que ja
  -- tinha 1.000.000: o consumido tem que ir a 1.001.373 NO MOMENTO da reserva, e
  -- nao na reconciliacao. Se o contador so subisse ao reconciliar, a janela entre
  -- reservar e reconciliar deixaria N reservas concorrentes passarem do teto.
  v_r1 := public.agente_orcamento_reservar(v_mes, 1373);
  perform teste_ok((select consumido_micros = 1001373
                      from public.agente_orcamento_mensal where mes = v_mes),
    'reserva: o consumido do mes sobe no instante da reserva (1.000.000 + 1.373 = 1.001.373)');
  perform teste_ok((select estado = 'reservada' and reservado_micros = 1373
                      and custo_micros is null and mes = v_mes
                      from public.agente_orcamento_reservas where id = v_r1),
    'reserva: a linha nasce "reservada", com o valor reservado e sem custo real');
  perform teste_ok(v_r1 is not null, 'reserva: a funcao devolve o id da reserva');
  -- A reserva criada e a MESMA que a funcao devolveu.
  perform teste_ok((select count(*) = 1 from public.agente_orcamento_reservas
                     where id = v_r1 and mes = v_mes),
    'reserva: existe exatamente a reserva devolvida, no mes pedido');

  -- ================= caso 2: o teto sequencial =================
  -- 2.500.000 + 2.500.000 = 5.000.000, o teto exato. As duas passam (o teto e
  -- "nao passar de", e nao "nao chegar a"): recusar a reserva que fecha o mes
  -- exato desperdicaria dinheiro.
  perform public.agente_orcamento_reservar(v_mes_cheio, 2500000);
  perform public.agente_orcamento_reservar(v_mes_cheio, 2500000);
  perform teste_ok((select consumido_micros = 5000000
                      from public.agente_orcamento_mensal where mes = v_mes_cheio),
    'teto: duas reservas de 2.500.000 fecham os US$ 5 exatos (5.000.000 µ$)');
  -- A proxima NAO passa, e a mensagem e a que a Tarefa 3 vai traduzir para o
  -- usuario. Texto verbatim da ruling R1.
  perform teste_erro($sql$select public.agente_orcamento_reservar(date '2099-11-01', 1)$sql$,
    'Orçamento mensal do assistente esgotado.',
    'teto: a reserva seguinte ao teto e recusada com a mensagem exata');
  -- E a recusa nao pode ter deixado o consumido maior: teto furado por tentativa
  -- recusada seria o pior dos dois mundos.
  perform teste_ok((select consumido_micros = 5000000
                      from public.agente_orcamento_mensal where mes = v_mes_cheio),
    'teto: a reserva recusada nao mexe no consumido (continua 5.000.000)');
  -- E nao sobrou reserva nenhuma da tentativa recusada (duas, e nao tres).
  perform teste_ok((select count(*) = 2 from public.agente_orcamento_reservas
                     where mes = v_mes_cheio),
    'teto: a recusa nao cria linha de reserva (duas linhas, nao tres)');

  -- ================= caso 3: reconciliacao nos dois sentidos =================
  -- Mes com 1.000 ja consumidos. Reserva de 1.373 -> 2.373.
  v_r1 := public.agente_orcamento_reservar(v_mes_recon, 1373);
  perform teste_ok((select consumido_micros = 2373
                      from public.agente_orcamento_mensal where mes = v_mes_recon),
    'reconciliacao: ponto de partida (1.000 + 1.373 = 2.373)');
  -- CUSTO MENOR que a reserva: 900 em vez de 1.373 devolve 473 (2.373 -> 1.900).
  perform public.agente_orcamento_reconciliar(v_r1, 900);
  perform teste_ok((select consumido_micros = 1900
                      from public.agente_orcamento_mensal where mes = v_mes_recon),
    'reconciliacao: custo real menor que a reserva DEVOLVE a diferenca (2.373 - 473 = 1.900)');
  perform teste_ok((select estado = 'liquidada' and custo_micros = 900 and reservado_micros = 1373
                      from public.agente_orcamento_reservas where id = v_r1),
    'reconciliacao: a reserva fica "liquidada", guardando o reservado E o custo real');
  -- CUSTO MAIOR que a reserva: 3.000 em vez de 1.373 sobe 1.627, mas o ponto de
  -- partida ja tem a reserva somada: a reserva v_r2 levou 1.900 -> 3.273 e a
  -- reconciliacao leva 3.273 -> 4.900 (3.273 + 1.627). E o caso que pega um
  -- `update` que so sabe subtrair.
  v_r2 := public.agente_orcamento_reservar(v_mes_recon, 1373);
  perform teste_ok((select consumido_micros = 3273
                      from public.agente_orcamento_mensal where mes = v_mes_recon),
    'reconciliacao: a segunda reserva soma no consumido antes de qualquer custo (1.900 + 1.373 = 3.273)');
  perform public.agente_orcamento_reconciliar(v_r2, 3000);
  perform teste_ok((select consumido_micros = 4900
                      from public.agente_orcamento_mensal where mes = v_mes_recon),
    'reconciliacao: custo real maior que a reserva AUMENTA o consumido (3.273 + 1.627 = 4.900)');
  perform teste_ok((select custo_micros = 3000 from public.agente_orcamento_reservas where id = v_r2),
    'reconciliacao: o custo real maior fica gravado na reserva');

  -- ================= caso 4: liberar devolve o saldo (falha pre-envio) =================
  -- Mes com 4.000.000 consumidos: sobram 1.000.000. Duas reservas de 500.000 usam
  -- todo o saldo restante (sem encostar no teto).
  v_r1 := public.agente_orcamento_reservar(v_mes_lib, 500000);
  v_r2 := public.agente_orcamento_reservar(v_mes_lib, 500000);
  perform teste_ok((select consumido_micros = 5000000
                      from public.agente_orcamento_mensal where mes = v_mes_lib),
    'liberar: as duas reservas de 500.000 esgotam o mes (4.000.000 + 1.000.000)');
  -- Com o mes cheio, uma reserva de 100.000 e recusada: e o saldo curto.
  perform teste_erro($sql$select public.agente_orcamento_reservar(date '2099-09-01', 100000)$sql$,
    'Orçamento mensal do assistente esgotado.',
    'liberar: com o mes cheio, reservar 100.000 e recusado');
  -- FALHA COMPROVADAMENTE ANTERIOR AO ENVIO: a reserva v_r2 e liberada e devolve
  -- os 500.000 ao mes.
  perform public.agente_orcamento_liberar(v_r2);
  perform teste_ok((select consumido_micros = 4500000
                      from public.agente_orcamento_mensal where mes = v_mes_lib),
    'liberar: devolve o valor reservado ao consumido do mes (5.000.000 - 500.000 = 4.500.000)');
  perform teste_ok((select estado = 'liberada' and custo_micros is null
                      from public.agente_orcamento_reservas where id = v_r2),
    'liberar: a reserva fica "liberada", sem custo real (nada foi enviado)');
  -- E a MESMA reserva que era recusada agora passa: e a prova de que o saldo
  -- voltou de verdade, e nao so de que um numero mudou.
  v_r2 := public.agente_orcamento_reservar(v_mes_lib, 400000);
  perform teste_ok((select consumido_micros = 4900000
                      from public.agente_orcamento_mensal where mes = v_mes_lib),
    'liberar: depois da liberacao a reserva recusada passa (4.500.000 + 400.000 = 4.900.000)');

  -- ================= caso 5: reserva liquidada nao se mexe de novo =================
  v_r1 := public.agente_orcamento_reservar(v_mes_estado, 1373);  -- 500 + 1.373 = 1.873
  perform public.agente_orcamento_reconciliar(v_r1, 1000);       -- 1.873 - 373 = 1.500
  perform teste_ok((select consumido_micros = 1500
                      from public.agente_orcamento_mensal where mes = v_mes_estado),
    'estado: reserva reservada -> liquidada (500 + 1.000 = 1.500 consumidos)');
  -- Reconciliar de novo: recusado, e o consumido nao se move. Sem esta guarda, um
  -- `usage` repetido por um retry cobraria a mesma chamada duas vezes.
  perform teste_erro($sql$select public.agente_orcamento_reconciliar(
    (select id from public.agente_orcamento_reservas where mes = date '2099-08-01'), 2000)$sql$,
    'Reserva já foi liquidada.',
    'estado: reserva ja liquidada nao pode ser liquidada de novo');
  -- Liberar uma reserva liquidada: recusado. Sem esta guarda, uma falha AMBIGUA
  -- (conexao caiu depois do envio) viraria saldo livre que pode ter sido faturado.
  perform teste_erro($sql$select public.agente_orcamento_liberar(
    (select id from public.agente_orcamento_reservas where mes = date '2099-08-01'))$sql$,
    'Reserva já foi liquidada.',
    'estado: reserva ja liquidada nao pode ser liberada (falha ambigua nao devolve saldo)');
  perform teste_ok((select consumido_micros = 1500
                      from public.agente_orcamento_mensal where mes = v_mes_estado),
    'estado: as duas recusas deixam o consumido parado em 1.500');
  -- E as duas guardas de estado valem tambem para a reserva LIBERADA: liberar de
  -- novo devolveria dinheiro duas vezes.
  perform teste_erro($sql$select public.agente_orcamento_liberar(
    (select id from public.agente_orcamento_reservas where mes = date '2099-09-01'
       and estado = 'liberada'))$sql$,
    'Reserva já foi liberada.',
    'estado: reserva ja liberada nao pode ser liberada de novo');
  perform teste_erro($sql$select public.agente_orcamento_reconciliar(
    (select id from public.agente_orcamento_reservas where mes = date '2099-09-01'
       and estado = 'liberada'), 100)$sql$,
    'Reserva já foi liberada.',
    'estado: reserva ja liberada nao pode ser liquidada');

  -- ================= caso 6: reserva inexistente e parametros tortos =================
  -- Um id que nao existe nao pode virar uma linha nova nem um silencio.
  perform teste_erro($sql$select public.agente_orcamento_reconciliar(gen_random_uuid(), 100)$sql$,
    'Reserva não encontrada.',
    'parametros: reconciliar uma reserva que nao existe e recusado');
  perform teste_erro($sql$select public.agente_orcamento_liberar(gen_random_uuid())$sql$,
    'Reserva não encontrada.',
    'parametros: liberar uma reserva que nao existe e recusado');
  -- MES TORTO: o mes do orcamento e o primeiro dia do mes (calendario de Sao
  -- Paulo). Um mes no meio do mes criaria uma segunda linha para o MESMO mes e o
  -- teto passaria a valer duas vezes.
  perform teste_erro($sql$select public.agente_orcamento_reservar(date '2099-12-15', 1000)$sql$,
    'primeiro dia',
    'parametros: mes que nao e o primeiro dia do mes e recusado');
  perform teste_erro($sql$select public.agente_orcamento_reservar(null, 1000)$sql$,
    'primeiro dia',
    'parametros: mes nulo e recusado');
  -- MICROS NAO-POSITIVOS: reserva de zero ou negativa nao e reserva. O teto por
  -- chamada (1.373 µ$) NAO vive aqui (ruling R10): o SQL so exige positivo.
  perform teste_erro($sql$select public.agente_orcamento_reservar(date '2099-07-01', 0)$sql$,
    'Micros da reserva precisam ser positivos.',
    'parametros: reserva de zero micros e recusada');
  perform teste_erro($sql$select public.agente_orcamento_reservar(date '2099-07-01', -1)$sql$,
    'Micros da reserva precisam ser positivos.',
    'parametros: reserva de micros negativos e recusada');
  perform teste_erro($sql$select public.agente_orcamento_reservar(date '2099-07-01', null)$sql$,
    'Micros da reserva precisam ser positivos.',
    'parametros: reserva de micros nulos e recusada');
  -- CUSTO NEGATIVO nao existe: um custo negativo AUMENTARIA o saldo do mes, que e
  -- exatamente o furo que o teto nao pode ter. Custo ZERO, esse sim, existe (uma
  -- resposta que voltou sem `usage`).
  v_r1 := public.agente_orcamento_reservar(v_mes_limpo, 1373);
  perform teste_erro($sql$select public.agente_orcamento_reconciliar(
    (select id from public.agente_orcamento_reservas where mes = date '2099-07-01'), -1)$sql$,
    'Custo em micros não pode ser negativo.',
    'parametros: custo negativo nao pode devolver saldo ao mes');
  perform public.agente_orcamento_reconciliar(v_r1, 0);
  perform teste_ok((select consumido_micros = 0
                      from public.agente_orcamento_mensal where mes = v_mes_limpo)
                   and (select custo_micros = 0 and estado = 'liquidada'
                          from public.agente_orcamento_reservas where id = v_r1),
    'parametros: custo zero e aceito (resposta sem uso) e devolve a reserva inteira');
  -- E nenhuma das recusas acima criou reserva ou mes novo.
  perform teste_ok((select count(*) = 1 from public.agente_orcamento_reservas
                     where mes = v_mes_limpo)
                   and (select count(*) = 1 from public.agente_orcamento_mensal
                          where mes = v_mes_limpo),
    'parametros: as recusas nao criaram reserva nem mes novo');

  -- ================= caso 7: o formato das tabelas e do estado =================
  -- O estado e um `check`: um valor fora dos tres nao entra nem por escrita direta
  -- (as funcoes sao a porta normal, mas a constraint e a ultima linha de defesa).
  perform teste_erro($sql$insert into public.agente_orcamento_reservas
    (mes, estado, reservado_micros) values (date '2099-12-01', 'cancelada', 1)$sql$,
    'agente_orcamento_reservas_estado_check',
    'formato: estado fora de reservada/liquidada/liberada e recusado pelo check');
  -- O dinheiro e INTEIRO: `pg_typeof` em cima do valor real da coluna, e nao do
  -- catalogo, para pegar um `real`/`numeric` que tivesse entrado por engano.
  perform teste_ok((select pg_typeof(consumido_micros) = 'bigint'::regtype
                      from public.agente_orcamento_mensal where mes = v_mes),
    'formato: consumido_micros e bigint (dinheiro inteiro em micros, sem ponto flutuante)');
  perform teste_ok((select pg_typeof(reservado_micros) = 'bigint'::regtype
                      and pg_typeof(custo_micros) = 'bigint'::regtype
                      from public.agente_orcamento_reservas where id = v_r1),
    'formato: reservado_micros e custo_micros sao bigint');
  perform teste_ok((select data_type = 'date' from information_schema.columns
                     where table_schema = 'public' and table_name = 'agente_orcamento_mensal'
                       and column_name = 'mes'),
    'formato: o mes e uma data (e nao texto)');
  -- A FK e o que garante que nao existe reserva sem mes (e que a limpeza do teste
  -- de concorrencia tem que apagar a reserva antes do mes).
  perform teste_ok((select count(*) = 1 from pg_constraint
                     where conname = 'agente_orcamento_reservas_mes_fkey'
                       and conrelid = 'public.agente_orcamento_reservas'::regclass
                       and contype = 'f'),
    'formato: a reserva referencia o mes (foreign key para agente_orcamento_mensal)');

  -- ================= permissoes: catalogo =================
  -- RLS LIGADA nas duas tabelas. Sem policy nenhuma, a tabela fica fechada para
  -- `authenticated`/`anon` mesmo que um grant futuro apareca: e a segunda tranca.
  perform teste_ok((select relrowsecurity from pg_class
                     where oid = 'public.agente_orcamento_mensal'::regclass)
                   and (select relrowsecurity from pg_class
                          where oid = 'public.agente_orcamento_reservas'::regclass),
    'permissoes: RLS esta LIGADA nas duas tabelas do orcamento');
  -- E nao existe policy nenhuma: a RLS sem policy e "ninguem passa" (o
  -- `service_role` do Supabase passa por `bypassrls`, mas nao a `anon`).
  perform teste_ok((select count(*) = 0 from pg_policies
                     where schemaname = 'public'
                       and tablename in ('agente_orcamento_mensal', 'agente_orcamento_reservas')),
    'permissoes: nenhuma policy criada nas tabelas do orcamento');
  -- Tabela: nenhum privilegio de tabela para os papeis publicos. O Supabase da
  -- SELECT/INSERT/UPDATE/DELETE a `anon` e `authenticated` no schema `public` por
  -- DEFAULT PRIVILEGES — se a migration so revogasse de PUBLIC, o grant direto no
  -- papel continuaria valendo (mesmo achado que 050_permissoes.sql registra).
  perform teste_ok(not has_table_privilege('anon', 'public.agente_orcamento_mensal', 'select')
                   and not has_table_privilege('anon', 'public.agente_orcamento_mensal', 'insert')
                   and not has_table_privilege('anon', 'public.agente_orcamento_mensal', 'update')
                   and not has_table_privilege('anon', 'public.agente_orcamento_mensal', 'delete')
                   and not has_table_privilege('anon', 'public.agente_orcamento_reservas', 'select')
                   and not has_table_privilege('anon', 'public.agente_orcamento_reservas', 'insert')
                   and not has_table_privilege('anon', 'public.agente_orcamento_reservas', 'update')
                   and not has_table_privilege('anon', 'public.agente_orcamento_reservas', 'delete'),
    'permissoes: anon nao tem SELECT/INSERT/UPDATE/DELETE em nenhuma das duas tabelas');
  perform teste_ok(not has_table_privilege('authenticated', 'public.agente_orcamento_mensal', 'select')
                   and not has_table_privilege('authenticated', 'public.agente_orcamento_mensal', 'insert')
                   and not has_table_privilege('authenticated', 'public.agente_orcamento_mensal', 'update')
                   and not has_table_privilege('authenticated', 'public.agente_orcamento_mensal', 'delete')
                   and not has_table_privilege('authenticated', 'public.agente_orcamento_reservas', 'select')
                   and not has_table_privilege('authenticated', 'public.agente_orcamento_reservas', 'insert')
                   and not has_table_privilege('authenticated', 'public.agente_orcamento_reservas', 'update')
                   and not has_table_privilege('authenticated', 'public.agente_orcamento_reservas', 'delete'),
    'permissoes: authenticated nao tem SELECT/INSERT/UPDATE/DELETE em nenhuma das duas tabelas');
  -- E `public` tambem nao: `PUBLIC` e o papel que todo mundo herda, entao um grant
  -- ali valeria para anon e authenticated de uma vez.
  perform teste_ok(not has_table_privilege('public', 'public.agente_orcamento_mensal', 'select')
                   and not has_table_privilege('public', 'public.agente_orcamento_reservas', 'select')
                   and not has_column_privilege('public', 'public.agente_orcamento_mensal',
                                                 'consumido_micros', 'update'),
    'permissoes: o papel PUBLIC nao tem privilegio nenhum nas tabelas do orcamento');
  -- As tres funcoes: `anon` e `authenticated` sem EXECUTE. O `revoke ... from anon`
  -- e obrigatorio (o grant chega direto no papel por default privileges).
  perform teste_ok(not has_function_privilege('anon', 'public.agente_orcamento_reservar(date,bigint)', 'execute')
                   and not has_function_privilege('anon', 'public.agente_orcamento_reconciliar(uuid,bigint)', 'execute')
                   and not has_function_privilege('anon', 'public.agente_orcamento_liberar(uuid)', 'execute'),
    'permissoes: anon NAO executa reservar, reconciliar nem liberar');
  perform teste_ok(not has_function_privilege('authenticated', 'public.agente_orcamento_reservar(date,bigint)', 'execute')
                   and not has_function_privilege('authenticated', 'public.agente_orcamento_reconciliar(uuid,bigint)', 'execute')
                   and not has_function_privilege('authenticated', 'public.agente_orcamento_liberar(uuid)', 'execute'),
    'permissoes: authenticated NAO executa reservar, reconciliar nem liberar');
  perform teste_ok(not has_function_privilege('public', 'public.agente_orcamento_reservar(date,bigint)', 'execute')
                   and not has_function_privilege('public', 'public.agente_orcamento_reconciliar(uuid,bigint)', 'execute')
                   and not has_function_privilege('public', 'public.agente_orcamento_liberar(uuid)', 'execute'),
    'permissoes: o papel PUBLIC NAO executa as tres funcoes');
  -- `service_role` executa: e a unica porta.
  perform teste_ok(has_function_privilege('service_role', 'public.agente_orcamento_reservar(date,bigint)', 'execute')
                   and has_function_privilege('service_role', 'public.agente_orcamento_reconciliar(uuid,bigint)', 'execute')
                   and has_function_privilege('service_role', 'public.agente_orcamento_liberar(uuid)', 'execute'),
    'permissoes: service_role executa reservar, reconciliar e liberar');
  -- O grant de tabela e o MINIMO, e a prova e a entrada do ACL (e nao so o
  -- `has_table_privilege`, que devolve true para DELETE tambem por heranca de
  -- papel — medido com sonda: `service_role` e membro de `postgres` neste
  -- projeto). O que a MIGRATION concede e `arw` = SELECT + INSERT + UPDATE; a
  -- entrada exata e assertada, e nao um "contem".
  perform teste_ok((select a::text from pg_class c, unnest(c.relacl) a
                     where c.oid = 'public.agente_orcamento_mensal'::regclass
                       and a::text like 'service_role=%') = 'service_role=arw/postgres',
    'permissoes: o ACL do mes da a service_role exatamente SELECT+INSERT+UPDATE (arw)');
  perform teste_ok((select a::text from pg_class c, unnest(c.relacl) a
                     where c.oid = 'public.agente_orcamento_reservas'::regclass
                       and a::text like 'service_role=%') = 'service_role=arw/postgres',
    'permissoes: o ACL das reservas da a service_role exatamente SELECT+INSERT+UPDATE (arw)');
  -- E o DELETE que o DEFAULT PRIVILEGES do Supabase punha no papel NAO esta mais
  -- la (achado Important 1: e a migracao que concede, nao o ambiente).
  perform teste_ok(not has_table_privilege('service_role', 'public.agente_orcamento_mensal', 'delete')
                   and not has_table_privilege('service_role', 'public.agente_orcamento_reservas', 'delete')
                   and not has_table_privilege('service_role', 'public.agente_orcamento_mensal', 'truncate')
                   and not has_table_privilege('service_role', 'public.agente_orcamento_reservas', 'truncate'),
    'permissoes: service_role NAO tem DELETE nem TRUNCATE no ledger (o revoke tirou o que o ambiente dava)');

  -- As tres sao `security invoker`: a funcao roda com os direitos de QUEM CHAMA.
  -- Com `security definer` ela rodaria como o dono do banco e a RLS do chamador
  -- seria ignorada — a mesma correcao de classe da migration 013 nas views.
  perform teste_ok(not (select prosecdef from pg_proc
                          where oid = 'public.agente_orcamento_reservar(date,bigint)'::regprocedure)
                   and not (select prosecdef from pg_proc
                              where oid = 'public.agente_orcamento_reconciliar(uuid,bigint)'::regprocedure)
                   and not (select prosecdef from pg_proc
                              where oid = 'public.agente_orcamento_liberar(uuid)'::regprocedure),
    'seguranca: as tres funcoes do orcamento NAO sao security definer');
  -- As funcoes nao podem ter sido criadas com `search_path` frouxo nem chamando
  -- objeto sem qualificacao: o corpo tem que falar `public.` explicitamente.
  perform teste_ok((select position('public.agente_orcamento_mensal' in prosrc) > 0
                    from pg_proc where oid = 'public.agente_orcamento_reservar(date,bigint)'::regprocedure)
                   and (select position('public.agente_orcamento_mensal' in prosrc) > 0
                          from pg_proc where oid = 'public.agente_orcamento_reconciliar(uuid,bigint)'::regprocedure),
    'seguranca: o corpo das funcoes referencia as tabelas com o schema qualificado');

  -- ================= permissoes: de verdade (troca de role) =================
  -- O bloco e escrito a mao (e nao com `teste_erro`) porque o Postgres proibe
  -- `set role` dentro de funcao `security definer` — e `teste_erro` e definer.
  -- Mesmo padrao de 050_permissoes.sql.
  execute 'set local role anon';
  begin
    perform (select count(*) from public.agente_orcamento_mensal);
    perform teste_ok(false, 'anon NAO consegue LER o orcamento (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0
                     or position(lower('row-level security') in lower(sqlerrm)) > 0,
      'anon NAO le o orcamento (a recusa e de permissao/RLS, veio: ' || sqlerrm || ')');
  end;
  begin
    perform (select count(*) from public.agente_orcamento_reservas);
    perform teste_ok(false, 'anon NAO consegue LER as reservas (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0
                     or position(lower('row-level security') in lower(sqlerrm)) > 0,
      'anon NAO le as reservas (a recusa e de permissao/RLS, veio: ' || sqlerrm || ')');
  end;
  begin
    execute $sql$insert into public.agente_orcamento_mensal (mes, consumido_micros)
      values (date '2099-06-01', 0)$sql$;
    perform teste_ok(false, 'anon NAO consegue escrever no orcamento (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0
                     or position(lower('row-level security') in lower(sqlerrm)) > 0,
      'anon NAO escreve no orcamento (a recusa e de permissao/RLS, veio: ' || sqlerrm || ')');
  end;
  begin
    perform public.agente_orcamento_reservar(date '2099-06-01', 1000);
    perform teste_ok(false, 'anon NAO consegue executar a reserva (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0,
      'anon NAO executa a funcao de reserva (veio: ' || sqlerrm || ')');
  end;

  execute 'set local role authenticated';
  begin
    perform (select count(*) from public.agente_orcamento_mensal);
    perform teste_ok(false, 'authenticated NAO consegue LER o orcamento (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0
                     or position(lower('row-level security') in lower(sqlerrm)) > 0,
      'authenticated NAO le o orcamento (a recusa e de permissao/RLS, veio: ' || sqlerrm || ')');
  end;
  begin
    perform public.agente_orcamento_reservar(date '2099-06-01', 1000);
    perform teste_ok(false, 'authenticated NAO consegue executar a reserva (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0,
      'authenticated NAO executa a funcao de reserva (veio: ' || sqlerrm || ')');
  end;
  -- O usuario logado tem que continuar fazendo o trabalho DELE: fechar a porta do
  -- orcamento nao pode ter fechado o resto (a correcao nao pode ter ido longe
  -- demais). A assercao e de catalogo, no mesmo papel: `authenticated` continua
  -- com EXECUTE nas RPCs do PDV.
  perform teste_ok(has_function_privilege('authenticated',
                     'public.registrar_venda(uuid,uuid,jsonb,jsonb,integer)', 'execute'),
    'authenticated continua com as RPCs dele (o fechamento foi so do orcamento)');

  -- ================= service_role EXECUTA as tres, de verdade =================
  -- Achado Important 1 da revisao: as assercoes de catalogo acima provam que a
  -- `service_role` TEM o privilegio; nenhuma prova que a funcao FUNCIONA para
  -- ela. E a diferenca importa porque as tres sao `security invoker`: o corpo roda
  -- com os direitos do chamador, entao um grant de tabela faltando faz a funcao
  -- morrer com "permission denied" exatamente para o unico chamador que a spec
  -- manda usar — e o resto do arquivo (que roda na role do endpoint) seguia verde.
  -- A spec §"Testes SQL" pede isto literalmente: "service_role consegue reservar,
  -- reconciliar e liberar uma reserva".
  --
  -- MES DEDICADO `2099-06-01`, e nao um dos meses dos outros casos: este bloco
  -- escreve pelo caminho de producao e nao pode encostar no cenario dos outros.
  execute 'set local role service_role';

  begin
    v_r1 := public.agente_orcamento_reservar(v_mes_serv, 1373);
    perform teste_ok(true, 'service_role: RESERVAR completa (reserva de 1.373 micros no mes dedicado)');
  exception when others then
    perform teste_ok(false, 'service_role: reservar falhou com "' || sqlerrm || '"');
  end;

  perform teste_ok((select consumido_micros = 1373
                      from public.agente_orcamento_mensal where mes = v_mes_serv),
    'service_role: a reserva que ELA criou somou no consumido (0 + 1.373)');

  begin
    perform public.agente_orcamento_reconciliar(v_r1, 1000);
    perform teste_ok(true, 'service_role: RECONCILIAR completa (custo real de 1.000 micros)');
  exception when others then
    perform teste_ok(false, 'service_role: reconciliar falhou com "' || sqlerrm || '"');
  end;

  perform teste_ok((select consumido_micros = 1000
                      from public.agente_orcamento_mensal where mes = v_mes_serv),
    'service_role: a reconciliacao dela ajustou o consumido (1.373 - 373 = 1.000)');

  -- Segunda reserva: e a que o `liberar` fecha (falha pre-envio).
  begin
    v_r2 := public.agente_orcamento_reservar(v_mes_serv, 1373);
    perform teste_ok(true, 'service_role: RESERVAR de novo completa (segunda reserva, para liberar)');
  exception when others then
    perform teste_ok(false, 'service_role: a segunda reserva falhou com "' || sqlerrm || '"');
  end;

  begin
    perform public.agente_orcamento_liberar(v_r2);
    perform teste_ok(true, 'service_role: LIBERAR completa (falha anterior ao envio)');
  exception when others then
    perform teste_ok(false, 'service_role: liberar falhou com "' || sqlerrm || '"');
  end;

  perform teste_ok((select consumido_micros = 1000
                      from public.agente_orcamento_mensal where mes = v_mes_serv)
                   and (select count(*) = 2 from public.agente_orcamento_reservas
                          where mes = v_mes_serv),
    'service_role: o ciclo inteiro no mes dedicado (1.000 consumidos, duas reservas)');

  -- A negativa que fecha o desenho: a `service_role` NAO apaga. Nao e decoracao —
  -- `create table` no schema `public` nasce com `service_role=arwdDxtm` pelo
  -- DEFAULT PRIVILEGES do Supabase (medido no banco de producao), e a migration
  -- tira `delete` e `truncate` com o `revoke all` antes do grant. O bloco abaixo
  -- e a prova de VERDADE (o catalogo acima prova o ACL; este prova o efeito).
  begin
    execute $sql$delete from public.agente_orcamento_mensal where mes = date '2099-06-01'$sql$;
    perform teste_ok(false, 'service_role NAO apaga o ledger (o delete passou)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0,
      'service_role NAO apaga o ledger (a recusa e de permissao, veio: ' || sqlerrm || ')');
  end;

  execute 'reset role';

  -- A linha do mes dedicado sobreviveu a tentativa de delete.
  perform teste_ok((select count(*) = 1 from public.agente_orcamento_mensal where mes = v_mes_serv),
    'service_role: a linha do mes continua la depois da tentativa de delete');

  -- ================= a limpeza e do ROLLBACK =================
  -- Este arquivo nao apaga nada: o runner envolve o caso numa transacao que
  -- termina em ROLLBACK, entao as seis linhas de mes e as reservas morrem com ela.
  -- A prova de que nada sobrevive e a propria suite passar duas vezes.
end $$;
