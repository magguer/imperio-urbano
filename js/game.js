import {
  BOARD, COLORS, RENT_TABLES, HOUSE_COST, GO_BONUS, JAIL_POSITION,
  GO_TO_JAIL_POSITION, PLAYER_COLORS, PLAYER_TOKENS, STARTING_MONEY, JAIL_BAIL,
} from './board.js';
import { CITY_CARDS, FORTUNE_CARDS, shuffleDeck } from './cards.js';
import {
  createTradeOffer, validateTrade, executeTrade, renderPropertyCheckboxes,
} from './trade.js';
import {
  createAuction, getCurrentBidder, advanceBidder, placeBid, passBid,
  isAuctionOver, getAuctionSummary, allPassed,
} from './auction.js';

// ─── Estado global ───────────────────────────────────────────
let state = null;
let pendingAction = null;
let tradeDraft = null;
let movingTokenId = null;
let diceBox = null;
let diceBoxReady = false;
let activeBoardCard = null;

const SAVE_KEY = 'imperio-urbano-save';
const SAVE_VERSION = 1;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createInitialState(playerConfigs) {
  const properties = BOARD.map((cell) => ({
    owner: null,
    houses: 0,
    mortgaged: false,
  }));

  const players = playerConfigs.map(({ name, token }, i) => ({
    id: i,
    name: name.trim() || `Jugador ${i + 1}`,
    token,
    color: PLAYER_COLORS[i],
    money: STARTING_MONEY,
    position: 0,
    inJail: false,
    jailTurns: 0,
    jailFreeCards: 0,
    bankrupt: false,
  }));

  return {
    players,
    properties,
    currentPlayer: 0,
    phase: 'roll',
    dice: [0, 0],
    doublesCount: 0,
    cityDeck: shuffleDeck(CITY_CARDS),
    fortuneDeck: shuffleDeck(FORTUNE_CARDS),
    cityDiscard: [],
    fortuneDiscard: [],
    log: ['¡Bienvenidos a Imperio Urbano! Que gane el mejor inversionista.'],
    winner: null,
    housesLeft: 32,
    hotelsLeft: 12,
    freeParkingPot: 0,
    auction: null,
  };
}

// ─── Utilidades ──────────────────────────────────────────────
function activePlayers() {
  return state.players.filter((p) => !p.bankrupt);
}

function currentPlayer() {
  return state.players[state.currentPlayer];
}

function addLog(msg) {
  state.log.unshift(msg);
  if (state.log.length > 50) state.log.pop();
  renderLog();
}

function updateBoardAction() {
  const el = $('#board-action');
  if (!el) return;
  const latest = state.log[0] || '';
  el.textContent = latest;
  el.classList.toggle('hidden', !latest);
}

function formatMoney(n) {
  return `$${n}`;
}

function tokenIcon(token, className = 'token-icon') {
  return `<span class="${className}" title="${token.name}"><i class="fa-solid ${token.icon}"></i></span>`;
}

function playerLabel(player) {
  return `${player.token.name} ${player.name}`;
}

function getGroupCells(group) {
  return BOARD.filter((c) => c.group === group).map((c) => c.id);
}

function ownsFullGroup(playerId, group) {
  if (!group || group === 'railroad' || group === 'utility') {
    const cells = BOARD.filter((c) => c.group === group);
    return cells.every((c) => state.properties[c.id].owner === playerId && !state.properties[c.id].mortgaged);
  }
  const cells = getGroupCells(group);
  return cells.every((id) => {
    const p = state.properties[id];
    return p.owner === playerId && !p.mortgaged;
  });
}

function countOwnedRailroads(playerId) {
  return BOARD.filter((c) => c.type === 'railroad' && state.properties[c.id].owner === playerId && !state.properties[c.id].mortgaged).length;
}

function countOwnedUtilities(playerId) {
  return BOARD.filter((c) => c.type === 'utility' && state.properties[c.id].owner === playerId && !state.properties[c.id].mortgaged).length;
}

function calcRent(cellId) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  if (prop.owner === null || prop.mortgaged) return 0;

  if (cell.type === 'property') {
    const table = RENT_TABLES[cell.group];
    if (prop.houses === 5) return table[5];
    if (prop.houses > 0) return table[prop.houses];
    return ownsFullGroup(prop.owner, cell.group) ? table[0] * 2 : table[0];
  }

  if (cell.type === 'railroad') {
    const n = countOwnedRailroads(prop.owner);
    return [25, 50, 100, 200][n - 1] || 25;
  }

  if (cell.type === 'utility') {
    const n = countOwnedUtilities(prop.owner);
    const diceTotal = state.dice[0] + state.dice[1] || 7;
    return n === 2 ? diceTotal * 10 : diceTotal * 4;
  }

  return 0;
}

function applyPayment(fromId, toId, amount, reason, toFreeParking = false) {
  const from = state.players[fromId];
  const to = toId !== null ? state.players[toId] : null;

  from.money -= amount;
  if (to) {
    to.money += amount;
  } else if (toFreeParking) {
    state.freeParkingPot += amount;
  }
  addLog(`${from.name} paga ${formatMoney(amount)}${reason ? ` (${reason})` : ''}${to ? ` a ${to.name}` : toFreeParking ? ' al fondo Zona Libre' : ''}.`);
}

function transferMoney(fromId, toId, amount, reason, toFreeParking = false) {
  const from = state.players[fromId];

  if (amount <= 0) return true;

  if (from.money >= amount) {
    applyPayment(fromId, toId, amount, reason, toFreeParking);
    return true;
  }

  pendingAction = { type: 'raiseFunds', fromId, toId, amount, reason, toFreeParking };
  state.phase = 'raiseFunds';
  showRaiseFundsModal(fromId, amount, reason);
  return false;
}

function completePendingPayment() {
  const action = pendingAction;
  if (action?.type !== 'raiseFunds') return false;

  const from = state.players[action.fromId];
  if (from.money < action.amount) {
    addLog(`${from.name} aún necesita ${formatMoney(action.amount - from.money)} para pagar ${action.reason}.`);
    return false;
  }

  applyPayment(action.fromId, action.toId, action.amount, action.reason, action.toFreeParking ?? false);
  pendingAction = null;
  state.phase = 'end';
  return true;
}

function declareBankruptcyFromDebt() {
  const action = pendingAction;
  if (action?.type !== 'raiseFunds') return;

  const player = state.players[action.fromId];
  player.bankrupt = true;
  addLog(`💀 ${player.name} declara quiebra.`);

  if (action.toId !== null && action.toId !== undefined) {
    const creditor = state.players[action.toId];
    creditor.money += player.money;
  }

  player.money = 0;
  BOARD.forEach((_, id) => {
    if (state.properties[id].owner === action.fromId) {
      state.properties[id].owner = action.toId ?? null;
      state.properties[id].houses = 0;
    }
  });

  pendingAction = null;
  checkWinner();
  nextTurn();
}

function checkBankruptcy(playerId, creditorId) {
  const player = state.players[playerId];
  if (player.money >= 0) return;

  const assets = getPlayerAssets(playerId);
  const total = player.money + assets.total;
  const debt = creditorId !== null ? -player.money : 0;

  if (creditorId !== null && total < debt) {
    // Quiebra total
    player.bankrupt = true;
    addLog(`💀 ${player.name} ha quebrado.`);

    // Transferir activos al acreedor
    if (creditorId !== null) {
      const creditor = state.players[creditorId];
      creditor.money += player.money;
      player.money = 0;
      BOARD.forEach((cell, id) => {
        const prop = state.properties[id];
        if (prop.owner === playerId) {
          prop.owner = creditorId;
          if (prop.houses > 0) {
            state.housesLeft += prop.houses === 5 ? 4 : prop.houses;
            if (prop.houses === 5) state.hotelsLeft++;
            prop.houses = 0;
          }
        }
      });
      player.jailFreeCards && (creditor.jailFreeCards += player.jailFreeCards);
      player.jailFreeCards = 0;
    } else {
      // Al banco
      BOARD.forEach((_, id) => {
        const prop = state.properties[id];
        if (prop.owner === playerId) {
          prop.owner = null;
          prop.houses = 0;
          prop.mortgaged = false;
        }
      });
    }

    checkWinner();
    nextTurn();
    return;
  }
}

