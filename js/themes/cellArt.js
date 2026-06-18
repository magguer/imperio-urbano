import { COMPACT_NAME_INDICES } from './shared.js';

/**
 * Imágenes personalizadas por casilla y tema.
 *
 * Convención para añadir arte nuevo:
 * 1. Guardar el archivo en `assets/themes/{themeId}/` (p. ej. `gondolin_box.png`).
 * 2. Registrar en el tema con `cellArt`, usando el índice del tablero clásico (40 casillas).
 *    Ese índice coincide con `BOARD_TEMPLATE` en shared.js y con la posición en `cellMeta`.
 * 3. Opcionalmente usar el slug del nombre (`gondolin`) en lugar del índice numérico.
 *
 * En tablero compacto (24 casillas) el índice clásico se resuelve con COMPACT_NAME_INDICES.
 */
export function slugifyCellName(name = '') {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/'s\b/g, 's')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getClassicCellIndex(boardIndex, boardSize = 'classic') {
  if (boardSize === 'classic') return boardIndex;
  return COMPACT_NAME_INDICES[boardIndex] ?? boardIndex;
}

function resolveArtFile(theme, classicIndex, cellName) {
  const art = theme?.cellArt;
  if (!art) return null;

  const byIndex = art[classicIndex] ?? art[String(classicIndex)];
  if (byIndex) return byIndex;

  const slug = slugifyCellName(cellName);
  if (!slug) return null;

  return art[slug] ?? art[`${slug}_box`] ?? null;
}

export function getCellArtUrl(theme, boardIndex, boardSize = 'classic', cellName = '') {
  if (!theme?.id) return null;

  const classicIndex = getClassicCellIndex(boardIndex, boardSize);
  const file = resolveArtFile(theme, classicIndex, cellName);
  if (!file) return null;

  const normalized = file.includes('.') ? file : `${file}.png`;
  return `assets/themes/${theme.id}/${normalized}`;
}
