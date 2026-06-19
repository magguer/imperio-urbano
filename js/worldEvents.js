// Eventos aleatorios del tablero — sorpresas temáticas periódicas

import { getTheme } from './themes/index.js';

export const WORLD_EVENT_INTERVAL = 8;
export const WORLD_EVENT_RANDOM_MIN_GAP = 3;
export const WORLD_EVENT_RANDOM_CHANCE = 0.14;

const EVENT_WEIGHTS = {
  robbery: 16,
  windfall: 16,
  levy: 12,
  festival: 14,
  plunder: 11,
  benevolentGift: 4,
  storm: 10,
  royalGrant: 10,
};

const THEME_COPY = {
  default: {
    robbery: { emoji: '🦹', title: 'Ladrón urbano', verb: 'roba' },
    windfall: { emoji: '💰', title: 'Hallazgo', verb: 'encuentra' },
    levy: { emoji: '📋', title: 'Inspección fiscal', verb: 'multa a todos' },
    festival: { emoji: '🎉', title: 'Fiesta de barrio', verb: 'bonifica a todos' },
    plunder: { emoji: '🏴‍☠️', title: 'Usurpador', verb: 'requisa' },
    benevolentGift: { emoji: '🎁', title: 'Subsidio municipal', verb: 'transfiere' },
    storm: { emoji: '🌧️', title: 'Temporal', verb: 'daña' },
    royalGrant: { emoji: '🏛️', title: 'Ayuda social', verb: 'subvenciona' },
  },
  world: {
    robbery: { emoji: '🏴‍☠️', title: 'Piratas', verb: 'saquean' },
    windfall: { emoji: '💎', title: 'Tesoro perdido', verb: 'descubre' },
    levy: { emoji: '🛃', title: 'Aranceles globales', verb: 'gravan a todos' },
    festival: { emoji: '🌍', title: 'Año turístico récord', verb: 'premia a todos' },
    plunder: { emoji: '⚔️', title: 'Conquista', verb: 'anexa' },
    benevolentGift: { emoji: '🤝', title: 'Acuerdo internacional', verb: 'cede' },
    storm: { emoji: '🌊', title: 'Tsunami', verb: 'arrasa' },
    royalGrant: { emoji: '🏦', title: 'Fondo de desarrollo', verb: 'apoya' },
  },
  lotr: {
    robbery: { emoji: '👹', title: 'Orcos saqueadores', verb: 'arrebatan' },
    windfall: { emoji: '💍', title: 'Tesoro élfico', verb: 'recibe' },
    levy: { emoji: '👁️', title: 'Ojo de Sauron', verb: 'exige tributo a todos' },
    festival: { emoji: '🍺', title: 'Banquete en Rivendel', verb: 'recompensa a todos' },
    plunder: { emoji: '🔥', title: 'Saqueo de Mordor', verb: 'confisca' },
    benevolentGift: { emoji: '🕊️', title: 'Intervención de los Valar', verb: 'donan' },
    storm: { emoji: '🌋', title: 'Erupción del Monte Doom', verb: 'devasta' },
    royalGrant: { emoji: '👑', title: 'Regalo de Gondor', verb: 'subsidiar' },
  },
  party: {
    robbery: { emoji: '🥴', title: 'Resaca legendaria', verb: 'vacía la cartera de' },
    windfall: { emoji: '🎰', title: 'Jackpot VIP', verb: 'gana' },
    levy: { emoji: '🧾', title: 'Cuenta del bar', verb: 'reparte entre todos' },
    festival: { emoji: '🪩', title: 'Noche loca', verb: 'premia a todos' },
    plunder: { emoji: '🎭', title: 'Confusión en la pista', verb: 'intercambia' },
    benevolentGift: { emoji: '🍾', title: 'Botella sorpresa', verb: 'regala' },
    storm: { emoji: '💥', title: 'Pelea en el after', verb: 'destroza' },
    royalGrant: { emoji: '🎁', title: 'Patrocinio', verb: 'patrocina' },
  },
  starwars: {
    robbery: { emoji: '🚨', title: 'Imperio Galáctico', verb: 'confisca' },
    windfall: { emoji: '✨', title: 'Contrabando valioso', verb: 'vende' },
    levy: { emoji: '⚙️', title: 'Impuesto imperial', verb: 'cobran a todos' },
    festival: { emoji: '🎺', title: 'Victoria rebelde', verb: 'celebra con todos' },
    plunder: { emoji: '☠️', title: 'Piratas espaciales', verb: 'capturan' },
    benevolentGift: { emoji: '🌟', title: 'La Fuerza', verb: 'bendice con' },
    storm: { emoji: '💥', title: 'Ataque orbital', verb: 'bombardea' },
    royalGrant: { emoji: '🛸', title: 'Alianza Rebelde', verb: 'financia' },
  },
  siliconvalley: {
    robbery: { emoji: '🕵️', title: 'Auditoría sorpresa', verb: 'congela fondos de' },
    windfall: { emoji: '📈', title: 'Ronda seed', verb: 'inyecta capital a' },
    levy: { emoji: '⚖️', title: 'Regulación SEC', verb: 'multa a todos' },
    festival: { emoji: '🚀', title: 'IPO colectiva', verb: 'liquida dividendos a todos' },
    plunder: { emoji: '🔄', title: 'Adquisición hostil', verb: 'absorbe' },
    benevolentGift: { emoji: '🤲', title: 'Acuerdo de fusion', verb: 'transfiere' },
    storm: { emoji: '💣', title: 'Bug en producción', verb: 'demuele' },
    royalGrant: { emoji: '💼', title: 'Grant público', verb: 'financia' },
  },
  naruto: {
    robbery: { emoji: '🥷', title: 'Ninja ladrón', verb: 'roba' },
    windfall: { emoji: '📜', title: 'Misión S-rank', verb: 'paga' },
    levy: { emoji: '🏯', title: 'Tributo del Hokage', verb: 'exige a todos' },
    festival: { emoji: '🎆', title: 'Festival de Konoha', verb: 'premia a todos' },
    plunder: { emoji: '💨', title: 'Jutsu de intercambio', verb: 'intercambia' },
    benevolentGift: { emoji: '🍥', title: 'Regalo del sensei', verb: 'cede' },
    storm: { emoji: '🌪️', title: 'Rasengan descontrolado', verb: 'daña' },
    royalGrant: { emoji: '🐸', title: 'Ayuda de Jiraiya', verb: 'apoya' },
  },
  football: {
    robbery: { emoji: '🟥', title: 'Multa disciplinaria', verb: 'sanciona' },
    windfall: { emoji: '🏆', title: 'Prima por título', verb: 'cobra' },
    levy: { emoji: '💸', title: 'Fair play financiero', verb: 'ajusta a todos' },
    festival: { emoji: '🎊', title: 'Copa ganada', verb: 'reparte el botín con todos' },
    plunder: { emoji: '🔁', title: 'Traspaso sorpresa', verb: 'ficha' },
    benevolentGift: { emoji: '🤝', title: 'Cesión solidaria', verb: 'cede' },
    storm: { emoji: '⛈️', title: 'Partido suspendido', verb: 'inutiliza' },
    royalGrant: { emoji: '💰', title: 'Patrocinio', verb: 'patrocina' },
  },
};

