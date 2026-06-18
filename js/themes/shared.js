// Constantes de juego compartidas entre todos los temas
export const GO_BONUS = 200;
export const STARTING_MONEY = 1500;
export const JAIL_BAIL = 50;

export const RENT_TABLES = {
  brown: [2, 10, 30, 90, 160, 250],
  lightblue: [4, 20, 60, 180, 320, 450],
  pink: [6, 30, 90, 270, 400, 550],
  orange: [8, 40, 100, 300, 450, 600],
  red: [10, 50, 150, 450, 625, 750],
  yellow: [12, 60, 180, 500, 700, 900],
  green: [14, 70, 200, 550, 750, 950],
  darkblue: [16, 80, 220, 600, 800, 1000],
};

export const HOUSE_COST = {
  brown: 50, lightblue: 50, pink: 100, orange: 100,
  red: 150, yellow: 150, green: 200, darkblue: 200,
};

// Mecánica fija: tipos, precios y grupos por casilla (40)
export const BOARD_TEMPLATE = [
  { type: 'go' },
  { type: 'property', color: 'brown', price: 60, group: 'brown' },
  { type: 'chance', deck: 'city' },
  { type: 'property', color: 'brown', price: 60, group: 'brown' },
  { type: 'tax', amount: 200 },
  { type: 'railroad', color: 'railroad', price: 200, group: 'railroad' },
  { type: 'property', color: 'lightblue', price: 100, group: 'lightblue' },
  { type: 'chest', deck: 'fortune' },
  { type: 'property', color: 'lightblue', price: 100, group: 'lightblue' },
  { type: 'property', color: 'lightblue', price: 120, group: 'lightblue' },
  { type: 'jail' },
  { type: 'property', color: 'pink', price: 140, group: 'pink' },
  { type: 'utility', color: 'utility', price: 150, group: 'utility' },
  { type: 'property', color: 'pink', price: 140, group: 'pink' },
  { type: 'property', color: 'pink', price: 160, group: 'pink' },
  { type: 'railroad', color: 'railroad', price: 200, group: 'railroad' },
  { type: 'property', color: 'orange', price: 180, group: 'orange' },
  { type: 'chance', deck: 'city' },
  { type: 'property', color: 'orange', price: 180, group: 'orange' },
  { type: 'property', color: 'orange', price: 200, group: 'orange' },
  { type: 'parking' },
  { type: 'property', color: 'red', price: 220, group: 'red' },
  { type: 'chest', deck: 'fortune' },
  { type: 'property', color: 'red', price: 220, group: 'red' },
  { type: 'property', color: 'red', price: 240, group: 'red' },
  { type: 'railroad', color: 'railroad', price: 200, group: 'railroad' },
  { type: 'property', color: 'yellow', price: 260, group: 'yellow' },
  { type: 'property', color: 'yellow', price: 260, group: 'yellow' },
  { type: 'utility', color: 'utility', price: 150, group: 'utility' },
  { type: 'property', color: 'yellow', price: 280, group: 'yellow' },
  { type: 'gotojail' },
  { type: 'property', color: 'green', price: 300, group: 'green' },
  { type: 'property', color: 'green', price: 300, group: 'green' },
  { type: 'chance', deck: 'city' },
  { type: 'property', color: 'green', price: 320, group: 'green' },
  { type: 'railroad', color: 'railroad', price: 200, group: 'railroad' },
  { type: 'chest', deck: 'fortune' },
  { type: 'property', color: 'darkblue', price: 350, group: 'darkblue' },
  { type: 'tax', amount: 100 },
  { type: 'property', color: 'darkblue', price: 400, group: 'darkblue' },
];

