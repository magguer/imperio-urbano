// Jugadores controlados por la computadora

const AI_SKILL = {
  casual: {
    buyThreshold: 62,
    cashReserve: 220,
    maxBidRatio: 0.68,
    buildReserve: 380,
    jailPayTurn: 3,
    noise: 0.38,
    tradeMinGain: 35,
    tradeProposeChance: 0.22,
    tradeProposeMinGain: 22,
    portfolioBoost: 8,
    auctionAggression: 0.8,
  },
  normal: {
    buyThreshold: 48,
    cashReserve: 160,
    maxBidRatio: 0.92,
    buildReserve: 220,
    jailPayTurn: 2,
    noise: 0.16,
    tradeMinGain: 18,
    tradeProposeChance: 0.42,
    tradeProposeMinGain: 12,
    portfolioBoost: 14,
    auctionAggression: 0.95,
  },
  hard: {
    buyThreshold: 38,
    cashReserve: 110,
    maxBidRatio: 1.08,
    buildReserve: 140,
    jailPayTurn: 1,
    noise: 0.06,
    tradeMinGain: 8,
    tradeProposeChance: 0.62,
    tradeProposeMinGain: 5,
    portfolioBoost: 20,
    auctionAggression: 1.1,
  },
  brutal: {
    buyThreshold: 28,
    cashReserve: 70,
    maxBidRatio: 1.28,
    buildReserve: 90,
    jailPayTurn: 0,
    noise: 0,
    tradeMinGain: 0,
    tradeProposeChance: 0.82,
    tradeProposeMinGain: 0,
    portfolioBoost: 26,
    auctionAggression: 1.22,
  },
};

export function getAISkill(difficultyId) {
  return AI_SKILL[difficultyId] || AI_SKILL.normal;
}

function randomNoise(skill) {
  if (!skill.noise) return 0;
  return (Math.random() - 0.5) * skill.noise * 40;
}

function getGroupCells(board, group) {
  return board.map((cell, id) => ({ cell, id })).filter(({ cell }) => cell.group === group).map(({ id }) => id);
}

function countOwnedInGroup(state, board, playerId, group) {
  return getGroupCells(board, group).filter((id) => state.properties[id].owner === playerId).length;
}

function countAcquirableInGroup(state, board, playerId, group) {
  return getGroupCells(board, group).filter((id) => state.properties[id].owner !== playerId).length;
}

