import {
  BOARD, BOARD_LEN, BOARD_GRID, COLORS, RENT_TABLES, HOUSE_COST, GO_BONUS, JAIL_POSITION,
  GO_TO_JAIL_POSITION, PLAYER_COLORS, PLAYER_TOKENS, JAIL_BAIL, currentBoardSize,
  CITY_CARDS, FORTUNE_CARDS, THEME, applyTheme, shuffleDeck,
} from './board.js';
import { getBoardConstants, getBoardPositions } from './themes/shared.js';
import { getCellArtUrl } from './themes/cellArt.js';
import { applyBoardBackground } from './themes/boardBg.js';
import {
  createTradeOffer, validateTrade, executeTrade, renderPropertyCheckboxes,
} from './trade.js';
import {
  createAuction, getCurrentBidder, advanceBidder, placeBid, passBid,
  isAuctionOver, getAuctionSummary, allPassed,
} from './auction.js';
import { THEMES, getTheme, getThemeDefaultPlayerName } from './themes/index.js';
import { DEFAULT_BUILDINGS } from './themes/shared.js';
import { getDifficultyPreset, DIFFICULTY_LIST, formatDifficultySummary } from './difficulty.js';
import {
  shouldBuyProperty, decideAuctionBid, decideJailAction, pickBuildTarget,
  pickHouseToSell, pickPropertyToMortgage, pickPropertyToUnmortgage, shouldAcceptTrade, proposeAITrade, defaultAIName,
} from './ai.js';
import * as sounds from './sounds.js';
import { shouldTriggerWorldEvent, resolveWorldEvent } from './worldEvents.js';
import {
  assignPremiumCells,
  isPremiumUnowned,
  ensurePremiumBuffIds,
} from './premiumCells.js';
import {
  tickPlayerBuffs,
  getBuffPresentation,
  getPremiumBuffPreview,
  resolvePurchasePrice,
  consumePurchaseDiscount,
  tryConsumeRentShield,
  getCardMoneyBonus,
  normalizePlayerBuff,
  normalizePremiumBuffIds,
  previewBuffGrant,
  applyBuffToPlayer,
  shouldReplaceActiveBuff,
} from './playerBuffs.js';

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
let aiTurnStartedAt = 0;
let aiTurnGeneration = 0;
let deferAITurnCleanup = false;
let activeRollId = 0;
let rollingSince = 0;
let diceAnimating = false;
let rollWatchdogTimer = null;
const WORLD_EVENT_PAUSE_MS = 10000;
const CARD_FLIP_REVEAL_MS = 1600;
let worldEventPauseUntil = 0;
let worldEventPauseTimer = null;
let worldEventPauseCountdownTimer = null;
let worldEventPauseActive = false;
let cardRevealPauseUntil = 0;
let cardRevealPauseTimer = null;
let cardRevealPauseCountdownTimer = null;
let cardRevealFlipTimer = null;
let cardRevealPauseActive = false;
let cardRevealFlipState = 'idle';
let pendingCardReveal = null;
let pendingPremiumReveal = null;

function isWorldEventPaused() {
  return worldEventPauseActive && worldEventPauseUntil > Date.now();
}

function isCardRevealPaused() {
  return cardRevealPauseActive;
}

function isGameplayPaused() {
  return isWorldEventPaused() || isCardRevealPaused();
}

function clearWorldEventPauseTimers() {
  if (worldEventPauseTimer) {
    clearTimeout(worldEventPauseTimer);
    worldEventPauseTimer = null;
  }
  if (worldEventPauseCountdownTimer) {
    clearInterval(worldEventPauseCountdownTimer);
    worldEventPauseCountdownTimer = null;
  }
}

function endWorldEventPause() {
  if (!worldEventPauseActive) return;

  clearWorldEventPauseTimers();
  worldEventPauseActive = false;
  worldEventPauseUntil = 0;
  document.body.classList.remove('world-event-pause');
  hideWorldEventOverlay();
  paintBoardAction();
  render();
  scheduleAI();
}

function hideWorldEventOverlay() {
  const overlay = $('#world-event-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.classList.remove(
    'world-event-overlay--good',
    'world-event-overlay--bad',
    'world-event-overlay--mixed',
  );
  $('#world-event-overlay-flat')?.classList.remove('hidden');
  $('#world-event-overlay-flip')?.classList.add('hidden');
  const flipRoot = $('#center-pause-flip-root');
  if (flipRoot) flipRoot.innerHTML = '';
  $('#world-event-overlay-flip .center-pause-footer')?.classList.remove('center-pause-footer--waiting');
  getCenterFlipCard()?.classList.remove('is-flipped');
  setCenterPauseControlsVisible(false);
}

function getCenterFlipCard() {
  return $('#center-pause-flip-root')?.querySelector('.premium-flip-card') || null;
}

function worldEventMessageBody(action) {
  const msg = action.message || '';
  const prefix = `${action.title}:`;
  if (msg.startsWith(prefix)) return msg.slice(prefix.length).trim();
  return msg;
}

function getPauseSecondsLeft(pauseUntil, isPaused) {
  if (!isPaused()) return 0;
  return Math.max(1, Math.ceil((pauseUntil - Date.now()) / 1000));
}

function getPauseElapsedPercent(pauseUntil, isPaused) {
  if (!isPaused()) return 100;
  return Math.max(0, Math.min(100, ((WORLD_EVENT_PAUSE_MS - (pauseUntil - Date.now())) / WORLD_EVENT_PAUSE_MS) * 100));
}

function paintCenterPauseOverlay(action) {
  const overlay = $('#world-event-overlay');
  if (!overlay || !action || (action.type !== 'worldEvent' && action.type !== 'cardDraw' && action.type !== 'premiumBuff')) {
    hideWorldEventOverlay();
    return;
  }

  overlay.classList.remove('hidden');
  overlay.classList.remove(
    'world-event-overlay--good',
    'world-event-overlay--bad',
    'world-event-overlay--mixed',
  );
  overlay.classList.add(`world-event-overlay--${action.tone}`);

  const flatPanel = $('#world-event-overlay-flat');
  const flipPanel = $('#world-event-overlay-flip');

  if (action.type === 'worldEvent') {
    flatPanel?.classList.remove('hidden');
    flipPanel?.classList.add('hidden');

    const emojiEl = flatPanel?.querySelector('.world-event-overlay-emoji');
    const kickerEl = flatPanel?.querySelector('.world-event-overlay-kicker');
    const titleEl = flatPanel?.querySelector('.world-event-overlay-title');
    const msgEl = flatPanel?.querySelector('.world-event-overlay-message');
    const countdownEl = flatPanel?.querySelector('.world-event-overlay-countdown');
    const progressEl = flatPanel?.querySelector('.world-event-overlay-progress');

    if (kickerEl) kickerEl.textContent = 'Evento del mundo';
    if (emojiEl) emojiEl.textContent = action.emoji;
    if (titleEl) titleEl.textContent = action.title;
    if (msgEl) msgEl.innerHTML = colorizeBoardMessage(worldEventMessageBody(action));

    const secondsLeft = getPauseSecondsLeft(worldEventPauseUntil, isWorldEventPaused);
    const elapsed = getPauseElapsedPercent(worldEventPauseUntil, isWorldEventPaused);

    if (countdownEl) countdownEl.textContent = `Continúa en ${secondsLeft}s`;
    if (progressEl) progressEl.style.width = `${elapsed}%`;

    const dismissBtn = flatPanel?.querySelector('.world-event-overlay-dismiss');
    if (dismissBtn) dismissBtn.onclick = endWorldEventPause;
    return;
  }

  flatPanel?.classList.add('hidden');
  flipPanel?.classList.remove('hidden');
  if (action.type === 'premiumBuff') {
    paintPremiumBuffFlipContent(action);
  } else {
    paintCardDrawFlipContent(action);
  }
  updateCenterPauseTimerUI();
  restoreCardFlipVisualState();

  const dismissBtn = $('#center-pause-dismiss');
  if (dismissBtn) dismissBtn.onclick = endCardRevealPause;
}

function stripLeadingEmoji(text) {
  return String(text).replace(/^(\p{Extended_Pictographic})\s*/u, '').trim();
}

function buildDeckCardBackHtml(deckName, deckTitle) {
  const emoji = leadingEmoji(deckTitle);
  const title = stripLeadingEmoji(deckTitle);
  const deckLabel = deckName === 'city' ? t().chanceName : t().fortuneName;

  return `
    <div class="deck-card-back deck-card-back--${deckName === 'city' ? 'chance' : 'fortune'}">
      <div class="deck-card-back-shine" aria-hidden="true"></div>
      <span class="deck-card-back-emoji" aria-hidden="true">${emoji}</span>
      <h3 class="deck-card-back-title">${escapeHtml(title)}</h3>
      <p class="deck-card-back-sub">${escapeHtml(deckLabel)}</p>
    </div>`;
}

function buildCardDrawFaceHtml(action) {
  return `
    <div class="deck-card-reveal premium-reveal-back deck-card-reveal--${action.tone}">
      <div class="premium-reveal-back-shine" aria-hidden="true"></div>
      <p class="premium-reveal-kicker">${escapeHtml(stripLeadingEmoji(action.deckTitle))}</p>
      <div class="premium-reveal-emoji" aria-hidden="true">${action.emoji}</div>
      <h3 class="premium-reveal-title">${escapeHtml(action.title)}</h3>
      <div class="premium-reveal-desc board-message">${colorizeLogText(action.message)}</div>
    </div>`;
}

function buildCardDrawFlipSceneHtml(action) {
  return `
    <div class="premium-flip-scene card-draw-flip-scene">
      <div class="premium-flip-card" id="card-draw-flip-card">
        <div class="premium-flip-face premium-flip-front">
          ${buildDeckCardBackHtml(action.deckName, action.deckTitle)}
        </div>
        <div class="premium-flip-face premium-flip-face-back">
          ${buildCardDrawFaceHtml(action)}
        </div>
      </div>
    </div>`;
}

function paintCardDrawFlipContent(action) {
  const root = $('#center-pause-flip-root');
  if (root && !root.querySelector('#card-draw-flip-card')) {
    root.innerHTML = buildCardDrawFlipSceneHtml(action);
  }
}

