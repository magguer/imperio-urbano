// Ventajas temporales al comprar casillas premium (orientadas al inicio de partida)

import { getTheme } from './themes/index.js';

const PURCHASE_DISCOUNT = 0.25;
const PURCHASE_DISCOUNT_CHARGES = 2;
const RENT_SHIELD_CHARGES = 2;
const LUCKY_CARD_BONUS = 100;

const BUFF_DEFS = {
  goldRush: { id: 'goldRush', rounds: 0, weight: 30, instantCash: true },
  dealMaker: { id: 'dealMaker', rounds: 8, weight: 28, charges: PURCHASE_DISCOUNT_CHARGES, discount: PURCHASE_DISCOUNT },
  safePassage: { id: 'safePassage', rounds: 8, weight: 27, charges: RENT_SHIELD_CHARGES },
  luckyDraw: { id: 'luckyDraw', rounds: 6, weight: 15, cardBonus: LUCKY_CARD_BONUS },
};

const LEGACY_BUFF_IDS = {
  rentSurge: 'luckyDraw',
  goRush: 'goldRush',
  taxShield: 'safePassage',
  buildFrenzy: 'dealMaker',
};

const BASE_BUFF_COPY = {
  goldRush: {
    emoji: '💰',
    title: 'Botín premium',
    describe: (ctx) => `Recibes ${ctx.cashLabel} al instante`,
  },
  dealMaker: {
    emoji: '🤝',
    title: 'Negociador experto',
    describe: (ctx) => `−25% en tus próximas ${ctx.charges} compras (hasta ${ctx.rounds} rondas)`,
  },
  safePassage: {
    emoji: '🎫',
    title: 'Salvo conducto',
    describe: (ctx) => `Sin pagar alquiler ${ctx.charges} veces (hasta ${ctx.rounds} rondas)`,
  },
  luckyDraw: {
    emoji: '🍀',
    title: 'Racha afortunada',
    describe: (ctx) => `+$${LUCKY_CARD_BONUS} extra en cartas de suerte (${ctx.rounds} ronda${ctx.rounds === 1 ? '' : 's'})`,
  },
};

const THEME_BUFF_COPY = {
  lotr: {
    goldRush: { emoji: '💰', title: 'Tesoro de Erebor', describe: (ctx) => `Recibes ${ctx.cashLabel} al instante` },
    dealMaker: { emoji: '🤝', title: 'Trato de aliados', describe: (ctx) => `−25% en tus próximas ${ctx.charges} compras (hasta ${ctx.rounds} rondas)` },
    safePassage: { emoji: '🛡️', title: 'Guardia élfica', describe: (ctx) => `Sin pagar tributo ${ctx.charges} veces (hasta ${ctx.rounds} rondas)` },
    luckyDraw: { emoji: '🔮', title: 'Visión del Palantír', describe: (ctx) => `+$${LUCKY_CARD_BONUS} extra en cartas de saber (${ctx.rounds} ronda${ctx.rounds === 1 ? '' : 's'})` },
  },
  world: {
    goldRush: { emoji: '💵', title: 'Reservas del tesoro', describe: (ctx) => `Recibes ${ctx.cashLabel} al instante` },
    dealMaker: { emoji: '🌍', title: 'Acuerdo comercial', describe: (ctx) => `−25% en tus próximas ${ctx.charges} compras (hasta ${ctx.rounds} rondas)` },
    safePassage: { emoji: '🛂', title: 'Pasaporte diplomático', describe: (ctx) => `Sin pagar alquiler ${ctx.charges} veces (hasta ${ctx.rounds} rondas)` },
    luckyDraw: { emoji: '🎴', title: 'Suerte viajera', describe: (ctx) => `+$${LUCKY_CARD_BONUS} extra en cartas (${ctx.rounds} ronda${ctx.rounds === 1 ? '' : 's'})` },
  },
  party: {
    goldRush: { emoji: '💸', title: 'Caja fuerte VIP', describe: (ctx) => `Recibes ${ctx.cashLabel} al instante` },
    dealMaker: { emoji: '🥂', title: 'Precio de amigo', describe: (ctx) => `−25% en tus próximas ${ctx.charges} compras (hasta ${ctx.rounds} rondas)` },
    safePassage: { emoji: '🕶️', title: 'Lista blanca', describe: (ctx) => `Sin pagar entrada ${ctx.charges} veces (hasta ${ctx.rounds} rondas)` },
    luckyDraw: { emoji: '🎰', title: 'Noche de suerte', describe: (ctx) => `+$${LUCKY_CARD_BONUS} extra en cartas (${ctx.rounds} ronda${ctx.rounds === 1 ? '' : 's'})` },
  },
  starwars: {
    goldRush: { emoji: '💎', title: 'Botín imperial', describe: (ctx) => `Recibes ${ctx.cashLabel} al instante` },
    dealMaker: { emoji: '🤝', title: 'Trato huttese', describe: (ctx) => `−25% en tus próximas ${ctx.charges} compras (hasta ${ctx.rounds} rondas)` },
    safePassage: { emoji: '🛡️', title: 'Escudo deflector', describe: (ctx) => `Sin pagar peaje ${ctx.charges} veces (hasta ${ctx.rounds} rondas)` },
    luckyDraw: { emoji: '✨', title: 'Favor de la Fuerza', describe: (ctx) => `+$${LUCKY_CARD_BONUS} extra en cartas (${ctx.rounds} ronda${ctx.rounds === 1 ? '' : 's'})` },
  },
  siliconvalley: {
    goldRush: { emoji: '💳', title: 'Ronda seed', describe: (ctx) => `Recibes ${ctx.cashLabel} al instante` },
    dealMaker: { emoji: '📉', title: 'Term sheet favorable', describe: (ctx) => `−25% en tus próximas ${ctx.charges} compras (hasta ${ctx.rounds} rondas)` },
    safePassage: { emoji: '🧾', title: 'Cláusula anti-alquiler', describe: (ctx) => `Sin pagar fee ${ctx.charges} veces (hasta ${ctx.rounds} rondas)` },
    luckyDraw: { emoji: '📈', title: 'Bonus por carta', describe: (ctx) => `+$${LUCKY_CARD_BONUS} extra en event cards (${ctx.rounds} ronda${ctx.rounds === 1 ? '' : 's'})` },
  },
};