function countPlayerProperties(state, playerId) {
  return state.properties.filter((prop) => prop.owner === playerId).length;
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

function opponentOwnsInGroup(state, board, playerId, group) {
  return getGroupCells(board, group).some((id) => {
    const owner = state.properties[id].owner;
    return owner !== null && owner !== playerId;
  });
}

function opponentNearMonopoly(state, board, playerId, group) {
  const cells = getGroupCells(board, group);
  const total = cells.length;
  const opponents = new Set();

  cells.forEach((id) => {
    const owner = state.properties[id].owner;
    if (owner !== null && owner !== playerId) opponents.add(owner);
  });

  for (const oppId of opponents) {
    const owned = cells.filter((id) => state.properties[id].owner === oppId).length;
    const unowned = cells.filter((id) => state.properties[id].owner === null).length;
    if (owned >= total - 1 && unowned >= 1) return true;
  }
  return false;
}

function getCashReserve(skill, player, state, playerId) {
  const props = countPlayerProperties(state, playerId);
  if (props < 2) return Math.min(skill.cashReserve, Math.max(80, Math.floor(player.money * 0.08)));
  if (props < 5) return Math.floor(skill.cashReserve * 0.85);
  return skill.cashReserve;
}

export function scoreProperty(cellId, state, playerId, board, rentTables, skill = getAISkill(state.difficultyId)) {
  const cell = board[cellId];
  const player = state.players[playerId];
  if (!cell?.price) return 0;

  const rent = baseRent(cell, rentTables);
  const cashAfter = player.money - cell.price;
  const reserve = getCashReserve(skill, player, state, playerId);
  const portfolio = countPlayerProperties(state, playerId);

  let score = 22;
  score += (rent / cell.price) * 220;

  if (cell.type === 'property' && cell.group) {
    const groupCells = getGroupCells(board, cell.group);
    const total = groupCells.length;
    const owned = countOwnedInGroup(state, board, playerId, cell.group);
    const acquirable = countAcquirableInGroup(state, board, playerId, cell.group);
    const alreadyOwns = state.properties[cellId].owner === playerId;

    score += owned * 22;

    if (!alreadyOwns) {
      if (owned > 0 && acquirable === 1) score += 38;
      if (owned === total - 1 && acquirable >= 1) score += 45;
    } else if (owned === total) {
      score += 20;
    } else if (owned > 0 && acquirable >= 1) {
      score += 10;
    }

    if (opponentNearMonopoly(state, board, playerId, cell.group)) score += 28;
    if (opponentOwnsInGroup(state, board, playerId, cell.group)) score -= 8;
  }

  if (cell.type === 'railroad') {
    const owned = countRailroads(state, board, playerId);
    score += 18 + owned * 16;
    if (owned >= 2) score += 12;
  }

  if (cell.type === 'utility') {
    const owned = countUtilities(state, board, playerId);
    score += 14 + owned * 18;
  }

  if (portfolio < 3) score += skill.portfolioBoost;
  else if (portfolio < 6) score += Math.floor(skill.portfolioBoost * 0.5);
  else if (portfolio >= 12) score -= 8;

  if (cashAfter < reserve) score -= 42;
  else if (cashAfter < reserve * 1.4) score -= 18;
  else if (cashAfter > reserve * 2.5) score += 12;
  else if (cashAfter > reserve * 4) score += 8;

  if (cell.price <= 120 && cashAfter >= reserve) score += 6;
  if (cell.price <= 80 && cashAfter >= reserve) score += 5;

  return score;
}

export function shouldBuyProperty(cellId, state, playerId, difficultyId, board, rentTables) {
  const cell = board[cellId];
  const player = state.players[playerId];
  const skill = getAISkill(difficultyId);

  if (player.money < cell.price) return false;

  const reserve = getCashReserve(skill, player, state, playerId);
  const cashAfter = player.money - cell.price;
  if (cashAfter < reserve) return false;

  const score = scoreProperty(cellId, state, playerId, board, rentTables, skill) + randomNoise(skill);
  if (score >= skill.buyThreshold) return true;

  const portfolio = countPlayerProperties(state, playerId);
  if (portfolio < 4 && cashAfter >= reserve * 1.15 && cell.price <= 180) {
    return score >= skill.buyThreshold - 10;
  }

  if (skill.buyThreshold <= 38 && cashAfter >= reserve && score >= skill.buyThreshold - 6) {
    return true;
  }

  return false;
}

export function estimateFairPrice(cellId, state, playerId, board, rentTables) {
  const cell = board[cellId];
  const skill = getAISkill(state.difficultyId);
  const score = scoreProperty(cellId, state, playerId, board, rentTables, skill);
  const ratio = Math.min(1.25, Math.max(0.45, score / 62));
  return Math.max(1, Math.floor(cell.price * ratio));
}

export function decideAuctionBid(auction, bidder, state, difficultyId, board, rentTables) {
  const skill = getAISkill(difficultyId);
  const fair = estimateFairPrice(auction.cellId, state, bidder.id, board, rentTables);
  const score = scoreProperty(auction.cellId, state, bidder.id, board, rentTables, skill);
  const minBid = auction.bid + 1;
  const auctionThreshold = skill.buyThreshold - 10;

  if (bidder.money < minBid) return { pass: true };
  if (score + randomNoise(skill) < auctionThreshold) return { pass: true };

  const cashAfterMin = bidder.money - minBid;
  const reserve = getCashReserve(skill, bidder, state, bidder.id);
  if (cashAfterMin < reserve * 0.75) return { pass: true };

  const maxBid = Math.floor(fair * skill.maxBidRatio * skill.auctionAggression);
  if (maxBid < minBid) return { pass: true };

  const step = Math.max(1, Math.ceil(fair * 0.06 * skill.auctionAggression));
  let amount = Math.min(bidder.money, Math.max(minBid, Math.min(maxBid, auction.bid + step)));

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

function unmortgageCost(cell) {
  return Math.floor(cell.price / 2 * 1.1);
}

export function pickPropertyToUnmortgage(state, playerId, board) {
  const player = state.players[playerId];
  const skill = getAISkill(state.difficultyId);
  const reserve = getCashReserve(skill, player, state, playerId);
  let target = null;
  let bestScore = -Infinity;

  board.forEach((cell, id) => {
    const prop = state.properties[id];
    if (prop.owner !== playerId || !prop.mortgaged || prop.houses > 0) return;
    if (!['property', 'railroad', 'utility'].includes(cell.type)) return;

    const cost = unmortgageCost(cell);
    if (player.money < cost + reserve) return;

    let score = cell.price * 0.15;

    if (cell.type === 'property' && cell.group) {
      const groupCells = getGroupCells(board, cell.group);
      const allOwned = groupCells.every((gid) => state.properties[gid].owner === playerId);
      const othersUnmortgaged = groupCells
        .filter((gid) => gid !== id)
        .every((gid) => !state.properties[gid].mortgaged);

      if (allOwned && othersUnmortgaged) score += 220;
      const owned = countOwnedInGroup(state, board, playerId, cell.group);
      if (owned === groupCells.length) score += 80;
      else if (owned >= 2) score += 35;
    }

    if (cell.type === 'railroad') {
      const railroads = board.filter((c, gid) =>
        c.type === 'railroad' && state.properties[gid].owner === playerId
      ).length;
      if (railroads >= 2) score += 50;
      else score += 25;
    }

    if (cell.type === 'utility') {
      const utilities = board.filter((c, gid) =>
        c.type === 'utility' && state.properties[gid].owner === playerId
      ).length;
      if (utilities >= 2) score += 45;
      else score += 20;
    }

    if (score > bestScore) {
      bestScore = score;
      target = id;
    }
  });

  return target;
}

function estimateTradeSideValue(state, playerId, propIds, money, jailCards, board, rentTables) {
  const skill = getAISkill(state.difficultyId);
  let value = money + jailCards * 45;
  propIds.forEach((id) => {
    value += scoreProperty(id, state, playerId, board, rentTables, skill) * 2;
    value += board[id].price * 0.35;
  });
  return value;
}

export function tradeNetForPlayer(offer, state, playerId, board, rentTables) {
  const isFrom = playerId === offer.fromId;
  const getsProps = isFrom ? offer.requestProps : offer.offerProps;
  const getsMoney = isFrom ? offer.requestMoney : offer.offerMoney;
  const getsJail = isFrom ? offer.requestJailCards : offer.offerJailCards;
  const givesProps = isFrom ? offer.offerProps : offer.requestProps;
  const givesMoney = isFrom ? offer.offerMoney : offer.requestMoney;
  const givesJail = isFrom ? offer.offerJailCards : offer.requestJailCards;

  const gets = estimateTradeSideValue(state, playerId, getsProps, getsMoney, getsJail, board, rentTables);
  const gives = estimateTradeSideValue(state, playerId, givesProps, givesMoney, givesJail, board, rentTables);
  return gets - gives;
}

function getTradeablePropIds(state, playerId, board) {
  return board.reduce((ids, cell, id) => {
    const prop = state.properties[id];
    if (
      prop.owner === playerId &&
      ['property', 'railroad', 'utility'].includes(cell.type) &&
      prop.houses === 0
    ) {
      ids.push(id);
    }
    return ids;
  }, []);
}

function isProtectedTradeAsset(state, board, playerId, cellId) {
  const cell = board[cellId];
  if (!cell?.group) return false;

  const groupCells = getGroupCells(board, cell.group);
  const owned = groupCells.filter((id) => state.properties[id].owner === playerId).length;
  return owned >= groupCells.length - 1;
}

function pickOfferProps(state, fromId, board, rentTables, skill, excludeIds) {
  return getTradeablePropIds(state, fromId, board)
    .filter((id) => !excludeIds.includes(id))
    .filter((id) => !isProtectedTradeAsset(state, board, fromId, id))
    .sort((a, b) => scoreProperty(a, state, fromId, board, rentTables, skill)
      - scoreProperty(b, state, fromId, board, rentTables, skill))
    .slice(0, 2);
}

function findMonopolyTradeTargets(state, fromId, toId, board, rentTables, skill) {
  const targets = [];
  const seenGroups = new Set();

  board.forEach((cell, id) => {
    if (!cell.group || seenGroups.has(cell.group)) return;
    seenGroups.add(cell.group);

    const groupCells = getGroupCells(board, cell.group);
    const fromOwned = groupCells.filter((gid) => state.properties[gid].owner === fromId);
    const toOwned = groupCells.filter((gid) => state.properties[gid].owner === toId);

    if (fromOwned.length !== groupCells.length - 1 || toOwned.length !== 1) return;

    const requestId = toOwned[0];
    targets.push({
      requestProps: [requestId],
      priority: scoreProperty(requestId, state, fromId, board, rentTables, skill) + cell.price * 0.2,
    });
  });

  return targets.sort((a, b) => b.priority - a.priority);
}

function finalizeTradeOffer(state, fromId, toId, requestProps, offerProps, board, rentTables, skill) {
  const from = state.players[fromId];
  const reserve = getCashReserve(skill, from, state, fromId);
  const maxMoney = Math.max(0, from.money - reserve);

  const offer = {
    fromId,
    toId,
    offerProps: [...offerProps],
    offerMoney: 0,
    offerJailCards: 0,
    requestProps: [...requestProps],
    requestMoney: 0,
    requestJailCards: 0,
  };

  const requestValue = estimateTradeSideValue(state, toId, requestProps, 0, 0, board, rentTables);
  const offerPropValue = estimateTradeSideValue(state, toId, offerProps, 0, 0, board, rentTables);
  const startMoney = Math.max(0, Math.floor(requestValue - offerPropValue));
  const step = Math.max(5, Math.floor(board[requestProps[0]].price * 0.05));

  for (let offerMoney = startMoney; offerMoney <= maxMoney; offerMoney += step) {
    offer.offerMoney = offerMoney;
    const fromNet = tradeNetForPlayer(offer, state, fromId, board, rentTables);
    const toNet = tradeNetForPlayer(offer, state, toId, board, rentTables);
    if (fromNet >= skill.tradeProposeMinGain && toNet >= skill.tradeMinGain) {
      return offer;
    }
  }

  return null;
}

function buildTradeWithPartner(state, fromId, toId, board, rentTables, skill) {
  const targets = findMonopolyTradeTargets(state, fromId, toId, board, rentTables, skill);
  for (const target of targets) {
    const propOffers = pickOfferProps(state, fromId, board, rentTables, skill, target.requestProps);
    const offerVariants = [propOffers, propOffers.slice(0, 1), []];
    const seen = new Set();

    for (const offerProps of offerVariants) {
      const key = offerProps.join(',');
      if (seen.has(key)) continue;
      seen.add(key);

      const offer = finalizeTradeOffer(
        state,
        fromId,
        toId,
        target.requestProps,
        offerProps,
        board,
        rentTables,
        skill,
      );
      if (offer) return offer;
    }
  }
  return null;
}

export function proposeAITrade(state, fromId, opponentIds, difficultyId, board, rentTables) {
  const skill = getAISkill(difficultyId);
  if (!opponentIds.length || Math.random() > skill.tradeProposeChance) return null;

  let bestOffer = null;
  let bestNet = -Infinity;

  opponentIds.forEach((toId) => {
    const offer = buildTradeWithPartner(state, fromId, toId, board, rentTables, skill);
    if (!offer) return;
    const net = tradeNetForPlayer(offer, state, fromId, board, rentTables);
    if (net > bestNet) {
      bestNet = net;
      bestOffer = offer;
    }
  });

  return bestOffer;
}

export function shouldAcceptTrade(offer, state, difficultyId, board, rentTables) {
  const skill = getAISkill(difficultyId);
  const net = tradeNetForPlayer(offer, state, offer.toId, board, rentTables);
  return net + randomNoise(skill) >= skill.tradeMinGain;
}

export function defaultAIName(index) {
  return `CPU ${index + 1}`;
}
