-- 110_relatorios.sql — casos das quatro funcoes de leitura do periodo
-- (migration 016_relatorios.sql, Task 1 da etapa 7).
--
-- O que este arquivo prova, e por que cada assercao e do tamanho que e:
--
--   * TICKET MEDIO DO PERIODO = total / quantidade, NUNCA a media das medias
--     diarias (o erro classico e silencioso deste numero). O cenario foi montado
--     para as duas contas DAREM DIFERENTE: o dia 15/01 tem UMA venda de 600 e o
--     dia 16/01 tem DUAS vendas que somam 3150. Total/quantidade = 3750/3 = 1250;
--     media das medias dos dias = (600 + 1575)/2 = 1088. Se cada dia tivesse o
--     mesmo numero de vendas, as duas contas coincidiriam e o caso nao provaria
--     nada — foi o achado que mudou o cenario do brief (ver o relatorio).
--   * FUSO: a venda das 22h de 15/01 em Sao Paulo (01:00 UTC do dia 16) conta no
--     dia 15 — a MESMA expressao de v_vendas_dia (005_views.sql:16).
--   * VENDA CANCELADA nao entra em numero nenhum (spec 6, A7): o dia 15 tem uma
--     venda concluida e uma cancelada, e o faturamento e so o da concluida.
--   * LUCRO SO DO DONO: a checagem vive DENTRO da funcao (spec 7.4), e nao so na
--     RLS — o atendente que chama a funcao direto leva a mensagem.
--   * EQUIVALENCIA: o faturamento do periodo e o mesmo numero que a soma de
--     `vendas.total` das concluidas do periodo, por outro caminho (criterio da
--     spec 13: "batem com o PDV").
--
-- As quatro vendas usam `criado_em` EXPLICITO e no passado, e todo recorte e por
-- dia/data e por produto proprios: o banco e o de PRODUCAO, e somar a tabela
-- inteira mediria a farmacia, nao a funcao (padrao de 040_views.sql).
--
-- ATENCAO ao que este caso NAO prova: o criterio "os 3 dias de venda real
-- conferidos" depende de venda real no banco (hoje 0 vendas) e fica aberto no
-- PROGRESSO.md — o que se prova aqui e a equivalencia por SQL, dentro da
-- transacao do caso.

do $$
declare
  v_dono       uuid;
  v_atendente  uuid;
  v_caixa      uuid;
  v_chave      uuid;
  v_p_a        uuid;
  v_p_b        uuid;
  v_p_c        uuid;
  v_p_canc     uuid;
  v_a          uuid;
  v_b          uuid;
  v_c          uuid;
  v_d          uuid;
  v_canc       uuid;
  v_canc2      uuid;
