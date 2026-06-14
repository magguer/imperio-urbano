import {
  BOARD, COLORS, RENT_TABLES, HOUSE_COST, GO_BONUS, JAIL_POSITION,
  GO_TO_JAIL_POSITION, PLAYER_COLORS, PLAYER_TOKENS, JAIL_BAIL,
  CITY_CARDS, FORTUNE_CARDS, THEME, applyTheme, shuffleDeck,
} from './board.js';
import {
  createTradeOffer, validateTrade, executeTrade, renderPropertyCheckboxes,
} from './trade.js';
import {
  createAuction, getCurrentBidder, advanceBidder, placeBid, passBid,
  isAuctionOver, getAuctionSummary, allPassed,
} from './auction.js';
import { THEMES, getTheme } from './themes/index.js';
import { DEFAULT_BUILDINGS } from './themes/shared.js';
import { getDifficultyPreset, DIFFICULTY_LIST, formatDifficultySummary } from './difficulty.js';
import {
  shouldBuyProperty, decideAuctionBid, decideJailAction, pickBuildTarget,
  pickHouseToSell, pickPropertyToMortgage, shouldAcceptTrade, defaultAIName,
} from './ai.js';
import * as sounds from './sounds.js';

const t = () => THEME.strings;
const tb = () => THEME?.strings?.buildings ?? DEFAULT_BUILDINGS;

function formatBuildingBadge(count) {
  if (!count) return '';
  if (count === 5) return tb().hotelEmoji;
  return `${count}${tb().houseEmoji}`;
}

function formatBuildingLabel(count) {
  if (count === 5) {
    const hotel = tb().hotel;
    return hotel.charAt(0).toUpperCase() + hotel.slice(1);
  }
  return `${count} ${tb().houses}`;
}

// ─── Estado global ───────────────────────────────────────────
let state = null;
let pendingAction = null;
let tradeDraft = null;
let movingTokenId = null;
let diceBox = null;
let diceBoxReady = false;
let diceBoxInitPromise = null;
let activeBoardCard = null;
let expandedPlayerId = null;
let collapsedPropGroups = new Set();
let logPanelCollapsed = true;
let aiTurnScheduled = false;
let aiTurnRunning = false;

const SAVE_KEY = 'imperio-urbano-save';
const SAVE_VERSION = 1;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createInitialState(playerConfigs, themeId = 'default', difficultyId = 'normal') {
  applyTheme(themeId);
  const difficulty = getDifficultyPreset(difficultyId);

  const properties = BOARD.map((cell) => ({
    owner: null,
    houses: 0,
    mortgaged: false,
  }));

  const players = playerConfigs.map(({ name, token, isAI }, i) => ({
    id: i,
    name: name.trim() || (isAI ? defaultAIName(i) : `Jugador ${i + 1}`),
    token,
    color: PLAYER_COLORS[i],
    isAI: !!isAI,
    money: difficulty.startingMoney,
    position: 0,
    inJail: false,
    jailTurns: 0,
    jailFreeCards: 0,
    bankrupt: false,
  }));

  return {
    themeId,
    difficultyId: difficulty.id,
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
    log: [t().welcomeLog],
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

function isAIPlayer(player = currentPlayer()) {
  return !!player?.isAI;
}

function scheduleAI() {
  if (aiTurnScheduled || aiTurnRunning || !state || state.winner) return;
  const player = currentPlayer();
  if (!player?.isAI || player.bankrupt) return;
  if (state.phase === 'rolling' || state.phase === 'auction') return;

  aiTurnScheduled = true;
  setTimeout(() => {
    aiTurnScheduled = false;
    runAITurn();
  }, 650);
}

let lastBoardAction = null;

function addLog(msg, options = {}) {
  state.log.unshift(msg);
  if (state.log.length > 50) state.log.pop();
  renderLog();
  if (!options.skipBoardAction) {
    setBoardAction({ type: 'message', message: msg });
  }
  pulseBoardAction();
}

function setBoardAction(action) {
  lastBoardAction = action;
  paintBoardAction();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BOARD_CONNECTOR_PHRASES = [
  'está en su propiedad:',
  'está hipotecada. Sin alquiler.',
  'no tiene dinero para comprar',
  'no tiene dinero para construir en',
  'aún necesita',
  'para pagar',
  'de alquiler por',
  'debe pagar',
  'pasa por',
  'llega a',
  'y cobra',
  'al fondo',
  'no saca doble',
  'saca doble',
  'paga fianza',
  'declara quiebra',
  'visita la',
  'descansa en',
  'usa carta de salida',
  'construye un',
  'construye una',
  'rechaza el trato con',
  'gana',
  'por',
  'cobra',
  'recibe',
  'compra',
  'vende',
  'hipoteca',
  'recupera',
  'obtiene',
  'tira',
  'va a',
  'debe',
  'paga',
  ' a ',
  ' al ',
  ' de ',
  ' en ',
  ' con ',
  ' sin ',
  ' y ',
  ' su ',
  ' el ',
  ' la ',
  ' los ',
  ' las ',
];

function wrapBoardConnectors(text) {
  let result = text;
  const tokens = [];

  for (const phrase of BOARD_CONNECTOR_PHRASES) {
    const regex = new RegExp(escapeRegex(phrase), 'gi');
    result = result.replace(regex, (match) => {
      const id = `@@C${tokens.length}@@`;
      tokens.push({ id, html: `<span class="board-msg-connector">${match}</span>` });
      return id;
    });
  }

  for (const { id, html } of tokens) {
    result = result.split(id).join(html);
  }

  return result;
}

function colorizeLogText(text) {
  let work = escapeHtml(text);
  const tokens = [];

  const players = [...state.players]
    .filter((p) => p.name)
    .sort((a, b) => b.name.length - a.name.length);

  for (const player of players) {
    const regex = new RegExp(escapeRegex(player.name), 'gi');
    work = work.replace(regex, (match) => {
      const id = `@@P${tokens.length}@@`;
      tokens.push({
        id,
        html: `<span class="board-msg-player" style="--player-color:${player.color}">${match}</span>`,
      });
      return id;
    });
  }

  work = work.replace(/\$(\d+)/g, (match) => {
    const id = `@@A${tokens.length}@@`;
    tokens.push({ id, html: `<span class="board-msg-amount">${match}</span>` });
    return id;
  });

  const cellNames = [...BOARD].map((c) => c.name).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of cellNames) {
    const regex = new RegExp(escapeRegex(name), 'gi');
    work = work.replace(regex, (match) => `<span class="board-msg-detail">${match}</span>`);
  }

  work = wrapBoardConnectors(work);

  for (const { id, html } of tokens) {
    work = work.split(id).join(html);
  }

  return work;
}

function colorizeBoardMessage(text) {
  return `<div class="board-message">${colorizeLogText(text)}</div>`;
}

function buildTransferDescription(action) {
  const { from, to, amount, reason, toFreeParking, toBank } = action;
  const fromSpan = `<span class="board-msg-player" style="--player-color:${from.color}">${escapeHtml(from.name)}</span>`;
  const amountSpan = `<span class="board-msg-amount">${formatMoney(amount)}</span>`;

  if (to) {
    const toSpan = `<span class="board-msg-player" style="--player-color:${to.color}">${escapeHtml(to.name)}</span>`;
    const reasonHtml = reason
      ? ` <span class="board-msg-connector">por</span> <span class="board-msg-detail">${escapeHtml(reason)}</span>`
      : '';
    return `<div class="board-message">${fromSpan} <span class="board-msg-connector">paga</span> ${amountSpan} <span class="board-msg-connector">a</span> ${toSpan}${reasonHtml}</div>`;
  }

  if (toFreeParking) {
    return `<div class="board-message">${fromSpan} <span class="board-msg-connector">paga</span> ${amountSpan} <span class="board-msg-connector">al fondo</span> <span class="board-msg-detail">${escapeHtml(t().parkingName)}</span></div>`;
  }

  if (toBank) {
    const reasonHtml = reason
      ? ` <span class="board-msg-connector">por</span> <span class="board-msg-detail">${escapeHtml(reason)}</span>`
      : '';
    return `<div class="board-message">${fromSpan} <span class="board-msg-connector">paga</span> ${amountSpan} <span class="board-msg-connector">al banco</span>${reasonHtml}</div>`;
  }

  return colorizeBoardMessage(`${from.name} paga ${formatMoney(amount)}.`);
}

function buildBoardActionHtml(action) {
  if (action.type === 'message') {
    return colorizeBoardMessage(action.message);
  }

  return buildTransferDescription(action);
}

function paintBoardAction() {
  const el = $('#board-action');
  if (!el) return;

  if (!lastBoardAction) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }

  if (lastBoardAction.type === 'transfer' || lastBoardAction.type === 'message') {
    el.innerHTML = buildBoardActionHtml(lastBoardAction);
  } else {
    el.textContent = lastBoardAction.message;
  }
  el.classList.remove('hidden');
}

function pulseBoardAction() {
  const el = $('#board-action');
  if (!el || el.classList.contains('hidden')) return;
  el.classList.remove('board-action-pop');
  void el.offsetWidth;
  el.classList.add('board-action-pop');
}

function formatMoney(n) {
  return `$${n}`;
}

function diff() {
  return getDifficultyPreset(state?.difficultyId || 'normal');
}

function goBonusAmount() {
  return Math.round(GO_BONUS * diff().goBonusMul);
}

function jailBailAmount() {
  return Math.round(JAIL_BAIL * diff().jailBailMul);
}

function scaleTax(amount) {
  return Math.round(amount * diff().taxMul);
}

function scaleCardFine(amount) {
  return Math.round(Math.abs(amount) * diff().fineMul);
}

function scaleCardIncome(amount) {
  return Math.round(amount * diff().cardIncomeMul);
}

function mortgageInterestAmount(price) {
  return Math.ceil(price * 0.1 * diff().mortgageInterestMul);
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

  setBoardAction({
    type: 'transfer',
    from,
    to,
    amount,
    reason,
    toFreeParking,
    toBank: !to && !toFreeParking,
  });

  addLog(
    `${from.name} paga ${formatMoney(amount)}${reason ? ` (${reason})` : ''}${to ? ` a ${to.name}` : toFreeParking ? ` al fondo ${t().parkingName}` : ''}.`,
    { skipBoardAction: true },
  );
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
  if (from.isAI) {
    scheduleAI();
    return false;
  }
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
  if (action.toId != null) checkBankruptcy(action.fromId, action.toId);
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

function buildPlayerPropertyListHtml(props) {
  if (!props.length) {
    return '<p class="player-detail-empty">Sin propiedades todavía</p>';
  }

  const sorted = [...props].sort((a, b) => a.id - b.id);
  const railroads = [];
  const utilities = [];
  const byGroup = new Map();

  sorted.forEach((item) => {
    if (item.cell.type === 'railroad') {
      railroads.push(item);
      return;
    }
    if (item.cell.type === 'utility') {
      utilities.push(item);
      return;
    }
    const key = item.cell.color || 'other';
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        label: COLORS[key]?.name || key,
        color: COLORS[key]?.bg || '#666',
        items: [],
      });
    }
    byGroup.get(key).items.push(item);
  });

  const renderItem = ({ id, cell, houses, mortgaged }) => {
    const color = COLORS[cell.color]?.bg || '#666';
    const extras = [];
    if (houses > 0) extras.push(formatBuildingBadge(houses));
    if (mortgaged) extras.push('HIP');
    return `
      <button type="button" class="player-prop-item" data-cell-id="${id}" title="Ver ${cell.name}">
        <span class="player-prop-color" style="background:${color}"></span>
        <span class="player-prop-name">${cell.name}</span>
        ${extras.length ? `<span class="player-prop-extra">${extras.join(' ')}</span>` : ''}
      </button>`;
  };

  const renderSection = (title, items) => {
    if (!items.length) return '';
    return `
      <div class="player-prop-group">
        <div class="player-prop-group-title">${title}</div>
        ${items.map(renderItem).join('')}
      </div>`;
  };

  let html = '';
  byGroup.forEach((group) => {
    html += renderSection(group.label, group.items);
  });
  html += renderSection(t().railroadLabel, railroads);
  html += renderSection(t().utilityLabel, utilities);
  return html;
}

