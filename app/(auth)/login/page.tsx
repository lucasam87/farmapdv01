import { entrar } from './actions'
import { AlternadorTema } from '@/app/(app)/tema'

export default async function LoginPage({
  searchParams,
}: {
  // No Next 16 `searchParams` é uma Promise.
  searchParams: Promise<{ erro?: string }>
}) {
  const { erro } = await searchParams

  const mensagem =
    erro === 'dados'
      ? 'Preencha e-mail e senha.'
      : erro
        ? 'E-mail ou senha incorretos.'
        : null

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-background p-6">
      {/*
        O alternador de tema fica AQUI, antes de qualquer login, e não só no menu
        do sistema. Ele nasceu só no casco autenticado e a consequência apareceu no
        dia 14/10/2026: quem entrava com uma conta ainda sem perfil caía na tela
        "Usuário sem perfil cadastrado" — que não tem menu — e não tinha como
        trocar o tema. Recurso de acessibilidade não pode depender de conseguir
        entrar.
      */}
      <div className="absolute right-4 top-4">
        <AlternadorTema compacto />
      </div>

      <form
        action={entrar}
        className="w-full max-w-sm rounded-lg bg-card p-8 shadow-sm"
      >
        {/* O logotipo entra como imagem DECORATIVA (`alt=""`): o nome já está no
            `h1`, e repetir faria o leitor de tela dizer "LaM Vendas" duas vezes.
            O `h1` é só para leitor de tela porque o desenho já traz o nome escrito
            — mas uma página sem `h1` é uma página sem título. */}
        <h1 className="sr-only">LaM Vendas — sistema da farmácia</h1>
        <img src="/logo-lam-vendas.png" alt="" aria-hidden="true" className="h-12 w-auto" />
        <p className="mt-1 text-sm text-muted-foreground">
          Entre com seu e-mail e sua senha.
        </p>

        {mensagem ? (
          <p
            role="alert"
            className="mt-6 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {mensagem}
          </p>
        ) : null}

        <label
          htmlFor="email"
          className="mt-6 block text-sm font-medium text-foreground"
        >
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-4 text-base text-foreground outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />

        <label
          htmlFor="senha"
          className="mt-4 block text-sm font-medium text-foreground"
        >
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 min-h-11 w-full rounded-lg border border-input bg-card px-4 text-base text-foreground outline-none focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />

        <button
          type="submit"
          className="mt-6 min-h-11 w-full rounded-lg bg-primary px-4 text-base font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Entrar
        </button>
      </form>
    </main>
  )
}