function getPlayerAssets(playerId) {
  let total = 0;
  const props = [];
  BOARD.forEach((cell, id) => {
    const p = state.properties[id];
    if (p.owner === playerId) {
      const val = p.mortgaged ? cell.price / 2 : cell.price;
      total += val;
      if (p.houses > 0) {
        const cost = HOUSE_COST[cell.group] || 0;
        total += p.houses === 5 ? cost * 5 : cost * p.houses;
      }
      props.push({ id, cell, ...p });
    }
  });
  return { total, props };
}

function checkWinner() {
  const alive = activePlayers();
  if (alive.length === 1) {
    state.winner = alive[0];
    state.phase = 'ended';
    clearSavedGame();
    showModal('¡Fin del juego!', `<h2>🏆 ${state.winner.name} gana Imperio Urbano!</h2><p>Ha dominado la ciudad con astucia y fortuna.</p>`, [
      { label: 'Nueva partida', action: () => location.reload() },
    ]);
  }
}

function nextPlayer() {
  let next = (state.currentPlayer + 1) % state.players.length;
  while (state.players[next].bankrupt) {
    next = (next + 1) % state.players.length;
  }
  state.currentPlayer = next;
  state.phase = 'roll';
  state.doublesCount = 0;
  pendingAction = null;
  render();
}

function nextTurn() {
  const alive = activePlayers();
  if (alive.length <= 1) return;
  nextPlayer();
}

// ─── Movimiento ──────────────────────────────────────────────
async function movePlayer(playerId, steps, collectGo = true) {
  const player = state.players[playerId];
  const oldPos = player.position;
  const newPos = (oldPos + steps) % 40;
  const passedGo = steps > 0 && (oldPos + steps >= 40);

  for (let step = 1; step <= Math.abs(steps); step++) {
    const direction = steps >= 0 ? 1 : -1;
    player.position = (oldPos + step * direction + 40) % 40;
    movingTokenId = playerId;
    renderBoard();
    await sleep(220);
    movingTokenId = null;
    renderBoard();
    await sleep(55);
  }

  if (passedGo && collectGo) {
    player.money += GO_BONUS;
    addLog(`${player.name} pasa por SALIDA y cobra ${formatMoney(GO_BONUS)}.`);
  }

  renderBoard();
  return newPos;
}

async function moveToPosition(playerId, target, collectGo = true) {
  const player = state.players[playerId];
  const oldPos = player.position;
  let steps = target - oldPos;
  if (steps <= 0) steps += 40;
  const passedGo = target < oldPos || (target === 0 && oldPos !== 0);

  await movePlayer(playerId, steps, false);
  player.position = target;

  if (passedGo && collectGo && target !== 0) {
    player.money += GO_BONUS;
    addLog(`${player.name} pasa por SALIDA y cobra ${formatMoney(GO_BONUS)}.`);
  } else if (target === 0 && collectGo) {
    player.money += GO_BONUS;
    addLog(`${player.name} llega a SALIDA y cobra ${formatMoney(GO_BONUS)}.`);
  }

  renderBoard();
  return target;
}

async function findNearest(playerId, type) {
  const pos = state.players[playerId].position;
  for (let i = 1; i <= 40; i++) {
    const idx = (pos + i) % 40;
    if (BOARD[idx].type === type) {
      await moveToPosition(playerId, idx);
      return idx;
    }
  }
  return pos;
}

function landOnCell(playerId, cellId) {
  const cell = BOARD[cellId];
  const player = state.players[playerId];
  const prop = state.properties[cellId];

  switch (cell.type) {
    case 'go':
      state.phase = 'end';
      render();
      break;
    case 'property':
    case 'railroad':
    case 'utility':
      handlePropertyLanding(playerId, cellId);
      break;
    case 'tax':
      if (!transferMoney(playerId, null, cell.amount, cell.name, true)) return;
      state.phase = 'end';
      render();
      break;
    case 'chance':
      drawCard('city', playerId);
      break;
    case 'chest':
      drawCard('fortune', playerId);
      break;
    case 'gotojail':
      sendToJail(playerId);
      break;
    case 'jail':
      addLog(`${player.name} visita la ${cell.name}.`);
      state.phase = 'end';
      render();
      break;
    case 'parking':
      if (state.freeParkingPot > 0) {
        const pot = state.freeParkingPot;
        player.money += pot;
        addLog(`🎉 ${player.name} recibe ${formatMoney(pot)} del fondo Zona Libre!`);
        state.freeParkingPot = 0;
      } else {
        addLog(`${player.name} descansa en ${cell.name}.`);
      }
      state.phase = 'end';
      render();
      break;
  }
}

function handlePropertyLanding(playerId, cellId) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const player = state.players[playerId];

  if (prop.owner === null) {
    state.phase = 'buy';
    pendingAction = { type: 'buy', cellId };
    showBuyModal(cellId);
    return;
  }

  if (prop.owner === playerId) {
    addLog(`${player.name} está en su propiedad: ${cell.name}.`);
    state.phase = 'build';
    render();
    return;
  }

  if (prop.mortgaged) {
    addLog(`${cell.name} está hipotecada. Sin alquiler.`);
    state.phase = 'end';
    render();
    return;
  }

  const rent = calcRent(cellId);
  addLog(`${player.name} debe pagar ${formatMoney(rent)} de alquiler por ${cell.name}.`);
  if (!transferMoney(playerId, prop.owner, rent, `alquiler ${cell.name}`)) return;
  checkBankruptcy(playerId, prop.owner);
  state.phase = 'end';
  render();
}

function sendToJail(playerId) {
  const player = state.players[playerId];
  player.position = JAIL_POSITION;
  player.inJail = true;
  player.jailTurns = 0;
  state.doublesCount = 0;
  addLog(`🚔 ${player.name} va a la Comisaría.`);
  state.phase = 'end';
  renderBoard();
  render();
}

// ─── Cartas ──────────────────────────────────────────────────
function drawCard(deckName, playerId) {
  const deckKey = deckName === 'city' ? 'cityDeck' : 'fortuneDeck';
  const discardKey = deckName === 'city' ? 'cityDiscard' : 'fortuneDiscard';
  const source = deckName === 'city' ? CITY_CARDS : FORTUNE_CARDS;

  if (state[deckKey].length === 0) {
    state[deckKey] = shuffleDeck(state[discardKey].length ? state[discardKey] : source);
    state[discardKey] = [];
  }

  const card = state[deckKey].pop();
  state[discardKey].push(card);

  showModal(
    deckName === 'city' ? '🃏 Sorpresa Ciudad' : '🎁 Fortuna',
    `<p>${card.text}</p>`,
    [{ label: 'Aceptar', action: () => { closeModal(); executeCard(card, playerId); } }],
  );
}

