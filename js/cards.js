// Cartas de Sorpresa Ciudad y Fortuna — textos originales
export const CITY_CARDS = [
  { text: 'Avanza hasta SALIDA. Cobra $200.', action: 'move', target: 0, collectGo: true },
  { text: 'Avanza hasta Metro Norte. Si pasas por SALIDA, cobra $200.', action: 'move', target: 5 },
  { text: 'Avanza hasta Metro Sur. Si pasas por SALIDA, cobra $200.', action: 'move', target: 15 },
  { text: 'Avanza hasta Metro Este. Si pasas por SALIDA, cobra $200.', action: 'move', target: 25 },
  { text: 'Avanza hasta Metro Oeste. Si pasas por SALIDA, cobra $200.', action: 'move', target: 35 },
  { text: 'Avanza hasta la casilla más cercana de Servicios. Si no está comprada, puedes comprarla.', action: 'nearest', type: 'utility' },
  { text: 'Avanza hasta la casilla más cercana de Metro. Si no está comprada, puedes comprarla.', action: 'nearest', type: 'railroad' },
  { text: 'El banco te devuelve $50 de impuestos.', action: 'money', amount: 50 },
  { text: 'Ganas un concurso de belleza arquitectónica. Cobra $10 de cada jugador.', action: 'collectEach', amount: 10 },
  { text: 'Sal de la Comisaría gratis. Guarda esta carta.', action: 'jailFree' },
  { text: '¡A la Comisaría! Ve directo sin pasar por SALIDA.', action: 'gotojail' },
  { text: 'Retrocede 3 casillas.', action: 'back', steps: 3 },
  { text: 'Eres presidente del consejo vecinal. Paga $50 a cada jugador.', action: 'payEach', amount: 50 },
  { text: 'Reparaciones urgentes: $25 por casa y $100 por hotel.', action: 'repairs', house: 25, hotel: 100 },
  { text: 'Multa por exceso de velocidad: paga $15.', action: 'money', amount: -15 },
  { text: 'Toma el tren hasta la siguiente estación de Metro.', action: 'nearest', type: 'railroad' },
];

export const FORTUNE_CARDS = [
  { text: 'Avanza hasta SALIDA. Cobra $200.', action: 'move', target: 0, collectGo: true },
  { text: 'Herencia inesperada. Cobra $200.', action: 'money', amount: 200 },
  { text: 'Dividendos de inversión. Cobra $50.', action: 'money', amount: 50 },
  { text: 'Cumpleaños del alcalde. Cobra $10 de cada jugador.', action: 'collectEach', amount: 10 },
  { text: 'Reembolso de impuestos. Cobra $20.', action: 'money', amount: 20 },
  { text: 'Seguro de vida. Cobra $100.', action: 'money', amount: 100 },
  { text: 'Ganas el segundo premio en un concurso. Cobra $25.', action: 'money', amount: 25 },
  { text: 'Vendes tu colección de sellos. Cobra $45.', action: 'money', amount: 45 },
  { text: 'Honorarios del hospital. Cobra $100.', action: 'money', amount: 100 },
  { text: 'Sal de la Comisaría gratis. Guarda esta carta.', action: 'jailFree' },
  { text: 'Paga reparación de calles: $40.', action: 'money', amount: -40 },
  { text: 'Multa de estacionamiento: $15.', action: 'money', amount: -15 },
  { text: 'Visita al médico: paga $50.', action: 'money', amount: -50 },
  { text: 'Matrícula universitaria: paga $50.', action: 'money', amount: -50 },
  { text: 'Reparaciones en tus propiedades: $25 por casa, $100 por hotel.', action: 'repairs', house: 25, hotel: 100 },
  { text: '¡A la Comisaría! Ve directo sin pasar por SALIDA.', action: 'gotojail' },
];

export function shuffleDeck(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
