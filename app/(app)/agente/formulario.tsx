'use client'

import { useRef, useState, type FormEvent } from 'react'
import { proximoEnvio, respostaAindaVale, type Envio } from './corrida'
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
//     memoria persistida). Cada envio e independente;
//   - deixar na tela a resposta de OUTRA pergunta: o campo e os exemplos seguem
//     habilitados durante o carregamento (so o botao desabilita), entao a resposta
//     de um envio antigo pode chegar depois de o texto mudar. Quem decide se ela
//     pode escrever na tela e `corrida.ts` (com teste), e o invariante e: **a
//     resposta visivel e sempre a resposta da pergunta que esta no campo**.
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

  // O envio mais recente e o texto que esta no campo AGORA. Sao `ref` de
  // proposito: quem os le e o callback assincrono do `fetch`, que enxerga o
  // estado do render em que foi criado — a `pergunta` do `useState` ficaria
  // congelada no texto do envio, e e justamente a diferenca entre "o que foi
  // enviado" e "o que esta no campo" que o guarda de `corrida.ts` precisa ver.
  const envioRef = useRef<Envio | null>(null)
  const perguntaRef = useRef('')
  // Um POST por vez: dois Enter antes do primeiro render nao podem gastar duas
  // chamadas pagas no provedor.
  const emVooRef = useRef(false)

  // A resposta/erro anterior sai da tela quando o TEXTO da pergunta muda: o que
  // fica visivel tem de ser a resposta da pergunta que esta no campo. Isso sozinho
  // nao bastava (Important 1): a resposta ja em voo ainda chegava depois — quem a
  // descarta e o guarda de `enviar`.
  function mudarPergunta(texto: string) {
    perguntaRef.current = texto
    setPergunta(texto)
    setResposta(null)
    setErro(null)
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (emVooRef.current) return

    emVooRef.current = true
    // A pergunta que ESTE envio manda, numerada. O texto enviado e o mesmo que o
    // guarda vai comparar depois, entao `envio.pergunta` e a fonte da verdade.
    const envio = proximoEnvio(envioRef.current, pergunta)
    envioRef.current = envio

    setCarregando(true)
    setResposta(null)
    setErro(null)

    try {
      const http = await fetch('/api/agente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // O texto vai como esta: quem apara, limita e faz a triagem e o servidor
        // (`validarPergunta`). O cliente nao tem uma segunda regra para divergir.
        body: JSON.stringify({ pergunta: envio.pergunta }),
      })

      // Corpo que nao e JSON nao pode virar excecao: vira `null` e a leitura o
      // trata como corpo fora do contrato.
      const bruto: unknown = await http.json().catch(() => null)

      // A corrida: se o campo ja mostra outra pergunta (o usuario digitou ou
      // clicou num exemplo enquanto este POST estava em voo), a resposta NAO
      // escreve nada. Resposta certa para pergunta errada e pior do que nenhuma.
      if (!respostaAindaVale(envio, envioRef.current, perguntaRef.current)) return

      const resultado = lerRespostaAgente(http.ok, bruto)

      if (resultado.tipo === 'resposta') {
        setResposta(resultado.texto)
        return
      }
      setErro(resultado.texto)
    } catch {
      // Falha de rede do envio atual; a de um envio ja superado nao vira recado.
      if (respostaAindaVale(envio, envioRef.current, perguntaRef.current)) setErro(ERRO_REDE)
    } finally {
      emVooRef.current = false
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