async function executeCard(card, playerId) {
  const player = state.players[playerId];

  switch (card.action) {
    case 'move':
      await moveToPosition(playerId, card.target, card.collectGo !== false);
      landOnCell(playerId, player.position);
      if (state.phase === 'rolling') {
        state.phase = 'end';
        render();
      }
      break;
    case 'nearest': {
      const pos = await findNearest(playerId, card.type);
      landOnCell(playerId, pos);
      if (state.phase === 'rolling') {
        state.phase = 'end';
        render();
      }
      break;
    }
    case 'money':
      if (card.amount > 0) {
        player.money += card.amount;
        addLog(`${player.name} recibe ${formatMoney(card.amount)}.`);
      } else if (!transferMoney(playerId, null, -card.amount, 'carta', true)) {
        return;
      }
      state.phase = 'end';
      render();
      break;
    case 'collectEach':
      activePlayers().forEach((p) => {
        if (p.id !== playerId && !p.bankrupt) {
          transferMoney(p.id, playerId, card.amount, 'carta');
        }
      });
      state.phase = 'end';
      render();
      break;
    case 'payEach': {
      let blocked = false;
      activePlayers().forEach((p) => {
        if (p.id !== playerId && !p.bankrupt) {
          if (!transferMoney(playerId, p.id, card.amount, 'carta')) blocked = true;
        }
      });
      if (blocked) return;
      state.phase = 'end';
      render();
      break;
    }
    case 'jailFree':
      player.jailFreeCards++;
      addLog(`${player.name} obtiene carta de salida de la Comisaría.`);
      state.phase = 'end';
      render();
      break;
    case 'gotojail':
      sendToJail(playerId);
      break;
    case 'back': {
      const newPos = (player.position - card.steps + 40) % 40;
      await movePlayer(playerId, -card.steps, false);
      landOnCell(playerId, newPos);
      if (state.phase === 'rolling') {
        state.phase = 'end';
        render();
      }
      break;
    }
    case 'repairs': {
      let cost = 0;
      BOARD.forEach((cell, id) => {
        const p = state.properties[id];
        if (p.owner === playerId && p.houses > 0) {
          cost += p.houses === 5 ? card.hotel : card.house * p.houses;
        }
      });
      if (cost > 0 && !transferMoney(playerId, null, cost, 'reparaciones', true)) return;
      state.phase = 'end';
      render();
      break;
    }
    default:
      state.phase = 'end';
      render();
  }
}

// ─── Acciones del jugador ────────────────────────────────────
async function rollDice() {
  const player = currentPlayer();
  if (state.phase !== 'roll' || player.bankrupt) return;

  if (player.inJail) {
    handleJailRoll();
    return;
  }

  state.phase = 'rolling';
  renderActions();
  const [d1, d2] = await animateDice();
  state.dice = [d1, d2];
  const isDouble = d1 === d2;

  if (isDouble) {
    state.doublesCount++;
    if (state.doublesCount >= 3) {
      addLog(`¡${player.name} sacó 3 dobles seguidos! A la Comisaría.`);
      sendToJail(player.id);
      state.doublesCount = 0;
      return;
    }
  } else {
    state.doublesCount = 0;
  }

  const steps = d1 + d2;
  addLog(`${player.name} tira ${d1} + ${d2} = ${steps}${isDouble ? ' (¡doble!)' : ''}.`);
  const newPos = await movePlayer(player.id, steps);
  landOnCell(player.id, newPos);

  render();
}

async function handleJailRoll() {
  const player = currentPlayer();
  state.phase = 'rolling';
  renderActions();
  const [d1, d2] = await animateDice();
  state.dice = [d1, d2];

  player.jailTurns++;
  const isDouble = d1 === d2;

  if (isDouble) {
    player.inJail = false;
    player.jailTurns = 0;
    state.doublesCount = 0;
    addLog(`${player.name} saca doble (${d1}+${d2}) y sale de la Comisaría.`);
    const newPos = await movePlayer(player.id, d1 + d2);
    landOnCell(player.id, newPos);
    if (state.phase === 'rolling') state.phase = 'end';
  } else if (player.jailTurns >= 3) {
    player.inJail = false;
    player.jailTurns = 0;
    state.doublesCount = 0;
    addLog(`${player.name} no saca doble (${d1}+${d2}). Debe pagar fianza para salir.`);
    transferMoney(player.id, null, JAIL_BAIL, 'fianza');
    const newPos = await movePlayer(player.id, d1 + d2);
    landOnCell(player.id, newPos);
    if (state.phase === 'rolling') state.phase = 'end';
  } else {
    state.doublesCount = 0;
    addLog(`${player.name} no saca doble (${d1}+${d2}). Turno ${player.jailTurns}/3 en la Comisaría.`);
    state.phase = 'end';
  }
  render();
}

function showJailOptions() {
  const player = currentPlayer();
  const buttons = [];

  if (player.money >= JAIL_BAIL) {
    buttons.push({
      label: `Pagar fianza (${formatMoney(JAIL_BAIL)})`,
      action: () => {
        closeModal();
        player.inJail = false;
        player.jailTurns = 0;
        state.doublesCount = 0;
        transferMoney(player.id, null, JAIL_BAIL, 'fianza');
        addLog(`${player.name} paga fianza.`);
        state.phase = 'roll';
        render();
      },
    });
  }

  if (player.jailFreeCards > 0) {
    buttons.push({
      label: 'Usar carta de salida',
      action: () => {
        closeModal();
        player.inJail = false;
        player.jailTurns = 0;
        state.doublesCount = 0;
        player.jailFreeCards--;
        addLog(`${player.name} usa carta de salida.`);
        state.phase = 'roll';
        render();
      },
    });
  }

  buttons.push({
    label: 'Seguir intentando',
    action: () => { closeModal(); state.phase = 'end'; render(); },
  });

  showModal('🚔 En la Comisaría', `<p>${player.name}, ¿cómo quieres salir?</p>`, buttons);
}

function buyProperty(cellId) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const player = currentPlayer();

  if (player.money < cell.price) {
    addLog(`${player.name} no tiene dinero para comprar ${cell.name}.`);
    state.phase = 'end';
    closeBoardCard();
    render();
    return;
  }

  player.money -= cell.price;
  prop.owner = player.id;
  addLog(`${player.name} compra ${cell.name} por ${formatMoney(cell.price)}.`);
  state.phase = 'end';
  closeBoardCard();
  render();
}

function declineProperty() {
  const cellId = pendingAction?.cellId;
  closeBoardCard();
  pendingAction = null;
  if (cellId != null) {
    startAuction(cellId);
  } else {
    state.phase = 'end';
    render();
  }
}

// ─── Subastas ────────────────────────────────────────────────
function startAuction(cellId) {
  const bidders = activePlayers().map((p) => p.id);
  state.auction = createAuction(cellId, bidders);
  state.phase = 'auction';
  addLog(`🔨 Subasta de ${BOARD[cellId].name}. Mínimo: $1.`);
  showAuctionModal();
}

function showAuctionModal() {
  const auction = state.auction;
  if (!auction || auction.done) return;

  if (isAuctionOver(auction)) {
    finishAuction();
    return;
  }

  const cell = BOARD[auction.cellId];
  const bidder = getCurrentBidder(auction, state.players);

  if (!bidder || isAuctionOver(auction)) {
    finishAuction();
    return;
  }

  if (auction.passed.has(bidder.id) && !allPassed(auction)) {
    advanceBidder(auction);
    showAuctionModal();
    return;
  }

  const minBid = auction.bid + 1;
  const canBid = bidder.money >= minBid;

  showModal(
    `🔨 Subasta: ${cell.name}`,
    `<div class="auction-info">
      <p><strong>Precio de lista:</strong> ${formatMoney(cell.price)}</p>
      <p><strong>Puja actual:</strong> ${auction.bid > 0 ? `${formatMoney(auction.bid)} (${state.players[auction.leader]?.name})` : 'Sin pujas'}</p>
      <p><strong>Turno de:</strong> ${tokenIcon(bidder.token, 'inline-token')} ${bidder.name} (${formatMoney(bidder.money)})</p>
      ${canBid ? `
        <div class="auction-bid-input">
          <label>Tu puja (mín. ${formatMoney(minBid)})</label>
          <input type="number" id="auction-bid-amount" min="${minBid}" max="${bidder.money}" value="${Math.min(minBid + 10, bidder.money)}">
        </div>` : '<p class="funds-needed">Sin dinero para pujar.</p>'}
    </div>`,
    [
      ...(canBid ? [{
        label: 'Pujar',
        primary: true,
        action: () => {
          const amount = parseInt($('#auction-bid-amount')?.value || '0', 10);
          const err = placeBid(auction, bidder.id, amount);
          if (err) { alert(err); return; }
          closeModal();
          advanceBidder(auction);
          showAuctionModal();
        },
      }] : []),
      {
        label: 'Pasar',
        action: () => {
          passBid(auction, bidder.id);
          closeModal();
          advanceBidder(auction);
          showAuctionModal();
        },
      },
    ],
  );
}

