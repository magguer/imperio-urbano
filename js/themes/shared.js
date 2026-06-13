// Constantes de juego compartidas entre todos los temas
export const GO_BONUS = 200;
export const JAIL_POSITION = 10;
export const GO_TO_JAIL_POSITION = 30;
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

export function buildBoard(cellMeta) {
  return BOARD_TEMPLATE.map((cell, id) => ({
    ...cell,
    id,
    ...cellMeta[id],
  }));
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