// Tablero compacto 7×7 (24 casillas): esquinas como el clásico (cárcel, parking, ir a cárcel)
export const BOARD_TEMPLATE_COMPACT = [
  { type: 'go' },
  { type: 'property', color: 'brown', price: 60, group: 'brown' },
  { type: 'property', color: 'brown', price: 60, group: 'brown' },
  { type: 'chance', deck: 'city' },
  { type: 'tax', amount: 200 },
  { type: 'railroad', color: 'railroad', price: 200, group: 'railroad' },
  { type: 'jail' },
  { type: 'property', color: 'lightblue', price: 100, group: 'lightblue' },
  { type: 'property', color: 'lightblue', price: 100, group: 'lightblue' },
  { type: 'chest', deck: 'fortune' },
  { type: 'utility', color: 'utility', price: 150, group: 'utility' },
  { type: 'railroad', color: 'railroad', price: 200, group: 'railroad' },
  { type: 'parking' },
  { type: 'property', color: 'pink', price: 140, group: 'pink' },
  { type: 'property', color: 'pink', price: 140, group: 'pink' },
  { type: 'property', color: 'orange', price: 180, group: 'orange' },
  { type: 'property', color: 'orange', price: 180, group: 'orange' },
  { type: 'property', color: 'red', price: 220, group: 'red' },
  { type: 'gotojail' },
  { type: 'property', color: 'red', price: 220, group: 'red' },
  { type: 'property', color: 'darkblue', price: 350, group: 'darkblue' },
  { type: 'chest', deck: 'fortune' },
  { type: 'utility', color: 'utility', price: 150, group: 'utility' },
  { type: 'property', color: 'darkblue', price: 400, group: 'darkblue' },
];

// Índices del tablero clásico usados para nombres en modo compacto
export const COMPACT_NAME_INDICES = [
  0, 1, 3, 2, 4, 5, 10, 6, 8, 7, 12, 15, 20, 11, 13, 16, 18, 21, 30, 23, 37, 36, 28, 39,
];

const CARD_TARGET_MAP = {
  0: 0,
  5: 5,
  15: 11,
  25: 11,
  35: 11,
  10: 6,
  30: 18,
};

export function getBoardConstants(boardSize = 'classic') {
  if (boardSize === 'compact') {
    return {
      len: 24,
      grid: 7,
      jail: 6,
      goToJail: 18,
      housesLeft: 19,
      hotelsLeft: 7,
    };
  }
  return {
    len: 40,
    grid: 11,
    jail: 10,
    goToJail: 30,
    housesLeft: 32,
    hotelsLeft: 12,
  };
}

export function buildBoard(cellMeta, boardSize = 'classic') {
  if (boardSize === 'classic') {
    return BOARD_TEMPLATE.map((cell, id) => ({
      ...cell,
      id,
      ...cellMeta[id],
    }));
  }

  return BOARD_TEMPLATE_COMPACT.map((cell, id) => {
    const classicIdx = COMPACT_NAME_INDICES[id];
    const meta = cellMeta[classicIdx] || {};
    return {
      ...cell,
      id,
      name: meta.name,
      desc: meta.desc,
    };
  });
}

export function buildBoardFromClassic(classicBoard, boardSize = 'classic') {
  if (boardSize === 'classic') return classicBoard;
  return BOARD_TEMPLATE_COMPACT.map((cell, id) => {
    const classicIdx = COMPACT_NAME_INDICES[id];
    const meta = classicBoard[classicIdx] || {};
    return {
      ...cell,
      id,
      name: meta.name,
      desc: meta.desc,
    };
  });
}

export function adaptCardsForBoardSize(cards, boardSize = 'classic') {
  if (boardSize === 'classic') return cards;
  return cards.map((card) => {
    if (card.action === 'move' && card.target != null) {
      const target = CARD_TARGET_MAP[card.target] ?? Math.min(card.target, 23);
      return { ...card, target };
    }
    return card;
  });
}

export function getBoardPositions(gridSize) {
  const pos = [];
  const G = gridSize;
  for (let i = 0; i <= G - 1; i++) pos.push({ row: G, col: G - i });
  for (let i = G; i <= 2 * G - 3; i++) pos.push({ row: 2 * G - 1 - i, col: 1 });
  for (let i = 2 * G - 2; i <= 3 * G - 3; i++) pos.push({ row: 1, col: i - (2 * G - 3) });
  for (let i = 3 * G - 2; i <= 4 * G - 5; i++) pos.push({ row: i - (3 * G - 4), col: G });
  return pos;
}

export const DEFAULT_BUILDINGS = {
  house: 'casa',
  houses: 'casas',
  houseEmoji: '🏠',
  houseMarker: '▪',
  hotel: 'hotel',
  hotels: 'hoteles',
  hotelEmoji: '🏨',
  rowLabel: 'Edificios',
  buildHouse: 'Casa',
  buildHotel: 'Hotel',
  supplyHouses: 'Casas',
  supplyHotels: 'Hoteles',
  noHousesLeft: 'No quedan casas en el banco.',
  noHotelsLeft: 'No quedan hoteles en el banco.',
  sellBeforeMortgage: 'Vende los edificios antes de hipotecar.',
  sellFundsHint: 'Hipoteca propiedades o vende edificios en el panel de acciones, luego pulsa',
};

export function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