function finishAuction() {
  const auction = state.auction;
  if (!auction) return;

  auction.done = true;
  const result = getAuctionSummary(auction, state.players, formatMoney);
  const prop = state.properties[auction.cellId];

  if (result.sold) {
    const winner = result.winner;
    winner.money -= result.amount;
    prop.owner = winner.id;
    addLog(`🔨 ${winner.name} gana ${result.cell.name} por ${formatMoney(result.amount)}.`);
  } else {
    addLog(`🔨 Nadie compró ${result.cell.name}. Sigue en venta.`);
  }

  state.auction = null;
  state.phase = 'end';
  closeModal();
  render();
}

// ─── Intercambios ────────────────────────────────────────────
function showTradePartnerSelect() {
  const player = currentPlayer();
  const others = activePlayers().filter((p) => p.id !== player.id);

  if (!others.length) {
    addLog('No hay jugadores con quien negociar.');
    return;
  }

  const options = others.map((p) =>
    `<option value="${p.id}">${playerLabel(p)} (${formatMoney(p.money)})</option>`
  ).join('');

  showModal(
    '🤝 Negociar',
    `<p>Elige con quién quieres negociar:</p>
     <select id="trade-partner" class="trade-select">${options}</select>`,
    [
      {
        label: 'Continuar',
        primary: true,
        action: () => {
          const toId = parseInt($('#trade-partner').value, 10);
          tradeDraft = createTradeOffer();
          tradeDraft.fromId = player.id;
          tradeDraft.toId = toId;
          closeModal();
          showTradeBuilder();
        },
      },
      { label: 'Cancelar', action: closeModal },
    ],
  );
}

function showTradeBuilder() {
  const from = state.players[tradeDraft.fromId];
  const to = state.players[tradeDraft.toId];

  showModal(
    `🤝 Trato: ${from.name} ↔ ${to.name}`,
    `<div class="trade-grid">
      <div class="trade-col">
        <h4>${tokenIcon(from.token, 'inline-token')} ${from.name} ofrece</h4>
        <div class="trade-props">${renderPropertyCheckboxes(state, from.id, 'offer', tradeDraft.offerProps)}</div>
        <label class="trade-money">Dinero: $<input type="number" id="offer-money" min="0" max="${from.money}" value="${tradeDraft.offerMoney}"></label>
        ${from.jailFreeCards ? `<label class="trade-check"><input type="checkbox" id="offer-jail" ${tradeDraft.offerJailCards ? 'checked' : ''}> Carta salida Comisaría (${from.jailFreeCards})</label>` : ''}
      </div>
      <div class="trade-col">
        <h4>${tokenIcon(to.token, 'inline-token')} ${to.name} ofrece</h4>
        <div class="trade-props">${renderPropertyCheckboxes(state, to.id, 'request', tradeDraft.requestProps)}</div>
        <label class="trade-money">Dinero: $<input type="number" id="request-money" min="0" max="${to.money}" value="${tradeDraft.requestMoney}"></label>
        ${to.jailFreeCards ? `<label class="trade-check"><input type="checkbox" id="request-jail" ${tradeDraft.requestJailCards ? 'checked' : ''}> Carta salida Comisaría (${to.jailFreeCards})</label>` : ''}
      </div>
    </div>`,
    [
      {
        label: 'Proponer trato',
        primary: true,
        action: () => {
          collectTradeDraft();
          const err = validateTrade(state, state.players, tradeDraft);
          if (err) { alert(err); return; }
          closeModal();
          showTradeReview();
        },
      },
      { label: 'Cancelar', action: () => { tradeDraft = null; closeModal(); } },
    ],
  );
}

function collectTradeDraft() {
  tradeDraft.offerProps = [...document.querySelectorAll('input[name="offer-prop"]:checked')].map((el) => parseInt(el.value, 10));
  tradeDraft.requestProps = [...document.querySelectorAll('input[name="request-prop"]:checked')].map((el) => parseInt(el.value, 10));
  tradeDraft.offerMoney = parseInt($('#offer-money')?.value || '0', 10) || 0;
  tradeDraft.requestMoney = parseInt($('#request-money')?.value || '0', 10) || 0;
  tradeDraft.offerJailCards = $('#offer-jail')?.checked ? 1 : 0;
  tradeDraft.requestJailCards = $('#request-jail')?.checked ? 1 : 0;
}

function showTradeReview() {
  const from = state.players[tradeDraft.fromId];
  const to = state.players[tradeDraft.toId];

  const listOffer = [
    ...tradeDraft.offerProps.map((id) => BOARD[id].name),
    ...(tradeDraft.offerMoney ? [formatMoney(tradeDraft.offerMoney)] : []),
    ...(tradeDraft.offerJailCards ? ['1 carta salida'] : []),
  ];
  const listRequest = [
    ...tradeDraft.requestProps.map((id) => BOARD[id].name),
    ...(tradeDraft.requestMoney ? [formatMoney(tradeDraft.requestMoney)] : []),
    ...(tradeDraft.requestJailCards ? ['1 carta salida'] : []),
  ];

  showModal(
    '🤝 Revisar trato',
    `<p><strong>Pasa el dispositivo a ${to.name}</strong></p>
     <div class="trade-review">
       <p><strong>${from.name} da:</strong> ${listOffer.length ? listOffer.join(', ') : '—'}</p>
       <p class="trade-arrow">⇅</p>
       <p><strong>${to.name} da:</strong> ${listRequest.length ? listRequest.join(', ') : '—'}</p>
     </div>
     ${tradeDraft.offerProps.some((id) => state.properties[id].mortgaged) || tradeDraft.requestProps.some((id) => state.properties[id].mortgaged)
    ? '<p class="trade-warning">⚠️ Hay propiedades hipotecadas en el trato. El nuevo dueño deberá pagar 10% extra para recuperarlas.</p>' : ''}`,
    [
      {
        label: 'Aceptar trato',
        primary: true,
        action: () => {
          executeTrade(state, state.players, tradeDraft, formatMoney, addLog);
          handleMortgagedTradeProps(tradeDraft);
          tradeDraft = null;
          closeModal();
          render();
        },
      },
      {
        label: 'Rechazar',
        action: () => {
          addLog(`${to.name} rechaza el trato con ${from.name}.`);
          tradeDraft = null;
          closeModal();
        },
      },
    ],
  );
}

function handleMortgagedTradeProps(offer) {
  [...offer.offerProps, ...offer.requestProps].forEach((id) => {
    const prop = state.properties[id];
    if (!prop.mortgaged) return;
    const cell = BOARD[id];
    const newOwner = prop.owner;
    const cost = Math.ceil(cell.price * 0.1);
    const player = state.players[newOwner];
    if (player.money >= cost) {
      player.money -= cost;
      addLog(`${player.name} paga ${formatMoney(cost)} de interés por ${cell.name} hipotecada recibida.`);
    }
  });
}

function buildHouse(cellId) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const player = currentPlayer();
  const cost = HOUSE_COST[cell.group];

  if (!ownsFullGroup(player.id, cell.group)) return;

  const groupCells = getGroupCells(cell.group);
  if (groupCells.some((id) => state.properties[id].mortgaged)) {
    addLog('No puedes construir si hay propiedades hipotecadas en el grupo.');
    return;
  }

  if (prop.houses >= 5) return;

  const minHouses = Math.min(...groupCells.map((id) => state.properties[id].houses));
  if (prop.houses > minHouses) {
    addLog('Debes construir de forma uniforme en el grupo.');
    return;
  }

  const needHotel = prop.houses === 4;
  if (needHotel && state.hotelsLeft <= 0) {
    addLog('No quedan hoteles en el banco.');
    return;
  }
  if (!needHotel && state.housesLeft <= 0) {
    addLog('No quedan casas en el banco.');
    return;
  }
  if (player.money < cost) {
    addLog(`${player.name} no tiene dinero para construir en ${cell.name}.`);
    return;
  }

  player.money -= cost;
  if (needHotel) {
    state.housesLeft += 4;
    state.hotelsLeft--;
    prop.houses = 5;
    addLog(`${player.name} construye un hotel en ${cell.name}.`);
  } else {
    state.housesLeft--;
    prop.houses++;
    addLog(`${player.name} construye casa en ${cell.name} (${prop.houses}/4).`);
  }
  render();
}

