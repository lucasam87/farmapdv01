// Quais rotas podem ser acessadas SEM sessão.
//
// A comparação é por segmento de caminho, nunca por `includes`: com `includes`,
// a rota "/logins" (ou "/logindefake") casaria com "/login" e viraria pública.

const ROTAS_PUBLICAS = ['/login']

export function rotaPublica(pathname: string): boolean {
  if (ROTAS_PUBLICAS.includes(pathname)) return true
  return pathname.startsWith('/auth/')
}
