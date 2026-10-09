import { LIMITE_PERGUNTA } from './logica'
import { FormularioAgente } from './formulario'

// A tela `/agente` da etapa 8 (spec, "Fluxo e componentes" 1). Server Component:
// a pagina so monta o texto fixo e entrega o formulario ao cliente.
//
// POR QUE ESTA PAGINA NAO CONSULTA O PERFIL: a sessao e o perfil ativo ja sao
// garantidos pelo layout de `(app)`, que devolve a tela de "sem perfil" para quem
// tem sessao sem linha em `perfis` (`app/(app)/layout.tsx:28`) — e o `proxy` barra
// quem nao tem sessao. Chamar `perfilAtual()` aqui seria uma ida ao Auth a mais por
// navegacao sem mudar nada nesta tela: `dono` e `atendente` veem exatamente o
// mesmo agente (spec, "Objetivo").
//
// O limite de 500 caracteres entra como PROP, vindo de `logica.ts` — a MESMA
// constante que a rota usa. Assim o numero tem uma fonte so e o modulo de decisao
// (regex de triagem, montagem de resposta) nao vai para o pacote do navegador.

export default function AgentePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-800">Agente</h1>
      <p className="mt-1 text-base text-slate-500">
        Pergunte sobre vendas e estoque da farmácia. O assistente consulta os dados do sistema e
        monta a resposta.
      </p>

      {/* Requisito explicito da spec ("Fluxo e componentes", paragrafo seguinte ao
          6; e "Limites, mensagens e falhas"): a interface ORIENTA o usuario a nao
          informar dado pessoal nem de saude. Nenhum filtro textual reconhece toda
          forma possivel, entao o aviso na tela e parte da defesa, nao enfeite. */}
      <section
        data-testid="orientacao-privacidade"
        className="mt-6 rounded-2xl bg-amber-50 p-5 text-base text-amber-900"
      >
        <h2 className="text-lg font-semibold">Não escreva dados pessoais nem de saúde</h2>
        <p className="mt-2">
          Nada de CPF, telefone, e-mail, sintomas, nome de remédio, dose ou tratamento. A pergunta é
          enviada a um serviço de inteligência artificial apenas para ser classificada, e o
          assistente responde só sobre vendas e estoque: ele não dá orientação de saúde nem
          substitui um médico ou farmacêutico.
        </p>
      </section>

      <FormularioAgente limite={LIMITE_PERGUNTA} />
    </div>
  )
}