function sellHouse(cellId) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const player = currentPlayer();
  const cost = HOUSE_COST[cell.group];

  if (prop.houses <= 0) return;

  const groupCells = getGroupCells(cell.group);
  const maxHouses = Math.max(...groupCells.map((id) => state.properties[id].houses));
  if (prop.houses < maxHouses) {
    addLog('Debes vender de forma uniforme en el grupo.');
    return;
  }

  if (prop.houses === 5) {
    prop.houses = 4;
    state.hotelsLeft++;
    state.housesLeft -= 4;
  } else {
    prop.houses--;
    state.housesLeft++;
  }

  player.money += Math.floor(cost / 2);
  addLog(`${player.name} vende edificio en ${cell.name}.`);
  render();
}

function toggleMortgage(cellId) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const player = currentPlayer();

  if (prop.owner !== player.id) return;
  if (prop.houses > 0) {
    addLog('Vende los edificios antes de hipotecar.');
    return;
  }

  if (prop.mortgaged) {
    const cost = Math.floor(cell.price / 2 * 1.1);
    if (player.money < cost) return;
    player.money -= cost;
    prop.mortgaged = false;
    addLog(`${player.name} recupera ${cell.name} (${formatMoney(cost)}).`);
  } else {
    const value = Math.floor(cell.price / 2);
    player.money += value;
    prop.mortgaged = true;
    addLog(`${player.name} hipoteca ${cell.name} por ${formatMoney(value)}.`);
  }
  render();
}

function endTurn() {
  if (state.doublesCount > 0 && !currentPlayer().inJail) return;
  nextTurn();
}

function isBlockingDoubleContinue() {
  if (pendingAction) return true;
  if (['buy', 'auction', 'raiseFunds'].includes(state.phase)) return true;
  if (!$('#modal')?.classList.contains('hidden')) return true;
  return false;
}

function tryContinueDoubleTurn() {
  if (state.doublesCount <= 0 || state.doublesCount >= 3) return;
  const player = currentPlayer();
  if (player.inJail) return;
  if (['roll', 'rolling'].includes(state.phase)) return;
  if (isBlockingDoubleContinue()) return;

  state.phase = 'roll';
  addLog(`${player.name} tira otra vez por doble.`);
}

// ─── Modales ─────────────────────────────────────────────────
function showBoardCard(body, buttons) {
  activeBoardCard = { body, buttons };
  paintBoardCard();
}

function paintBoardCard() {
  if (!activeBoardCard) return;

  const card = $('#board-card');
  const defaultView = $('#board-center-default');
  const content = $('#board-card-content');
  const actions = $('#board-card-actions');
  if (!card || !content || !actions) return;

  defaultView?.classList.add('hidden');
  card.classList.remove('hidden');
  content.innerHTML = activeBoardCard.body;
  actions.innerHTML = '';
  activeBoardCard.buttons.forEach((btn) => {
    const el = document.createElement('button');
    el.className = 'btn' + (btn.primary ? ' btn-primary' : '');
    el.textContent = btn.label;
    el.onclick = btn.action;
    actions.appendChild(el);
  });
}

function closeBoardCard() {
  activeBoardCard = null;
  $('#board-card')?.classList.add('hidden');
  $('#board-center-default')?.classList.remove('hidden');
}

function buildPropertyCardHtml(cellId, extra = '') {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const owner = prop.owner !== null ? state.players[prop.owner] : null;
  const color = cell.color ? COLORS[cell.color] : null;
  const accent = color?.bg || '#555';

  let rows = '';
  if (cell.price) rows += `<div class="property-card-row"><span>Precio</span><strong>${formatMoney(cell.price)}</strong></div>`;
  if (cell.type === 'property' && cell.group) {
    const rents = RENT_TABLES[cell.group];
    rows += `<div class="property-card-row"><span>Alquiler</span><strong>${formatMoney(rents[0])}</strong></div>`;
    rows += `<div class="property-card-rents">${rents.map((r, i) => i === 0 ? '' : i < 5 ? `<span>${i}🏠 ${formatMoney(r)}</span>` : `<span>🏨 ${formatMoney(r)}</span>`).join('')}</div>`;
  }
  if (cell.type === 'railroad') rows += `<div class="property-card-row"><span>Tipo</span><strong>Estación de Metro</strong></div>`;
  if (cell.type === 'utility') rows += `<div class="property-card-row"><span>Tipo</span><strong>Servicio público</strong></div>`;
  if (owner) rows += `<div class="property-card-row"><span>Dueño</span><strong>${owner.name}${prop.mortgaged ? ' (hipotecada)' : ''}</strong></div>`;
  if (prop.houses > 0) rows += `<div class="property-card-row"><span>Edificios</span><strong>${prop.houses === 5 ? 'Hotel' : prop.houses + ' casas'}</strong></div>`;
  if (prop.owner !== null && !prop.mortgaged && isOwnableCell(cell)) {
    rows += `<div class="property-card-row highlight"><span>Alquiler actual</span><strong>${formatMoney(calcRent(cellId))}</strong></div>`;
  }

  return `
    <div class="property-card" style="--card-color:${accent}">
      <div class="property-card-band" style="background:${accent}"></div>
      <div class="property-card-name">${cell.name}</div>
      ${color ? `<div class="property-card-group">${color.name}</div>` : ''}
      <div class="property-card-body">${rows}${extra}</div>
    </div>
  `;
}

function showModal(title, body, buttons) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  const actions = $('#modal-actions');
  actions.innerHTML = '';
  buttons.forEach((btn) => {
    const el = document.createElement('button');
    el.className = 'btn' + (btn.primary ? ' btn-primary' : '');
    el.textContent = btn.label;
    el.onclick = btn.action;
    actions.appendChild(el);
  });
  $('#modal').classList.remove('hidden');
}

function closeModal() {
  $('#modal').classList.add('hidden');
}

function showBuyModal(cellId) {
  const cell = BOARD[cellId];
  const rent = cell.type === 'property' ? RENT_TABLES[cell.group][0] : null;
  const extra = `
    <div class="property-card-extra">
      <div class="property-card-row"><span>Tu dinero</span><strong>${formatMoney(currentPlayer().money)}</strong></div>
      ${rent != null ? `<div class="property-card-row"><span>Alquiler base</span><strong>${formatMoney(rent)}</strong></div>` : ''}
    </div>`;

  showBoardCard(
    buildPropertyCardHtml(cellId, extra),
    [
      { label: `Comprar (${formatMoney(cell.price)})`, action: () => buyProperty(cellId), primary: true },
      { label: 'Subastar', action: () => declineProperty() },
    ],
  );
}

function showRaiseFundsModal(playerId, amount, reason) {
  const player = state.players[playerId];
  const needed = amount - player.money;

  showModal(
    '💸 Necesitas más dinero',
    `<p>${player.name} debe pagar ${formatMoney(amount)} (${reason}) pero solo tiene ${formatMoney(player.money)}.</p>
     <p>Hipoteca propiedades o vende casas en el panel de acciones, luego pulsa <strong>Pagar deuda</strong>.</p>
     <p class="funds-needed">Faltan: ${formatMoney(needed)}</p>`,
    [
      {
        label: 'Gestionar activos',
        action: () => {
          closeModal();
          render();
        },
        primary: true,
      },
      {
        label: 'Declarar quiebra',
        action: () => {
          closeModal();
          declareBankruptcyFromDebt();
        },
      },
    ],
  );
}

