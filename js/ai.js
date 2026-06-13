// Jugadores controlados por la computadora

const AI_SKILL = {
  casual: {
    buyThreshold: 68,
    maxBidRatio: 0.58,
    buildReserve: 380,
    jailPayTurn: 3,
    noise: 0.4,
    tradeMinGain: 80,
  },
  normal: {
    buyThreshold: 52,
    maxBidRatio: 0.85,
    buildReserve: 220,
    jailPayTurn: 2,
    noise: 0.18,
    tradeMinGain: 40,
  },
  hard: {
    buyThreshold: 38,
    maxBidRatio: 1.08,
    buildReserve: 140,
    jailPayTurn: 1,
    noise: 0.06,
    tradeMinGain: 15,
  },
  brutal: {
    buyThreshold: 28,
    maxBidRatio: 1.28,
    buildReserve: 90,
    jailPayTurn: 0,
    noise: 0,
    tradeMinGain: 0,
  },
};

export function getAISkill(difficultyId) {
  return AI_SKILL[difficultyId] || AI_SKILL.normal;
}

function randomNoise(skill) {
  if (!skill.noise) return 0;
  return (Math.random() - 0.5) * skill.noise * 50;
}

function getGroupCells(board, group) {
  return board.map((cell, id) => ({ cell, id })).filter(({ cell }) => cell.group === group).map(({ id }) => id);
}

function countOwnedInGroup(state, board, playerId, group) {
  return getGroupCells(board, group).filter((id) => state.properties[id].owner === playerId).length;
}

function countUnownedInGroup(state, board, group) {
  return getGroupCells(board, group).filter((id) => state.properties[id].owner === null).length;
}

function countRailroads(state, board, playerId) {
  return board.filter((cell, id) =>
    cell.type === 'railroad' &&
    state.properties[id].owner === playerId &&
    !state.properties[id].mortgaged
  ).length;
}

function countUtilities(state, board, playerId) {
  return board.filter((cell, id) =>
    cell.type === 'utility' &&
    state.properties[id].owner === playerId &&
    !state.properties[id].mortgaged
  ).length;
}

function baseRent(cell, rentTables) {
  if (cell.type === 'property' && cell.group) return rentTables[cell.group]?.[0] ?? 0;
  if (cell.type === 'railroad') return 25;
  if (cell.type === 'utility') return 28;
  return 0;
}

export function scoreProperty(cellId, state, playerId, board, rentTables) {
  const cell = board[cellId];
  const player = state.players[playerId];
  if (!cell?.price) return 0;

  const rent = baseRent(cell, rentTables);
  let score = (rent / cell.price) * 120;

  if (cell.type === 'property' && cell.group) {
    const owned = countOwnedInGroup(state, board, playerId, cell.group);
    const unowned = countUnownedInGroup(state, board, cell.group);
    score += owned * 18;
    if (unowned === 1) score += 35;

    const blockedByOpponent = getGroupCells(board, cell.group).some((id) => {
      const owner = state.properties[id].owner;
      return owner !== null && owner !== playerId;
    });
    if (blockedByOpponent) score -= 12;
  }

  if (cell.type === 'railroad') {
    score += 20 + countRailroads(state, board, playerId) * 14;
  }

  if (cell.type === 'utility') {
    score += 15 + countUtilities(state, board, playerId) * 16;
  }

  const cashAfter = player.money - cell.price;
  if (cashAfter < 120) score -= 35;
  else if (cashAfter < 250) score -= 15;
  else if (cashAfter > 600) score += 8;

  return score;
}

export function shouldBuyProperty(cellId, state, playerId, difficultyId, board, rentTables) {
  const cell = board[cellId];
  const player = state.players[playerId];
  const skill = getAISkill(difficultyId);

  if (player.money < cell.price) return false;

  const score = scoreProperty(cellId, state, playerId, board, rentTables) + randomNoise(skill);
  return score >= skill.buyThreshold;
}

export function estimateFairPrice(cellId, state, playerId, board, rentTables) {
  const cell = board[cellId];
  const score = scoreProperty(cellId, state, playerId, board, rentTables);
  const ratio = Math.min(1.15, Math.max(0.35, score / 70));
  return Math.max(1, Math.floor(cell.price * ratio));
}

export function decideAuctionBid(auction, bidder, state, difficultyId, board, rentTables) {
  const cell = board[auction.cellId];
  const skill = getAISkill(difficultyId);
  const fair = estimateFairPrice(auction.cellId, state, bidder.id, board, rentTables);
  const maxBid = Math.floor(fair * skill.maxBidRatio);
  const minBid = auction.bid + 1;

  if (bidder.money < minBid) return { pass: true };

  const score = scoreProperty(auction.cellId, state, bidder.id, board, rentTables) + randomNoise(skill);
  if (score + randomNoise(skill) < skill.buyThreshold - 8) return { pass: true };

  if (maxBid < minBid) return { pass: true };

  let amount = Math.min(bidder.money, Math.max(minBid, Math.min(maxBid, auction.bid + Math.ceil(fair * 0.08))));
  if (auction.leader === bidder.id) amount = minBid;

  if (amount > maxBid) return { pass: true };

  return { pass: false, amount };
}