function paintPremiumBuffFlipContent(action) {
  const root = $('#center-pause-flip-root');
  if (root && !root.querySelector('#premium-flip-card')) {
    root.innerHTML = buildPremiumFlipRevealHtml(action.cellId, action.buffResult);
    bindPropertyCardArtInteractions(root);
    const premiumCard = root.querySelector('.property-card--premium');
    const sheenTarget = premiumCard?.querySelector('.property-card-premium-wrap') || premiumCard;
    if (sheenTarget && action.cellId != null) {
      applyPremiumSheenStyle(sheenTarget, action.cellId);
    }
  }
}

function setCenterPauseControlsVisible(visible) {
  const footer = $('#world-event-overlay-flip .center-pause-footer');
  footer?.classList.toggle('center-pause-footer--waiting', !visible);
  $$('#world-event-overlay-flip .center-pause-controls').forEach((el) => {
    el.classList.toggle('center-pause-controls-hidden', !visible);
  });
}

function restoreCardFlipVisualState() {
  const flip = getCenterFlipCard();
  if (!flip) return;

  if (cardRevealFlipState === 'flipped') {
    flip.classList.add('is-flipped');
    setCenterPauseControlsVisible(true);
  } else {
    flip.classList.remove('is-flipped');
    setCenterPauseControlsVisible(false);
  }
}

function updateCenterPauseTimerUI() {
  const countdownEl = $('#center-pause-countdown');
  const progressEl = $('#center-pause-progress');
  if (!countdownEl || !progressEl) return;

  if (cardRevealFlipState !== 'flipped') {
    countdownEl.textContent = 'Revelando carta…';
    progressEl.style.width = '0%';
    return;
  }

  const secondsLeft = getPauseSecondsLeft(cardRevealPauseUntil, () => cardRevealPauseUntil > Date.now());
  const elapsed = getPauseElapsedPercent(cardRevealPauseUntil, () => cardRevealPauseUntil > Date.now());
  countdownEl.textContent = `Continúa en ${secondsLeft}s`;
  progressEl.style.width = `${elapsed}%`;
}

function startCenterFlipAnimation() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  cardRevealFlipState = 'idle';
  getCenterFlipCard()?.classList.remove('is-flipped');
  setCenterPauseControlsVisible(false);

  if (reducedMotion) {
    cardRevealFlipState = 'flipped';
    getCenterFlipCard()?.classList.add('is-flipped');
    beginCardRevealReadingPeriod();
    return;
  }

  requestAnimationFrame(() => {
    setTimeout(() => {
      if (!cardRevealPauseActive) return;
      cardRevealFlipState = 'flipped';
      getCenterFlipCard()?.classList.add('is-flipped');
    }, 480);
  });

  if (cardRevealFlipTimer) clearTimeout(cardRevealFlipTimer);
  cardRevealFlipTimer = setTimeout(beginCardRevealReadingPeriod, CARD_FLIP_REVEAL_MS);
}

function beginCardRevealReadingPeriod() {
  if (!cardRevealPauseActive) return;
  if (cardRevealPauseUntil > 0) return;

  cardRevealPauseUntil = Date.now() + WORLD_EVENT_PAUSE_MS;
  setCenterPauseControlsVisible(true);
  updateCenterPauseTimerUI();

  if (cardRevealPauseCountdownTimer) clearInterval(cardRevealPauseCountdownTimer);
  cardRevealPauseCountdownTimer = setInterval(() => {
    if (!cardRevealPauseActive || cardRevealPauseUntil <= Date.now()) {
      endCardRevealPause();
      return;
    }
    updateCenterPauseTimerUI();
  }, 200);

  if (cardRevealPauseTimer) clearTimeout(cardRevealPauseTimer);
  cardRevealPauseTimer = setTimeout(endCardRevealPause, WORLD_EVENT_PAUSE_MS);
}

function paintWorldEventOverlay(action) {
  paintCenterPauseOverlay(action);
}

function beginWorldEventPause() {
  clearWorldEventPauseTimers();
  worldEventPauseActive = true;
  worldEventPauseUntil = Date.now() + WORLD_EVENT_PAUSE_MS;
  document.body.classList.add('world-event-pause');
  paintWorldEventOverlay(lastBoardAction);
  paintBoardAction();
  render();

  worldEventPauseCountdownTimer = setInterval(() => {
    if (!isWorldEventPaused()) {
      endWorldEventPause();
      return;
    }
    paintWorldEventOverlay(lastBoardAction);
  }, 200);

  worldEventPauseTimer = setTimeout(endWorldEventPause, WORLD_EVENT_PAUSE_MS);
}

function clearCardRevealPauseTimers() {
  if (cardRevealPauseTimer) {
    clearTimeout(cardRevealPauseTimer);
    cardRevealPauseTimer = null;
  }
  if (cardRevealPauseCountdownTimer) {
    clearInterval(cardRevealPauseCountdownTimer);
    cardRevealPauseCountdownTimer = null;
  }
  if (cardRevealFlipTimer) {
    clearTimeout(cardRevealFlipTimer);
    cardRevealFlipTimer = null;
  }
}

function getCardRevealTone(card) {
  if (card.action === 'money') return card.amount >= 0 ? 'good' : 'bad';
  if (card.action === 'jail') return 'bad';
  if (card.action === 'jailfree') return 'good';
  return 'mixed';
}

function leadingEmoji(text) {
  const match = String(text).match(/^(\p{Extended_Pictographic})/u);
  return match ? match[1] : '🎴';
}

async function endCardRevealPause() {
  if (!cardRevealPauseActive) return;

  clearCardRevealPauseTimers();
  cardRevealPauseActive = false;
  cardRevealPauseUntil = 0;
  cardRevealFlipState = 'idle';
  document.body.classList.remove('world-event-pause');
  hideWorldEventOverlay();

  const pendingCard = pendingCardReveal;
  const pendingPremium = pendingPremiumReveal;
  pendingCardReveal = null;
  pendingPremiumReveal = null;
  paintBoardAction();
  renderBoard();
  renderPlayers();
  renderActions();
  renderLog();

  if (pendingCard) {
    await executeCard(pendingCard.card, pendingCard.playerId);
  } else if (pendingPremium?.onComplete) {
    pendingPremium.onComplete();
  }

  saveGame();
  scheduleAI();
}

function beginCardRevealPause() {
  clearCardRevealPauseTimers();
  cardRevealPauseActive = true;
  cardRevealPauseUntil = 0;
  cardRevealFlipState = 'idle';
  document.body.classList.add('world-event-pause');
  render();
  setTimeout(startCenterFlipAnimation, 0);
}

const DICE_ROLL_TIMEOUT_MS = 8000;
const DICE_INIT_TIMEOUT_MS = 10000;
const MAX_MOVE_MS = 4000;
const ROLLING_STUCK_MS = DICE_INIT_TIMEOUT_MS + DICE_ROLL_TIMEOUT_MS + MAX_MOVE_MS + 3000;

const SAVE_KEY = 'imperio-urbano-save';
const SAVE_VERSION = 1;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise)
      .then((value) => { clearTimeout(timer); resolve(value); })
      .catch((error) => { clearTimeout(timer); reject(error); });
  });
}

function getSetupBoardSize() {
  return document.querySelector('input[name="board-size"]:checked')?.value || 'classic';
}

function getSetupGameDifficulty() {
  return document.querySelector('input[name="game-difficulty"]:checked')?.value || 'normal';
}

function aiDifficultyFor(player) {
  if (!player) return state?.difficultyId || 'normal';
  return player.aiDifficultyId || state?.difficultyId || 'normal';
}