// ─── Renderizado ─────────────────────────────────────────────
// ─── Dados 3D ────────────────────────────────────────────────
const DICE_BASE = `${window.location.origin}/vendor/dice-box/`;

async function initDiceBox() {
  if (diceBoxReady) return true;

  const container = $('#dice-box');
  const stage = $('#dice-stage');
  if (!container || !stage) return false;

  try {
    const { default: DiceBox } = await import(`${DICE_BASE}dice-box.es.min.js`);
    diceBox = new DiceBox({
      container: '#dice-box',
      assetPath: 'assets/',
      origin: DICE_BASE,
      themeColor: '#ffffff',
      scale: 9,
      enableShadows: true,
    });
    await diceBox.init();
    diceBoxReady = true;
    stage.classList.add('webgl-ready');
    stage.classList.remove('fallback-ready');
    return true;
  } catch (error) {
    console.error('Dados 3D no disponibles:', error);
    stage.classList.add('fallback-ready');
    stage.classList.remove('webgl-ready');
    return false;
  }
}

async function animateDice() {
  const result = $('#dice-result');
  const stage = $('#dice-stage');

  if (await initDiceBox()) {
    try {
      if (result) result.textContent = 'Tirando...';
      const rolls = await diceBox.roll('2d6');
      const values = (Array.isArray(rolls) ? rolls : [])
        .map((die) => Number(die.value))
        .filter((n) => n >= 1 && n <= 6);
      if (values.length >= 2) {
        const [d1, d2] = values;
        if (result) result.textContent = `${d1} + ${d2} = ${d1 + d2}`;
        return [d1, d2];
      }
    } catch (error) {
      console.error('Error al tirar dados 3D:', error);
    }
  }

  // Respaldo CSS solo si WebGL falla
  stage?.classList.add('fallback-ready');
  stage?.classList.remove('webgl-ready');
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const el1 = $('#die1');
  const el2 = $('#die2');
  if (el1 && el2) {
    el1.style.transform = getDieTransform(d1, 1);
    el2.style.transform = getDieTransform(d2, 2);
  }
  if (result) result.textContent = `${d1} + ${d2} = ${d1 + d2}`;
  return [d1, d2];
}

function getDieTransform(value, index = 1) {
  const settle = index === 1 ? 'rotateZ(2deg)' : 'rotateZ(-4deg)';
  const transforms = {
    1: `rotateX(-18deg) rotateY(28deg) ${settle}`,
    2: `rotateX(-12deg) rotateY(208deg) ${settle}`,
    3: `rotateX(-14deg) rotateY(-62deg) ${settle}`,
    4: `rotateX(-14deg) rotateY(118deg) ${settle}`,
    5: `rotateX(-108deg) rotateY(18deg) ${settle}`,
    6: `rotateX(72deg) rotateY(22deg) ${settle}`,
  };
  return transforms[value] || transforms[1];
}

function createDieHtml(id, value) {
  return `
    <div class="die" id="${id}" style="transform:${getDieTransform(value || 1, id === 'die1' ? 1 : 2)}" aria-label="Dado ${value || '?'}">
      <div class="die-face face-1"></div>
      <div class="die-face face-2"></div>
      <div class="die-face face-3"><span class="pip"></span></div>
      <div class="die-face face-4"></div>
      <div class="die-face face-5"><span class="pip"></span></div>
      <div class="die-face face-6"></div>
    </div>
  `;
}

function isOwnableCell(cell) {
  return ['property', 'railroad', 'utility'].includes(cell.type);
}

const TOKEN_LAYOUTS = {
  1: [[0, 0]],
  2: [[-44, 0], [44, 0]],
  3: [[-44, -30], [44, -30], [0, 34]],
  4: [[-44, -30], [44, -30], [-44, 30], [44, 30]],
  5: [[-44, -34], [44, -34], [0, 0], [-44, 34], [44, 34]],
  6: [[-44, -34], [0, -34], [44, -34], [-44, 34], [0, 34], [44, 34]],
};

function getTokenOffset(index, total) {
  const layout = TOKEN_LAYOUTS[Math.min(total, 6)] || TOKEN_LAYOUTS[6];
  const [x, y] = layout[index] || [0, 0];
  return `translate(calc(-50% + ${x}%), calc(-50% + ${y}%))`;
}

function renderTokenLayer(board, positions) {
  const layer = document.createElement('div');
  layer.className = 'token-layer';
  layer.id = 'token-layer';

  const grouped = {};
  state.players.filter((p) => !p.bankrupt).forEach((player) => {
    if (!grouped[player.position]) grouped[player.position] = [];
    grouped[player.position].push(player);
  });

  Object.entries(grouped).forEach(([cellId, players]) => {
    const pos = positions[Number(cellId)];
    const slot = document.createElement('div');
    slot.className = 'token-slot';
    slot.style.gridRow = pos.row;
    slot.style.gridColumn = pos.col;
    slot.dataset.count = String(players.length);

    players.forEach((player, index) => {
      const token = document.createElement('span');
      token.className = `token${movingTokenId === player.id ? ' token-moving animate__animated animate__pulse' : ''}`;
      token.style.setProperty('--token-color', player.color);
      token.style.background = player.color;
      token.style.transform = `${getTokenOffset(index, players.length)} translateZ(22px) rotateX(-12deg)`;
      token.title = player.name;
      token.innerHTML = `<i class="fa-solid ${player.token.icon}"></i>`;
      slot.appendChild(token);
    });

    layer.appendChild(slot);
  });

  board.appendChild(layer);
}

function renderBoard() {
  const board = $('#board');
  const savedStage = document.getElementById('dice-stage');
  const keepStage = savedStage?.querySelector('canvas') ? savedStage : null;
  board.innerHTML = '';

  const positions = getBoardPositions();

  BOARD.forEach((cell, i) => {
    const pos = positions[i];
    const prop = state.properties[i];
    const ownable = isOwnableCell(cell);
    const el = document.createElement('div');
    el.className = `cell cell-${cell.type}${cell.color ? ` cell-color-${cell.color}` : ''}`;
    el.style.gridRow = pos.row;
    el.style.gridColumn = pos.col;

    if (ownable && cell.color && COLORS[cell.color]) {
      el.style.setProperty('--cell-color', COLORS[cell.color].bg);
    }

    let housesHtml = '';
    if (ownable && prop.houses > 0) {
      const isHotel = prop.houses === 5;
      housesHtml = `<div class="houses">${isHotel ? '🏨' : '▪'.repeat(prop.houses)}</div>`;
    }

    const owner = ownable && prop.owner !== null ? state.players[prop.owner] : null;

    el.innerHTML = `
      ${ownable ? '<div class="cell-color-bar"></div>' : ''}
      <div class="cell-name">${cell.name}</div>
      ${ownable && cell.price ? `<div class="cell-price">${formatMoney(cell.price)}</div>` : ''}
      ${cell.type === 'go' ? '<div class="cell-desc">+$200</div>' : ''}
      ${cell.type === 'tax' ? `<div class="cell-desc">${formatMoney(cell.amount)}</div>` : ''}
      ${housesHtml}
      ${ownable && prop.mortgaged ? '<div class="mortgaged">HIP</div>' : ''}
      ${owner ? `<div class="owner-dot" style="background:${owner.color}" title="${owner.name}"></div>` : ''}
    `;

    el.onclick = () => showCellInfo(i);
    board.appendChild(el);
  });

  const center = document.createElement('div');
  center.className = 'board-center';
  center.style.gridRow = '2 / 11';
  center.style.gridColumn = '2 / 11';
  center.innerHTML = `
    <div class="board-center-default" id="board-center-default">
      <h1>Imperio Urbano</h1>
      <p class="tagline">Domina la ciudad</p>
      <div class="board-action${state.log[0] ? '' : ' hidden'}" id="board-action">${state.log[0] || ''}</div>
      <div class="dice-stage" id="dice-stage">
        <div class="dice-box" id="dice-box"></div>
        <div class="dice-fallback">
          ${createDieHtml('die1', state.dice[0])}
          ${createDieHtml('die2', state.dice[1])}
        </div>
      </div>
      <div class="dice-result" id="dice-result">${state.dice[0] ? `${state.dice[0]} + ${state.dice[1]} = ${state.dice[0] + state.dice[1]}` : 'Listo para tirar'}</div>
    </div>
    <div class="board-card hidden" id="board-card">
      <div class="board-card-content" id="board-card-content"></div>
      <div class="board-card-actions" id="board-card-actions"></div>
    </div>
  `;
  board.appendChild(center);

  renderTokenLayer(board, positions);

  if (keepStage) {
    $('#dice-stage')?.replaceWith(keepStage);
    if (diceBoxReady) keepStage.classList.add('webgl-ready');
    diceBox?.resizeWorld?.();
  }

  if (activeBoardCard) paintBoardCard();
}

