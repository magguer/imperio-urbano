import { getTheme, applyThemeToDOM } from './themes/index.js';
import {
  GO_BONUS, JAIL_POSITION, GO_TO_JAIL_POSITION, STARTING_MONEY, JAIL_BAIL,
  RENT_TABLES, HOUSE_COST, shuffleDeck,
} from './themes/shared.js';

export {
  GO_BONUS, JAIL_POSITION, GO_TO_JAIL_POSITION, STARTING_MONEY, JAIL_BAIL,
  RENT_TABLES, HOUSE_COST, shuffleDeck,
};

export let BOARD = [];
export let COLORS = {};
export let PLAYER_COLORS = [];
export let PLAYER_TOKENS = [];
export let CITY_CARDS = [];
export let FORTUNE_CARDS = [];
export let THEME = null;

export function loadTheme(themeId) {
  const theme = getTheme(themeId);
  THEME = theme;
  BOARD = theme.board;
  COLORS = theme.colors;
  PLAYER_COLORS = theme.playerColors;
  PLAYER_TOKENS = theme.tokens;
  CITY_CARDS = theme.cityCards;
  FORTUNE_CARDS = theme.fortuneCards;
  return theme;
}

export function applyTheme(themeId) {
  const theme = loadTheme(themeId);
  applyThemeToDOM(theme);
  return theme;
}

// Carga tema por defecto al importar el módulo
applyTheme('default');