function createInitialState(playerConfigs, themeId = 'default', difficultyId = 'normal', boardSize = 'classic', options = {}) {
  applyTheme(themeId, boardSize);
  const difficulty = getDifficultyPreset(difficultyId);
  const { housesLeft, hotelsLeft } = getBoardConstants(boardSize);

  const properties = BOARD.map(() => ({
    owner: null,
    houses: 0,
    mortgaged: false,
    premium: false,
    premiumBuffId: null,
  }));
  assignPremiumCells(properties, BOARD);

  const players = playerConfigs.map(({ name, token, isAI, aiDifficultyId }, i) => ({
    id: i,
    name: name.trim() || (isAI ? defaultAIName(i) : `Jugador ${i + 1}`),
    token,
    color: PLAYER_COLORS[i],
    isAI: !!isAI,
    aiDifficultyId: isAI ? (aiDifficultyId || difficulty.id) : null,
    money: difficulty.startingMoney,
    position: 0,
    inJail: false,
    jailTurns: 0,
    jailFreeCards: 0,
    bankrupt: false,
    activeBuff: null,
  }));

  return {
    themeId,
    boardSize,
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
    housesLeft,
    hotelsLeft,
    freeParkingPot: 0,
    auction: null,
    worldEventsEnabled: options.worldEventsEnabled !== false,
    worldEventsMode: options.worldEventsMode === 'random' ? 'random' : 'interval',
    turnCounter: 0,
    lastWorldEventTurn: 0,
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

function isActiveRoll(rollId) {
  return rollId === activeRollId && state?.phase === 'rolling';
}

function resetDiceFlowState() {
  activeRollId++;
  aiTurnGeneration++;
  rollingSince = 0;
  diceAnimating = false;
  aiTurnRunning = false;
  aiTurnStartedAt = 0;
  aiTurnScheduled = false;
  deferAITurnCleanup = false;
  clearRollWatchdog();
  clearWorldEventPauseTimers();
  worldEventPauseActive = false;
  worldEventPauseUntil = 0;
  clearCardRevealPauseTimers();
  cardRevealPauseActive = false;
  cardRevealPauseUntil = 0;
  cardRevealFlipState = 'idle';
  pendingCardReveal = null;
  pendingPremiumReveal = null;
  document.body.classList.remove('world-event-pause');
  hideWorldEventOverlay();
}

function invalidateStuckRoll() {
  activeRollId++;
  aiTurnGeneration++;
  rollingSince = 0;
  diceAnimating = false;
  aiTurnRunning = false;
  aiTurnStartedAt = 0;
  if (state) state.phase = 'roll';
  resetDiceBox();
  $('.board-center')?.classList.remove('board-center--dice-rolling');
  $('#dice-overlay')?.classList.remove('dice-overlay--rolling');
  clearRollWatchdog();
}

function clearRollWatchdog() {
  if (!rollWatchdogTimer) return;
  clearTimeout(rollWatchdogTimer);
  rollWatchdogTimer = null;
}

function startRollWatchdog(rollId) {
  clearRollWatchdog();
  rollWatchdogTimer = setTimeout(() => {
    rollWatchdogTimer = null;
    if (!state || state.phase !== 'rolling' || rollId !== activeRollId) return;
    console.warn('Tirada de dados atascada; recuperando.');
    invalidateStuckRoll();
    render();
  }, ROLLING_STUCK_MS);
}

function recoverStuckGameState() {
  const now = Date.now();

  if (state?.phase === 'rolling' && rollingSince && now - rollingSince >= ROLLING_STUCK_MS) {
    invalidateStuckRoll();
    return;
  }

  if (aiTurnRunning && aiTurnStartedAt && now - aiTurnStartedAt >= ROLLING_STUCK_MS) {
    aiTurnRunning = false;
    aiTurnStartedAt = 0;
    diceAnimating = false;
    if (state?.phase === 'rolling') {
      invalidateStuckRoll();
    } else {
      aiTurnGeneration++;
    }
  }
}

function scheduleAI() {
  if (aiTurnScheduled || !state || state.winner) return;
  if (isGameplayPaused()) return;

  recoverStuckGameState();

  if (aiTurnRunning) return;
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
    el.classList.remove('board-action--start');
    return;
  }

  el.classList.toggle('board-action--start', lastBoardAction.type === 'gameStart');
  el.classList.remove(
    'board-action--world-event',
    'board-action--world-event-good',
    'board-action--world-event-bad',
    'board-action--world-event-mixed',
    'board-action--player-buff',
    'board-action--player-buff-good',
  );

  if (lastBoardAction.type === 'gameStart') {
    el.innerHTML = `<span class="board-action-start">${escapeHtml(lastBoardAction.message)}</span>`;
  } else if (lastBoardAction.type === 'cardDraw' || lastBoardAction.type === 'premiumBuff') {
    if (isCardRevealPaused()) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    el.classList.add('board-action--world-event', `board-action--world-event-${lastBoardAction.tone}`);
    el.innerHTML = `
      <span class="board-action-world-event-compact">
        <span class="board-action-world-event-compact-icon" aria-hidden="true">${lastBoardAction.emoji}</span>
        <span class="board-action-world-event-compact-text">${escapeHtml(lastBoardAction.title)}</span>
      </span>`;
  } else if (lastBoardAction.type === 'worldEvent') {
    if (isWorldEventPaused()) {
      el.innerHTML = '';
      el.classList.add('hidden');
      return;
    }
    el.classList.add('board-action--world-event', `board-action--world-event-${lastBoardAction.tone}`);
    el.innerHTML = `
      <span class="board-action-world-event-compact">
        <span class="board-action-world-event-compact-icon" aria-hidden="true">${lastBoardAction.emoji}</span>
        <span class="board-action-world-event-compact-text">${escapeHtml(lastBoardAction.title)}</span>
      </span>`;
  } else if (lastBoardAction.type === 'playerBuff') {
    el.classList.add('board-action--player-buff', `board-action--player-buff-${lastBoardAction.tone}`);
    el.innerHTML = `
      <span class="board-action-player-buff-compact">
        <span class="board-action-player-buff-compact-icon" aria-hidden="true">${lastBoardAction.emoji}</span>
        <span class="board-action-player-buff-compact-text">
          <strong>${escapeHtml(lastBoardAction.playerName)}</strong> · ${escapeHtml(lastBoardAction.title)}
        </span>
      </span>`;
  } else if (lastBoardAction.type === 'transfer' || lastBoardAction.type === 'message') {
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

function formatBuffTagLabel(buffLabel) {
  if (!buffLabel) return '';
  if (buffLabel.chargesLeft != null) {
    return `${buffLabel.emoji} ${buffLabel.title} · ${buffLabel.chargesLeft}u · ${buffLabel.roundsLeft}r`;
  }
  return `${buffLabel.emoji} ${buffLabel.title} · ${buffLabel.roundsLeft}r`;
}

function diff() {
  return getDifficultyPreset(state?.difficultyId || 'normal');
}

function goBonusAmount(player = null) {
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

function houseCostForPlayer(group, player) {
  return HOUSE_COST[group] || 0;
}

function houseCostTableFor(player) {
  return HOUSE_COST;
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

  let rent = 0;

  if (cell.type === 'property') {
    const table = RENT_TABLES[cell.group];
    if (prop.houses === 5) rent = table[5];
    else if (prop.houses > 0) rent = table[prop.houses];
    else rent = ownsFullGroup(prop.owner, cell.group) ? table[0] * 2 : table[0];
  } else if (cell.type === 'railroad') {
    const n = countOwnedRailroads(prop.owner);
    rent = [25, 50, 100, 200][n - 1] || 25;
  } else if (cell.type === 'utility') {
    const n = countOwnedUtilities(prop.owner);
    const diceTotal = state.dice[0] + state.dice[1] || 7;
    rent = n === 2 ? diceTotal * 10 : diceTotal * 4;
  }

  rent = Math.round(rent);
  return rent;
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
    const cost = houseCostForPlayer(cell.group, player);

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

  const buffLabel = player.activeBuff
    ? getBuffPresentation(player.activeBuff, state.themeId || 'default')
    : null;

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
      ${buffLabel ? `
      <div class="player-active-buff">
        <div class="player-active-buff-head">${buffLabel.emoji} Ventaja activa</div>
        <div class="player-active-buff-name">${escapeHtml(buffLabel.title)}</div>
        <div class="player-active-buff-meta">${buffLabel.chargesLeft != null ? `${buffLabel.chargesLeft} uso${buffLabel.chargesLeft === 1 ? '' : 's'} · ` : ''}${buffLabel.roundsLeft} ronda${buffLabel.roundsLeft === 1 ? '' : 's'} · ${escapeHtml(buffLabel.description)}</div>
      </div>` : ''}
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
  state.turnCounter = (state.turnCounter || 0) + 1;
  maybeTriggerWorldEvent();
}

function announcePlayerBuffGrant(result) {
  if (!result) return;
  addLog(result.message, { skipBoardAction: true });
  setBoardAction({
    type: 'playerBuff',
    tone: result.tone,
    emoji: result.emoji,
    title: result.title,
    message: result.description,
    playerName: result.playerName,
  });
  pulseBoardAction();
}

function buildPremiumFlipRevealHtml(cellId, buffResult, currentBuff = null) {
  const cell = BOARD[cellId];
  const frontHtml = buildPropertyCardHtml(cellId, '', { hidePremiumBuff: true });
  const rounds = buffResult.roundsLeft ?? 1;

  return `
    <div class="premium-flip-scene">
      <div class="premium-flip-card" id="premium-flip-card">
        <div class="premium-flip-face premium-flip-front">
          ${frontHtml}
        </div>
        <div class="premium-flip-face premium-flip-face-back">
          <div class="premium-reveal-back">
            <div class="premium-reveal-back-shine" aria-hidden="true"></div>
            <p class="premium-reveal-kicker">${currentBuff ? 'Nueva ventaja premium' : 'Ventaja premium revelada'}</p>
            ${currentBuff ? `
            <div class="premium-reveal-current">
              <span class="premium-reveal-current-label">Activa ahora</span>
              <strong>${currentBuff.emoji} ${escapeHtml(currentBuff.title)}</strong>
              <span>${escapeHtml(currentBuff.description)}</span>
            </div>` : ''}
            <div class="premium-reveal-emoji" aria-hidden="true">${buffResult.emoji}</div>
            <h3 class="premium-reveal-title">${escapeHtml(buffResult.title)}</h3>
            <p class="premium-reveal-desc">${escapeHtml(buffResult.description)}</p>
            <p class="premium-reveal-meta">${escapeHtml(buffResult.playerName || '')}${buffResult.playerName ? ' · ' : ''}${rounds} ronda${rounds === 1 ? '' : 's'}</p>
            <p class="premium-reveal-cell">${escapeHtml(cell.name)}</p>
          </div>
        </div>
      </div>
    </div>`;
}

function premiumBuffContext(player) {
  return {
    goBonus: goBonusAmount(player),
    formatMoney,
  };
}

function handlePremiumBuffAfterPurchase(player, prop, cellId, onComplete) {
  const themeId = state.themeId || 'default';
  const buffId = prop?.premiumBuffId;
  if (!prop?.premium || !buffId) {
    onComplete?.();
    return;
  }

  const context = premiumBuffContext(player);
  const newPreview = previewBuffGrant(buffId, themeId, context);
  if (!newPreview) {
    onComplete?.();
    return;
  }
  newPreview.playerName = player.name;

  if (player.activeBuff && !player.isAI) {
    const currentLabel = getBuffPresentation(player.activeBuff, themeId, formatMoney(goBonusAmount()));
    showPremiumBuffChoiceReveal(cellId, player, currentLabel, newPreview, buffId, onComplete);
    return;
  }

  if (player.activeBuff && player.isAI) {
    if (shouldReplaceActiveBuff(player, buffId)) {
      const result = applyBuffToPlayer(player, buffId, themeId, context);
      announcePlayerBuffGrant({
        ...result,
        message: `${result.emoji} ${player.name} cambia a «${result.title}»: ${result.description}`,
      });
    } else {
      addLog(`${player.name} mantiene su ventaja premium actual.`);
    }
    onComplete?.();
    return;
  }

  const result = applyBuffToPlayer(player, buffId, themeId, context);
  showPremiumBuffReveal(cellId, result, onComplete);
}

function showPremiumBuffChoiceReveal(cellId, player, currentBuff, newPreview, buffId, onComplete) {
  showBoardCard(
    buildPremiumFlipRevealHtml(cellId, newPreview, currentBuff),
    [
      {
        label: `Mantener ${currentBuff.emoji} ${currentBuff.title}`,
        action: () => {
          addLog(`${player.name} mantiene «${currentBuff.title}».`);
          closeBoardCard();
          onComplete?.();
          saveGame();
        },
      },
      {
        label: `Cambiar a ${newPreview.emoji} ${newPreview.title}`,
        action: () => {
          const result = applyBuffToPlayer(player, buffId, state.themeId || 'default', premiumBuffContext(player));
          announcePlayerBuffGrant({
            ...result,
            message: `${result.emoji} ${player.name} cambia a «${result.title}»: ${result.description}`,
          });
          closeBoardCard();
          onComplete?.();
          saveGame();
        },
        primary: true,
      },
    ],
    cellId,
  );
  startPremiumFlipAnimation();
}

function startPremiumFlipAnimation() {
  const flip = document.getElementById('premium-flip-card');
  const actions = $('#board-card-actions');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  actions?.classList.add('premium-reveal-actions-hidden');

  if (reducedMotion) {
    flip?.classList.add('is-flipped');
    actions?.classList.remove('premium-reveal-actions-hidden');
    return;
  }

  requestAnimationFrame(() => {
    setTimeout(() => flip?.classList.add('is-flipped'), 480);
  });
  setTimeout(() => actions?.classList.remove('premium-reveal-actions-hidden'), 1600);
}

function showPremiumBuffReveal(cellId, buffResult, onComplete) {
  announcePlayerBuffGrant(buffResult);
  pendingCardReveal = null;
  pendingPremiumReveal = { onComplete };
  setBoardAction({
    type: 'premiumBuff',
    tone: buffResult.tone || 'good',
    cellId,
    buffResult,
    emoji: buffResult.emoji,
    title: buffResult.title,
    message: buffResult.description,
    playerName: buffResult.playerName,
  });
  pulseBoardAction();
  saveGame();
  beginCardRevealPause();
}

function maybeTriggerWorldEvent() {
  if (!shouldTriggerWorldEvent(state)) return;

  const result = resolveWorldEvent(state, BOARD, state.themeId, formatMoney);
  if (!result) return;

  state.lastWorldEventTurn = state.turnCounter;
  addLog(`${result.emoji} ${result.message}`, { skipBoardAction: true });
  setBoardAction({
    type: 'worldEvent',
    tone: result.tone,
    emoji: result.emoji,
    title: result.title,
    message: result.message,
  });
  pulseBoardAction();
  saveGame();
  render();
  beginWorldEventPause();
}

// ─── Movimiento ──────────────────────────────────────────────
async function movePlayer(playerId, steps, collectGo = true) {
  const player = state.players[playerId];
  const oldPos = player.position;
  const newPos = (oldPos + steps) % BOARD_LEN;
  const passedGo = steps > 0 && (oldPos + steps >= BOARD_LEN);

  for (let step = 1; step <= Math.abs(steps); step++) {
    const direction = steps >= 0 ? 1 : -1;
    player.position = (oldPos + step * direction + BOARD_LEN) % BOARD_LEN;
    movingTokenId = playerId;
    updateBoardTokens();
    sounds.playTokenStep();
    await sleep(220);
    movingTokenId = null;
    updateBoardTokens();
    await sleep(55);
  }

  if (passedGo && collectGo) {
    const bonus = goBonusAmount(player);
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
  if (steps <= 0) steps += BOARD_LEN;
  const passedGo = target < oldPos || (target === 0 && oldPos !== 0);

  await movePlayer(playerId, steps, false);
  player.position = target;

  if (passedGo && collectGo && target !== 0) {
    const bonus = goBonusAmount(player);
    player.money += bonus;
    addLog(`${player.name} pasa por ${t().goName} y cobra ${formatMoney(bonus)}.`);
  } else if (target === 0 && collectGo) {
    const bonus = goBonusAmount(player);
    player.money += bonus;
    addLog(`${player.name} llega a ${t().goName} y cobra ${formatMoney(bonus)}.`);
  }

  updateBoardTokens();
  return target;
}

async function findNearest(playerId, type) {
  const pos = state.players[playerId].position;
  for (let i = 1; i <= BOARD_LEN; i++) {
    const idx = (pos + i) % BOARD_LEN;
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
  if (tryConsumeRentShield(player)) {
    addLog(`${player.name} usa salvo conducto premium: sin alquiler en ${cell.name}.`);
    state.phase = 'end';
    render();
    return;
  }
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
  const deckTitle = deckName === 'city' ? t().chanceDeckTitle : t().fortuneDeckTitle;
  addLog(`${player.name} — ${deckTitle}: ${card.text}`, { skipBoardAction: true });
  pendingCardReveal = { card, playerId };
  setBoardAction({
    type: 'cardDraw',
    deckName,
    tone: getCardRevealTone(card),
    emoji: leadingEmoji(deckTitle),
    deckTitle,
    title: player.name,
    message: card.text,
  });
  pulseBoardAction();
  saveGame();
  beginCardRevealPause();
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
        const bonus = getCardMoneyBonus(player);
        const income = scaleCardIncome(card.amount) + bonus;
        player.money += income;
        addLog(`${player.name} recibe ${formatMoney(income)}${bonus ? ` (incl. +${formatMoney(bonus)} premium)` : ''}.`);
      } else if (!transferMoney(playerId, null, scaleCardFine(card.amount), 'carta', true)) {
        return;
      }
      state.phase = 'end';
      render();
      break;
    case 'collectEach': {
      const cardBonus = getCardMoneyBonus(player);
      activePlayers().forEach((p) => {
        if (p.id !== playerId && !p.bankrupt) {
          transferMoney(p.id, playerId, scaleCardIncome(card.amount), 'carta');
        }
      });
      if (cardBonus) {
        player.money += cardBonus;
        addLog(`${player.name} recibe +${formatMoney(cardBonus)} extra por ventaja premium.`);
      }
      state.phase = 'end';
      render();
      break;
    }
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
      const newPos = (player.position - card.steps + BOARD_LEN) % BOARD_LEN;
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
  if (state.phase !== 'roll' || player.bankrupt || isGameplayPaused()) return;

  closeBoardCard();
  closeModal();

  if (player.inJail) {
    await handleJailRoll();
    return;
  }

  const rollId = ++activeRollId;
  state.phase = 'rolling';
  rollingSince = Date.now();
  startRollWatchdog(rollId);
  renderActions();
  try {
    const [d1, d2] = await animateDice();
    if (!isActiveRoll(rollId)) return;

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
    if (!isActiveRoll(rollId)) return;
    landOnCell(player.id, newPos);

    if (!isCardRevealPaused()) render();
  } finally {
    if (rollId === activeRollId) {
      rollingSince = 0;
      clearRollWatchdog();
    }
  }
}

async function handleJailRoll() {
  const player = currentPlayer();
  const rollId = ++activeRollId;
  state.phase = 'rolling';
  rollingSince = Date.now();
  startRollWatchdog(rollId);
  renderActions();
  try {
    const [d1, d2] = await animateDice();
    if (!isActiveRoll(rollId)) return;

    state.dice = [d1, d2];

    player.jailTurns++;
    const isDouble = d1 === d2;

    if (isDouble) {
      player.inJail = false;
      player.jailTurns = 0;
      state.doublesCount = 0;
      addLog(`${player.name} saca doble (${d1}+${d2}) y sale de ${t().jailName}.`);
      const newPos = await movePlayer(player.id, d1 + d2);
      if (!isActiveRoll(rollId)) return;
      landOnCell(player.id, newPos);
      if (state.phase === 'rolling') state.phase = 'end';
    } else if (player.jailTurns >= 3) {
      player.inJail = false;
      player.jailTurns = 0;
      state.doublesCount = 0;
      addLog(`${player.name} no saca doble (${d1}+${d2}). Debe pagar fianza para salir.`);
      transferMoney(player.id, null, jailBailAmount(), 'fianza');
      const newPos = await movePlayer(player.id, d1 + d2);
      if (!isActiveRoll(rollId)) return;
      landOnCell(player.id, newPos);
      if (state.phase === 'rolling') state.phase = 'end';
    } else {
      state.doublesCount = 0;
      addLog(`${player.name} no saca doble (${d1}+${d2}). Turno ${player.jailTurns}/3 en ${t().jailName}.`);
      state.phase = 'end';
    }
    if (!isCardRevealPaused()) render();
  } finally {
    if (rollId === activeRollId) {
      rollingSince = 0;
      clearRollWatchdog();
    }
  }
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

  const { price, saved } = resolvePurchasePrice(player, cell.price);
  if (player.money < price) {
    addLog(`${player.name} no tiene dinero para comprar ${cell.name}.`);
    pendingAction = null;
    state.phase = 'end';
    closeBoardCard();
    render();
    return;
  }

  player.money -= price;
  if (saved > 0) consumePurchaseDiscount(player);
  prop.owner = player.id;
  let logMsg = `${player.name} compra ${cell.name} por ${formatMoney(price)}`;
  if (saved > 0) logMsg += ` (−${formatMoney(saved)} premium)`;
  logMsg += '.';
  addLog(logMsg);
  pendingAction = null;
  state.phase = 'end';

  if (prop.premium && prop.premiumBuffId) {
    handlePremiumBuffAfterPurchase(player, prop, cellId, () => {
      closeBoardCard();
      render();
    });
    return;
  }

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
      const decision = decideAuctionBid(auction, bidder, state, aiDifficultyFor(bidder), BOARD, RENT_TABLES);
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
    const { price, saved } = resolvePurchasePrice(winner, result.amount);
    winner.money -= price;
    if (saved > 0) consumePurchaseDiscount(winner);
    prop.owner = winner.id;
    let logMsg = `🔨 ${winner.name} gana ${result.cell.name} por ${formatMoney(price)}`;
    if (saved > 0) logMsg += ` (−${formatMoney(saved)} premium)`;
    logMsg += '.';
    addLog(logMsg);
    state.auction = null;
    state.phase = 'end';
    closeModal();

    if (prop.premium && prop.premiumBuffId) {
      handlePremiumBuffAfterPurchase(winner, prop, auction.cellId, () => render());
      return;
    }

    render();
  } else {
    addLog(`🔨 Nadie compró ${result.cell.name}. Sigue en venta.`);
    state.auction = null;
    state.phase = 'end';
    closeModal();
    render();
  }
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

function formatTradeReviewBody(from, to, offer) {
  const listOffer = [
    ...offer.offerProps.map((id) => BOARD[id].name),
    ...(offer.offerMoney ? [formatMoney(offer.offerMoney)] : []),
    ...(offer.offerJailCards ? ['1 carta salida'] : []),
  ];
  const listRequest = [
    ...offer.requestProps.map((id) => BOARD[id].name),
    ...(offer.requestMoney ? [formatMoney(offer.requestMoney)] : []),
    ...(offer.requestJailCards ? ['1 carta salida'] : []),
  ];
  const mortgagedWarning = offer.offerProps.some((id) => state.properties[id].mortgaged)
    || offer.requestProps.some((id) => state.properties[id].mortgaged)
    ? '<p class="trade-warning">⚠️ Hay propiedades hipotecadas en el trato. El nuevo dueño deberá pagar 10% extra para recuperarlas.</p>'
    : '';

  return `
    <div class="trade-review">
      <p><strong>${from.name} da:</strong> ${listOffer.length ? listOffer.join(', ') : '—'}</p>
      <p class="trade-arrow">⇅</p>
      <p><strong>${to.name} da:</strong> ${listRequest.length ? listRequest.join(', ') : '—'}</p>
    </div>
    ${mortgagedWarning}`;
}

function showTradeReview() {
  const from = state.players[tradeDraft.fromId];
  const to = state.players[tradeDraft.toId];

  showModal(
    '🤝 Revisar trato',
    `<p><strong>Pasa el dispositivo a ${to.name}</strong></p>
     ${formatTradeReviewBody(from, to, tradeDraft)}`,
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
  if (shouldAcceptTrade(offer, state, aiDifficultyFor(to), BOARD, RENT_TABLES)) {
    executeTrade(state, state.players, offer, formatMoney, addLog);
    handleMortgagedTradeProps(offer);
  } else {
    addLog(`${to.name} rechaza el trato con ${from.name}.`);
  }
  tradeDraft = null;
  render();
}

function completeDeferredAITurn() {
  aiTurnRunning = false;
  aiTurnStartedAt = 0;
  if (isAIPlayer()) scheduleAI();
}

function finishAIEndPhase(player) {
  if (state.doublesCount > 0 && !player.inJail) {
    state.phase = 'roll';
    render();
    return;
  }
  endTurn();
}

function showAITradeProposal(offer, onDone) {
  const from = state.players[offer.fromId];
  const to = state.players[offer.toId];

  addLog(`🤝 ${from.name} propone un trato a ${to.name}.`);
  showModal(
    `🤝 ${from.name} propone un trato`,
    `<p><strong>${to.name}</strong>, revisa la oferta:</p>
     ${formatTradeReviewBody(from, to, offer)}`,
    [
      {
        label: 'Aceptar trato',
        primary: true,
        action: () => {
          closeModal();
          executeTrade(state, state.players, offer, formatMoney, addLog);
          handleMortgagedTradeProps(offer);
          render();
          onDone();
        },
      },
      {
        label: 'Rechazar',
        action: () => {
          closeModal();
          addLog(`${to.name} rechaza el trato con ${from.name}.`);
          render();
          onDone();
        },
      },
    ],
  );
}

function tryAITradeProposal(player) {
  const opponents = activePlayers()
    .filter((p) => p.id !== player.id)
    .map((p) => p.id);
  const offer = proposeAITrade(state, player.id, opponents, aiDifficultyFor(player), BOARD, RENT_TABLES);
  if (!offer) return 'none';

  const err = validateTrade(state, state.players, offer);
  if (err) return 'none';

  const to = state.players[offer.toId];
  if (to.isAI) {
    if (shouldAcceptTrade(offer, state, aiDifficultyFor(to), BOARD, RENT_TABLES)) {
      addLog(`🤝 ${player.name} propone un trato a ${to.name}.`);
      executeTrade(state, state.players, offer, formatMoney, addLog);
      handleMortgagedTradeProps(offer);
    } else {
      addLog(`🤝 ${player.name} propone un trato a ${to.name}, pero ${to.name} lo rechaza.`);
    }
    render();
    return 'done';
  }

  showAITradeProposal(offer, () => {
    finishAIEndPhase(player);
    completeDeferredAITurn();
  });
  return 'pending';
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

function aiUnmortgageProperties(playerId) {
  let safety = 0;
  while (safety++ < 10) {
    const target = pickPropertyToUnmortgage(state, playerId, BOARD);
    if (target == null) break;
    toggleMortgage(target);
  }
}

function aiBuildHouses(playerId) {
  const player = state.players[playerId];
  let safety = 0;
  while (safety++ < 12) {
    const target = pickBuildTarget(state, playerId, BOARD, houseCostTableFor(player), ownsFullGroup, getGroupCells);
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
  if (isGameplayPaused()) return;

  const player = currentPlayer();
  if (!player?.isAI || player.bankrupt) return;
  if (state.phase === 'rolling' || state.phase === 'auction') return;

  aiTurnRunning = true;
  aiTurnStartedAt = Date.now();
  const turnId = ++aiTurnGeneration;
  try {
    if (state.phase === 'buy' && pendingAction?.type === 'buy') {
      closeBoardCard();
      const cellId = pendingAction.cellId;
      if (shouldBuyProperty(cellId, state, player.id, aiDifficultyFor(player), BOARD, RENT_TABLES)) {
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
        const jailChoice = decideJailAction(player, aiDifficultyFor(player), jailBailAmount());
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
      if (isCardRevealPaused()) return;
      closeBoardCard();
      aiUnmortgageProperties(player.id);
      aiBuildHouses(player.id);
      if (state.doublesCount > 0 && !player.inJail) {
        state.phase = 'roll';
        render();
        return;
      }
      const tradeResult = tryAITradeProposal(player);
      if (tradeResult === 'pending') {
        deferAITurnCleanup = true;
        return;
      }
      finishAIEndPhase(player);
    }
  } finally {
    if (deferAITurnCleanup) {
      deferAITurnCleanup = false;
      return;
    }
    if (turnId === aiTurnGeneration) {
      aiTurnRunning = false;
      aiTurnStartedAt = 0;
      if (isAIPlayer()) scheduleAI();
    }
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
  const cost = houseCostForPlayer(cell.group, player);

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
  tickPlayerBuffs(currentPlayer());
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
function showBoardCard(body, buttons, cellId = null) {
  activeBoardCard = { body, buttons, cellId };
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
  bindPropertyCardArtInteractions(content);
  if (!content.querySelector('.premium-flip-scene')) {
    const premiumCard = content.querySelector('.property-card--premium');
    const sheenTarget = premiumCard?.querySelector('.property-card-premium-wrap') || premiumCard;
    if (sheenTarget && activeBoardCard.cellId != null) {
      applyPremiumSheenStyle(sheenTarget, activeBoardCard.cellId);
    }
  }
  actions.innerHTML = '';
  actions.classList.remove('premium-reveal-actions-hidden');
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

function openPropertyArtLightbox(url, label = '') {
  const lightbox = $('#property-art-lightbox');
  const img = lightbox?.querySelector('.property-art-lightbox-img');
  const caption = lightbox?.querySelector('.property-art-lightbox-caption');
  if (!lightbox || !img) return;
  img.src = url;
  img.alt = label;
  if (caption) caption.textContent = label;
  resetPropertyArtLightboxView();
  lightbox.classList.remove('hidden');
  document.body.classList.add('property-art-lightbox-open');
}

const LIGHTBOX_ZOOM_MIN = 1;
const LIGHTBOX_ZOOM_MAX = 4;
const LIGHTBOX_ZOOM_STEP = 0.5;
let propertyArtLightboxZoom = 1;
let propertyArtLightboxPan = { x: 0, y: 0 };
let propertyArtLightboxDrag = null;

function updatePropertyArtLightboxView() {
  const lightbox = $('#property-art-lightbox');
  const pan = lightbox?.querySelector('.property-art-lightbox-pan');
  const viewport = lightbox?.querySelector('.property-art-lightbox-viewport');
  const frame = lightbox?.querySelector('.property-art-lightbox-frame');
  const label = lightbox?.querySelector('.property-art-lightbox-zoom-level');
  if (!pan || !viewport) return;

  const zoom = propertyArtLightboxZoom;
  const hasPan = zoom > 1 || propertyArtLightboxPan.x !== 0 || propertyArtLightboxPan.y !== 0;
  pan.style.transform = hasPan
    ? `translate(${propertyArtLightboxPan.x}px, ${propertyArtLightboxPan.y}px) scale(${zoom})`
    : '';
  viewport.classList.toggle('is-zoomed', zoom > 1);
  viewport.classList.toggle('is-pannable', zoom > 1);
  frame?.classList.toggle('is-zoomed', zoom > 1);
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;
}

function setPropertyArtLightboxZoom(nextZoom) {
  propertyArtLightboxZoom = Math.min(
    LIGHTBOX_ZOOM_MAX,
    Math.max(LIGHTBOX_ZOOM_MIN, nextZoom),
  );
  if (propertyArtLightboxZoom === 1) {
    propertyArtLightboxPan = { x: 0, y: 0 };
  }
  updatePropertyArtLightboxView();
}

function resetPropertyArtLightboxView() {
  propertyArtLightboxZoom = 1;
  propertyArtLightboxPan = { x: 0, y: 0 };
  propertyArtLightboxDrag = null;
  updatePropertyArtLightboxView();
}

function bindPropertyArtLightboxPan(viewport) {
  const endDrag = (event) => {
    if (!propertyArtLightboxDrag || propertyArtLightboxDrag.pointerId !== event.pointerId) return;
    propertyArtLightboxDrag = null;
    viewport.classList.remove('is-dragging');
    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  };

  viewport.addEventListener('pointerdown', (event) => {
    if (propertyArtLightboxZoom <= 1) return;
    if (event.button !== 0) return;
    propertyArtLightboxDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: propertyArtLightboxPan.x,
      panY: propertyArtLightboxPan.y,
    };
    viewport.classList.add('is-dragging');
    viewport.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!propertyArtLightboxDrag || propertyArtLightboxDrag.pointerId !== event.pointerId) return;
    propertyArtLightboxPan.x = propertyArtLightboxDrag.panX + (event.clientX - propertyArtLightboxDrag.startX);
    propertyArtLightboxPan.y = propertyArtLightboxDrag.panY + (event.clientY - propertyArtLightboxDrag.startY);
    updatePropertyArtLightboxView();
    event.preventDefault();
  });

  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
}

function closePropertyArtLightbox() {
  const lightbox = $('#property-art-lightbox');
  if (!lightbox) return;
  lightbox.classList.add('hidden');
  document.body.classList.remove('property-art-lightbox-open');
  const img = lightbox.querySelector('.property-art-lightbox-img');
  const pan = lightbox.querySelector('.property-art-lightbox-pan');
  if (img) img.removeAttribute('src');
  if (pan) pan.style.transform = '';
  resetPropertyArtLightboxView();
}

function bindPropertyCardArtInteractions(root) {
  root?.querySelectorAll('.property-card-art-btn').forEach((btn) => {
    btn.onclick = (event) => {
      event.stopPropagation();
      const url = btn.dataset.artUrl;
      const label = btn.querySelector('.property-card-art')?.alt || '';
      if (url) openPropertyArtLightbox(url, label);
    };
  });
}

function initPropertyArtLightbox() {
  const lightbox = $('#property-art-lightbox');
  if (!lightbox || lightbox.dataset.bound) return;
  lightbox.dataset.bound = '1';

  lightbox.querySelector('.property-art-lightbox-backdrop')?.addEventListener('click', closePropertyArtLightbox);
  lightbox.querySelector('.property-art-lightbox-close')?.addEventListener('click', closePropertyArtLightbox);
  lightbox.querySelector('[data-zoom="in"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    setPropertyArtLightboxZoom(propertyArtLightboxZoom + LIGHTBOX_ZOOM_STEP);
  });
  lightbox.querySelector('[data-zoom="out"]')?.addEventListener('click', (event) => {
    event.stopPropagation();
    setPropertyArtLightboxZoom(propertyArtLightboxZoom - LIGHTBOX_ZOOM_STEP);
  });

  const viewport = lightbox.querySelector('.property-art-lightbox-viewport');
  const img = lightbox.querySelector('.property-art-lightbox-img');
  if (viewport) bindPropertyArtLightboxPan(viewport);
  img?.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    if (propertyArtLightboxZoom > 1) {
      resetPropertyArtLightboxView();
    }
  });
  img?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (propertyArtLightboxZoom <= 1) {
      setPropertyArtLightboxZoom(1.5);
    }
  });
  viewport?.addEventListener('wheel', (event) => {
    if (lightbox.classList.contains('hidden')) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? LIGHTBOX_ZOOM_STEP : -LIGHTBOX_ZOOM_STEP;
    setPropertyArtLightboxZoom(propertyArtLightboxZoom + delta);
  }, { passive: false });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightbox.classList.contains('hidden')) {
      closePropertyArtLightbox();
    }
  });
}

function buildPremiumBonusRow(cellId) {
  const prop = state.properties[cellId];
  if (!prop?.premium || !prop.premiumBuffId) return '';

  if (prop.owner === null) {
    return `<div class="property-card-row property-card-row--premium property-card-row--premium-mystery"><span>⭐ Casilla premium</span><strong>Ventaja sorpresa al comprar</strong></div>`;
  }

  const preview = getPremiumBuffPreview(prop.premiumBuffId, state.themeId || 'default', formatMoney(goBonusAmount()));
  if (!preview) return '';
  return `<div class="property-card-row property-card-row--premium"><span>${preview.emoji} Ventaja premium</span><strong>${preview.title} — ${preview.description}</strong></div>`;
}

function buildThemedArtStatsRows(cellId, { hidePremiumBuff = false } = {}) {
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const owner = prop.owner !== null ? state.players[prop.owner] : null;
  let statsRows = '';

  if (cell.type === 'go') {
    statsRows += `<div class="property-card-row"><span>Al pasar</span><strong>+${formatMoney(goBonusAmount())}</strong></div>`;
  } else if (cell.type === 'tax') {
    statsRows += `<div class="property-card-row"><span>Pago</span><strong>${formatMoney(scaleTax(cell.amount))}</strong></div>`;
  } else if (cell.type === 'parking') {
    statsRows += `<div class="property-card-row"><span>Descanso</span><strong>${escapeHtml(cell.desc || 'Sin efecto')}</strong></div>`;
  } else if (cell.type === 'jail') {
    statsRows += `<div class="property-card-row"><span>Visita</span><strong>${escapeHtml(cell.desc || t().jailName)}</strong></div>`;
  } else if (cell.type === 'gotojail') {
    statsRows += `<div class="property-card-row"><span>Efecto</span><strong>${escapeHtml(cell.desc || `Ir a ${t().jailName}`)}</strong></div>`;
  } else if (cell.type === 'chance') {
    statsRows += `<div class="property-card-row"><span>Mazo</span><strong>${t().chanceName}</strong></div>`;
  } else if (cell.type === 'chest') {
    statsRows += `<div class="property-card-row"><span>Mazo</span><strong>${t().fortuneName}</strong></div>`;
  }

  if (cell.type === 'property' && cell.group) {
    const rents = RENT_TABLES[cell.group];
    statsRows += `<div class="property-card-row"><span>Alquiler</span><strong>${formatMoney(rents[0])}</strong></div>`;
    statsRows += `<div class="property-card-rents">${rents.map((r, i) => i === 0 ? '' : i < 5 ? `<span>${i}${tb().houseEmoji} ${formatMoney(r)}</span>` : `<span>${tb().hotelEmoji} ${formatMoney(r)}</span>`).join('')}</div>`;
  }
  if (cell.type === 'railroad') {
    if (cell.price) statsRows += `<div class="property-card-row"><span>Precio</span><strong>${formatMoney(cell.price)}</strong></div>`;
    statsRows += `<div class="property-card-row"><span>Tipo</span><strong>${t().railroadLabel}</strong></div>`;
  }
  if (cell.type === 'utility') {
    if (cell.price) statsRows += `<div class="property-card-row"><span>Precio</span><strong>${formatMoney(cell.price)}</strong></div>`;
    statsRows += `<div class="property-card-row"><span>Tipo</span><strong>${t().utilityLabel}</strong></div>`;
  }
  if (owner) statsRows += `<div class="property-card-row"><span>Dueño</span><strong>${owner.name}${prop.mortgaged ? ' (hipotecada)' : ''}</strong></div>`;
  if (prop.houses > 0) statsRows += `<div class="property-card-row"><span>${tb().rowLabel}</span><strong>${formatBuildingLabel(prop.houses)}</strong></div>`;
  if (prop.owner !== null && !prop.mortgaged && isOwnableCell(cell)) {
    statsRows += `<div class="property-card-row highlight"><span>Alquiler actual</span><strong>${formatMoney(calcRent(cellId))}</strong></div>`;
  }
  if (!hidePremiumBuff) statsRows += buildPremiumBonusRow(cellId);

  return statsRows;
}

function hasPropertyCardDetails(statsRows, extra = '') {
  if (statsRows) return true;
  return extra.replace(/<[^>]+>/g, '').trim().length > 0;
}

function buildPropertyCardHtml(cellId, extra = '', options = {}) {
  const { hidePremiumBuff = false } = options;
  const cell = BOARD[cellId];
  const prop = state.properties[cellId];
  const owner = prop.owner !== null ? state.players[prop.owner] : null;
  const color = cell.color ? COLORS[cell.color] : null;
  const accent = color?.bg || '#555';
  const isPremium = isPremiumUnowned(prop);
  const premiumClass = isPremium ? ' property-card--premium' : '';
  const premiumFx = isPremium
    ? '<span class="property-card-premium-fx" aria-hidden="true"><span class="cell-premium-glow"></span><span class="cell-premium-sheen"></span></span>'
    : '';

  let rows = '';
  if (cell.price) rows += `<div class="property-card-row"><span>Precio</span><strong>${formatMoney(cell.price)}</strong></div>`;
  if (cell.type === 'go') rows += `<div class="property-card-row"><span>Al pasar</span><strong>+${formatMoney(goBonusAmount())}</strong></div>`;
  if (cell.type === 'tax') rows += `<div class="property-card-row"><span>Pago</span><strong>${formatMoney(scaleTax(cell.amount))}</strong></div>`;
  if (cell.type === 'parking') rows += `<div class="property-card-row"><span>Descanso</span><strong>${escapeHtml(cell.desc || 'Sin efecto')}</strong></div>`;
  if (cell.type === 'jail') rows += `<div class="property-card-row"><span>Visita</span><strong>${escapeHtml(cell.desc || t().jailName)}</strong></div>`;
  if (cell.type === 'gotojail') rows += `<div class="property-card-row"><span>Efecto</span><strong>${escapeHtml(cell.desc || `Ir a ${t().jailName}`)}</strong></div>`;
  if (cell.type === 'chance') rows += `<div class="property-card-row"><span>Mazo</span><strong>${t().chanceName}</strong></div>`;
  if (cell.type === 'chest') rows += `<div class="property-card-row"><span>Mazo</span><strong>${t().fortuneName}</strong></div>`;
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
  if (!hidePremiumBuff) rows += buildPremiumBonusRow(cellId);

  const artUrl = getCellArtUrl(THEME, cellId, currentBoardSize, cell.name);

  if (artUrl) {
    const statsRows = buildThemedArtStatsRows(cellId, { hidePremiumBuff });
    const detailsBlock = hasPropertyCardDetails(statsRows, extra)
      ? `<div class="property-card-details property-card-details--art">
          <div class="property-card-body">${statsRows}${extra}</div>
        </div>`
      : '';

    const innerContent = `
        <button type="button" class="property-card-art-btn" data-art-url="${artUrl}" aria-label="Ampliar ilustración de ${escapeHtml(cell.name)}">
          <img class="property-card-art" src="${artUrl}" alt="${escapeHtml(cell.name)}" loading="lazy" />
          <span class="property-card-art-zoom-hint"><i class="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i> Ampliar</span>
        </button>
        ${detailsBlock}`;

    return `
      <div class="property-card property-card--themed-art${premiumClass}" style="--card-color:${accent}">
        ${isPremium
    ? `<div class="property-card-premium-wrap">${premiumFx}${innerContent}</div>`
    : innerContent}
      </div>
    `;
  }

  return `
    <div class="property-card${premiumClass}" style="--card-color:${accent}">
      ${premiumFx}
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
  const hasArt = !!getCellArtUrl(THEME, cellId, currentBoardSize, cell.name);
  const extra = `
    <div class="property-card-extra">
      <div class="property-card-row"><span>Tu dinero</span><strong>${formatMoney(currentPlayer().money)}</strong></div>
      ${rent != null && !hasArt ? `<div class="property-card-row"><span>Alquiler base</span><strong>${formatMoney(rent)}</strong></div>` : ''}
    </div>`;

  showBoardCard(
    buildPropertyCardHtml(cellId, extra),
    [
      { label: `Comprar (${formatMoney(cell.price)})`, action: () => buyProperty(cellId), primary: true },
      { label: 'Subastar', action: () => declineProperty() },
    ],
    cellId,
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
      await withTimeout(diceBox.init(), DICE_INIT_TIMEOUT_MS);
      if (!container.isConnected) {
        resetDiceBox();
        return false;
      }

      diceBoxReady = true;
      stage.classList.add('webgl-ready');
      diceBox.show?.();
      syncDiceBoxSize();
      return true;
    } catch (error) {
      console.error('Dados 3D no disponibles:', error);
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

  if (diceAnimating) {
    return rollDiceSilent(result);
  }

  diceAnimating = true;
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
        diceBox.clear?.();
        const rolls = await withTimeout(diceBox.roll('2d6'), DICE_ROLL_TIMEOUT_MS);
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
        console.warn('Dados 3D no respondieron; usando tirada silenciosa:', error);
        diceBox.clear?.();
        diceBox.hide?.();
      }
    }

    return rollDiceSilent(result);
  } finally {
    diceAnimating = false;
    center?.classList.remove('board-center--dice-rolling');
    overlay?.classList.remove('dice-overlay--rolling');
  }
}

async function rollDiceSilent(result) {
  const stage = $('#dice-stage');
  stage?.classList.remove('webgl-ready');
  diceBox?.hide?.();
  if (result) result.textContent = 'Tirando...';
  await sleep(720);
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  if (result) result.textContent = `${d1} + ${d2} = ${d1 + d2}`;
  sounds.playDiceLand();
  return [d1, d2];
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
  const positions = getBoardPositions(BOARD_GRID);
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
  const useOwnerGlow = (state.themeId || 'default') === 'lotr';
  layer.className = `owner-layer${useOwnerGlow ? ' owner-layer--glow' : ''}`;
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
    if (useOwnerGlow) {
      const trimClasses = getOwnerMarkerTrimClasses(pos, edge, positions).join(' ');
      marker.className = `owner-marker owner-marker--${edge}${trimClasses ? ` ${trimClasses}` : ''}`;
      applyOwnerGlowStyle(marker, owner.color);
    } else {
      marker.className = `owner-marker owner-marker--${edge}`;
      marker.style.setProperty('--owner-color', owner.color);
    }
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
  const G = BOARD_GRID;
  if (pos.row === G) return 'top';
  if (pos.col === 1) return 'right';
  if (pos.row === 1) return 'bottom';
  if (pos.col === G) return 'left';
  return 'top';
}

function isOwnedBoardCellAt(pos, positions) {
  const idx = positions.findIndex((p) => p.row === pos.row && p.col === pos.col);
  if (idx < 0) return false;
  if (!isOwnableCell(BOARD[idx])) return false;
  return state.properties[idx].owner !== null;
}

function getOwnerMarkerTrimClasses(pos, edge, positions) {
  const G = BOARD_GRID;
  const classes = [];

  if (edge === 'top') {
    if (pos.col === G && isOwnedBoardCellAt({ row: G - 1, col: G }, positions)) {
      classes.push('owner-marker-trim-start');
    }
    if (pos.col === 1 && isOwnedBoardCellAt({ row: G - 1, col: 1 }, positions)) {
      classes.push('owner-marker-trim-end');
    }
  } else if (edge === 'right') {
    if (pos.row === G - 1 && isOwnedBoardCellAt({ row: G, col: 1 }, positions)) {
      classes.push('owner-marker-trim-start');
    }
    if (pos.row === 2 && isOwnedBoardCellAt({ row: 1, col: 1 }, positions)) {
      classes.push('owner-marker-trim-end');
    }
  } else if (edge === 'bottom') {
    if (pos.col === 1 && isOwnedBoardCellAt({ row: 2, col: 1 }, positions)) {
      classes.push('owner-marker-trim-start');
    }
    if (pos.col === G && isOwnedBoardCellAt({ row: 2, col: G }, positions)) {
      classes.push('owner-marker-trim-end');
    }
  } else if (edge === 'left') {
    if (pos.row === 2 && isOwnedBoardCellAt({ row: 1, col: G }, positions)) {
      classes.push('owner-marker-trim-start');
    }
    if (pos.row === G - 1 && isOwnedBoardCellAt({ row: G, col: G }, positions)) {
      classes.push('owner-marker-trim-end');
    }
  }

  return classes;
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

function premiumSheenRandom(cellId, slot = 0) {
  const x = Math.sin(cellId * 12.9898 + slot * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function applyPremiumSheenStyle(cellEl, cellId) {
  const r = (slot) => premiumSheenRandom(cellId, slot);
  cellEl.style.setProperty('--premium-sheen-duration', `${(2.6 + r(1) * 1.6).toFixed(2)}s`);
  cellEl.style.setProperty('--premium-sheen-delay', `${(r(2) * 2.5).toFixed(2)}s`);
  cellEl.style.setProperty('--premium-glow-duration', `${(4 + r(3) * 3).toFixed(2)}s`);
  cellEl.style.setProperty('--premium-glow-delay', `${(r(4) * 2.5).toFixed(2)}s`);
}

function hexWithAlpha(hex, alpha) {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
  const raw = hex.replace('#', '');
  if (raw.length === 3) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}${a}`;
  }
  return `#${raw.slice(0, 6)}${a}`;
}

function applyOwnerGlowStyle(el, color) {
  el.style.setProperty('--owner-glow-color', color);
  el.style.setProperty('--owner-glow-bright', hexWithAlpha(color, 0.82));
  el.style.setProperty('--owner-glow-mid', hexWithAlpha(color, 0.42));
  el.style.setProperty('--owner-glow-soft', hexWithAlpha(color, 0.16));
  el.style.setProperty('--owner-glow-fade', hexWithAlpha(color, 0));
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

  const grid = BOARD_GRID;
  board.classList.toggle('board--compact', grid !== 11);
  board.style.setProperty('--board-grid', grid);
  const positions = getBoardPositions(grid);

  BOARD.forEach((cell, i) => {
    const pos = positions[i];
    const prop = state.properties[i];
    const ownable = isOwnableCell(cell);
    const el = document.createElement('div');
    el.className = `cell cell-${cell.type}${cell.color ? ` cell-color-${cell.color}` : ''}`;
    el.dataset.cellId = String(i);
    el.style.gridRow = pos.row;
    el.style.gridColumn = pos.col;

    if (ownable && cell.color && COLORS[cell.color]) {
      el.style.setProperty('--cell-color', COLORS[cell.color].bg);
    }

    const artUrl = getCellArtUrl(THEME, i, currentBoardSize, cell.name);
    if (artUrl) {
      el.classList.add('cell-has-art', `cell-art-edge-${getCellOwnerEdge(pos)}`);
      el.setAttribute('aria-label', cell.name);
    }

    if (isPremiumUnowned(prop)) {
      el.classList.add('cell-premium');
      applyPremiumSheenStyle(el, i);
      if (artUrl) el.setAttribute('aria-label', `${cell.name} — casilla premium con ventaja sorpresa`);
    }

    el.innerHTML = `
      ${artUrl ? `<img class="cell-art" src="${artUrl}" alt="" loading="lazy" aria-hidden="true" />` : ''}
      ${!artUrl && ownable ? '<div class="cell-color-bar"></div>' : ''}
      ${!artUrl ? `<div class="cell-name">${cell.name}</div>` : ''}
      ${!artUrl && ownable && cell.price ? `<div class="cell-price">${formatMoney(cell.price)}</div>` : ''}
      ${!artUrl && cell.type === 'go' ? `<div class="cell-desc">+${formatMoney(goBonusAmount())}</div>` : ''}
      ${!artUrl && cell.type === 'tax' ? `<div class="cell-desc">${formatMoney(scaleTax(cell.amount))}</div>` : ''}
      ${isPremiumUnowned(prop) ? '<span class="cell-premium-fx" aria-hidden="true"><span class="cell-premium-glow"></span><span class="cell-premium-sheen"></span></span>' : ''}
      ${ownable && prop.mortgaged ? '<div class="mortgaged">HIP</div>' : ''}
    `;

    el.onclick = () => showCellInfo(i);
    board.appendChild(el);
  });

  const center = document.createElement('div');
  center.className = 'board-center';
  center.style.gridRow = `2 / ${grid}`;
  center.style.gridColumn = `2 / ${grid}`;
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
    <div class="world-event-overlay hidden" id="world-event-overlay" role="alertdialog" aria-modal="true" aria-labelledby="world-event-overlay-title">
      <div class="world-event-overlay-backdrop" aria-hidden="true"></div>
      <article class="world-event-overlay-panel world-event-overlay-card" id="world-event-overlay-flat">
        <div class="world-event-overlay-body">
          <span class="world-event-overlay-emoji" aria-hidden="true"></span>
          <span class="world-event-overlay-kicker">Evento del mundo</span>
          <h3 class="world-event-overlay-title" id="world-event-overlay-title"></h3>
          <p class="world-event-overlay-message"></p>
        </div>
        <footer class="center-pause-footer">
          <div class="world-event-overlay-timer">
            <div class="world-event-overlay-progress-track" aria-hidden="true">
              <div class="world-event-overlay-progress"></div>
            </div>
            <span class="world-event-overlay-countdown"></span>
          </div>
          <button type="button" class="btn btn-primary world-event-overlay-dismiss">Continuar</button>
        </footer>
      </article>
      <article class="world-event-overlay-panel world-event-overlay-card hidden" id="world-event-overlay-flip">
        <div class="center-pause-flip-stage">
          <div id="center-pause-flip-root"></div>
        </div>
        <footer class="center-pause-footer">
          <div class="world-event-overlay-timer center-pause-controls center-pause-controls-hidden">
            <div class="world-event-overlay-progress-track" aria-hidden="true">
              <div class="world-event-overlay-progress" id="center-pause-progress"></div>
            </div>
            <span class="world-event-overlay-countdown" id="center-pause-countdown">Revelando carta…</span>
          </div>
          <button type="button" class="btn btn-primary world-event-overlay-dismiss center-pause-controls center-pause-controls-hidden" id="center-pause-dismiss">Continuar</button>
        </footer>
      </article>
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
  applyBoardBackground(board, THEME, currentBoardSize);

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

  showBoardCard(buildPropertyCardHtml(cellId, extra), buttons, cellId);
}

function renderPlayers() {
  const container = $('#players-panel');
  container.innerHTML = '';

  state.players.forEach((player, i) => {
    const isCurrent = i === state.currentPlayer && !state.winner;
    const isExpanded = expandedPlayerId === player.id;
    const assets = getPlayerAssets(player.id);
    const netWorth = player.money + assets.total;
    const buffLabel = player.activeBuff
      ? getBuffPresentation(player.activeBuff, state.themeId || 'default')
      : null;
    const el = document.createElement('div');
    el.className = `player-card player-card-clickable${isCurrent ? ' active' : ''}${isExpanded ? ' expanded' : ''}${player.bankrupt ? ' bankrupt' : ''}`;
    el.innerHTML = `
      ${isCurrent ? `<span class="turn-badge turn-badge--float${player.isAI ? ' ai-badge' : ''}">${player.isAI ? '🤖 TURNO IA' : 'TU TURNO'}</span>` : ''}
      <div class="player-header">
        <span class="player-token" style="--token-color:${player.color}"><i class="fa-solid ${player.token.icon}"></i></span>
        <div class="player-header-main">
          <span class="player-name">${player.name}</span>
          <div class="player-header-tags">
            ${player.isAI ? `<span class="ai-tag">IA · ${getDifficultyPreset(aiDifficultyFor(player)).name}</span>` : ''}
            ${buffLabel ? `<span class="player-buff-tag" title="${escapeHtml(buffLabel.description)}">${formatBuffTagLabel(buffLabel)}</span>` : ''}
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
  if (isWorldEventPaused()) {
    container.appendChild(createPropertiesPanelMessage(
      'Evento del mundo',
      'El tablero está en pausa unos segundos.',
      'phase',
    ));
    return;
  }

  if (isCardRevealPaused()) {
    container.appendChild(createPropertiesPanelMessage(
      lastBoardAction?.type === 'premiumBuff' ? 'Ventaja premium' : 'Carta especial',
      'El tablero está en pausa unos segundos.',
      'phase',
    ));
    return;
  }

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
  if (isWorldEventPaused() && lastBoardAction?.type === 'worldEvent') {
    paintCenterPauseOverlay(lastBoardAction);
    paintBoardAction();
  } else if (isCardRevealPaused() && (lastBoardAction?.type === 'cardDraw' || lastBoardAction?.type === 'premiumBuff')) {
    paintCenterPauseOverlay(lastBoardAction);
    paintBoardAction();
  }
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
  loadedState.boardSize = loadedState.boardSize || 'classic';
  loadedState.worldEventsEnabled = loadedState.worldEventsEnabled !== false;
  loadedState.worldEventsMode = loadedState.worldEventsMode === 'random' ? 'random' : 'interval';
  loadedState.turnCounter = loadedState.turnCounter || 0;
  loadedState.lastWorldEventTurn = loadedState.lastWorldEventTurn || 0;
  if (loadedState.auction?.passed) {
    loadedState.auction.passed = new Set(loadedState.auction.passed);
  }

  loadedState.players.forEach((player) => {
    const tokenId = player.token?.id ?? player.token;
    player.token = PLAYER_TOKENS.find((t) => t.id === tokenId) || PLAYER_TOKENS[player.id] || PLAYER_TOKENS[0];
    player.id = player.id ?? loadedState.players.indexOf(player);
    player.isAI = !!player.isAI;
    normalizePlayerBuff(player);
    if (player.isAI) {
      player.aiDifficultyId = player.aiDifficultyId || loadedState.difficultyId || 'normal';
    } else {
      player.aiDifficultyId = null;
    }
  });

  loadedState.properties?.forEach((prop) => {
    prop.premium = !!prop.premium;
  });
  ensurePremiumBuffIds(loadedState.properties);

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
  applyTheme(data.state?.themeId || 'default', data.state?.boardSize || 'classic');
  const loaded = unpackSaveData(data);
  state = loaded.state;
  pendingAction = loaded.pendingAction;
  tradeDraft = null;
  activeBoardCard = null;
  resetDiceFlowState();
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
  const boardLabel = (data.state.boardSize || 'classic') === 'compact' ? 'Compacto' : 'Clásico';
  const diffName = getDifficultyPreset(data.state.difficultyId || 'normal').name;
  const when = new Date(data.savedAt).toLocaleString('es-ES', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return `${themeName} · ${boardLabel} · ${diffName} · ${players.length} jugadores · turno de ${turn} · guardado ${when}`;
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

function showNewGameBanner() {
  setBoardAction({
    type: 'gameStart',
    message: t().startGameMessage || 'Comenzar juego',
  });
  pulseBoardAction();
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
      aiDifficultyId: $(`#player-ai-${i}`)?.checked
        ? ($(`#player-ai-difficulty-${i}`)?.value || getSetupGameDifficulty())
        : null,
    });
  }

  collapsedPropGroups.clear();
  logPanelCollapsed = true;
  resetDiceFlowState();
  $('#log-panel')?.classList.add('side-panel--log-collapsed');
  $('#log-panel-toggle')?.setAttribute('aria-expanded', 'false');
  const boardSize = getSetupBoardSize();
  state = createInitialState(playerConfigs, themeId, difficultyId, boardSize, {
    worldEventsEnabled: $('#world-events-enabled')?.checked ?? true,
    worldEventsMode: document.querySelector('input[name="world-events-mode"]:checked')?.value || 'interval',
  });
  const premiumCount = state.properties.filter((prop) => prop.premium).length;
  if (premiumCount > 0) {
    state.log.unshift(`⭐ ${premiumCount} casillas premium en el tablero (brillo dorado): cada una otorga una ventaja sorpresa al comprarla.`);
  }
  $('#setup-screen').classList.add('hidden');
  $('#game-screen').classList.remove('hidden');
  render();
  showNewGameBanner();
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
        applyTheme(input.value, getSetupBoardSize());
        setupTokenIds = [];
        refreshSetupPlayers?.({ useThemeDefaults: true });
      }
    });
  });
}

