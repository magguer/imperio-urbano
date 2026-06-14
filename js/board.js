import { getTheme, applyThemeToDOM } from './themes/index.js';
import {
  GO_BONUS, STARTING_MONEY, JAIL_BAIL,
  RENT_TABLES, HOUSE_COST, shuffleDeck,
  buildBoardFromClassic, adaptCardsForBoardSize, getBoardConstants,
} from './themes/shared.js';

export {
  GO_BONUS, STARTING_MONEY, JAIL_BAIL,
  RENT_TABLES, HOUSE_COST, shuffleDeck,
};

export let BOARD = [];
export let COLORS = {};
export let PLAYER_COLORS = [];
export let PLAYER_TOKENS = [];
export let CITY_CARDS = [];
export let FORTUNE_CARDS = [];
export let THEME = null;
export let BOARD_LEN = 40;
export let BOARD_GRID = 11;
export let JAIL_POSITION = 10;
export let GO_TO_JAIL_POSITION = 30;
export let currentBoardSize = 'classic';

export function loadTheme(themeId, boardSize = 'classic') {
  const theme = getTheme(themeId);
  const constants = getBoardConstants(boardSize);

  THEME = theme;
  currentBoardSize = boardSize;
  BOARD_LEN = constants.len;
  BOARD_GRID = constants.grid;
  JAIL_POSITION = constants.jail;
  GO_TO_JAIL_POSITION = constants.goToJail;
  BOARD = buildBoardFromClassic(theme.board, boardSize);
  COLORS = theme.colors;
  PLAYER_COLORS = theme.playerColors;
  PLAYER_TOKENS = theme.tokens;
  CITY_CARDS = adaptCardsForBoardSize(theme.cityCards, boardSize);
  FORTUNE_CARDS = adaptCardsForBoardSize(theme.fortuneCards, boardSize);
  return theme;
}

export function applyTheme(themeId, boardSize = 'classic') {
  const theme = loadTheme(themeId, boardSize);
  applyThemeToDOM(theme);
  return theme;
}

// Carga tema por defecto al importar el módulo
applyTheme('default');
