export default function PaginaInicial() {
  return (
    <div className="max-w-xl">
      {/* O logotipo também aqui: é a primeira tela depois do login, e era o único
          ponto do caminho principal sem a marca. `alt` vazio porque o `h1` abaixo
          já diz o nome — repetir faria o leitor de tela dizer duas vezes. */}
      <img src="/logo-lam-vendas.png" alt="" aria-hidden="true" className="h-14 w-auto" />
      <h1 className="mt-4 text-2xl font-semibold text-foreground">Bem-vindo</h1>
      <p className="mt-2 text-base text-muted-foreground">
        Escolha uma opção no menu ao lado.
      </p>
    </div>
  )
}
