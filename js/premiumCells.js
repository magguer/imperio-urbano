// Casillas premium: marcadas al inicio con ventaja temporal al comprarlas.

import { pickRandomBuffId, grantBuffToPlayer, normalizePremiumBuffIds } from './playerBuffs.js';

export { normalizePremiumBuffIds };

function shuffleIds(ids) {
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function countPremiumCells(boardLen) {
  return boardLen >= 35 ? 5 : 3;
}

export function pickPremiumCellIds(board) {
  const pool = board
    .map((cell, id) => ({ cell, id }))
    .filter(({ cell }) => ['property', 'railroad', 'utility'].includes(cell.type))
    .map(({ id }) => id);

  const count = Math.min(countPremiumCells(board.length), pool.length);
  return shuffleIds(pool).slice(0, count);
}

export function assignPremiumCells(properties, board) {
  pickPremiumCellIds(board).forEach((id) => {
    properties[id].premium = true;
    properties[id].premiumBuffId = pickRandomBuffId();
  });
}

export function isPremiumUnowned(prop) {
  return !!prop?.premium && prop.owner === null;
}

export function grantPremiumCellBuff(player, prop, themeId, context = {}) {
  if (!prop?.premium || !prop.premiumBuffId) return null;
  return grantBuffToPlayer(player, prop.premiumBuffId, themeId, context);
}

export function ensurePremiumBuffIds(properties) {
  normalizePremiumBuffIds(properties);
  properties?.forEach((prop) => {
    if (prop.premium && !prop.premiumBuffId) {
      prop.premiumBuffId = pickRandomBuffId();
    }
  });
}