export function decideJailAction(player, difficultyId, bailAmount) {
  const skill = getAISkill(difficultyId);

  if (player.jailFreeCards > 0 && player.jailTurns >= skill.jailPayTurn) return 'card';

  if (player.money >= bailAmount && player.jailTurns > skill.jailPayTurn) {
    if (player.money >= bailAmount * 2 || player.jailTurns >= 2) return 'bail';
  }

  return 'roll';
}

const RENT_WEIGHT = { 0: 1.2, 1: 1.5, 2: 1.8, 3: 2.2, 4: 2.8 };

export function pickBuildTarget(state, playerId, board, houseCost, ownsFullGroup, getGroupCellsFn) {
  const player = state.players[playerId];
  const skill = getAISkill(state.difficultyId);
  let best = null;
  let bestScore = -1;

  board.forEach((cell, id) => {
    const prop = state.properties[id];
    if (prop.owner !== playerId || prop.mortgaged || cell.type !== 'property' || !cell.group) return;
    if (!ownsFullGroup(playerId, cell.group)) return;
    if (prop.houses >= 5) return;

    const groupCells = getGroupCellsFn(cell.group);
    if (groupCells.some((gid) => state.properties[gid].mortgaged)) return;

    const minHouses = Math.min(...groupCells.map((gid) => state.properties[gid].houses));
    if (prop.houses > minHouses) return;

    const cost = houseCost[cell.group];
    if (player.money - cost < skill.buildReserve) return;

    const needHotel = prop.houses === 4;
    if (needHotel && state.hotelsLeft <= 0) return;
    if (!needHotel && state.housesLeft <= 0) return;

    const score = (RENT_WEIGHT[prop.houses] ?? 1) * (cell.price / 100);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  });

  return best;
}

export function pickHouseToSell(state, playerId, board, getGroupCellsFn) {
  let target = null;
  let lowestPriority = Infinity;

  board.forEach((cell, id) => {
    const prop = state.properties[id];
    if (prop.owner !== playerId || prop.houses <= 0 || cell.type !== 'property') return;

    const groupCells = getGroupCellsFn(cell.group);
    const maxHouses = Math.max(...groupCells.map((gid) => state.properties[gid].houses));
    if (prop.houses < maxHouses) return;

    const priority = cell.price + prop.houses * 40;
    if (priority < lowestPriority) {
      lowestPriority = priority;
      target = id;
    }
  });

  return target;
}

export function pickPropertyToMortgage(state, playerId, board) {
  let target = null;
  let bestScore = Infinity;

  board.forEach((cell, id) => {
    const prop = state.properties[id];
    if (prop.owner !== playerId || prop.houses > 0 || prop.mortgaged) return;
    if (!['property', 'railroad', 'utility'].includes(cell.type)) return;

    let penalty = 0;
    if (cell.group) {
      const owned = countOwnedInGroup(state, board, playerId, cell.group);
      const total = getGroupCells(board, cell.group).length;
      if (owned >= total - 1) penalty -= 200;
      else if (owned >= 2) penalty -= 80;
    }
    if (cell.type === 'railroad' && countRailroads(state, board, playerId) >= 2) penalty -= 60;
    if (cell.type === 'utility' && countUtilities(state, board, playerId) >= 1) penalty -= 40;

    const score = cell.price + penalty;
    if (score < bestScore) {
      bestScore = score;
      target = id;
    }
  });

  return target;
}

function estimateTradeSideValue(state, playerId, propIds, money, jailCards, board, rentTables) {
  let value = money + jailCards * 45;
  propIds.forEach((id) => {
    value += scoreProperty(id, state, playerId, board, rentTables) * 2;
    value += board[id].price * 0.35;
  });
  return value;
}

export function shouldAcceptTrade(offer, state, difficultyId, board, rentTables) {
  const skill = getAISkill(difficultyId);
  const to = state.players[offer.toId];
  const from = state.players[offer.fromId];

  const gives = estimateTradeSideValue(state, to.id, offer.offerProps, offer.offerMoney, offer.offerJailCards, board, rentTables);
  const receives = estimateTradeSideValue(state, to.id, offer.requestProps, offer.requestMoney, offer.requestJailCards, board, rentTables);

  const net = receives - gives;
  return net + randomNoise(skill) >= skill.tradeMinGain;
}

export function defaultAIName(index) {
  return `CPU ${index + 1}`;
}
