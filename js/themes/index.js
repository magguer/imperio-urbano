import defaultTheme from './default.js';
import worldTheme from './world.js';
import lotrTheme from './lotr.js';
import partyTheme from './party.js';
import starwarsTheme from './starwars.js';
import siliconvalleyTheme from './siliconvalley.js';
import narutoTheme from './naruto.js';
import footballTheme from './football.js';

export const THEMES = [
  defaultTheme,
  worldTheme,
  lotrTheme,
  partyTheme,
  starwarsTheme,
  siliconvalleyTheme,
  narutoTheme,
  footballTheme,
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || defaultTheme;
}

export function getThemeDefaultPlayerName(themeId, index) {
  const names = getTheme(themeId).defaultPlayerNames;
  if (Array.isArray(names) && names[index]) return names[index];
  return '';
}

export function applyThemeToDOM(theme) {
  document.documentElement.dataset.theme = theme.id;
  document.title = `${theme.strings.gameName} — Juego de Mesa Local`;

  const fontLink = document.getElementById('theme-font');
  if (fontLink && theme.style.fontUrl) {
    fontLink.href = theme.style.fontUrl;
  }

  const root = document.documentElement;
  Object.entries(theme.style.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  if (theme.style.bodyBg) {
    document.body.style.background = theme.style.bodyBg;
  }
  if (theme.style.fontFamily) {
    document.body.style.fontFamily = theme.style.fontFamily;
  }

  const logoIcon = document.querySelector('.logo-icon');
  const logoTitle = document.querySelector('.logo h1');
  const logoSubtitle = document.querySelector('.logo .subtitle');
  if (logoIcon) logoIcon.textContent = theme.icon;
  if (logoTitle) logoTitle.textContent = theme.strings.gameName;
  if (logoSubtitle) logoSubtitle.textContent = theme.tagline;

  const rulesList = document.querySelector('.rules-summary ul');
  if (rulesList) {
    rulesList.innerHTML = theme.strings.rules
      .map((rule) => `<li>${rule}</li>`)
      .join('');
  }
}

export function previewTheme(themeId) {
  applyThemeToDOM(getTheme(themeId));
}