const BUFF_VALUE_SCORE = {
  goldRush: 26,
  dealMaker: 24,
  safePassage: 22,
  luckyDraw: 18,
};

function normalizeBuffId(buffId) {
  return LEGACY_BUFF_IDS[buffId] || buffId;
}

function themeCopy(themeId, buffId) {
  return THEME_BUFF_COPY[themeId]?.[buffId] || BASE_BUFF_COPY[buffId] || BASE_BUFF_COPY.goldRush;
}

function goNameFor(themeId) {
  return getTheme(themeId)?.strings?.goName ?? 'GO';
}

function pickWeightedBuff() {
  const entries = Object.values(BUFF_DEFS);
  const total = entries.reduce((sum, b) => sum + b.weight, 0);
  let roll = Math.random() * total;
  for (const buff of entries) {
    roll -= buff.weight;
    if (roll <= 0) return buff;
  }
  return entries[0];
}

function buildDescribeContext(buff, def, cashLabel = null) {
  const rounds = buff?.roundsLeft ?? buff?.roundsTotal ?? def?.rounds ?? 1;
  return {
    rounds,
    charges: buff?.chargesLeft ?? def?.charges ?? 0,
    cashLabel: cashLabel ?? `$${def?.cashAmount ?? 200}`,
    go: goNameFor('default'),
  };
}

export function pickRandomBuffId() {
  return pickWeightedBuff().id;
}

export function getBuffDefinition(buffId) {
  return BUFF_DEFS[normalizeBuffId(buffId)] ?? null;
}

export function getPremiumBuffScore(buffId) {
  return BUFF_VALUE_SCORE[normalizeBuffId(buffId)] ?? 12;
}

export function getActiveBuff(player) {
  return player?.activeBuff ?? null;
}

export function getBuffPresentation(buff, themeId, cashLabel = null) {
  if (!buff?.id) return null;
  const buffId = normalizeBuffId(buff.id);
  const copy = themeCopy(themeId, buffId);
  const def = BUFF_DEFS[buffId];
  const ctx = buildDescribeContext(buff, def, cashLabel);
  const rounds = ctx.rounds;
  return {
    emoji: copy.emoji,
    title: copy.title,
    description: copy.describe(ctx),
    roundsLeft: rounds,
    chargesLeft: buff.chargesLeft ?? null,
  };
}

export function getPremiumBuffPreview(buffId, themeId, cashLabel = null) {
  const id = normalizeBuffId(buffId);
  const def = BUFF_DEFS[id];
  if (!def) return null;
  const previewBuff = {
    id,
    roundsLeft: def.rounds,
    roundsTotal: def.rounds,
    chargesLeft: def.charges ?? null,
  };
  return getBuffPresentation(previewBuff, themeId, cashLabel);
}

export function previewBuffGrant(buffId, themeId, context = {}) {
  const id = normalizeBuffId(buffId);
  const def = BUFF_DEFS[id];
  if (!def) return null;

  const cashAmount = context.goBonus ?? 200;
  const cashLabel = context.formatMoney ? context.formatMoney(cashAmount) : `$${cashAmount}`;
  const previewBuff = def.instantCash
    ? { id, roundsLeft: 0, roundsTotal: 0 }
    : { id, roundsLeft: def.rounds, roundsTotal: def.rounds, chargesLeft: def.charges ?? null };
  const label = getBuffPresentation(previewBuff, themeId, cashLabel);

  return {
    type: 'playerBuff',
    tone: 'good',
    emoji: label.emoji,
    title: label.title,
    description: label.description,
    roundsLeft: label.roundsLeft,
    chargesLeft: label.chargesLeft,
    instantCash: def.instantCash ? cashAmount : undefined,
    buffId: id,
  };
}