function initBoardSizePicker() {
  document.querySelectorAll('input[name="board-size"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const themeId = document.querySelector('input[name="game-theme"]:checked')?.value || 'default';
      applyTheme(themeId, input.value);
    });
  });
}

function getSetupThemeId() {
  return document.querySelector('input[name="game-theme"]:checked')?.value || 'default';
}

function initSetup() {
  initPropertyArtLightbox();
  const countSelect = $('#player-count');
  const namesContainer = $('#player-names');

  function resolvePlayerName(themeId, index, savedNames, useThemeDefaults) {
    if (useThemeDefaults) {
      return getThemeDefaultPlayerName(themeId, index);
    }
    if (savedNames[index] !== undefined && savedNames[index] !== '') {
      return savedNames[index];
    }
    return getThemeDefaultPlayerName(themeId, index);
  }

  function buildAIDifficultyOptions(selectedId, globalDefault) {
    const selected = selectedId || globalDefault;
    return DIFFICULTY_LIST.map((preset) =>
      `<option value="${preset.id}"${preset.id === selected ? ' selected' : ''}>${preset.name}</option>`,
    ).join('');
  }

  function syncAiDifficultyRow(row, isAi) {
    row?.classList.toggle('is-ai', isAi);
    const wrap = row?.querySelector('.ai-difficulty-wrap');
    const select = row?.querySelector('.player-ai-difficulty');
    wrap?.classList.toggle('hidden', !isAi);
    if (select) select.disabled = !isAi;
  }

  function updateNameInputs(options = {}) {
    const { useThemeDefaults = false } = options;
    const themeId = getSetupThemeId();
    const gameDifficulty = getSetupGameDifficulty();
    const count = parseInt(countSelect.value);
    const savedNames = {};
    const savedAiDifficulties = {};
    const savedAiFlags = {};
    namesContainer.querySelectorAll('[id^="player-name-"]').forEach((input) => {
      const idx = parseInt(input.id.replace('player-name-', ''), 10);
      if (!Number.isNaN(idx)) savedNames[idx] = input.value;
    });
    namesContainer.querySelectorAll('[id^="player-ai-difficulty-"]').forEach((select) => {
      const idx = parseInt(select.id.replace('player-ai-difficulty-', ''), 10);
      if (!Number.isNaN(idx)) savedAiDifficulties[idx] = select.value;
    });
    namesContainer.querySelectorAll('.player-ai-toggle').forEach((input) => {
      const idx = parseInt(input.id.replace('player-ai-', ''), 10);
      if (!Number.isNaN(idx)) savedAiFlags[idx] = input.checked;
    });

    setupTokenIds = reconcileSetupTokens(count, setupTokenIds.length ? setupTokenIds : getDefaultTokenIds(count));
    namesContainer.innerHTML = '';

    for (let i = 0; i < count; i++) {
      const token = PLAYER_TOKENS.find((t) => t.id === setupTokenIds[i]) || PLAYER_TOKENS[i];
      const defaultAI = savedAiFlags[i] !== undefined ? savedAiFlags[i] : i > 0;
      const playerName = resolvePlayerName(themeId, i, savedNames, useThemeDefaults);
      const aiDifficulty = savedAiDifficulties[i] || gameDifficulty;
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
                value="${playerName.replace(/"/g, '&quot;')}"
                style="border-color: ${PLAYER_COLORS[i]}">
              <label class="ai-toggle">
                <input type="checkbox" id="player-ai-${i}" class="player-ai-toggle" ${defaultAI ? 'checked' : ''}>
                <span><i class="fa-solid fa-robot" aria-hidden="true"></i> Computadora (IA)</span>
              </label>
              <div class="ai-difficulty-wrap${defaultAI ? '' : ' hidden'}">
                <label class="ai-difficulty-label" for="player-ai-difficulty-${i}">Nivel IA</label>
                <select id="player-ai-difficulty-${i}" class="player-ai-difficulty"${defaultAI ? '' : ' disabled'}>
                  ${buildAIDifficultyOptions(aiDifficulty, gameDifficulty)}
                </select>
              </div>
            </div>
          </div>
        </div>`;
    }

    namesContainer.querySelectorAll('.player-ai-toggle').forEach((input) => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.id.replace('player-ai-', ''), 10);
        const nameInput = $(`#player-name-${idx}`);
        const row = input.closest('.name-input');
        syncAiDifficultyRow(row, input.checked);
        if (input.checked && !nameInput.value.trim()) {
          nameInput.value = getThemeDefaultPlayerName(getSetupThemeId(), idx) || defaultAIName(idx);
        }
      });
    });

    namesContainer.querySelectorAll('.token-trigger').forEach((btn) => {
      btn.addEventListener('click', () => {
        openTokenPicker(parseInt(btn.dataset.player, 10));
      });
    });
  }

  countSelect.addEventListener('change', () => updateNameInputs());
  refreshSetupPlayers = (options) => updateNameInputs(options);
  renderThemePicker();
  renderDifficultyPicker();
  initBoardSizePicker();
  updateNameInputs({ useThemeDefaults: true });
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

  initWorldEventsSetup();
  initGameSettings();
}

function initWorldEventsSetup() {
  const toggle = $('#world-events-enabled');
  const options = $('#world-events-options');

  function syncWorldEventsOptions() {
    const enabled = toggle?.checked ?? true;
    options?.classList.toggle('is-disabled', !enabled);
  }

  toggle?.addEventListener('change', syncWorldEventsOptions);
  syncWorldEventsOptions();
}

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initSetup);

if (typeof window !== 'undefined') {
  window.__imperioUrbano = { exportSaveJson, importSaveFromText, resumeGame };
}