function getBoardPositions() {
  const pos = [];
  // Esquina inferior derecha (SALIDA) → fila inferior izquierda (Comisaría)
  for (let i = 0; i <= 10; i++) pos.push({ row: 11, col: 11 - i });
  // Columna izquierda ascendente (sin esquinas)
  for (let i = 11; i <= 19; i++) pos.push({ row: 21 - i, col: 1 });
  // Esquina superior izquierda (Zona Libre) → superior derecha (¡A la Comisaría!)
  for (let i = 20; i <= 30; i++) pos.push({ row: 1, col: i - 19 });
  // Columna derecha descendente (sin esquinas) — termina en fila 10, no en SALIDA
  for (let i = 31; i <= 39; i++) pos.push({ row: i - 29, col: 11 });
  return pos;
}

function showCellInfo(cellId) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const owner = prop.owner !== null ? state.players[prop.owner] : null;

  let extra = '';
  if (owner && owner.id === currentPlayer().id && cell.type === 'property') {
    const groupOwned = ownsFullGroup(owner.id, cell.group);
    extra = `<div class="property-card-extra"><p>${groupOwned ? '✅ Monopolio del grupo' : '❌ Falta completar el grupo'}</p></div>`;
  }

  const buttons = [{ label: 'Cerrar', action: closeBoardCard }];
  if (owner && owner.id === currentPlayer().id && prop.houses === 0 && !prop.mortgaged &&
      (state.phase === 'end' || state.phase === 'build')) {
    buttons.unshift({
      label: 'Incluir en trato',
      action: () => { closeBoardCard(); showTradePartnerSelect(); },
    });
  }

  showBoardCard(buildPropertyCardHtml(cellId, extra), buttons);
}

function renderPlayers() {
  const container = $('#players-panel');
  container.innerHTML = '';

  state.players.forEach((player, i) => {
    const isCurrent = i === state.currentPlayer && !state.winner;
    const assets = getPlayerAssets(player.id);
    const el = document.createElement('div');
    el.className = `player-card${isCurrent ? ' active' : ''}${player.bankrupt ? ' bankrupt' : ''}`;
    el.innerHTML = `
      <div class="player-header">
        <span class="player-token" style="--token-color:${player.color}"><i class="fa-solid ${player.token.icon}"></i></span>
        <span class="player-name">${player.name}</span>
        ${isCurrent ? '<span class="turn-badge">TU TURNO</span>' : ''}
      </div>
      <div class="player-money">${formatMoney(player.money)}</div>
      <div class="player-meta">
        ${player.inJail ? '🚔 En la Comisaría' : `📍 ${BOARD[player.position].name}`}
        ${player.jailFreeCards ? ` | 🎫 ${player.jailFreeCards}` : ''}
      </div>
      <div class="player-assets">
        🏘️ ${assets.props.length} props · 💎 ${formatMoney(player.money + assets.total)}
      </div>
      ${player.bankrupt ? '<div class="bankrupt-label">QUEBRADO</div>' : ''}
    `;
    container.appendChild(el);
  });
}

function renderActions() {
  const container = $('#actions-panel');
  const player = currentPlayer();
  container.innerHTML = '';

  if (state.winner || player.bankrupt) return;

  const addBtn = (label, fn, primary = false, disabled = false) => {
    const btn = document.createElement('button');
    btn.className = `btn${primary ? ' btn-primary' : ''}`;
    btn.textContent = label;
    btn.disabled = disabled;
    btn.onclick = fn;
    container.appendChild(btn);
  };

  addBtn('💾 Copiar partida', copySaveToClipboard);

  if (state.phase === 'roll') {
    addBtn('🤝 Negociar', showTradePartnerSelect);
    if (player.inJail) {
      if (player.money >= JAIL_BAIL) {
        addBtn(`💰 Pagar fianza (${formatMoney(JAIL_BAIL)})`, () => {
          player.inJail = false;
          player.jailTurns = 0;
          state.doublesCount = 0;
          transferMoney(player.id, null, JAIL_BAIL, 'fianza');
          addLog(`${player.name} paga fianza y sale de la Comisaría.`);
          state.phase = 'roll';
          render();
        });
      }
      if (player.jailFreeCards > 0) {
        addBtn('🎫 Usar carta de salida', () => {
          player.inJail = false;
          player.jailTurns = 0;
          state.doublesCount = 0;
          player.jailFreeCards--;
          addLog(`${player.name} usa carta de salida.`);
          state.phase = 'roll';
          render();
        });
      }
      addBtn(`🎲 Tirar dados (intento ${player.jailTurns + 1}/3)`, rollDice, true);
    } else {
      addBtn('🎲 Tirar dados', rollDice, true);
    }
  }

  if (state.phase === 'end' || state.phase === 'build') {
    addBtn('🤝 Negociar', showTradePartnerSelect);
    if (state.doublesCount === 0 || player.inJail) {
      addBtn('✅ Terminar turno', endTurn, true);
    }
  }

  if (state.phase === 'raiseFunds') {
    addBtn('🤝 Negociar', showTradePartnerSelect);
    if (pendingAction?.type === 'raiseFunds') {
      const owed = pendingAction.amount;
      const missing = Math.max(0, owed - player.money);
      const debtInfo = document.createElement('div');
      debtInfo.className = 'debt-banner';
      debtInfo.innerHTML = `
        <p><strong>Deuda pendiente:</strong> ${formatMoney(owed)} (${pendingAction.reason})</p>
        <p>Tienes ${formatMoney(player.money)}${missing > 0 ? ` · Faltan ${formatMoney(missing)}` : ' · Puedes pagar'}</p>`;
      container.appendChild(debtInfo);
      addBtn(`💸 Pagar ${formatMoney(owed)}`, () => {
        if (completePendingPayment()) render();
      }, true, player.money < owed);
      addBtn('💀 Declarar quiebra', declareBankruptcyFromDebt);
    }
  }

  if (state.phase === 'end' || state.phase === 'build' || state.phase === 'raiseFunds') {
    const section = document.createElement('div');
    section.className = 'build-section';
    section.innerHTML = '<h4>Tus propiedades</h4>';
    container.appendChild(section);

    const assets = getPlayerAssets(player.id);
    assets.props.forEach(({ id, cell, houses, mortgaged }) => {
      const row = document.createElement('div');
      row.className = 'prop-row';
      const canBuild = cell.type === 'property' && ownsFullGroup(player.id, cell.group) && !mortgaged && houses < 5;
      const canSell = houses > 0;
      const canMortgage = houses === 0;

      row.innerHTML = `
        <span class="prop-name" style="border-left: 4px solid ${COLORS[cell.color]?.bg || '#666'}">${cell.name}${houses ? ` (${houses === 5 ? '🏨' : houses + '🏠'})` : ''}${mortgaged ? ' [HIP]' : ''}</span>
      `;

      if (canBuild) {
        const groupCells = getGroupCells(cell.group);
        const minHousesInGroup = Math.min(...groupCells.map((gid) => state.properties[gid].houses));
        const needHotel = houses === 4;
        const canBuildEvenly = houses === minHousesInGroup;
        const hasSupply = needHotel ? state.hotelsLeft > 0 : state.housesLeft > 0;
        const cost = HOUSE_COST[cell.group];

        if (canBuildEvenly && hasSupply && player.money >= cost) {
          const b = document.createElement('button');
          b.className = 'btn-sm';
          b.textContent = needHotel
            ? `+ Hotel (${formatMoney(cost)})`
            : `+ Casa (${formatMoney(cost)})`;
          b.onclick = () => buildHouse(id);
          row.appendChild(b);
        }
      }
      if (canSell) {
        const b = document.createElement('button');
        b.className = 'btn-sm';
        b.textContent = '- Vender';
        b.onclick = () => sellHouse(id);
        row.appendChild(b);
      }
      if (canMortgage) {
        const b = document.createElement('button');
        b.className = 'btn-sm';
        b.textContent = mortgaged ? 'Recuperar' : 'Hipotecar';
        b.onclick = () => toggleMortgage(id);
        row.appendChild(b);
      }

      section.appendChild(row);
    });
  }

  // Info de banco
  const info = document.createElement('div');
  info.className = 'bank-info';
  info.innerHTML = `<small>🏠 Casas: ${state.housesLeft} | 🏨 Hoteles: ${state.hotelsLeft}<br>🅿️ Zona Libre: ${formatMoney(state.freeParkingPot)}</small>`;
  container.appendChild(info);
}