function groupPlayerProperties(props) {
  const sorted = [...props].sort((a, b) => a.id - b.id);
  const groups = [];
  const railroads = [];
  const utilities = [];
  const byGroup = new Map();

  sorted.forEach((item) => {
    if (item.cell.type === 'railroad') {
      railroads.push(item);
      return;
    }
    if (item.cell.type === 'utility') {
      utilities.push(item);
      return;
    }
    const key = item.cell.color || 'other';
    if (!byGroup.has(key)) {
      byGroup.set(key, {
        title: COLORS[key]?.name || key,
        color: COLORS[key]?.bg || '#666',
        items: [],
      });
    }
    byGroup.get(key).items.push(item);
  });

  byGroup.forEach((group) => groups.push(group));
  if (railroads.length) {
    groups.push({ title: t().railroadLabel, color: COLORS.railroad?.bg || '#666', items: railroads });
  }
  if (utilities.length) {
    groups.push({ title: t().utilityLabel, color: COLORS.utility?.bg || '#666', items: utilities });
  }
  return groups;
}

function createPropertyActionCard(id, cell, houses, mortgaged, player) {
  const color = COLORS[cell.color]?.bg || '#666';
  const card = document.createElement('article');
  card.className = 'prop-card';
  card.style.setProperty('--prop-color', color);

  const badges = [];
  if (houses > 0) {
    badges.push(`<span class="prop-badge prop-badge-build">${formatBuildingBadge(houses)}</span>`);
  }
  if (mortgaged) {
    badges.push('<span class="prop-badge prop-badge-hip">HIP</span>');
  }

  card.innerHTML = `
    <div class="prop-card-head">
      <span class="prop-card-color" aria-hidden="true"></span>
      <div class="prop-card-info">
        <span class="prop-card-name">${cell.name}</span>
        ${badges.length ? `<div class="prop-card-badges">${badges.join('')}</div>` : ''}
      </div>
    </div>
    <div class="prop-card-actions"></div>
  `;

  const actions = card.querySelector('.prop-card-actions');
  const canBuild = cell.type === 'property' && ownsFullGroup(player.id, cell.group) && !mortgaged && houses < 5;
  const canSell = houses > 0;
  const canMortgage = houses === 0;

  if (canBuild) {
    const groupCells = getGroupCells(cell.group);
    const minHousesInGroup = Math.min(...groupCells.map((gid) => state.properties[gid].houses));
    const needHotel = houses === 4;
    const canBuildEvenly = houses === minHousesInGroup;
    const hasSupply = needHotel ? state.hotelsLeft > 0 : state.housesLeft > 0;
    const cost = HOUSE_COST[cell.group];

    if (canBuildEvenly && hasSupply && player.money >= cost) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'prop-btn prop-btn-build';
      b.textContent = needHotel
        ? `+ ${tb().buildHotel} (${formatMoney(cost)})`
        : `+ ${tb().buildHouse} (${formatMoney(cost)})`;
      b.onclick = () => buildHouse(id);
      actions.appendChild(b);
    }
  }

  if (canSell) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'prop-btn prop-btn-sell';
    b.textContent = '- Vender';
    b.onclick = () => sellHouse(id);
    actions.appendChild(b);
  }

  if (canMortgage) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `prop-btn ${mortgaged ? 'prop-btn-recover' : 'prop-btn-mortgage'}`;
    b.textContent = mortgaged ? 'Recuperar' : 'Hipotecar';
    b.onclick = () => toggleMortgage(id);
    actions.appendChild(b);
  }

  if (!actions.children.length) {
    actions.classList.add('prop-card-actions--empty');
  }

  return card;
}

function propGroupKey(title, color) {
  return `${color}|${title}`;
}