export function estimateBuffValue(buffOrId, partialBuff = null) {
  const id = normalizeBuffId(typeof buffOrId === 'string' ? buffOrId : buffOrId?.id);
  const def = BUFF_DEFS[id];
  if (!def) return 0;

  const buff = typeof buffOrId === 'string' ? partialBuff : buffOrId;
  let score = BUFF_VALUE_SCORE[id] || 12;
  if (def.instantCash) score += 18;
  if (buff?.chargesLeft != null) score += buff.chargesLeft * 10;
  else if (def.charges) score += def.charges * 10;
  if (buff?.roundsLeft) score += buff.roundsLeft * 4;
  else if (def.rounds) score += def.rounds * 4;
  return score;
}

export function shouldReplaceActiveBuff(player, newBuffId) {
  if (!player?.activeBuff) return true;
  const currentScore = estimateBuffValue(player.activeBuff);
  const newScore = estimateBuffValue(newBuffId);
  return newScore > currentScore + 2;
}

export function applyBuffToPlayer(player, buffId, themeId, context = {}) {
  const id = normalizeBuffId(buffId);
  const def = BUFF_DEFS[id];
  if (!player || !def) return null;

  const cashAmount = context.goBonus ?? 200;
  const cashLabel = context.formatMoney ? context.formatMoney(cashAmount) : `$${cashAmount}`;

  if (def.instantCash) {
    player.money += cashAmount;
    const label = getBuffPresentation(
      { id, roundsLeft: 0, roundsTotal: 0 },
      themeId,
      cashLabel,
    );
    return {
      type: 'playerBuff',
      tone: 'good',
      emoji: label.emoji,
      title: label.title,
      description: label.description,
      roundsLeft: 0,
      instantCash: cashAmount,
      message: `${label.emoji} ${player.name} activa «${label.title}» al comprar casilla premium: ${label.description}.`,
      playerName: player.name,
    };
  }

  player.activeBuff = {
    id,
    roundsLeft: def.rounds,
    roundsTotal: def.rounds,
    chargesLeft: def.charges ?? null,
  };

  const label = getBuffPresentation(player.activeBuff, themeId, cashLabel);
  return {
    type: 'playerBuff',
    tone: 'good',
    emoji: label.emoji,
    title: label.title,
    description: label.description,
    roundsLeft: label.roundsLeft,
    chargesLeft: label.chargesLeft,
    message: `${label.emoji} ${player.name} activa «${label.title}» al comprar casilla premium: ${label.description}`,
    playerName: player.name,
  };
}

export function grantBuffToPlayer(player, buffId, themeId, context = {}) {
  return applyBuffToPlayer(player, buffId, themeId, context);
}

export function resolvePurchasePrice(player, basePrice) {
  const buff = getActiveBuff(player);
  if (buff?.id !== 'dealMaker' || !buff.chargesLeft || buff.chargesLeft <= 0) {
    return { price: basePrice, saved: 0, applied: false };
  }
  const def = BUFF_DEFS.dealMaker;
  const price = Math.max(1, Math.round(basePrice * (1 - def.discount)));
  return { price, saved: basePrice - price, applied: true };
}

export function consumePurchaseDiscount(player) {
  const buff = getActiveBuff(player);
  if (buff?.id !== 'dealMaker' || buff.chargesLeft == null) return;
  buff.chargesLeft -= 1;
  if (buff.chargesLeft <= 0) player.activeBuff = null;
}

export function tryConsumeRentShield(player) {
  const buff = getActiveBuff(player);
  if (buff?.id !== 'safePassage' || !buff.chargesLeft || buff.chargesLeft <= 0) return false;
  buff.chargesLeft -= 1;
  if (buff.chargesLeft <= 0) player.activeBuff = null;
  return true;
}

export function getCardMoneyBonus(player) {
  return getActiveBuff(player)?.id === 'luckyDraw' ? LUCKY_CARD_BONUS : 0;
}

export function tickPlayerBuffs(player) {
  if (!player?.activeBuff) return;
  if (player.activeBuff.roundsLeft <= 0) return;
  player.activeBuff.roundsLeft -= 1;
  if (player.activeBuff.roundsLeft <= 0) {
    player.activeBuff = null;
  }
}

export function normalizePlayerBuff(player) {
  if (!player?.activeBuff?.id) {
    player.activeBuff = null;
    return;
  }
  const id = normalizeBuffId(player.activeBuff.id);
  if (!BUFF_DEFS[id]) {
    player.activeBuff = null;
    return;
  }
  player.activeBuff.id = id;
  const def = BUFF_DEFS[id];
  if (def.charges != null && player.activeBuff.chargesLeft == null) {
    player.activeBuff.chargesLeft = def.charges;
  }
}

export function normalizePremiumBuffIds(properties) {
  properties?.forEach((prop) => {
    if (prop.premiumBuffId) {
      prop.premiumBuffId = normalizeBuffId(prop.premiumBuffId);
    }
  });
}
