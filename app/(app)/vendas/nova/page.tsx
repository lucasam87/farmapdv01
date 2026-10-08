import { Pdv } from './pdv'

// A PAGINA NAO CARREGA MAIS CLIENTE NENHUM.
//
// Ate a Task 6 ela trazia os 500 primeiros clientes em ordem alfabetica (mais os
// 200 maiores devedores, so para casar o saldo) e entregava tudo ao `Pdv`, que
// montava um `<select>`. Alem de carregar centenas de linhas em toda venda, isso
// tinha um defeito de balcao: cliente fora do corte — e a base veio inteira do
// sistema antigo — nao conseguia comprar no crediario, porque nao existia opcao
// para ele no seletor.
//
// Agora quem serve a lista e `GET /api/clientes/busca`, chamada pelo `Pdv` a cada
// tecla, com a mesma espera curta da busca de produto. O `Pdv` nao recebe mais
// nada na primeira renderizacao: o campo de cliente nasce vazio e nada na tela
// depende de uma lista previa — se a rota falhar, a venda em dinheiro continua
// acontecendo (o crediario e que exige cliente escolhido, como sempre).
export default function NovaVendaPage() {
  return <Pdv />
}
