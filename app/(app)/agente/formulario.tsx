'use client'

import { useState, type FormEvent } from 'react'
import { ERRO_REDE, lerRespostaAgente } from './resposta'

// A tela do agente gerencial da etapa 8 (spec, "Fluxo e componentes" 1): UMA
// pergunta de ate `limite` caracteres, um exemplo clicavel por intencao, a
// resposta e o erro — tudo em portugues. Client component porque tem estado e
// evento; a pagina (`page.tsx`) fica no servidor.
//
// O QUE ESTA TELA NUNCA FAZ:
//   - mostrar a saida bruta do modelo, o prompt, nome de view, codigo de erro
//     tecnico, chave ou qualquer detalhe interno: o texto exibido e SEMPRE o campo
//     `resposta` ou o campo `erro` que a rota montou (R6). O cliente NAO reescreve
//     nem traduz mensagem do servidor — se a resposta chega vazia ou fora do
//     contrato, a tela diz apenas que algo saiu do esperado;
//   - guardar historico: nao ha lista de perguntas anteriores, nao ha
//     `localStorage` e a pergunta anterior nunca e reenviada (a spec proibe
//     memoria persistida). Cada envio e independente.
//
// A traducao da resposta HTTP para o que a tela mostra mora em `resposta.ts`
// (modulo puro, testado por `resposta.test.ts`): assim a regra "nunca tela em
// branco, nunca saida crua" tem teste, sem precisar de jsdom.

// Um exemplo por intencao permitida (spec, "Perguntas permitidas"), escritos como
// pergunta de verdade. Clicar PREENCHE o campo e NAO envia: quem envia e o botao,
// e assim o E2E da Tarefa 5 consegue conferir o texto antes de perguntar.
const EXEMPLOS = [
  { testId: 'exemplo-vendas-dia', pergunta: 'Como foram as vendas de hoje?' },
  { testId: 'exemplo-mais-vendidos', pergunta: 'Quais produtos mais venderam?' },
  { testId: 'exemplo-estoque-baixo', pergunta: 'O que preciso repor?' },
  { testId: 'exemplo-estoque-parado', pergunta: 'Quais produtos estão parados?' },
] as const

const CAMPO =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500'

export function FormularioAgente({ limite }: { limite: number }) {
  const [pergunta, setPergunta] = useState('')
  const [resposta, setResposta] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  // A resposta/erro anterior sai da tela quando o TEXTO da pergunta muda: o que
  // fica visivel tem de ser a resposta da pergunta que esta no campo. Sem isso, o
  // atendente trocaria a pergunta e continuaria lendo a resposta da anterior.
  function mudarPergunta(texto: string) {
    setPergunta(texto)
    setResposta(null)
    setErro(null)
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    // O botao ja fica desabilitado durante a consulta; a guarda fecha o caso de
    // um segundo Enter antes do render do estado de carregamento.
    if (carregando) return

    setCarregando(true)
    setResposta(null)
    setErro(null)

    try {
      const http = await fetch('/api/agente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // O campo vai como esta: quem apara, limita e triagem e o servidor
        // (`validarPergunta`). O cliente nao tem uma segunda regra para divergir.
        body: JSON.stringify({ pergunta }),
      })

      // Corpo que nao e JSON nao pode virar excecao: vira `null` e a leitura o
      // trata como corpo fora do contrato.
      const bruto: unknown = await http.json().catch(() => null)
      const resultado = lerRespostaAgente(http.ok, bruto)

      if (resultado.tipo === 'resposta') {
        setResposta(resultado.texto)
        return
      }
      setErro(resultado.texto)
    } catch {
      setErro(ERRO_REDE)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
      <label htmlFor="pergunta" className="block text-sm font-medium text-slate-700">
        Pergunta
      </label>
      <input
        id="pergunta"
        name="pergunta"
        type="text"
        maxLength={limite}
        autoComplete="off"
        value={pergunta}
        onChange={(evento) => mudarPergunta(evento.target.value)}
        placeholder="Ex.: como foram as vendas de hoje?"
        data-testid="pergunta"
        aria-describedby="pergunta-contador"
        className={CAMPO}
      />
      <p
        id="pergunta-contador"
        data-testid="contador-caracteres"
        className="mt-1 text-sm text-slate-500"
      >
        {pergunta.length} de {limite} caracteres
      </p>

      <section className="mt-4">
        <p className="text-sm text-slate-500">Exemplos (clique para preencher a pergunta):</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXEMPLOS.map((exemplo) => (
            <button
              key={exemplo.testId}
              type="button"
              data-testid={exemplo.testId}
              onClick={() => mudarPergunta(exemplo.pergunta)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-base text-slate-700 hover:bg-slate-100"
            >
              {exemplo.pergunta}
            </button>
          ))}
        </div>
      </section>

      <button
        type="submit"
        disabled={carregando}
        data-testid="enviar"
        className="mt-6 rounded-lg bg-slate-800 px-6 py-3 text-base font-medium text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {carregando ? 'Consultando…' : 'Perguntar'}
      </button>

      {/* Regiao de resultado PERSISTENTE: um `aria-live` que so nasce junto com o
          texto costuma nao ser anunciado pelo leitor de tela. Ela ja existe na
          pagina (vazia ou com a dica) e o texto entra nela. `aria-busy` marca a
          espera. */}
      <div
        role="status"
        aria-live="polite"
        aria-busy={carregando}
        data-testid="resultado-area"
        className="mt-5"
      >
        {carregando ? (
          <p data-testid="carregando" className="text-base text-slate-500">
            Consultando o assistente…
          </p>
        ) : null}
        {!carregando && resposta !== null ? (
          <p
            data-testid="resultado"
            className="whitespace-pre-line rounded-xl bg-emerald-50 px-4 py-3 text-base text-emerald-900"
          >
            {resposta}
          </p>
        ) : null}
        {!carregando && resposta === null && erro === null ? (
          <p data-testid="resultado-vazio" className="text-base text-slate-400">
            A resposta aparece aqui.
          </p>
        ) : null}
      </div>

      {/* Regiao de erro persistente, gemea da de cima: `role="alert"` e
          `aria-live="assertive"` porque recusa e falha precisam ser anunciadas na
          hora. O texto e o do servidor, sem reescrita. */}
      <div role="alert" aria-live="assertive" data-testid="erro-area" className="mt-4">
        {erro !== null ? (
          <p data-testid="erro" className="rounded-xl bg-red-50 px-4 py-3 text-base text-red-700">
            {erro}
          </p>
        ) : null}
      </div>
    </form>
  )
}
