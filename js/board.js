// Tablero de Imperio Urbano — 40 casillas, tema original
export const GO_BONUS = 200;
export const JAIL_POSITION = 10;
export const GO_TO_JAIL_POSITION = 30;

export const COLORS = {
  brown: { bg: '#8B4513', light: '#D2691E', name: 'Barrio Antiguo' },
  lightblue: { bg: '#87CEEB', light: '#B0E0E6', name: 'Costa' },
  pink: { bg: '#FF69B4', light: '#FFB6C1', name: 'Centro' },
  orange: { bg: '#FF8C00', light: '#FFA500', name: 'Universidad' },
  red: { bg: '#DC143C', light: '#F08080', name: 'Puerto' },
  yellow: { bg: '#FFD700', light: '#FFFACD', name: 'Aeropuerto' },
  green: { bg: '#228B22', light: '#90EE90', name: 'Parque' },
  darkblue: { bg: '#00008B', light: '#4169E1', name: 'Rascacielos' },
  railroad: { bg: '#2F4F4F', light: '#708090', name: 'Metro' },
  utility: { bg: '#C0C0C0', light: '#E8E8E8', name: 'Servicios' },
};

// Rentas: [base, 1casa, 2casas, 3casas, 4casas, hotel]
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

export const BOARD = [
  { id: 0, type: 'go', name: 'SALIDA', desc: 'Cobra $200 al pasar' },
  { id: 1, type: 'property', name: 'Calle del Molino', color: 'brown', price: 60, group: 'brown' },
  { id: 2, type: 'chance', name: 'Sorpresa', deck: 'city' },
  { id: 3, type: 'property', name: 'Avenida del Río', color: 'brown', price: 60, group: 'brown' },
  { id: 4, type: 'tax', name: 'Impuesto', amount: 200, desc: 'Paga $200' },
  { id: 5, type: 'railroad', name: 'Metro Norte', color: 'railroad', price: 200, group: 'railroad' },
  { id: 6, type: 'property', name: 'Plaza Mayor', color: 'lightblue', price: 100, group: 'lightblue' },
  { id: 7, type: 'chest', name: 'Fortuna', deck: 'fortune' },
  { id: 8, type: 'property', name: 'Mercado Central', color: 'lightblue', price: 100, group: 'lightblue' },
  { id: 9, type: 'property', name: 'Paseo Marítimo', color: 'lightblue', price: 120, group: 'lightblue' },
  { id: 10, type: 'jail', name: 'Comisaría', desc: 'Solo visita' },
  { id: 11, type: 'property', name: 'Calle Rosa', color: 'pink', price: 140, group: 'pink' },
  { id: 12, type: 'utility', name: 'Agua Municipal', color: 'utility', price: 150, group: 'utility' },
  { id: 13, type: 'property', name: 'Avenida Flores', color: 'pink', price: 140, group: 'pink' },
  { id: 14, type: 'property', name: 'Jardín Botánico', color: 'pink', price: 160, group: 'pink' },
  { id: 15, type: 'railroad', name: 'Metro Sur', color: 'railroad', price: 200, group: 'railroad' },
  { id: 16, type: 'property', name: 'Campus Norte', color: 'orange', price: 180, group: 'orange' },
  { id: 17, type: 'chance', name: 'Sorpresa', deck: 'city' },
  { id: 18, type: 'property', name: 'Biblioteca', color: 'orange', price: 180, group: 'orange' },
  { id: 19, type: 'property', name: 'Facultad de Arte', color: 'orange', price: 200, group: 'orange' },
  { id: 20, type: 'parking', name: 'Zona Libre', desc: 'Descansa aquí' },
  { id: 21, type: 'property', name: 'Muelle 1', color: 'red', price: 220, group: 'red' },
  { id: 22, type: 'chest', name: 'Fortuna', deck: 'fortune' },
  { id: 23, type: 'property', name: 'Muelle 2', color: 'red', price: 220, group: 'red' },
  { id: 24, type: 'property', name: 'Almacén Portuario', color: 'red', price: 240, group: 'red' },
  { id: 25, type: 'railroad', name: 'Metro Este', color: 'railroad', price: 200, group: 'railroad' },
  { id: 26, type: 'property', name: 'Terminal A', color: 'yellow', price: 260, group: 'yellow' },
  { id: 27, type: 'property', name: 'Terminal B', color: 'yellow', price: 260, group: 'yellow' },
  { id: 28, type: 'utility', name: 'Energía Urbana', color: 'utility', price: 150, group: 'utility' },
  { id: 29, type: 'property', name: 'Hangar', color: 'yellow', price: 280, group: 'yellow' },
  { id: 30, type: 'gotojail', name: '¡A la Comisaría!', desc: 'Ve directo a la cárcel' },
  { id: 31, type: 'property', name: 'Torre Financiera', color: 'green', price: 300, group: 'green' },
  { id: 32, type: 'property', name: 'Rascacielos Norte', color: 'green', price: 300, group: 'green' },
  { id: 33, type: 'chance', name: 'Sorpresa', deck: 'city' },
  { id: 34, type: 'property', name: 'Parque Central', color: 'green', price: 320, group: 'green' },
  { id: 35, type: 'railroad', name: 'Metro Oeste', color: 'railroad', price: 200, group: 'railroad' },
  { id: 36, type: 'chest', name: 'Fortuna', deck: 'fortune' },
  { id: 37, type: 'property', name: 'Torre del Cielo', color: 'darkblue', price: 350, group: 'darkblue' },
  { id: 38, type: 'tax', name: 'Tasa de Lujo', amount: 100, desc: 'Paga $100' },
  { id: 39, type: 'property', name: 'Gran Torre', color: 'darkblue', price: 400, group: 'darkblue' },
];

export const PLAYER_COLORS = ['#E74C3C', '#3498DB', '#2ECC71', '#F39C12', '#9B59B6', '#1ABC9C'];
export const PLAYER_TOKENS = [
  { id: 'car', name: 'Auto deportivo', icon: 'fa-car-side' },
  { id: 'rocket', name: 'Cohete', icon: 'fa-rocket' },
  { id: 'tower', name: 'Torre', icon: 'fa-building' },
  { id: 'ship', name: 'Yate', icon: 'fa-ship' },
  { id: 'plane', name: 'Avión', icon: 'fa-plane' },
  { id: 'crown', name: 'Corona', icon: 'fa-crown' },
  { id: 'gem', name: 'Diamante', icon: 'fa-gem' },
  { id: 'train', name: 'Tren', icon: 'fa-train-subway' },
  { id: 'helicopter', name: 'Helicóptero', icon: 'fa-helicopter' },
  { id: 'knight', name: 'Caballo', icon: 'fa-chess-knight' },
  { id: 'trophy', name: 'Trofeo', icon: 'fa-trophy' },
  { id: 'key', name: 'Llave', icon: 'fa-key' },
];
export const STARTING_MONEY = 1500;
export const JAIL_BAIL = 50;
