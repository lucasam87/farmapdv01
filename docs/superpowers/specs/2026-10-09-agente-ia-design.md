# Agente gerencial de IA — desenho da Etapa 8

Data: 09/10/2026  
Status: desenho aprovado pelo Lucas nas seções de segurança, custo, respostas e acesso. A spec ainda precisa da revisão final dele antes de virar plano.

## Objetivo

Adicionar `/agente` ao sistema da farmácia como uma interface em português para quatro consultas gerenciais de leitura. O agente usa DeepSeek para classificar uma pergunta em uma consulta permitida; o servidor lê as views com a sessão Supabase do usuário e monta a resposta. O modelo nunca recebe linhas do banco e nunca escreve no banco.

O agente é acessível a perfis ativos `dono` e `atendente`. Não expõe lucro, custo, nomes, telefones, saldos ou outros dados de clientes.

## Perguntas permitidas

| Intenção | Exemplo | Fonte | Limite |
|---|---|---|---|
| Vendas por dia | “Como foram as vendas de hoje?” | `v_vendas_dia` | Hoje por padrão; intervalo explícito de até 31 dias |
| Mais vendidos | “Quais produtos mais venderam?” | `v_mais_vendidos` | 10 produtos; acumulado histórico da view |
| Estoque baixo | “O que preciso repor?” | `v_estoque_baixo` | 10 produtos, na ordem da view |
| Produtos parados | “Quais produtos estão parados?” | `v_estoque_parado` | 10 produtos; a view define parado como sem venda por 60 dias ou mais |

A resposta de vendas mostra dia, quantidade, total e ticket médio que já vêm agregados na view. Valores monetários continuam em centavos até serem apresentados por `lib/format.ts`. As demais respostas mostram apenas nome e quantidade de estoque, ou nome e quantidade vendida. Resultado vazio recebe mensagem fixa em português.

As views de mais vendidos, estoque baixo e estoque parado não aceitam período. Se a pergunta exigir um período para essas três intenções, o classificador retorna `fora_escopo` em vez de fingir que a view filtra datas.

## Fluxo e componentes

1. A tela `/agente` permite uma pergunta de até 500 caracteres e oferece um exemplo clicável para cada intenção. Não há histórico persistido; cada envio é independente.
2. `POST /api/agente` exige sessão Supabase e perfil ativo. Sem sessão ou perfil, encerra antes de chamar qualquer serviço externo.
3. Antes da chamada externa, a rota recusa localmente entradas reconhecidas como clínicas e padrões de CPF, telefone ou e-mail. O texto não é gravado em log nem em banco.
4. A rota envia o texto e um prompt fixo ao endpoint Chat Completions do DeepSeek, com o modelo `deepseek-flash` e saída JSON. O modelo pode retornar somente uma intenção dentre as quatro permitidas, `fora_escopo`, e datas para a consulta de vendas. O servidor valida estritamente a resposta, o período e o limite de resultados.
5. A rota consulta somente a view associada à intenção, usando `criarClienteServidor()` e o token da sessão. O limite de linhas é aplicado no servidor. Nenhuma query SQL livre, RPC de escrita, tabela de clientes, view de lucro ou view de histórico com dados de clientes fica disponível ao agente.
6. A resposta final é montada por código a partir dos campos permitidos. A resposta bruta do modelo não é mostrada ao usuário. Portanto o modelo não pode acrescentar conselho clínico, cálculos financeiros ou fatos que não vieram da view.

DeepSeek recebe o texto da pergunta para classificação, mas não recebe resultados de consultas, identificadores de usuário, cookies ou chaves Supabase. A interface orienta a não informar dados pessoais ou de saúde. Filtros locais bloqueiam CPF, telefone, e-mail e padrões clínicos conhecidos; nenhum filtro textual consegue reconhecer toda forma possível de dado pessoal ou de saúde.

## Integração com DeepSeek

- Usar `fetch` nativo do servidor para `https://api.deepseek.com/chat/completions`; não instalar SDK.
- A chave `DEEPSEEK_API_KEY` existe somente no ambiente do servidor. Nunca usar prefixo `NEXT_PUBLIC_`.
- Usar `deepseek-flash`; limitar a pergunta a 500 caracteres, o payload de mensagens a 4.096 bytes e a saída a 120 tokens; exigir JSON. Validar enumeração, datas, intervalo e propriedades antes de consultar o banco.
- Se a saída não for JSON válido, contiver intenção desconhecida ou período inválido, retornar recusa/solicitação fixa; nunca interpretar texto livre do modelo como instrução SQL ou argumento não validado.
- Não usar streaming. Não armazenar prompt, classificação ou resposta além da memória da requisição/tela aberta.

