/**
 * Imagen de fondo del tablero por tema.
 *
 * Convención:
 * 1. Guardar en `assets/themes/{themeId}/` (p. ej. `bg_lotr_theme.png`).
 * 2. Registrar en el tema con `boardBg` — string (mismo para clásico y compacto)
 *    o `{ classic, compact }` para imágenes distintas.
 */
const BOARD_BG_CLASS = 'board-theme-bg';

export function getBoardBgUrl(theme, boardSize = 'classic') {
  const bg = theme?.boardBg;
  if (!bg || !theme?.id) return null;

  let file = null;
  if (typeof bg === 'string') {
    file = bg;
  } else {
    file = bg[boardSize] ?? bg.classic ?? bg.compact ?? null;
  }
  if (!file) return null;

  const normalized = file.includes('.') ? file : `${file}.png`;
  return `assets/themes/${theme.id}/${normalized}`;
}

export function applyBoardBackground(boardEl, theme, boardSize = 'classic') {
  if (!boardEl) return;

  const url = getBoardBgUrl(theme, boardSize);
  boardEl.classList.toggle('board--themed-bg', !!url);

  let img = boardEl.querySelector(`:scope > .${BOARD_BG_CLASS}`);
  if (!url) {
    img?.remove();
    return;
  }

  if (!img) {
    img = document.createElement('img');
    img.className = BOARD_BG_CLASS;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.decoding = 'async';
    img.loading = 'eager';
    boardEl.prepend(img);
  }

  if (img.getAttribute('src') !== url) {
    img.src = url;
  }
}