function renderPlayerPropertyActions(container, player) {
  const assets = getPlayerAssets(player.id);

  groupPlayerProperties(assets.props).forEach(({ title, color, items }) => {
    const key = propGroupKey(title, color);
    const collapsed = collapsedPropGroups.has(key);
    const group = document.createElement('div');
    group.className = `prop-group${collapsed ? ' prop-group--collapsed' : ''}`;
    group.style.setProperty('--prop-group-color', color);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'prop-group-toggle';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.innerHTML = `
      <span class="prop-group-toggle-main">
        <span class="prop-group-color-dot" aria-hidden="true"></span>
        <span class="prop-group-title">${title}</span>
      </span>
      <span class="prop-group-toggle-meta">
        <span class="prop-group-count">${items.length}</span>
        <i class="fa-solid fa-chevron-down prop-group-chevron" aria-hidden="true"></i>
      </span>`;

    const body = document.createElement('div');
    body.className = 'prop-group-body';
    const bodyInner = document.createElement('div');
    bodyInner.className = 'prop-group-body-inner';

    items.forEach(({ id, cell, houses, mortgaged }) => {
      bodyInner.appendChild(createPropertyActionCard(id, cell, houses, mortgaged, player));
    });

    body.appendChild(bodyInner);

    toggle.addEventListener('click', () => {
      const nowCollapsed = group.classList.toggle('prop-group--collapsed');
      toggle.setAttribute('aria-expanded', String(!nowCollapsed));
      if (nowCollapsed) collapsedPropGroups.add(key);
      else collapsedPropGroups.delete(key);
    });

    group.append(toggle, body);
    container.appendChild(group);
  });
}

function buildPlayerDetailsHtml(player, assets) {
  const netWorth = player.money + assets.total;
  const mortgaged = assets.props.filter((p) => p.mortgaged).length;
  const withBuildings = assets.props.filter((p) => p.houses > 0).length;

  const summaryParts = [];
  if (mortgaged) summaryParts.push(`${mortgaged} hipotecada${mortgaged === 1 ? '' : 's'}`);
  if (withBuildings) summaryParts.push(`${withBuildings} con ${tb().houses}`);
  if (player.jailFreeCards) summaryParts.push(`${player.jailFreeCards} ${t().jailFreeCard}`);

  return `
    <div class="player-details">
      <div class="player-detail-stats">
        <div class="player-detail-row">
          <span class="player-detail-label">Efectivo</span>
          <span class="player-detail-value">${formatMoney(player.money)}</span>
        </div>
        <div class="player-detail-row">
          <span class="player-detail-label">En propiedades</span>
          <span class="player-detail-value">${formatMoney(assets.total)}</span>
        </div>
        <div class="player-detail-row player-detail-row-total">
          <span class="player-detail-label">Patrimonio</span>
          <span class="player-detail-value">${formatMoney(netWorth)}</span>
        </div>
      </div>
      <div class="player-detail-header">
        <span class="player-detail-count">${assets.props.length} propiedad${assets.props.length === 1 ? '' : 'es'}</span>
        ${summaryParts.length ? `<span class="player-detail-tags">${summaryParts.join(' · ')}</span>` : ''}
      </div>
      <div class="player-prop-list">
        ${buildPlayerPropertyListHtml(assets.props)}
      </div>
    </div>`;
}