function copyFor(themeId, eventId) {
  return THEME_COPY[themeId]?.[eventId] || THEME_COPY.default[eventId];
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isOwnable(cell) {
  return ['property', 'railroad', 'utility'].includes(cell.type);
}

function getActivePlayers(state) {
  return state.players.filter((p) => !p.bankrupt);
}

function getTransferableProps(state, board, playerId) {
  return board
    .map((cell, id) => ({ cell, id }))
    .filter(({ cell, id }) => {
      const prop = state.properties[id];
      return prop.owner === playerId
        && !prop.mortgaged
        && prop.houses === 0
        && isOwnable(cell);
    });
}

function getBuiltProps(state, board) {
  return board
    .map((cell, id) => ({ cell, id }))
    .filter(({ cell, id }) => {
      const prop = state.properties[id];
      return prop.owner !== null
        && !prop.mortgaged
        && prop.houses > 0
        && cell.type === 'property';
    });
}

function scaleMoney(base, difficultyId) {
  const mul = { casual: 0.85, normal: 1, hard: 1.15, brutal: 1.3 }[difficultyId] || 1;
  return Math.max(10, Math.round(base * mul));
}

function deductMoney(player, amount) {
  const paid = Math.min(player.money, amount);
  player.money -= paid;
  return paid;
}

function canRunEvent(eventId, state, board) {
  const players = getActivePlayers(state);
  if (players.length === 0) return false;

  switch (eventId) {
    case 'robbery':
      return players.some((p) => p.money > 0);
    case 'windfall':
    case 'royalGrant':
      return true;
    case 'levy':
    case 'festival':
      return players.length >= 1;
    case 'plunder': {
      if (players.length < 2) return false;
      return players.some((p) => getTransferableProps(state, board, p.id).length > 0);
    }
    case 'benevolentGift': {
      if (players.length < 2) return false;
      const richest = [...players].sort((a, b) => countProps(state, b.id) - countProps(state, a.id))[0];
      const poorest = [...players].sort((a, b) => countProps(state, a.id) - countProps(state, b.id))[0];
      if (richest.id === poorest.id) return false;
      return getTransferableProps(state, board, richest.id).length > 0;
    }
    case 'storm':
      return getBuiltProps(state, board).length > 0;
    default:
      return false;
  }
}

function countProps(state, playerId) {
  return state.properties.filter((p) => p.owner === playerId).length;
}

function pickWeightedEvent(state, board) {
  const pool = Object.entries(EVENT_WEIGHTS)
    .filter(([eventId]) => canRunEvent(eventId, state, board))
    .flatMap(([eventId, weight]) => Array(weight).fill(eventId));
  return pool.length ? pickRandom(pool) : null;
}

function resolveRobbery(state, board, themeId, formatMoney) {
  const players = getActivePlayers(state).filter((p) => p.money > 0);
  const victim = pickRandom(players);
  const amount = scaleMoney(80 + Math.floor(Math.random() * 70), state.difficultyId);
  const paid = deductMoney(victim, amount);
  const meta = copyFor(themeId, 'robbery');
  return {
    id: 'robbery',
    tone: 'bad',
    emoji: meta.emoji,
    title: meta.title,
    message: `${meta.title}: ${meta.verb} ${formatMoney(paid)} a ${victim.name}.`,
  };
}

function resolveWindfall(state, board, themeId, formatMoney) {
  const player = pickRandom(getActivePlayers(state));
  const amount = scaleMoney(90 + Math.floor(Math.random() * 80), state.difficultyId);
  player.money += amount;
  const meta = copyFor(themeId, 'windfall');
  return {
    id: 'windfall',
    tone: 'good',
    emoji: meta.emoji,
    title: meta.title,
    message: `${meta.title}: ${player.name} ${meta.verb} ${formatMoney(amount)}.`,
  };
}

function resolveLevy(state, board, themeId, formatMoney) {
  const amount = scaleMoney(25 + Math.floor(Math.random() * 25), state.difficultyId);
  const players = getActivePlayers(state);
  let total = 0;
  players.forEach((player) => {
    total += deductMoney(player, amount);
  });
  state.freeParkingPot += total;
  const parkingName = getTheme(themeId).strings?.parkingName || 'Zona Libre';
  const meta = copyFor(themeId, 'levy');
  return {
    id: 'levy',
    tone: 'bad',
    emoji: meta.emoji,
    title: meta.title,
    message: `${meta.title}: ${meta.verb} ${formatMoney(amount)} (${formatMoney(total)} al fondo ${parkingName}).`,
  };
}

function resolveFestival(state, board, themeId, formatMoney) {
  const amount = scaleMoney(35 + Math.floor(Math.random() * 30), state.difficultyId);
  const players = getActivePlayers(state);
  players.forEach((player) => {
    player.money += amount;
  });
  const meta = copyFor(themeId, 'festival');
  return {
    id: 'festival',
    tone: 'good',
    emoji: meta.emoji,
    title: meta.title,
    message: `${meta.title}: ${meta.verb} ${formatMoney(amount)} a cada jugador.`,
  };
}

function resolvePlunder(state, board, themeId, formatMoney) {
  const players = shuffle(getActivePlayers(state));
  let fromPlayer = null;
  let propEntry = null;

  for (const player of players) {
    const props = getTransferableProps(state, board, player.id);
    if (props.length) {
      fromPlayer = player;
      propEntry = pickRandom(props);
      break;
    }
  }
  if (!fromPlayer || !propEntry) return null;

  const others = getActivePlayers(state).filter((p) => p.id !== fromPlayer.id);
  const toPlayer = pickRandom(others);
  state.properties[propEntry.id].owner = toPlayer.id;
  const meta = copyFor(themeId, 'plunder');
  return {
    id: 'plunder',
    tone: 'mixed',
    emoji: meta.emoji,
    title: meta.title,
    message: `${meta.title}: ${meta.verb} ${propEntry.cell.name} de ${fromPlayer.name} a ${toPlayer.name}.`,
  };
}

function resolveBenevolentGift(state, board, themeId, formatMoney) {
  const players = getActivePlayers(state);
  const richest = [...players].sort((a, b) => countProps(state, b.id) - countProps(state, a.id))[0];
  const poorest = [...players].sort((a, b) => countProps(state, a.id) - countProps(state, b.id))[0];
  const props = getTransferableProps(state, board, richest.id);
  if (!props.length || richest.id === poorest.id) return null;

  const propEntry = pickRandom(props);
  state.properties[propEntry.id].owner = poorest.id;
  const meta = copyFor(themeId, 'benevolentGift');
  return {
    id: 'benevolentGift',
    tone: 'good',
    emoji: meta.emoji,
    title: meta.title,
    message: `${meta.title}: ${meta.verb} ${propEntry.cell.name} de ${richest.name} a ${poorest.name}.`,
  };
}

function resolveStorm(state, board, themeId, formatMoney) {
  const built = getBuiltProps(state, board);
  const target = pickRandom(built);
  const prop = state.properties[target.id];
  const owner = state.players[prop.owner];
  const wasHotel = prop.houses === 5;

  if (wasHotel) {
    prop.houses = 4;
    state.hotelsLeft += 1;
    state.housesLeft -= 4;
  } else {
    prop.houses -= 1;
    state.housesLeft += 1;
  }

  const meta = copyFor(themeId, 'storm');
  return {
    id: 'storm',
    tone: 'bad',
    emoji: meta.emoji,
    title: meta.title,
    message: `${meta.title}: ${meta.verb} un${wasHotel ? ' hotel' : 'a casa'} en ${target.cell.name} de ${owner.name}.`,
  };
}

function resolveRoyalGrant(state, board, themeId, formatMoney) {
  const players = getActivePlayers(state);
  const poorest = [...players].sort((a, b) => a.money - b.money)[0];
  const amount = scaleMoney(120 + Math.floor(Math.random() * 80), state.difficultyId);
  poorest.money += amount;
  const meta = copyFor(themeId, 'royalGrant');
  return {
    id: 'royalGrant',
    tone: 'good',
    emoji: meta.emoji,
    title: meta.title,
    message: `${meta.title}: ${meta.verb} ${formatMoney(amount)} a ${poorest.name} (el más necesitado).`,
  };
}

const RESOLVERS = {
  robbery: resolveRobbery,
  windfall: resolveWindfall,
  levy: resolveLevy,
  festival: resolveFestival,
  plunder: resolvePlunder,
  benevolentGift: resolveBenevolentGift,
  storm: resolveStorm,
  royalGrant: resolveRoyalGrant,
};

export function shouldTriggerWorldEvent(state) {
  if (!state?.worldEventsEnabled || state.winner) return false;
  const turn = state.turnCounter || 0;
  if (turn <= 0) return false;
  const last = state.lastWorldEventTurn || 0;
  const gap = turn - last;
  const mode = state.worldEventsMode || 'interval';

  if (mode === 'random') {
    if (gap < WORLD_EVENT_RANDOM_MIN_GAP) return false;
    return Math.random() < WORLD_EVENT_RANDOM_CHANCE;
  }

  return gap >= WORLD_EVENT_INTERVAL;
}

export function resolveWorldEvent(state, board, themeId, formatMoney, attempt = 0) {
  if (attempt > 10) return null;
  const eventId = pickWeightedEvent(state, board);
  if (!eventId) return null;
  const result = RESOLVERS[eventId](state, board, themeId, formatMoney);
  if (!result) return resolveWorldEvent(state, board, themeId, formatMoney, attempt + 1);
  return result;
}
