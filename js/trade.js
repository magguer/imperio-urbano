// Sistema de negociación entre jugadores
import { BOARD, COLORS } from './board.js';

export function createTradeOffer() {
  return {
    fromId: null,
    toId: null,
    offerProps: [],
    offerMoney: 0,
    offerJailCards: 0,
    requestProps: [],
    requestMoney: 0,
    requestJailCards: 0,
  };
}

export function getTradeableProperties(state, playerId) {
  return BOARD.map((cell, id) => ({ cell, id, prop: state.properties[id] }))
    .filter(({ cell, prop }) =>
      prop.owner === playerId &&
      ['property', 'railroad', 'utility'].includes(cell.type)
    );
}

export function validateTrade(state, players, offer) {
  const from = players[offer.fromId];
  const to = players[offer.toId];
  if (!from || !to || from.bankrupt || to.bankrupt) return 'Jugador no válido.';

  const fromProps = getTradeableProperties(state, offer.fromId);
  const toProps = getTradeableProperties(state, offer.toId);

  for (const id of offer.offerProps) {
    if (!fromProps.find((p) => p.id === id)) return `${from.name} no puede ofrecer ${BOARD[id].name}.`;
  }
  for (const id of offer.requestProps) {
    if (!toProps.find((p) => p.id === id)) return `${to.name} no posee ${BOARD[id].name}.`;
  }

  if (offer.offerMoney < 0 || offer.requestMoney < 0) return 'Cantidades inválidas.';
  if (offer.offerMoney > from.money) return `${from.name} no tiene suficiente dinero.`;
  if (offer.requestMoney > to.money) return `${to.name} no tiene suficiente dinero.`;
  if (offer.offerJailCards > from.jailFreeCards) return `${from.name} no tiene tantas cartas.`;
  if (offer.requestJailCards > to.jailFreeCards) return `${to.name} no tiene tantas cartas.`;

  const empty =
    offer.offerProps.length === 0 && offer.offerMoney === 0 && offer.offerJailCards === 0 &&
    offer.requestProps.length === 0 && offer.requestMoney === 0 && offer.requestJailCards === 0;
  if (empty) return 'La oferta está vacía.';

  return null;
}

export function executeTrade(state, players, offer, formatMoney, addLog) {
  const from = players[offer.fromId];
  const to = players[offer.toId];

  offer.offerProps.forEach((id) => { state.properties[id].owner = offer.toId; });
  offer.requestProps.forEach((id) => { state.properties[id].owner = offer.fromId; });

  from.money -= offer.offerMoney;
  to.money += offer.offerMoney;
  to.money -= offer.requestMoney;
  from.money += offer.requestMoney;

  from.jailFreeCards -= offer.offerJailCards;
  to.jailFreeCards += offer.offerJailCards;
  to.jailFreeCards -= offer.requestJailCards;
  from.jailFreeCards += offer.requestJailCards;

  const parts = [];
  if (offer.offerProps.length) parts.push(`${from.name} da: ${offer.offerProps.map((id) => BOARD[id].name).join(', ')}`);
  if (offer.requestProps.length) parts.push(`${to.name} da: ${offer.requestProps.map((id) => BOARD[id].name).join(', ')}`);
  if (offer.offerMoney) parts.push(`${from.name} paga ${formatMoney(offer.offerMoney)}`);
  if (offer.requestMoney) parts.push(`${to.name} paga ${formatMoney(offer.requestMoney)}`);
  if (offer.offerJailCards) parts.push(`${from.name} da ${offer.offerJailCards} carta(s) de salida`);
  if (offer.requestJailCards) parts.push(`${to.name} da ${offer.requestJailCards} carta(s) de salida`);

  addLog(`🤝 Trato cerrado: ${parts.join(' · ')}`);
}

export function renderPropertyCheckboxes(state, playerId, prefix, selected = []) {
  const props = getTradeableProperties(state, playerId);
  if (!props.length) return '<p class="trade-empty">Sin propiedades</p>';

  return props.map(({ cell, id, prop }) => {
    const color = COLORS[cell.color]?.bg || '#666';
    const checked = selected.includes(id) ? 'checked' : '';
    const extras = [];
    if (prop.houses > 0) extras.push(prop.houses === 5 ? '🏨' : `${prop.houses}🏠`);
    if (prop.mortgaged) extras.push('HIP');
    return `
      <label class="trade-prop">
        <input type="checkbox" name="${prefix}-prop" value="${id}" ${checked}>
        <span class="trade-prop-color" style="background:${color}"></span>
        <span>${cell.name}${extras.length ? ` (${extras.join(', ')})` : ''}</span>
      </label>`;
  }).join('');
}
