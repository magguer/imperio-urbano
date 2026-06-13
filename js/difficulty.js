export const DIFFICULTY_PRESETS = {
  casual: {
    id: 'casual',
    name: 'Casual',
    tagline: 'Más capital inicial y multas suaves',
    startingMoney: 2000,
    goBonusMul: 1.25,
    jailBailMul: 0.75,
    taxMul: 0.75,
    fineMul: 0.75,
    cardIncomeMul: 1.25,
    repairMul: 0.75,
    mortgageInterestMul: 0.75,
  },
  normal: {
    id: 'normal',
    name: 'Estándar',
    tagline: 'Reglas clásicas',
    startingMoney: 1500,
    goBonusMul: 1,
    jailBailMul: 1,
    taxMul: 1,
    fineMul: 1,
    cardIncomeMul: 1,
    repairMul: 1,
    mortgageInterestMul: 1,
  },
  hard: {
    id: 'hard',
    name: 'Dura',
    tagline: 'Menos dinero y multas más caras',
    startingMoney: 1200,
    goBonusMul: 0.85,
    jailBailMul: 1.5,
    taxMul: 1.5,
    fineMul: 1.5,
    cardIncomeMul: 0.85,
    repairMul: 1.35,
    mortgageInterestMul: 1.5,
  },
  brutal: {
    id: 'brutal',
    name: 'Brutal',
    tagline: 'Capital escaso e impuestos duplicados',
    startingMoney: 1000,
    goBonusMul: 0.7,
    jailBailMul: 2,
    taxMul: 2,
    fineMul: 2,
    cardIncomeMul: 0.7,
    repairMul: 1.75,
    mortgageInterestMul: 2,
  },
};

export const DIFFICULTY_LIST = Object.values(DIFFICULTY_PRESETS);

export function getDifficultyPreset(id) {
  return DIFFICULTY_PRESETS[id] || DIFFICULTY_PRESETS.normal;
}

export function formatDifficultySummary(preset) {
  const taxPct = Math.round((preset.taxMul - 1) * 100);
  const taxLabel = taxPct === 0 ? 'multas normales' : taxPct > 0 ? `multas +${taxPct}%` : `multas ${taxPct}%`;
  return `Inicio ${preset.startingMoney.toLocaleString('es-ES')} · ${taxLabel}`;
}