begin
  -- ================= cenario =================
  -- Dono e atendente: o segundo existe para provar que o lucro e do dono.
  v_dono := criar_usuario_teste(gen_random_uuid(), 'relatorios@farmacia.local');
  v_atendente := criar_usuario_teste(gen_random_uuid(), 'relatorios-atendente@farmacia.local', 'atendente');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- O caixa e criado direto pela fixture (sem abrir_caixa): registrar_venda exige
  -- um caixa aberto, e a fixture respeita o terminal 'balcao'.
  v_caixa := criar_caixa_aberto(v_dono);

  -- Precos e custos conhecidos — e deles que saem TODOS os numeros esperados.
  -- PRODUTO A existe nos DOIS dias de proposito: e o que prova que o ranking
  -- soma os dias (2 do dia 15 + 1 do dia 16). PRODUTO C e o de MAIOR total e
  -- MENOR quantidade, para o ranking ter de ser provado por quantidade.
  v_p_a := criar_produto('PRODUTO A', 300, 100);   -- 2x no dia 15 + 1x no dia 16
  v_p_b := criar_produto('PRODUTO B', 450, 100);   -- 1x no dia 16 (o 3o lugar do ranking)
  v_p_c := criar_produto('PRODUTO C', 2400, 100);  -- 1x no dia 16 (caro, pouca quantidade)
  v_p_canc := criar_produto('PRODUTO CANCELADO', 5000, 100);
  update produtos set preco_custo = 100 where id = v_p_a;
  update produtos set preco_custo = 300 where id = v_p_b;
  update produtos set preco_custo = 500 where id = v_p_c;
  update produtos set preco_custo = 2000 where id = v_p_canc;

  -- ---- venda A: 2x PRODUTO A, as 22h de 15/01 em SP (01:00 UTC de 16/01) ----
  -- E a venda da virada de data do Review Focus 2: em UTC ela e do dia 16, e no
  -- fuso de Sao Paulo e do dia 15.
  v_chave := gen_random_uuid();
  v_a := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_a, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 600)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-01-16 01:00:00+00' where id = v_a;

  -- ---- venda B: 1x A + 1x C, dinheiro + pix, ao meio-dia de 16/01 em SP ----
  -- Pagamento dividido e duas formas: e o que prova a contagem por forma.
  v_chave := gen_random_uuid();
  v_b := (registrar_venda(v_chave, null,
    jsonb_build_array(
      jsonb_build_object('produto_id', v_p_a, 'quantidade', 1),
      jsonb_build_object('produto_id', v_p_c, 'quantidade', 1)),
    jsonb_build_array(
      jsonb_build_object('forma', 'dinheiro', 'valor', 1700),
      jsonb_build_object('forma', 'pix', 'valor', 1000)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-01-16 15:00:00+00' where id = v_b;

  -- ---- venda D: 1x PRODUTO B no mesmo dia 16/01 ----
  -- Ela existe para o dia 16 ter DUAS vendas e o dia 15 ter UMA: sem essa
  -- diferenca de volumes, ticket medio do periodo e media das medias diarias
  -- dariam o mesmo numero e o caso 1 nao provaria nada. O PRODUTO B so aparece
  -- aqui, entao ele tambem da ao ranking um terceiro lugar com quantidade 1.
  v_chave := gen_random_uuid();
  v_d := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_b, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 450)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-01-16 15:00:00+00' where id = v_d;

  -- ---- venda C: CONCLUIDA e FORA do periodo (12h de 17/01 em SP) ----
  -- Com o PRODUTO C, que tambem aparece numa venda do periodo (a B): assim o
  -- recorte de data e provado por produto e nao por "produto que so existe fora".
  v_chave := gen_random_uuid();
  v_c := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_c, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 2400)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-01-17 15:00:00+00' where id = v_c;

  -- ---- venda cancelada 1: 1x PRODUTO CANCELADO no dia 15/01 ----
  -- No MESMO dia de uma venda concluida, de proposito: assim um filtro de status
  -- furado muda o faturamento do dia 15 em vez de deixar o numero igual por
  -- coincidencia.
  v_chave := gen_random_uuid();
  v_canc := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_canc, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 5000)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-01-15 15:00:00+00' where id = v_canc;
  perform cancelar_venda(v_canc, 'cancelada de proposito no cenario do relatorio');

  -- ---- venda cancelada 2: no dia 18/01, que fica com UMA venda e so ela ----
  -- O dia 18/01 e o unico do cenario com uma venda SO e ela cancelada: e o dia que
  -- prova o filtro de status no nivel do dia (existe linha no banco naquele dia, e
  -- o relatorio devolve zeros mesmo assim; sem o filtro seriam 5000 em 1 venda).
  -- OBSERVACAO registrada de proposito: "nenhuma venda concluida" e "nenhuma venda"
  -- devolvem a MESMA coisa (uma linha de zeros), porque uma agregacao em SQL sempre
  -- devolve uma linha. Quem precisa distinguir os dois casos e a tela, e ela tem o
  -- periodo escolhido — o banco nao inventa uma linha a mais para dizer "vazio".
  v_chave := gen_random_uuid();
  v_canc2 := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_canc, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 5000)),
    0)->>'id')::uuid;
  update vendas set criado_em = timestamptz '2026-01-18 15:00:00+00' where id = v_canc2;
  perform cancelar_venda(v_canc2, 'cancelada de proposito no cenario do relatorio');

  -- ================= caso 1: o resumo do periodo =================
  -- Dia 15: 600 (1 venda). Dia 16: 2700 + 450 = 3150 (2 vendas).
  -- Periodo: 3750 em 3 vendas -> 1250. A media das medias diarias daria 1088.
  perform teste_ok((select faturamento = 3750 and vendas = 3 and ticket_medio = 1250
                      from relatorio_resumo(date '2026-01-15', date '2026-01-16')),
    'caso 1: ticket medio do periodo e total/quantidade (3750/3 = 1250), nao a media das medias dos dias (1875)');
  -- O MESMO periodo por outro angulo: a media das medias diarias, calculada aqui
  -- em cima de v_vendas_dia, da 1088 — um numero DIFERENTE do ticket medio da
  -- funcao (1250). Esta assercao existe para o cenario nao poder ser afrouxado
  -- sem que alguem veja: e ela que garante que o caso 1 acima distingue as duas
  -- contas. Num cenario com o mesmo numero de vendas por dia, 1088 seria 1250 e a
  -- assercao ficaria vermelha.
  perform teste_ok(
    (select round(avg(ticket_medio)) from v_vendas_dia
      where dia between date '2026-01-15' and date '2026-01-16') = 1088
    and (select ticket_medio from relatorio_resumo(date '2026-01-15', date '2026-01-16')) = 1250
    and (select round(avg(ticket_medio)) from v_vendas_dia
          where dia between date '2026-01-15' and date '2026-01-16')
        <> (select ticket_medio from relatorio_resumo(date '2026-01-15', date '2026-01-16')),
    'caso 1: a media das medias dos dias (1088) e um numero diferente do ticket medio do periodo (1250)');
  perform teste_ok((select ticket_medio = 0 and faturamento = 0 and vendas = 0
                      from relatorio_resumo(date '2026-01-01', date '2026-01-02')),
    'caso 1: periodo sem venda devolve zero, e nao divisao por zero');
  -- Nulo e invertido nao podem estourar (a tela valida antes; o banco nao quebra).
  perform teste_ok((select faturamento = 0 and vendas = 0 and ticket_medio = 0
                      from relatorio_resumo(null, null)),
    'caso 1: periodo nulo devolve zeros em vez de erro');
  perform teste_ok((select faturamento = 0 and vendas = 0 and ticket_medio = 0
                      from relatorio_resumo(date '2026-01-16', date '2026-01-15')),
    'caso 1: periodo invertido devolve zeros em vez de erro');

  -- ================= caso 2: fuso de Sao Paulo e venda cancelada =================
  -- A venda das 22h de 15/01 (01:00 UTC de 16/01) e a cancelada das 12h de 15/01
  -- estao as duas no dia 15: o faturamento do dia e 600 (so a concluida), em UMA
  -- venda. O dia 15 e o unico dia do cenario com o par concluida + cancelada.
  perform teste_ok((select faturamento = 600 and vendas = 1 and ticket_medio = 600
                      from relatorio_resumo(date '2026-01-15', date '2026-01-15')),
    'caso 2: a venda das 22h de 15/01 conta no dia 15 (SP), e a cancelada do mesmo dia nao entra');
  -- O dia 16 em UTC receberia a venda A; em SP ela e do dia 15. Sem a expressao
  -- de fuso, este dia teria 2400 + 3150 = 5550 em 3 vendas.
  perform teste_ok((select faturamento = 3150 and vendas = 2
                      from relatorio_resumo(date '2026-01-16', date '2026-01-16')),
    'caso 2: o dia 16/01 tem as duas vendas do dia (3150) e nao recebe a venda da virada');
  -- O dia 17/01 tem a venda C, CONCLUIDA e FORA do periodo: o recorte de data nao
  -- pode esconder venda concluida de outro dia (nem trazer de volta a de dentro).
  perform teste_ok((select faturamento = 2400 and vendas = 1 and ticket_medio = 2400
                      from relatorio_resumo(date '2026-01-17', date '2026-01-17')),
    'caso 2: o dia 17/01 tem a propria venda concluida (2400), e nao a do periodo');
  -- O dia 18/01 tem UMA venda no banco — cancelada. O relatorio devolve zeros: e o
  -- filtro de status no nivel do dia (sem ele seriam 5000 em 1 venda).
  perform teste_ok((select faturamento = 0 and vendas = 0 and ticket_medio = 0
                      from relatorio_resumo(date '2026-01-18', date '2026-01-18')),
    'caso 2: o dia que so tem venda cancelada fatura zero, em zero vendas');
  -- E o periodo que as incluiria tambem nao as conta: 15/01 a 18/01 tem QUATRO
  -- vendas concluidas (3750 do periodo + 2400 da venda C = 6150) e NAO as duas
  -- canceladas (que somariam 10000 a mais em 2 vendas a mais).
  perform teste_ok((select faturamento = 6150 and vendas = 4
                      from relatorio_resumo(date '2026-01-15', date '2026-01-18')),
    'caso 2: esticar o periodo ate 18/01 soma a do dia 17 e nenhuma das duas canceladas');
  -- A soma das formas do MESMO periodo largo: 3750 + 2400 = 6150 (as canceladas
  -- nao entram nem por aqui).
  perform teste_ok((select sum(total) = 6150 from relatorio_formas_pagamento(date '2026-01-15', date '2026-01-18')),
    'caso 2: as formas do periodo largo somam 6150, sem as canceladas');

  -- ================= caso 3: lucro = receita - custo (e so o dono le) =================
  -- Os valores esperados saem do CENARIO deste arquivo: 2x A e 1x A com custo 100,
  -- 1x B com custo 300 e 1x C com custo 500.
  -- Receita 600 + 2700 + 450 = 3750; custo 200 + 100 + 300 + 500 = 1100.
  perform teste_ok((select receita = 3750 and custo = 1100 and lucro = 2650
                      from relatorio_lucro(date '2026-01-15', date '2026-01-16')),
    'caso 3: lucro = receita - custo no periodo (3750 - 1100 = 2650)');
  -- A receita do lucro e a MESMA do resumo: e o que amarra as duas funcoes ao
  -- mesmo numero (o total da venda e a soma dos itens).
  perform teste_ok((select receita = faturamento
                      from relatorio_lucro(date '2026-01-15', date '2026-01-16') l,
                           relatorio_resumo(date '2026-01-15', date '2026-01-16') r),
    'caso 3: a receita do lucro bate com o faturamento do resumo no mesmo periodo');
  -- O dia 15 tem UMA venda concluida (2x A, custo 100 cada) e A CANCELADA (1x
  -- PRODUTO CANCELADO, custo 2000). Se o status vazasse para o lucro, o custo do
  -- dia sairia de 200 para 2200.
  perform teste_ok((select receita = 600 and custo = 200 and lucro = 400
                      from relatorio_lucro(date '2026-01-15', date '2026-01-15')),
    'caso 3: o dia da venda cancelada tem o lucro so da venda concluida (400)');
  -- Nulo e invertido: zeros, nunca erro.
  perform teste_ok((select receita = 0 and custo = 0 and lucro = 0
                      from relatorio_lucro(null, null)),
    'caso 3: periodo nulo devolve zeros em vez de erro');
  perform teste_ok((select receita = 0 and custo = 0 and lucro = 0
                      from relatorio_lucro(date '2026-01-16', date '2026-01-15')),
    'caso 3: periodo invertido devolve zeros em vez de erro');

  -- O atendente chamando a funcao DIRETO leva a mensagem: a guarda e da funcao,
  -- e nao da RLS nem da tela (spec 7.4). O mesmo periodo que o dono acabou de ler.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  perform teste_erro($sql$select * from relatorio_lucro(date '2026-01-15', date '2026-01-16')$sql$,
    'Só o dono vê o lucro', 'caso 3: atendente chamando a funcao direto nao le o lucro');
  -- E o atendente LE o resto do relatorio: a recusa e do lucro, nao do relatorio.
  perform teste_ok((select faturamento = 3750 from relatorio_resumo(date '2026-01-15', date '2026-01-16')),
    'caso 3: o atendente continua lendo o resumo do periodo');
  -- Volta para o dono: `request.jwt.claims` e do CONNECTION e continua valendo nas
  -- assercoes seguintes. Sem isto, o `relatorio_lucro` das proximas linhas estoura.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- ================= caso 4: formas de pagamento do periodo =================
  -- No periodo: dinheiro 600 + 1700 + 450 = 2750 em 3 pagamentos; pix 1000 em 1.
  perform teste_ok((select count(*) = 2 from relatorio_formas_pagamento(date '2026-01-15', date '2026-01-16')),
    'caso 4: o periodo tem as duas formas usadas, e so elas');
  perform teste_ok((select forma = 'dinheiro' and quantidade = 3 and total = 2750
                      from relatorio_formas_pagamento(date '2026-01-15', date '2026-01-16') limit 1),
    'caso 4: dinheiro aparece com 3 pagamentos e 2750');
  perform teste_ok((select forma = 'pix' and quantidade = 1 and total = 1000
                      from relatorio_formas_pagamento(date '2026-01-15', date '2026-01-16') offset 1 limit 1),
    'caso 4: a segunda linha e o pix, com 1 pagamento de 1000 (ordenado por total, maior primeiro)');
  -- A soma das formas e o faturamento do periodo: e a invariante que pega uma
  -- juncao furada (pagamento de venda cancelada, ou venda contada duas vezes).
  perform teste_ok((select sum(total) = 3750 from relatorio_formas_pagamento(date '2026-01-15', date '2026-01-16')),
    'caso 4: a soma das formas e o faturamento do periodo (2750 + 1000 = 3750)');
  -- No dia 16/01: dinheiro 1700 + 450 = 2150 em 2 pagamentos e pix 1000 em 1; a
  -- soma e o faturamento do dia (3150). Este e o recorte que prova que a funcao
  -- respeita o dia de cada pagamento, e nao o periodo inteiro.
  perform teste_ok((select sum(total) = 3150 from relatorio_formas_pagamento(date '2026-01-16', date '2026-01-16')),
    'caso 4: as formas do dia 16/01 somam o total vendido no dia (2150 + 1000)');
  perform teste_ok((select quantidade = 2 and total = 2150
                      from relatorio_formas_pagamento(date '2026-01-16', date '2026-01-16') limit 1),
    'caso 4: no dia 16/01 o dinheiro tem 2 pagamentos e 2150');
  -- O dia 18/01 tem UMA venda no banco, CANCELADA: ela nao pode aparecer como
  -- forma de pagamento nenhuma (a venda de 5000 em dinheiro).
  perform teste_ok((select count(*) = 0 from relatorio_formas_pagamento(date '2026-01-18', date '2026-01-18')),
    'caso 4: o dia que so tem venda cancelada nao tem forma nenhuma');
  perform teste_ok((select count(*) = 0 from relatorio_formas_pagamento(date '2026-01-19', date '2026-01-20')),
    'caso 4: periodo sem venda devolve lista vazia, e nao erro');

  -- ================= caso 5: mais vendidos do periodo =================
  -- PRODUTO A: 2 (dia 15) + 1 (dia 16) = 3, total 900. PRODUTO C: 1, total 2400.
  -- PRODUTO B: 1, total 450. Ordena por QUANTIDADE, entao A (3) vem antes de C e B,
  -- apesar do total menor que o do C.
  perform teste_ok((select count(*) = 3 from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 10)),
    'caso 5: o ranking do periodo tem os tres produtos vendidos');
  perform teste_ok((select produto_id = v_p_a and nome = 'PRODUTO A' and quantidade = 3 and total = 900
                      from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 10) limit 1),
    'caso 5: o ranking soma os dias do mesmo produto (2 do dia 15 + 1 do dia 16 = 3)');
  perform teste_ok((select produto_id = v_p_c and quantidade = 1 and total = 2400
                      from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 10) offset 1 limit 1),
    'caso 5: o segundo colocado e o produto de maior total e menor quantidade (quantidade manda)');
  perform teste_ok((select produto_id = v_p_b and quantidade = 1 and total = 450
                      from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 10) offset 2 limit 1),
    'caso 5: o terceiro colocado e o produto do dia 16');
  -- O limite corta a lista.
  perform teste_ok((select count(*) = 1 from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 1)),
    'caso 5: o limite do ranking corta a lista em 1');
  perform teste_ok((select quantidade = 3 from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 1)),
    'caso 5: com limite 1 fica o lider por quantidade');
  -- Limite nulo cai no padrao de 10 (o que a tela manda quando nao escolhe).
  perform teste_ok((select count(*) = 3 from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', null)),
    'caso 5: limite nulo usa o padrao de 10 e nao corta os tres produtos');
  -- O dia 18/01 so tem a venda cancelada: ranking vazio. E o mesmo vale para o
  -- periodo 15-16, que nao pode ganhar unidade da cancelada do dia 15 nem da
  -- venda C (que e do dia 17): o total de unidades do periodo e 5 (3 do A + 1 do C
  -- + 1 do B) — se a venda C entrasse, seriam 6 e o C apareceria com 2.
  perform teste_ok((select count(*) = 0 from relatorio_mais_vendidos(date '2026-01-18', date '2026-01-18', 10)),
    'caso 5: o dia 18/01, que so tem venda cancelada, nao aparece no ranking');
  perform teste_ok((select coalesce(sum(quantidade), 0) = 5 and coalesce(sum(total), 0) = 3750
                      from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 10)),
    'caso 5: o ranking do periodo soma 5 unidades e 3750, sem a venda de fora');
  perform teste_ok((select count(*) = 0 from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 10)
                      where produto_id = v_p_canc),
    'caso 5: o produto da venda cancelada nao aparece no ranking do periodo');

  -- ================= caso 6: equivalencia com a soma das vendas =================
  -- O numero do relatorio e o mesmo que a soma das vendas concluidas do periodo,
  -- por outro caminho (e o criterio da spec 13: "batem com o PDV").
  perform teste_ok((
    select (select faturamento from relatorio_resumo(date '2026-01-15', date '2026-01-16'))
         = (select coalesce(sum(total), 0) from vendas
              where status = 'concluida'
                and (criado_em at time zone 'America/Sao_Paulo')::date
                    between date '2026-01-15' and date '2026-01-16')
  ), 'caso 6: o faturamento do periodo bate com a soma das vendas concluidas do periodo');
  -- A mesma equivalencia pelo caminho dos itens: a soma dos itens e a soma dos
  -- totais das vendas no periodo (as duas tabelas contam a mesma historia).
  perform teste_ok((
    select (select coalesce(sum(i.total), 0) from venda_itens i
              join vendas v on v.id = i.venda_id
             where v.status = 'concluida'
               and (v.criado_em at time zone 'America/Sao_Paulo')::date
                   between date '2026-01-15' and date '2026-01-16')
         = (select receita from relatorio_lucro(date '2026-01-15', date '2026-01-16'))
  ), 'caso 6: a receita do lucro e a soma dos itens das vendas concluidas do periodo');
  -- E a contagem de vendas bate com a contagem da tabela no mesmo recorte.
  perform teste_ok((
    select (select vendas from relatorio_resumo(date '2026-01-15', date '2026-01-16'))
         = (select count(*) from vendas
              where status = 'concluida'
                and (criado_em at time zone 'America/Sao_Paulo')::date
                    between date '2026-01-15' and date '2026-01-16')
  ), 'caso 6: a contagem de vendas do periodo bate com a contagem da tabela');

  -- ================= permissoes (padrao das RPCs do projeto) =================
  -- A chave publica nao le o relatorio: mesma correcao de classe da migration 013.
  perform teste_ok(not has_function_privilege('anon', 'relatorio_resumo(date,date)', 'execute'),
    'permissoes: anon NAO executa relatorio_resumo');
  perform teste_ok(not has_function_privilege('anon', 'relatorio_lucro(date,date)', 'execute'),
    'permissoes: anon NAO executa relatorio_lucro');
  perform teste_ok(not has_function_privilege('anon', 'relatorio_formas_pagamento(date,date)', 'execute'),
    'permissoes: anon NAO executa relatorio_formas_pagamento');
  perform teste_ok(not has_function_privilege('anon', 'relatorio_mais_vendidos(date,date,integer)', 'execute'),
    'permissoes: anon NAO executa relatorio_mais_vendidos');
  perform teste_ok(has_function_privilege('authenticated', 'relatorio_resumo(date,date)', 'execute')
                   and has_function_privilege('authenticated', 'relatorio_lucro(date,date)', 'execute')
                   and has_function_privilege('authenticated', 'relatorio_formas_pagamento(date,date)', 'execute')
                   and has_function_privilege('authenticated', 'relatorio_mais_vendidos(date,date,integer)', 'execute'),
    'permissoes: authenticated executa as quatro funcoes do relatorio');

  -- As quatro sao `security invoker`: a RLS continua valendo para quem chama, que
  -- e o oposto do `security definer` (mesmo espirito da migration 013 nas views).
  perform teste_ok(not (select prosecdef from pg_proc where oid = 'relatorio_resumo(date,date)'::regprocedure)
                   and not (select prosecdef from pg_proc where oid = 'relatorio_lucro(date,date)'::regprocedure)
                   and not (select prosecdef from pg_proc where oid = 'relatorio_formas_pagamento(date,date)'::regprocedure)
                   and not (select prosecdef from pg_proc where oid = 'relatorio_mais_vendidos(date,date,integer)'::regprocedure),
    'seguranca: as quatro funcoes NAO sao security definer (a RLS de quem chama vale)');

  -- ================= a chave publica nao LE o relatorio =================
  -- `has_function_privilege` olha o catalogo; isto TROCA DE ROLE e tenta ler de
  -- verdade, como 050_permissoes.sql faz. O bloco e escrito a mao (e nao com
  -- teste_erro) porque o Postgres proibe `set role` dentro de funcao security
  -- definer — e teste_erro e definer.
  execute 'set local role anon';
  begin
    perform (select count(*) from relatorio_resumo(date '2026-01-15', date '2026-01-16'));
    perform teste_ok(false, 'anon NAO le o relatorio pela funcao (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0,
      'anon NAO le o relatorio (a recusa e de permissao, veio: ' || sqlerrm || ')');
  end;
  begin
    perform (select count(*) from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 10));
    perform teste_ok(false, 'anon NAO le o ranking pela funcao (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0,
      'anon NAO le o ranking (a recusa e de permissao, veio: ' || sqlerrm || ')');
  end;
  execute 'reset role';
end $$;
