import { entrar } from './actions'

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
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
      <form
        action={entrar}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold text-slate-800">Farmácia</h1>
        <p className="mt-1 text-sm text-slate-500">
          Entre com seu e-mail e sua senha.
        </p>

        {mensagem ? (
          <p
            role="alert"
            className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {mensagem}
          </p>
        ) : null}

        <label
          htmlFor="email"
          className="mt-6 block text-sm font-medium text-slate-700"
        >
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500"
        />

        <label
          htmlFor="senha"
          className="mt-4 block text-sm font-medium text-slate-700"
        >
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-500"
        />

        <button
          type="submit"
          className="mt-6 w-full rounded-lg bg-slate-800 px-4 py-3 text-base font-medium text-white hover:bg-slate-700"
        >
          Entrar
        </button>
      </form>
    </main>
  )
}