function checkWinner() {
  const alive = activePlayers();
  if (alive.length === 1) {
    state.winner = alive[0];
    state.phase = 'ended';
    clearSavedGame();
    showModal('¡Fin del juego!', `<h2>🏆 ${state.winner.name} gana ${t().gameName}!</h2><p>${t().winMessage}</p>`, [
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
    updateBoardTokens();
    sounds.playTokenStep();
    await sleep(220);
    movingTokenId = null;
    updateBoardTokens();
    await sleep(55);
  }

  if (passedGo && collectGo) {
    const bonus = goBonusAmount();
    player.money += bonus;
    addLog(`${player.name} pasa por ${t().goName} y cobra ${formatMoney(bonus)}.`);
  }

  updateBoardTokens();
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
    const bonus = goBonusAmount();
    player.money += bonus;
    addLog(`${player.name} pasa por ${t().goName} y cobra ${formatMoney(bonus)}.`);
  } else if (target === 0 && collectGo) {
    const bonus = goBonusAmount();
    player.money += bonus;
    addLog(`${player.name} llega a ${t().goName} y cobra ${formatMoney(bonus)}.`);
  }

  updateBoardTokens();
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
      if (!transferMoney(playerId, null, scaleTax(cell.amount), cell.name, true)) return;
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
        addLog(`🎉 ${player.name} recibe ${formatMoney(pot)} del fondo ${t().parkingName}!`);
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
    if (player.isAI) {
      scheduleAI();
    } else {
      showBuyModal(cellId);
    }
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
  addLog(`${t().jailEmoji} ${player.name} va a ${t().jailName}.`);
  state.phase = 'end';
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

  sounds.playCard(deckName);
  const player = state.players[playerId];
  if (player.isAI) {
    executeCard(card, playerId);
    return;
  }
  showModal(
    deckName === 'city' ? t().chanceDeckTitle : t().fortuneDeckTitle,
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
        const income = scaleCardIncome(card.amount);
        player.money += income;
        addLog(`${player.name} recibe ${formatMoney(income)}.`);
      } else if (!transferMoney(playerId, null, scaleCardFine(card.amount), 'carta', true)) {
        return;
      }
      state.phase = 'end';
      render();
      break;
    case 'collectEach':
      activePlayers().forEach((p) => {
        if (p.id !== playerId && !p.bankrupt) {
          transferMoney(p.id, playerId, scaleCardIncome(card.amount), 'carta');
        }
      });
      state.phase = 'end';
      render();
      break;
    case 'payEach': {
      let blocked = false;
      const eachAmount = scaleCardFine(card.amount);
      activePlayers().forEach((p) => {
        if (p.id !== playerId && !p.bankrupt) {
          if (!transferMoney(playerId, p.id, eachAmount, 'carta')) blocked = true;
        }
      });
      if (blocked) return;
      state.phase = 'end';
      render();
      break;
    }
    case 'jailFree':
      player.jailFreeCards++;
      addLog(`${player.name} obtiene ${t().jailFreeCard}.`);
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
      const houseUnit = Math.round(card.house * diff().repairMul);
      const hotelUnit = Math.round(card.hotel * diff().repairMul);
      BOARD.forEach((cell, id) => {
        const p = state.properties[id];
        if (p.owner === playerId && p.houses > 0) {
          cost += p.houses === 5 ? hotelUnit : houseUnit * p.houses;
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

  closeBoardCard();
  closeModal();

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
      addLog(`¡${player.name} sacó 3 dobles seguidos! A ${t().jailName}.`);
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
    addLog(`${player.name} saca doble (${d1}+${d2}) y sale de ${t().jailName}.`);
    const newPos = await movePlayer(player.id, d1 + d2);
    landOnCell(player.id, newPos);
    if (state.phase === 'rolling') state.phase = 'end';
  } else if (player.jailTurns >= 3) {
    player.inJail = false;
    player.jailTurns = 0;
    state.doublesCount = 0;
    addLog(`${player.name} no saca doble (${d1}+${d2}). Debe pagar fianza para salir.`);
    transferMoney(player.id, null, jailBailAmount(), 'fianza');
    const newPos = await movePlayer(player.id, d1 + d2);
    landOnCell(player.id, newPos);
    if (state.phase === 'rolling') state.phase = 'end';
  } else {
    state.doublesCount = 0;
    addLog(`${player.name} no saca doble (${d1}+${d2}). Turno ${player.jailTurns}/3 en ${t().jailName}.`);
    state.phase = 'end';
  }
  render();
}

function showJailOptions() {
  const player = currentPlayer();
  const buttons = [];

  if (player.money >= jailBailAmount()) {
    buttons.push({
      label: `Pagar fianza (${formatMoney(jailBailAmount())})`,
      action: () => {
        closeModal();
        player.inJail = false;
        player.jailTurns = 0;
        state.doublesCount = 0;
        transferMoney(player.id, null, jailBailAmount(), 'fianza');
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

  showModal(`${t().jailEmoji} ${t().jailName}`, `<p>${player.name}, ¿cómo quieres salir?</p>`, buttons);
}

function buyProperty(cellId) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const player = currentPlayer();

  if (player.money < cell.price) {
    addLog(`${player.name} no tiene dinero para comprar ${cell.name}.`);
    pendingAction = null;
    state.phase = 'end';
    closeBoardCard();
    render();
    return;
  }

  player.money -= cell.price;
  prop.owner = player.id;
  addLog(`${player.name} compra ${cell.name} por ${formatMoney(cell.price)}.`);
  pendingAction = null;
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
  advanceAuctionTurn();
}

function advanceAuctionTurn() {
  const auction = state.auction;
  if (!auction || auction.done) return;

  while (!isAuctionOver(auction)) {
    const bidder = getCurrentBidder(auction, state.players);
    if (!bidder) break;

    if (auction.passed.has(bidder.id) && !allPassed(auction)) {
      advanceBidder(auction);
      continue;
    }

    if (bidder.isAI) {
      const decision = decideAuctionBid(auction, bidder, state, state.difficultyId, BOARD, RENT_TABLES);
      if (decision.pass) {
        passBid(auction, bidder.id);
      } else {
        const err = placeBid(auction, bidder.id, decision.amount);
        if (err) passBid(auction, bidder.id);
      }
      advanceBidder(auction);
      continue;
    }

    showAuctionModal();
    return;
  }

  finishAuction();
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
    advanceAuctionTurn();
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
          advanceAuctionTurn();
        },
      }] : []),
      {
        label: 'Pasar',
        action: () => {
          passBid(auction, bidder.id);
          closeModal();
          advanceBidder(auction);
          advanceAuctionTurn();
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
        ${from.jailFreeCards ? `<label class="trade-check"><input type="checkbox" id="offer-jail" ${tradeDraft.offerJailCards ? 'checked' : ''}> ${t().jailFreeCard} (${from.jailFreeCards})</label>` : ''}
      </div>
      <div class="trade-col">
        <h4>${tokenIcon(to.token, 'inline-token')} ${to.name} ofrece</h4>
        <div class="trade-props">${renderPropertyCheckboxes(state, to.id, 'request', tradeDraft.requestProps)}</div>
        <label class="trade-money">Dinero: $<input type="number" id="request-money" min="0" max="${to.money}" value="${tradeDraft.requestMoney}"></label>
        ${to.jailFreeCards ? `<label class="trade-check"><input type="checkbox" id="request-jail" ${tradeDraft.requestJailCards ? 'checked' : ''}> ${t().jailFreeCard} (${to.jailFreeCards})</label>` : ''}
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
          const to = state.players[tradeDraft.toId];
          if (to.isAI) {
            respondToTradeFromAI();
          } else {
            showTradeReview();
          }
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

function respondToTradeFromAI() {
  const offer = tradeDraft;
  const from = state.players[offer.fromId];
  const to = state.players[offer.toId];
  if (shouldAcceptTrade(offer, state, state.difficultyId, BOARD, RENT_TABLES)) {
    executeTrade(state, state.players, offer, formatMoney, addLog);
    handleMortgagedTradeProps(offer);
  } else {
    addLog(`${to.name} rechaza el trato con ${from.name}.`);
  }
  tradeDraft = null;
  render();
}

function aiPayJailBail(player) {
  player.inJail = false;
  player.jailTurns = 0;
  state.doublesCount = 0;
  transferMoney(player.id, null, jailBailAmount(), 'fianza');
  addLog(`${player.name} paga fianza y sale de ${t().jailName}.`);
  state.phase = 'roll';
}

function aiUseJailCard(player) {
  player.inJail = false;
  player.jailTurns = 0;
  state.doublesCount = 0;
  player.jailFreeCards--;
  addLog(`${player.name} usa carta de salida.`);
  state.phase = 'roll';
}

function aiBuildHouses(playerId) {
  let safety = 0;
  while (safety++ < 12) {
    const target = pickBuildTarget(state, playerId, BOARD, HOUSE_COST, ownsFullGroup, getGroupCells);
    if (target == null) break;
    buildHouse(target);
  }
}

async function aiRaiseFunds(playerId) {
  const action = pendingAction;
  if (action?.type !== 'raiseFunds' || action.fromId !== playerId) return;

  let safety = 0;
  while (state.players[playerId].money < action.amount && safety++ < 24) {
    const sellTarget = pickHouseToSell(state, playerId, BOARD, getGroupCells);
    if (sellTarget != null) {
      sellHouse(sellTarget);
      continue;
    }

    const mortgageTarget = pickPropertyToMortgage(state, playerId, BOARD);
    if (mortgageTarget != null) {
      toggleMortgage(mortgageTarget);
      continue;
    }

    declareBankruptcyFromDebt();
    return;
  }

  if (state.players[playerId].money >= action.amount) {
    completePendingPayment();
  }
  render();
}

async function runAITurn() {
  if (aiTurnRunning || !state || state.winner) return;

  const player = currentPlayer();
  if (!player?.isAI || player.bankrupt) return;
  if (state.phase === 'rolling' || state.phase === 'auction') return;

  aiTurnRunning = true;
  try {
    if (state.phase === 'buy' && pendingAction?.type === 'buy') {
      closeBoardCard();
      const cellId = pendingAction.cellId;
      if (shouldBuyProperty(cellId, state, player.id, state.difficultyId, BOARD, RENT_TABLES)) {
        buyProperty(cellId);
      } else {
        declineProperty();
      }
      return;
    }

    if (state.phase === 'raiseFunds' && player.isAI) {
      await aiRaiseFunds(player.id);
      return;
    }

    if (state.phase === 'roll' && player.isAI) {
      if (player.inJail) {
        const jailChoice = decideJailAction(player, state.difficultyId, jailBailAmount());
        if (jailChoice === 'bail' && player.money >= jailBailAmount()) {
          aiPayJailBail(player);
          render();
          return;
        }
        if (jailChoice === 'card' && player.jailFreeCards > 0) {
          aiUseJailCard(player);
          render();
          return;
        }
      }
      await rollDice();
      return;
    }

    if ((state.phase === 'end' || state.phase === 'build') && player.isAI) {
      closeBoardCard();
      aiBuildHouses(player.id);
      if (state.doublesCount > 0 && !player.inJail) {
        state.phase = 'roll';
        render();
        return;
      }
      endTurn();
    }
  } finally {
    aiTurnRunning = false;
    if (isAIPlayer()) scheduleAI();
  }
}

function handleMortgagedTradeProps(offer) {
  [...offer.offerProps, ...offer.requestProps].forEach((id) => {
    const prop = state.properties[id];
    if (!prop.mortgaged) return;
    const cell = BOARD[id];
    const newOwner = prop.owner;
    const cost = mortgageInterestAmount(cell.price);
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
    addLog(tb().noHotelsLeft);
    return;
  }
  if (!needHotel && state.housesLeft <= 0) {
    addLog(tb().noHousesLeft);
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
    addLog(`${player.name} construye un ${tb().hotel} en ${cell.name}.`);
  } else {
    state.housesLeft--;
    prop.houses++;
    addLog(`${player.name} construye un ${tb().house} en ${cell.name} (${prop.houses}/4).`);
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

  const wasHotel = prop.houses === 5;

  if (prop.houses === 5) {
    prop.houses = 4;
    state.hotelsLeft++;
    state.housesLeft -= 4;
  } else {
    prop.houses--;
    state.housesLeft++;
  }

  player.money += Math.floor(cost / 2);
  addLog(`${player.name} vende ${wasHotel ? `un ${tb().hotel}` : `un ${tb().house}`} en ${cell.name}.`);
  render();
}

function toggleMortgage(cellId) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const player = currentPlayer();

  if (prop.owner !== player.id) return;
  if (prop.houses > 0) {
    addLog(tb().sellBeforeMortgage);
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
  closeBoardCard();
  nextTurn();
}

function isBlockingDoubleContinue() {
  if (activeBoardCard) return true;
  if (!$('#modal')?.classList.contains('hidden')) return true;
  if (state.phase === 'auction') return true;
  if (state.phase === 'raiseFunds') return true;
  if (state.phase === 'buy' && pendingAction?.type === 'buy') return true;
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
  const play = $('.board-center-play');
  const content = $('#board-card-content');
  const actions = $('#board-card-actions');
  if (!card || !content || !actions) return;

  play?.classList.add('hidden');
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
  const card = $('#board-card');
  const play = $('.board-center-play');
  if (card) card.classList.add('hidden');
  play?.classList.remove('hidden');
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
    rows += `<div class="property-card-rents">${rents.map((r, i) => i === 0 ? '' : i < 5 ? `<span>${i}${tb().houseEmoji} ${formatMoney(r)}</span>` : `<span>${tb().hotelEmoji} ${formatMoney(r)}</span>`).join('')}</div>`;
  }
  if (cell.type === 'railroad') rows += `<div class="property-card-row"><span>Tipo</span><strong>${t().railroadLabel}</strong></div>`;
  if (cell.type === 'utility') rows += `<div class="property-card-row"><span>Tipo</span><strong>${t().utilityLabel}</strong></div>`;
  if (owner) rows += `<div class="property-card-row"><span>Dueño</span><strong>${owner.name}${prop.mortgaged ? ' (hipotecada)' : ''}</strong></div>`;
  if (prop.houses > 0) rows += `<div class="property-card-row"><span>${tb().rowLabel}</span><strong>${formatBuildingLabel(prop.houses)}</strong></div>`;
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
     <p>${tb().sellFundsHint} <strong>Pagar deuda</strong>.</p>
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

function waitForLayout() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function syncDiceBoxSize() {
  if (!diceBox?.canvas?.isConnected) return;
  const box = $('#dice-box');
  const stage = $('#dice-stage');
  const overlay = $('#dice-overlay');
  const width = box?.clientWidth || stage?.clientWidth || overlay?.clientWidth || 0;
  const height = box?.clientHeight || stage?.clientHeight || overlay?.clientHeight || 0;
  if (width > 0 && height > 0) {
    window.dispatchEvent(new Event('resize'));
  }
}

function resetDiceBox() {
  diceBoxReady = false;
  diceBox = null;
  diceBoxInitPromise = null;
}

async function initDiceBox() {
  if (diceBoxReady && diceBox?.canvas?.isConnected) {
    syncDiceBoxSize();
    return true;
  }

  if (diceBox?.canvas && !diceBox.canvas.isConnected) {
    resetDiceBox();
  }

  if (diceBoxInitPromise) return diceBoxInitPromise;

  diceBoxInitPromise = (async () => {
    const container = $('#dice-box');
    const stage = $('#dice-stage');
    if (!container?.isConnected || !stage) return false;

    await waitForLayout();

    try {
      const { default: DiceBox } = await import(`${DICE_BASE}dice-box.es.min.js`);
      if (!container.isConnected) return false;

      diceBox = new DiceBox({
        container: '#dice-box',
        assetPath: 'assets/',
        origin: DICE_BASE,
        themeColor: '#ffffff',
        scale: 4,
        enableShadows: true,
        offscreen: false,
      });
      await diceBox.init();
      if (!container.isConnected) {
        resetDiceBox();
        return false;
      }

      diceBoxReady = true;
      stage.classList.add('webgl-ready');
      stage.classList.remove('fallback-ready');
      diceBox.show?.();
      syncDiceBoxSize();
      return true;
    } catch (error) {
      console.error('Dados 3D no disponibles:', error);
      stage?.classList.add('fallback-ready');
      stage?.classList.remove('webgl-ready');
      resetDiceBox();
      return false;
    }
  })();

  try {
    return await diceBoxInitPromise;
  } finally {
    diceBoxInitPromise = null;
  }
}

async function animateDice() {
  const result = $('#dice-result');
  const stage = $('#dice-stage');
  const overlay = $('#dice-overlay');
  const center = $('.board-center');

  sounds.unlockAudio();
  sounds.playDiceRoll();

  closeBoardCard();
  await waitForLayout();
  center?.classList.add('board-center--dice-rolling');
  overlay?.classList.add('dice-overlay--rolling');

  try {
    if (await initDiceBox()) {
      try {
        if (result) result.textContent = 'Tirando...';
        syncDiceBoxSize();
        await waitForLayout();
        diceBox.show?.();
        const rolls = await diceBox.roll('2d6');
        const values = (Array.isArray(rolls) ? rolls : [])
          .map((die) => Number(die.value))
          .filter((n) => n >= 1 && n <= 6);
        if (values.length >= 2) {
          const [d1, d2] = values;
          if (result) result.textContent = `${d1} + ${d2} = ${d1 + d2}`;
          sounds.playDiceLand();
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
    sounds.playDiceLand();
    return [d1, d2];
  } finally {
    center?.classList.remove('board-center--dice-rolling');
    overlay?.classList.remove('dice-overlay--rolling');
  }
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

function updateBoardTokens() {
  const board = $('#board');
  if (!board) return;
  const positions = getBoardPositions();
  document.getElementById('token-layer')?.remove();
  renderTokenLayer(board, positions);
}

function buildOwnerBuildingsHtml(count, edge) {
  if (!count) return '';
  if (count === 5) {
    return `<div class="owner-buildings owner-buildings--${edge} owner-buildings-hotel" title="${tb().hotel}">${tb().hotelEmoji}</div>`;
  }
  const icons = Array.from({ length: count }, () => (
    `<span class="owner-building" aria-hidden="true"></span>`
  )).join('');
  return `<div class="owner-buildings owner-buildings--${edge} owner-buildings-count-${count}" title="${count} ${tb().houses}">${icons}</div>`;
}

function renderOwnerMarkerLayer(board, positions) {
  const layer = document.createElement('div');
  layer.className = 'owner-layer';
  layer.id = 'owner-layer';

  BOARD.forEach((cell, i) => {
    if (!isOwnableCell(cell)) return;
    const prop = state.properties[i];
    if (prop.owner === null) return;

    const pos = positions[i];
    const owner = state.players[prop.owner];
    const edge = getCellOwnerEdge(pos);

    const slot = document.createElement('div');
    slot.className = 'owner-slot';
    slot.style.gridRow = String(pos.row);
    slot.style.gridColumn = String(pos.col);

    const wrap = document.createElement('div');
    wrap.className = `owner-marker-wrap owner-marker-wrap--${edge}`;

    const marker = document.createElement('div');
    marker.className = `owner-marker owner-marker--${edge}`;
    marker.style.setProperty('--owner-color', owner.color);
    marker.title = owner.name;
    wrap.appendChild(marker);

    if (prop.houses > 0) {
      wrap.insertAdjacentHTML('beforeend', buildOwnerBuildingsHtml(prop.houses, edge));
    }

    slot.appendChild(wrap);
    layer.appendChild(slot);
  });

  board.appendChild(layer);
}

function getCellOwnerEdge(pos) {
  if (pos.row === 11) return 'top';
  if (pos.col === 1) return 'right';
  if (pos.row === 1) return 'bottom';
  if (pos.col === 11) return 'left';
  return 'top';
}

function getDiceResultText() {
  return state.dice[0]
    ? `${state.dice[0]} + ${state.dice[1]} = ${state.dice[0] + state.dice[1]}`
    : 'Listo para tirar';
}

function createDiceOverlayHtml() {
  return `
    <div class="dice-stage" id="dice-stage">
      <div class="dice-box" id="dice-box"></div>
      <div class="dice-fallback">
        ${createDieHtml('die1', state.dice[0])}
        ${createDieHtml('die2', state.dice[1])}
      </div>
    </div>
  `;
}

function mountDiceResult(center, savedResult = null) {
  let result = savedResult || document.getElementById('dice-result');
  if (result?.parentElement && result.parentElement !== center) {
    result.remove();
  }
  if (!result) {
    result = document.createElement('div');
    result.className = 'dice-result';
    result.id = 'dice-result';
  }
  center.appendChild(result);
  result.textContent = getDiceResultText();
  return result;
}

function renderBoard() {
  const board = $('#board');
  const savedOverlay = document.getElementById('dice-overlay');
  const savedResult = document.getElementById('dice-result');
  const keepOverlay = savedOverlay?.querySelector('canvas') ? savedOverlay : null;
  if (keepOverlay) {
    savedOverlay.querySelector('#dice-result')?.remove();
  }
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

    el.innerHTML = `
      ${ownable ? '<div class="cell-color-bar"></div>' : ''}
      <div class="cell-name">${cell.name}</div>
      ${ownable && cell.price ? `<div class="cell-price">${formatMoney(cell.price)}</div>` : ''}
      ${cell.type === 'go' ? `<div class="cell-desc">+${formatMoney(goBonusAmount())}</div>` : ''}
      ${cell.type === 'tax' ? `<div class="cell-desc">${formatMoney(scaleTax(cell.amount))}</div>` : ''}
      ${ownable && prop.mortgaged ? '<div class="mortgaged">HIP</div>' : ''}
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
      <div class="board-center-inner">
        <div class="board-center-header">
          <h1>${THEME.strings.centerTitle}</h1>
          <p class="tagline">${THEME.strings.centerTagline}</p>
        </div>
        <div class="board-center-play">
          <div class="board-action hidden" id="board-action"></div>
          <div class="board-actions" id="board-actions"></div>
        </div>
      </div>
    </div>
    <div class="board-card hidden" id="board-card">
      <div class="board-card-content" id="board-card-content"></div>
      <div class="board-card-actions" id="board-card-actions"></div>
    </div>
  `;
  if (keepOverlay) {
    center.appendChild(keepOverlay);
  } else {
    const overlay = document.createElement('div');
    overlay.className = 'dice-overlay';
    overlay.id = 'dice-overlay';
    overlay.innerHTML = createDiceOverlayHtml();
    center.appendChild(overlay);
  }

  mountDiceResult(center, savedResult);

  board.appendChild(center);

  renderOwnerMarkerLayer(board, positions);
  renderTokenLayer(board, positions);

  if (keepOverlay) {
    if (diceBoxReady) $('#dice-stage')?.classList.add('webgl-ready');
    syncDiceBoxSize();
  } else if (diceBoxReady && diceBox?.canvas && !diceBox.canvas.isConnected) {
    resetDiceBox();
    initDiceBox();
  }

  if (activeBoardCard) paintBoardCard();

  paintBoardAction();
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
    const isExpanded = expandedPlayerId === player.id;
    const assets = getPlayerAssets(player.id);
    const netWorth = player.money + assets.total;
    const el = document.createElement('div');
    el.className = `player-card player-card-clickable${isCurrent ? ' active' : ''}${isExpanded ? ' expanded' : ''}${player.bankrupt ? ' bankrupt' : ''}`;
    el.innerHTML = `
      ${isCurrent ? `<span class="turn-badge turn-badge--float${player.isAI ? ' ai-badge' : ''}">${player.isAI ? '🤖 TURNO IA' : 'TU TURNO'}</span>` : ''}
      <div class="player-header">
        <span class="player-token" style="--token-color:${player.color}"><i class="fa-solid ${player.token.icon}"></i></span>
        <div class="player-header-main">
          <span class="player-name">${player.name}</span>
          <div class="player-header-tags">
            ${player.isAI ? '<span class="ai-tag">IA</span>' : ''}
          </div>
        </div>
        <span class="player-expand-icon" aria-hidden="true"><i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}"></i></span>
      </div>
      ${isExpanded ? '' : `
      <div class="player-finance">
        <div class="player-finance-cash">${formatMoney(player.money)}</div>
        <div class="player-finance-worth">Patrimonio <strong>${formatMoney(netWorth)}</strong></div>
      </div>`}
      <div class="player-meta">
        ${player.inJail ? `${t().jailEmoji} En ${t().jailName}` : `📍 ${BOARD[player.position].name}`}
        ${player.jailFreeCards && !isExpanded ? ` · 🎫 ${player.jailFreeCards}` : ''}
        ${!isExpanded ? ` · ${assets.props.length} prop` : ''}
      </div>
      ${isExpanded ? buildPlayerDetailsHtml(player, assets) : ''}
      ${player.bankrupt ? '<div class="bankrupt-label">QUEBRADO</div>' : ''}
    `;

    el.addEventListener('click', () => {
      expandedPlayerId = expandedPlayerId === player.id ? null : player.id;
      renderPlayers();
    });

    el.querySelector('.player-details')?.addEventListener('click', (e) => e.stopPropagation());

    el.querySelectorAll('.player-prop-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showCellInfo(parseInt(btn.dataset.cellId, 10));
      });
    });

    container.appendChild(el);
  });
}

function renderTurnActions(container) {
  const player = currentPlayer();

  if (player.isAI && !state.winner) {
    const note = document.createElement('div');
    note.className = 'board-ai-turn';
    note.style.setProperty('--player-color', player.color || '#3b82f6');
    note.innerHTML = `
      <span class="board-ai-turn-icon" aria-hidden="true">🤖</span>
      <span class="board-ai-turn-name">${escapeHtml(player.name)}</span>
      <span class="board-ai-turn-text">está jugando…</span>`;
    container.appendChild(note);
    return;
  }

  const addBtn = (label, fn, primary = false, disabled = false, extraClass = '') => {
    const btn = document.createElement('button');
    btn.className = `btn${primary ? ' btn-primary' : ''}${extraClass ? ` ${extraClass}` : ''}`;
    btn.textContent = label;
    btn.disabled = disabled;
    btn.onclick = fn;
    container.appendChild(btn);
  };

  if (state.phase === 'roll') {
    addBtn('🤝 Negociar', showTradePartnerSelect);
    if (player.inJail) {
      if (player.money >= jailBailAmount()) {
        addBtn(`💰 Pagar fianza (${formatMoney(jailBailAmount())})`, () => {
          player.inJail = false;
          player.jailTurns = 0;
          state.doublesCount = 0;
          transferMoney(player.id, null, jailBailAmount(), 'fianza');
          addLog(`${player.name} paga fianza y sale de ${t().jailName}.`);
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
    if (state.doublesCount > 0 && !player.inJail) {
      addBtn('🎲 Tirar de nuevo (doble)', () => {
        closeBoardCard();
        state.phase = 'roll';
        render();
      }, true);
    } else {
      addBtn('✅ Terminar turno', endTurn, true);
    }
  }

  if (state.phase === 'raiseFunds') {
    addBtn('🤝 Negociar', showTradePartnerSelect);
    if (pendingAction?.type === 'raiseFunds') {
      const owed = pendingAction.amount;
      const missing = Math.max(0, owed - player.money);
      const debtInfo = document.createElement('div');
      debtInfo.className = 'board-debt-banner';
      debtInfo.innerHTML = `
        <p><strong>Deuda:</strong> ${formatMoney(owed)} (${pendingAction.reason})</p>
        <p>Tienes ${formatMoney(player.money)}${missing > 0 ? ` · Faltan ${formatMoney(missing)}` : ' · Puedes pagar'}</p>`;
      container.appendChild(debtInfo);
      addBtn(`💸 Pagar ${formatMoney(owed)}`, () => {
        if (completePendingPayment()) render();
      }, true, player.money < owed);
      addBtn('💀 Declarar quiebra', declareBankruptcyFromDebt, false, false, 'btn-danger');
    }
  }

  if (state.phase === 'buy' && pendingAction?.type === 'buy') {
    const cell = BOARD[pendingAction.cellId];
    addBtn(`Comprar (${formatMoney(cell.price)})`, () => buyProperty(pendingAction.cellId), true);
    addBtn('Subastar', () => declineProperty());
    addBtn('Ver ficha', () => showBuyModal(pendingAction.cellId));
  }

  if (state.phase === 'auction' && state.auction && !state.auction.done) {
    addBtn('🔨 Continuar subasta', () => advanceAuctionTurn(), true);
  }
}

function renderBankInfoPanel() {
  const panel = $('#bank-info-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="bank-stat-row">
      <span class="bank-stat-emoji" aria-hidden="true">${tb().houseEmoji}</span>
      <span class="bank-stat-label">${escapeHtml(tb().supplyHouses)}</span>
      <span class="bank-stat-value">${state.housesLeft}</span>
    </div>
    <div class="bank-stat-row">
      <span class="bank-stat-emoji" aria-hidden="true">${tb().hotelEmoji}</span>
      <span class="bank-stat-label">${escapeHtml(tb().supplyHotels)}</span>
      <span class="bank-stat-value">${state.hotelsLeft}</span>
    </div>
    <div class="bank-stat-row bank-stat-row--parking">
      <span class="bank-stat-emoji" aria-hidden="true">${t().parkingEmoji}</span>
      <span class="bank-stat-label">${escapeHtml(t().parkingName)}</span>
      <span class="bank-stat-value bank-stat-value--money">${formatMoney(state.freeParkingPot)}</span>
    </div>`;
}

function createPropertiesPanelMessage(title, detail, variant = 'idle') {
  const message = document.createElement('div');
  message.className = `properties-panel-message properties-panel-message--${variant}`;
  message.innerHTML = `
    <p class="properties-panel-message-title">${escapeHtml(title)}</p>
    ${detail ? `<p class="properties-panel-message-detail">${escapeHtml(detail)}</p>` : ''}`;
  return message;
}

function renderPropertiesPanelIdleMessage(container, player) {
  if (player.isAI) {
    container.appendChild(createPropertiesPanelMessage(
      `${player.name} está jugando`,
      'Las acciones de propiedades aparecen cuando es tu turno.',
      'ai',
    ));
    return;
  }

  const assets = getPlayerAssets(player.id);
  const canManageProps = state.phase === 'end' || state.phase === 'build' || state.phase === 'raiseFunds';

  if (canManageProps && !assets.props.length) {
    if (state.phase === 'raiseFunds') {
      container.appendChild(createPropertiesPanelMessage(
        'Sin propiedades para vender',
        'No tienes bienes que hipotecar. Declara quiebra si no puedes pagar.',
        'empty',
      ));
    } else {
      container.appendChild(createPropertiesPanelMessage(
        'Sin propiedades todavía',
        'Compra casillas cuando pares en ellas y estén libres.',
        'empty',
      ));
    }
    return;
  }

  const phaseHints = {
    roll: ['Esperando tu tirada', 'Tira los dados en el tablero para avanzar.'],
    rolling: ['Moviendo ficha', 'Espera a que termine el movimiento.'],
    buy: ['Decisión de compra', 'Elige en el tablero si compras o subastas la propiedad.'],
    auction: ['Subasta en curso', 'Sigue la subasta desde el tablero.'],
    raiseFunds: ['Reuniendo fondos', 'Vende casas o hipoteca propiedades para pagar tu deuda.'],
  };

  const hint = phaseHints[state.phase];
  if (hint) {
    container.appendChild(createPropertiesPanelMessage(hint[0], hint[1], 'phase'));
  }
}

function renderActions() {
  const container = $('#actions-panel');
  const boardActions = $('#board-actions');
  const player = currentPlayer();
  container.innerHTML = '';
  if (boardActions) boardActions.innerHTML = '';

  renderBankInfoPanel();

  if (state.winner || player.bankrupt) return;

  if (player.isAI) {
    if (boardActions) renderTurnActions(boardActions);
    renderPropertiesPanelIdleMessage(container, player);
    return;
  }

  if (boardActions) renderTurnActions(boardActions);

  const canManageProps = state.phase === 'end' || state.phase === 'build' || state.phase === 'raiseFunds';
  const assets = getPlayerAssets(player.id);

  if (canManageProps && assets.props.length) {
    renderPlayerPropertyActions(container, player);
  } else {
    renderPropertiesPanelIdleMessage(container, player);
  }
}

function renderLog() {
  const log = $('#game-log');
  if (!log) return;

  log.innerHTML = state.log.map((m, i) => (
    `<div class="log-entry${i === 0 ? ' log-entry--latest' : ''}">${colorizeLogText(m)}</div>`
  )).join('');

  const countEl = $('#log-entry-count');
  if (countEl) {
    const count = state.log.length;
    countEl.textContent = count > 0 ? String(count) : '';
    countEl.hidden = count === 0;
  }
}

function render() {
  renderBoard();
  renderPlayers();
  tryContinueDoubleTurn();
  renderActions();
  renderLog();
  saveGame();
  scheduleAI();
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
  loadedState.difficultyId = loadedState.difficultyId || 'normal';
  if (loadedState.auction?.passed) {
    loadedState.auction.passed = new Set(loadedState.auction.passed);
  }

  loadedState.players.forEach((player) => {
    const tokenId = player.token?.id ?? player.token;
    player.token = PLAYER_TOKENS.find((t) => t.id === tokenId) || PLAYER_TOKENS[player.id] || PLAYER_TOKENS[0];
    player.id = player.id ?? loadedState.players.indexOf(player);
    player.isAI = !!player.isAI;
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
    if (!data?.state?.players?.length) return null;
    return data;
  } catch {
    return null;
  }
}

function clearSavedGame() {
  localStorage.removeItem(SAVE_KEY);
}

function restoreInterruptedTurnUI() {
  if (state.phase === 'buy' && pendingAction?.type === 'buy') {
    const player = currentPlayer();
    if (player.isAI) {
      scheduleAI();
    } else {
      showBuyModal(pendingAction.cellId);
    }
    return;
  }

  if (state.phase === 'auction' && state.auction && !state.auction.done) {
    advanceAuctionTurn();
    return;
  }

  if (state.phase === 'raiseFunds' && pendingAction?.type === 'raiseFunds') {
    const player = state.players[pendingAction.fromId];
    if (player?.isAI) {
      scheduleAI();
    } else if (player?.id === state.currentPlayer) {
      showRaiseFundsModal(pendingAction.fromId, pendingAction.amount, pendingAction.reason);
    }
  }
}

async function resumeFromSaveData(data) {
  applyTheme(data.state?.themeId || 'default');
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
  restoreInterruptedTurnUI();
  await initDiceBox();
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
  if (!json) return false;
  try {
    await navigator.clipboard.writeText(json);
    addLog('Copia de seguridad copiada al portapapeles.');
    return true;
  } catch {
    addLog('No se pudo copiar. Usa «Restaurar partida» en la pantalla inicial.');
    return false;
  }
}

function updateSettingsSoundUI() {
  const on = sounds.isSoundEnabled();
  const label = $('#settings-sound-label');
  const hint = $('#settings-sound-hint');
  const toggle = $('#settings-sound-toggle');
  const icon = $('#settings-sound')?.querySelector('.settings-row-icon i');
  if (label) label.textContent = on ? 'Sonido activado' : 'Sonido desactivado';
  if (hint) hint.textContent = on ? 'Pulsa para silenciar efectos' : 'Pulsa para activar efectos';
  if (toggle) toggle.classList.toggle('is-on', on);
  if (icon) icon.className = on ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
}

function openSettings() {
  updateSettingsSoundUI();
  $('#settings-panel')?.classList.remove('hidden');
}

function closeSettings() {
  $('#settings-panel')?.classList.add('hidden');
}

function returnToMainMenu() {
  closeSettings();
  showModal(
    'Volver al menú',
    '<p>La partida se guardará automáticamente. Podrás continuarla desde la pantalla inicial con <strong>Continuar partida</strong>.</p>',
    [
      { label: 'Cancelar', action: closeModal },
      {
        label: 'Volver al menú',
        action: () => {
          closeModal();
          closeBoardCard();
          if (state && !state.winner) saveGame();
          $('#game-screen').classList.add('hidden');
          $('#setup-screen').classList.remove('hidden');
          updateResumeSection();
        },
        primary: true,
      },
    ],
  );
}

function initLogPanel() {
  const panel = $('#log-panel');
  const toggle = $('#log-panel-toggle');
  if (!panel || !toggle) return;

  toggle.addEventListener('click', () => {
    logPanelCollapsed = !logPanelCollapsed;
    panel.classList.toggle('side-panel--log-collapsed', logPanelCollapsed);
    toggle.setAttribute('aria-expanded', String(!logPanelCollapsed));
  });
}

function initGameSettings() {
  initLogPanel();
  $('#settings-btn')?.addEventListener('click', openSettings);
  $('#settings-close')?.addEventListener('click', closeSettings);
  $('#settings-backdrop')?.addEventListener('click', closeSettings);
  $('#settings-copy')?.addEventListener('click', () => copySaveToClipboard());
  $('#settings-sound')?.addEventListener('click', () => {
    sounds.toggleSound();
    updateSettingsSoundUI();
  });
  $('#settings-menu')?.addEventListener('click', returnToMainMenu);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#settings-panel')?.classList.contains('hidden')) {
      closeSettings();
    }
  });
}

function importSaveFromText(text) {
  const data = JSON.parse(text.trim());
  if (data.version !== SAVE_VERSION) throw new Error('Versión de guardado no compatible.');
  resumeFromSaveData(data);
}

function formatSaveSummary(data) {
  const players = data.state.players.filter((p) => !p.bankrupt);
  const turn = data.state.players[data.state.currentPlayer]?.name ?? '?';
  const themeName = getTheme(data.state.themeId || 'default').name;
  const diffName = getDifficultyPreset(data.state.difficultyId || 'normal').name;
  const when = new Date(data.savedAt).toLocaleString('es-ES', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return `${themeName} · ${diffName} · ${players.length} jugadores · turno de ${turn} · guardado ${when}`;
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
let setupTokenIds = [];
let refreshSetupPlayers = null;

function getDefaultTokenIds(count) {
  return PLAYER_TOKENS.slice(0, count).map((token) => token.id);
}

function reconcileSetupTokens(count, previous = []) {
  const used = new Set();
  const result = [];

  for (let i = 0; i < count; i++) {
    const prevId = previous[i];
    const prevValid = prevId && PLAYER_TOKENS.some((t) => t.id === prevId) && !used.has(prevId);
    if (prevValid) {
      result.push(prevId);
      used.add(prevId);
      continue;
    }
    const available = PLAYER_TOKENS.find((t) => !used.has(t.id));
    const fallback = available?.id ?? PLAYER_TOKENS[i % PLAYER_TOKENS.length].id;
    result.push(fallback);
    used.add(fallback);
  }

  return result;
}

function openTokenPicker(playerIndex) {
  const taken = new Set(setupTokenIds.filter((_, idx) => idx !== playerIndex));
  const currentId = setupTokenIds[playerIndex];
  const playerColor = PLAYER_COLORS[playerIndex];

  const grid = PLAYER_TOKENS.map((token) => {
    const takenByOther = taken.has(token.id);
    const selected = token.id === currentId;
    return `
      <button type="button"
        class="token-picker-option${selected ? ' is-selected' : ''}${takenByOther ? ' is-taken' : ''}"
        data-token-id="${token.id}"
        ${takenByOther ? 'disabled' : ''}
        style="--token-color:${playerColor}"
        title="${takenByOther ? 'Ya elegida por otro jugador' : token.name}">
        <span class="token-picker-option-icon"><i class="fa-solid ${token.icon}"></i></span>
        <span class="token-picker-option-name">${token.name}</span>
        ${takenByOther ? '<span class="token-picker-option-badge">Ocupada</span>' : ''}
      </button>`;
  }).join('');

  showModal(
    `Elegir ficha — Jugador ${playerIndex + 1}`,
    `<p class="token-picker-hint">Cada jugador debe tener una ficha distinta.</p>
     <div class="token-picker-modal-grid">${grid}</div>`,
    [{ label: 'Cerrar', action: closeModal }],
  );

  $$('.token-picker-option:not(.is-taken)').forEach((btn) => {
    btn.addEventListener('click', () => {
      setupTokenIds[playerIndex] = btn.dataset.tokenId;
      closeModal();
      updateTokenTrigger(playerIndex);
    });
  });
}

function updateTokenTrigger(playerIndex) {
  const token = PLAYER_TOKENS.find((t) => t.id === setupTokenIds[playerIndex]);
  const btn = $(`.token-trigger[data-player="${playerIndex}"]`);
  if (!btn || !token) return;
  btn.title = token.name;
  btn.setAttribute('aria-label', `Ficha: ${token.name}. Pulsa para cambiar`);
  btn.innerHTML = `<i class="fa-solid ${token.icon}"></i>`;
}

function startGame() {
  const themeId = document.querySelector('input[name="game-theme"]:checked')?.value || 'default';
  const difficultyId = document.querySelector('input[name="game-difficulty"]:checked')?.value || 'normal';
  const count = parseInt($('#player-count').value);
  const playerConfigs = [];
  for (let i = 0; i < count; i++) {
    const token = PLAYER_TOKENS.find((item) => item.id === setupTokenIds[i]) || PLAYER_TOKENS[i];
    playerConfigs.push({
      name: $(`#player-name-${i}`).value,
      token,
      isAI: $(`#player-ai-${i}`)?.checked ?? false,
    });
  }

  collapsedPropGroups.clear();
  logPanelCollapsed = true;
  $('#log-panel')?.classList.add('side-panel--log-collapsed');
  $('#log-panel-toggle')?.setAttribute('aria-expanded', 'false');
  state = createInitialState(playerConfigs, themeId, difficultyId);
  $('#setup-screen').classList.add('hidden');
  $('#game-screen').classList.remove('hidden');
  render();
  initDiceBox();
}

function updateDifficultySummary() {
  const selected = document.querySelector('input[name="game-difficulty"]:checked')?.value || 'normal';
  const preset = getDifficultyPreset(selected);
  const summary = $('#difficulty-summary');
  if (summary) summary.textContent = formatDifficultySummary(preset);
}

function renderDifficultyPicker() {
  const container = $('#difficulty-picker');
  if (!container) return;

  container.innerHTML = DIFFICULTY_LIST.map((preset, index) => `
    <label class="difficulty-option" data-difficulty="${preset.id}">
      <input type="radio" name="game-difficulty" value="${preset.id}" ${index === 1 ? 'checked' : ''}>
      <span class="difficulty-option-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
      <div class="difficulty-option-body">
        <div class="difficulty-option-title">${preset.name}</div>
        <div class="difficulty-option-desc">${preset.tagline}</div>
      </div>
    </label>
  `).join('');

  container.querySelectorAll('input[name="game-difficulty"]').forEach((input) => {
    input.addEventListener('change', updateDifficultySummary);
  });
  updateDifficultySummary();
}

function renderThemePicker() {
  const container = $('#theme-picker');
  if (!container) return;

  container.innerHTML = THEMES.map((theme, index) => {
    const accent = theme.style?.vars?.['--accent'] || '#f0a500';
    return `
    <label class="theme-option" data-theme="${theme.id}" style="--theme-accent: ${accent}">
      <input type="radio" name="game-theme" value="${theme.id}" ${index === 0 ? 'checked' : ''}>
      <span class="theme-option-check" aria-hidden="true"><i class="fa-solid fa-check"></i></span>
      <span class="theme-option-icon">${theme.icon}</span>
      <div class="theme-option-body">
        <div class="theme-option-title">${theme.name}</div>
        <div class="theme-option-desc">${theme.tagline}</div>
      </div>
    </label>`;
  }).join('');

  container.querySelectorAll('input[name="game-theme"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        applyTheme(input.value);
        setupTokenIds = [];
        refreshSetupPlayers?.();
      }
    });
  });
}

function initSetup() {
  const countSelect = $('#player-count');
  const namesContainer = $('#player-names');

  function updateNameInputs() {
    const count = parseInt(countSelect.value);
    const savedNames = {};
    namesContainer.querySelectorAll('[id^="player-name-"]').forEach((input) => {
      const idx = parseInt(input.id.replace('player-name-', ''), 10);
      if (!Number.isNaN(idx)) savedNames[idx] = input.value;
    });

    setupTokenIds = reconcileSetupTokens(count, setupTokenIds.length ? setupTokenIds : getDefaultTokenIds(count));
    namesContainer.innerHTML = '';

    for (let i = 0; i < count; i++) {
      const token = PLAYER_TOKENS.find((t) => t.id === setupTokenIds[i]) || PLAYER_TOKENS[i];
      const defaultAI = i > 0;
      namesContainer.innerHTML += `
        <div class="name-input${defaultAI ? ' is-ai' : ''}">
          <div class="name-input-row">
            <button type="button" class="token-trigger" data-player="${i}"
              style="--token-color:${PLAYER_COLORS[i]}"
              title="${token.name}"
              aria-label="Ficha: ${token.name}. Pulsa para cambiar">
              <i class="fa-solid ${token.icon}"></i>
            </button>
            <div class="name-input-fields">
              <label for="player-name-${i}">Jugador ${i + 1}</label>
              <input type="text" id="player-name-${i}" placeholder="Nombre" maxlength="12"
                value="${savedNames[i] || ''}"
                style="border-color: ${PLAYER_COLORS[i]}">
              <label class="ai-toggle">
                <input type="checkbox" id="player-ai-${i}" class="player-ai-toggle" ${defaultAI ? 'checked' : ''}>
                <span><i class="fa-solid fa-robot" aria-hidden="true"></i> Computadora (IA)</span>
              </label>
            </div>
          </div>
        </div>`;
    }

    namesContainer.querySelectorAll('.player-ai-toggle').forEach((input) => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.id.replace('player-ai-', ''), 10);
        const nameInput = $(`#player-name-${idx}`);
        const row = input.closest('.name-input');
        row?.classList.toggle('is-ai', input.checked);
        if (input.checked && !nameInput.value.trim()) {
          nameInput.value = defaultAIName(idx);
        }
      });
    });

    namesContainer.querySelectorAll('.token-trigger').forEach((btn) => {
      btn.addEventListener('click', () => {
        openTokenPicker(parseInt(btn.dataset.player, 10));
      });
    });
  }

  countSelect.addEventListener('change', updateNameInputs);
  refreshSetupPlayers = updateNameInputs;
  renderThemePicker();
  renderDifficultyPicker();
  updateNameInputs();
  updateResumeSection();

  $('#start-btn').addEventListener('click', () => {
    sounds.unlockAudio();
    startGame();
  });
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

  initGameSettings();
}

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initSetup);

if (typeof window !== 'undefined') {
  window.__imperioUrbano = { exportSaveJson, importSaveFromText, resumeGame };
}