Referências oficiais consultadas em 09/10/2026: [Chat Completions e JSON mode](https://api-docs.deepseek.com/api/create-chat-completion/), [modelos e preços](https://api-docs.deepseek.com/quick_start/pricing/). A API cobra por tokens e devolve uso de entrada/saída. O preço pode mudar; a configuração de custo deve acompanhar a tabela oficial antes de alterar o modelo ou publicar uma mudança de preço.

## Teto mensal de custo

O teto escolhido é **US$ 5 por mês**, aplicado pelo próprio sistema. O mês de controle segue o calendário de São Paulo, sem rollover. O uso é mantido em micros de dólar (inteiros), evitando ponto flutuante.

Adicionar uma tabela de orçamento mensal e uma tabela de reservas, ambas com RLS ativado e sem acesso de `anon` ou `authenticated`. A rota usa uma instância Supabase privilegiada somente para o orçamento; as leituras de negócio continuam sempre na instância vinculada à sessão do usuário. Uma função transacional reserva e reconcilia valores com bloqueio da linha do mês para não permitir que requisições concorrentes ultrapassem o teto.

O servidor reserva antes da chamada o custo máximo permitido pelos limites de tamanho e tokens, calculado com os preços de pico do modelo configurado: 4.096 tokens de entrada e 120 de saída. Na tabela oficial consultada em 09/10/2026, o preço de pico de `deepseek-flash` é US$ 0,30 por milhão de tokens de entrada sem cache e US$ 1,20 por milhão de saída. A reserva inicial é arredondada para cima a **1.373 micros de dólar por chamada**. Após resposta com `usage`, liquida pelo custo real calculado com as mesmas tarifas máximas. Erros comprovadamente anteriores à chamada liberam a reserva. Se a conexão cair depois do envio e o custo for desconhecido, a reserva máxima permanece consumida até o fim do mês para não abrir espaço que possa ter sido faturado. Ao atingir o teto, nenhuma nova chamada é enviada ao DeepSeek até o próximo mês.

As tabelas de orçamento ficam protegidas para escrita/leitura apenas pela role `service_role`. Funções de orçamento usam `SECURITY INVOKER`, nomes de objetos qualificados e execução concedida apenas a `service_role`; `anon`, `authenticated` e `PUBLIC` não podem consultar nem alterar o contador. `SUPABASE_SERVICE_ROLE_KEY` fica exclusivamente no servidor e é usada somente por essas funções de orçamento, nunca pelas consultas às views. A chave não existe hoje no ambiente local e deve ser adicionada fora do chat antes do teste integrado real.

Risco documentado: o teto interno depende do preço configurado e dos limites de tokens. Uma alteração de preço pelo provedor precisa atualizar o valor de reserva antes da próxima publicação. O saldo do provedor pode servir como proteção operacional adicional, mas não substitui o limite mensal do sistema.

## Limites, mensagens e falhas

- Pergunta clínica reconhecida localmente: recusa fixa, sem chamada DeepSeek.
- Classificação `fora_escopo`: a pergunta já foi enviada ao DeepSeek para classificação; a rota responde com recusa fixa e não consulta view alguma.
- CPF, telefone ou e-mail reconhecido: aviso para remover o dado, sem chamada DeepSeek.
- Sem sessão: resposta de autenticação apropriada; perfil ausente/inativo: acesso negado. Não chamar o provedor.
- Orçamento esgotado: informar em português que o limite mensal do assistente foi atingido.
- DeepSeek indisponível, limite de requisições, saída inválida ou falha de leitura: mensagem curta em português, sem expor detalhes técnicos, chaves, prompt ou linhas do banco.
- Não registrar perguntas ou respostas em logs do servidor.

## Verificação e aceite

### Testes unitários

- Classificação JSON válida para cada intenção permitida e `fora_escopo`.
- Rejeição de JSON inválido, propriedades inesperadas, data inválida, intervalo invertido ou acima de 31 dias, e limite maior que 10.
- Recusa local de padrões clínicos e CPF/telefone/e-mail, antes de qualquer chamada ao provedor.
- Formatação das quatro respostas a partir de dados de entrada conhecidos; moeda somente via `lib/format.ts`.
- Reserva em micros de dólar, reconciliação com `usage`, liberação de falha pré-envio e retenção em falha ambígua.

### Testes SQL

- RLS habilitada nas tabelas de orçamento.
- `anon` e `authenticated` não leem nem alteram orçamento e não executam funções de reserva/liquidação.
- `service_role` consegue reservar, reconciliar e liberar uma reserva.
- Reservas simultâneas não ultrapassam US$ 5; orçamento esgotado recusa nova reserva.
- Valores de orçamento e fixtures limitados a registros próprios do teste; nenhuma asserção conta tabelas reais inteiras.

### Testes E2E

- Perfil dono e atendente acessam `/agente`; sem sessão/perfil, nenhuma chamada externa ocorre.
- Uma pergunta de cada uma das quatro intenções mostra dados corretos da view e resposta montada pelo servidor.
- Pergunta clínica reconhecida localmente e pergunta contendo CPF/telefone/e-mail não chamam DeepSeek nem consultam views. Pergunta `fora_escopo` chama o classificador DeepSeek, mas não consulta views.
- Limite mensal esgotado bloqueia a chamada; falha do provedor mostra mensagem em português.
- Asserções verificam que a rota nunca envia linhas de dados do banco ao DeepSeek e não mostra resposta bruta do modelo.

O ambiente atual não tem `DEEPSEEK_API_KEY` nem `SUPABASE_SERVICE_ROLE_KEY`. Testes unitários e SQL podem validar as fronteiras sem API paga; o E2E contra DeepSeek real depende de o Lucas configurar essas duas chaves localmente. Não pedir nem registrar valores dessas chaves no chat.

## Fora do escopo

- Escrita no banco, ações na farmácia, SQL livre, consultas de cliente/crediário, custo/lucro, aconselhamento médico, memória persistida, streaming, anexos e publicação na Vercel.
- A pergunta clínica é recusada pelo agente; isso não substitui orientação de profissional de saúde.

## Aprovações necessárias depois deste desenho

O desenho foi aprovado em seções pelo Lucas. O próximo gate é ele revisar este arquivo final. Depois da aprovação da spec, escrever o plano da Etapa 8 e pedir aprovação do plano e do modo de execução antes de implementar.