function renderLog() {
  const log = $('#game-log');
  log.innerHTML = state.log.map((m) => `<div class="log-entry">${m}</div>`).join('');
  updateBoardAction();
}

function render() {
  renderBoard();
  renderPlayers();
  tryContinueDoubleTurn();
  renderActions();
  renderLog();
  saveGame();
}

// ─── Guardado de partida ─────────────────────────────────────
function packSaveData() {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    state: {
      ...state,
      auction: state.auction
        ? { ...state.auction, passed: [...state.auction.passed] }
        : null,
    },
    pendingAction,
  };
}

function unpackSaveData(data) {
  if (!data?.state?.players?.length) throw new Error('Datos de partida inválidos.');

  const loadedState = data.state;
  if (loadedState.auction?.passed) {
    loadedState.auction.passed = new Set(loadedState.auction.passed);
  }

  loadedState.players.forEach((player) => {
    const tokenId = player.token?.id ?? player.token;
    player.token = PLAYER_TOKENS.find((t) => t.id === tokenId) || PLAYER_TOKENS[player.id] || PLAYER_TOKENS[0];
    player.id = player.id ?? loadedState.players.indexOf(player);
  });

  return {
    state: loadedState,
    pendingAction: data.pendingAction ?? null,
  };
}

function saveGame() {
  if (!state || state.winner) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(packSaveData()));
  } catch {
    // Quota exceeded or private browsing — ignore silently
  }
}

function loadSavedGameMeta() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    unpackSaveData(data);
    return data;
  } catch {
    return null;
  }
}

function clearSavedGame() {
  localStorage.removeItem(SAVE_KEY);
}

function resumeFromSaveData(data) {
  const loaded = unpackSaveData(data);
  state = loaded.state;
  pendingAction = loaded.pendingAction;
  tradeDraft = null;
  activeBoardCard = null;
  if (state.phase === 'rolling') state.phase = 'end';
  if (state.players[state.currentPlayer]?.inJail) state.doublesCount = 0;
  closeModal();
  closeBoardCard();

  $('#setup-screen').classList.add('hidden');
  $('#game-screen').classList.remove('hidden');
  render();
  initDiceBox();
  addLog('Partida restaurada.');
}

function resumeGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  resumeFromSaveData(JSON.parse(raw));
}

function exportSaveJson() {
  if (!state) return null;
  return JSON.stringify(packSaveData(), null, 2);
}

async function copySaveToClipboard() {
  const json = exportSaveJson();
  if (!json) return;
  try {
    await navigator.clipboard.writeText(json);
    addLog('Copia de seguridad copiada al portapapeles.');
  } catch {
    addLog('No se pudo copiar. Usa «Restaurar partida» en la pantalla inicial.');
  }
}

function importSaveFromText(text) {
  const data = JSON.parse(text.trim());
  if (data.version !== SAVE_VERSION) throw new Error('Versión de guardado no compatible.');
  resumeFromSaveData(data);
}

function formatSaveSummary(data) {
  const players = data.state.players.filter((p) => !p.bankrupt);
  const turn = data.state.players[data.state.currentPlayer]?.name ?? '?';
  const when = new Date(data.savedAt).toLocaleString('es-ES', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return `${players.length} jugadores · turno de ${turn} · guardado ${when}`;
}

function updateResumeSection() {
  const section = $('#resume-section');
  const startBtn = $('#start-btn');
  const data = loadSavedGameMeta();
  if (!section) return;

  if (data) {
    section.classList.remove('hidden');
    const summary = $('#resume-summary');
    if (summary) summary.textContent = formatSaveSummary(data);
    startBtn?.classList.remove('btn-primary');
    startBtn?.classList.add('btn-ghost');
  } else {
    section.classList.add('hidden');
    startBtn?.classList.add('btn-primary');
    startBtn?.classList.remove('btn-ghost');
  }
}

// ─── Setup ───────────────────────────────────────────────────
function startGame() {
  const count = parseInt($('#player-count').value);
  const playerConfigs = [];
  for (let i = 0; i < count; i++) {
    const tokenId = $(`input[name="player-token-${i}"]:checked`)?.value || PLAYER_TOKENS[i].id;
    const token = PLAYER_TOKENS.find((item) => item.id === tokenId) || PLAYER_TOKENS[i];
    playerConfigs.push({
      name: $(`#player-name-${i}`).value,
      token,
    });
  }

  state = createInitialState(playerConfigs);
  $('#setup-screen').classList.add('hidden');
  $('#game-screen').classList.remove('hidden');
  render();
  initDiceBox();
}

function initSetup() {
  const countSelect = $('#player-count');
  const namesContainer = $('#player-names');

  function updateNameInputs() {
    const count = parseInt(countSelect.value);
    namesContainer.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const tokenOptions = PLAYER_TOKENS.map((token, tokenIndex) => `
        <label class="token-choice" title="${token.name}">
          <input type="radio" name="player-token-${i}" value="${token.id}" ${tokenIndex === i ? 'checked' : ''}>
          <span style="--token-color:${PLAYER_COLORS[i]}">
            <i class="fa-solid ${token.icon}"></i>
          </span>
        </label>
      `).join('');

      namesContainer.innerHTML += `
        <div class="name-input">
          <label><span class="inline-token" style="--token-color:${PLAYER_COLORS[i]}"><i class="fa-solid ${PLAYER_TOKENS[i].icon}"></i></span> Jugador ${i + 1}</label>
          <input type="text" id="player-name-${i}" placeholder="Nombre" maxlength="12"
            style="border-color: ${PLAYER_COLORS[i]}">
          <div class="token-picker" aria-label="Ficha del jugador ${i + 1}">${tokenOptions}</div>
        </div>`;
    }
  }

  countSelect.addEventListener('change', updateNameInputs);
  updateNameInputs();
  updateResumeSection();

  $('#start-btn').addEventListener('click', startGame);
  $('#resume-btn')?.addEventListener('click', resumeGame);
  $('#discard-save-btn')?.addEventListener('click', () => {
    if (confirm('¿Descartar la partida guardada y empezar una nueva?')) {
      clearSavedGame();
      updateResumeSection();
    }
  });
  $('#import-btn')?.addEventListener('click', () => {
    const text = $('#import-save')?.value?.trim();
    if (!text) return;
    try {
      importSaveFromText(text);
    } catch (err) {
      alert(err.message || 'No se pudo importar la partida.');
    }
  });
}

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initSetup);

if (typeof window !== 'undefined') {
  window.__imperioUrbano = { exportSaveJson, importSaveFromText, resumeGame };
}
