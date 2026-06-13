const STORAGE_KEY = 'imperio-urbano-sounds';

let audioCtx = null;
let enabled = localStorage.getItem(STORAGE_KEY) !== '0';

function ensureContext() {
  if (!enabled) return null;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone({
  frequency,
  duration = 0.1,
  type = 'sine',
  volume = 0.1,
  slideTo = null,
  delay = 0,
}) {
  const ctx = ensureContext();
  if (!ctx) return;

  const start = ctx.currentTime + delay;
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();

  gain.connect(ctx.destination);
  osc.connect(gain);
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 40), start + duration);
  }

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function playNoise(duration = 0.3, volume = 0.06, filterFreq = 1400) {
  const ctx = ensureContext();
  if (!ctx) return;

  const start = ctx.currentTime;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    const fade = 1 - i / bufferSize;
    data[i] = (Math.random() * 2 - 1) * fade;
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(start);
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(value) {
  enabled = value;
  localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
}

export function toggleSound() {
  setSoundEnabled(!enabled);
  return enabled;
}

export function unlockAudio() {
  ensureContext();
}

export function playDiceRoll() {
  playNoise(0.38, 0.07, 1800);
  playTone({ frequency: 920, slideTo: 520, duration: 0.09, type: 'square', volume: 0.025, delay: 0.04 });
  playTone({ frequency: 780, slideTo: 420, duration: 0.08, type: 'square', volume: 0.02, delay: 0.12 });
}

export function playDiceLand() {
  playTone({ frequency: 220, slideTo: 95, duration: 0.14, type: 'sine', volume: 0.11 });
  playTone({ frequency: 480, slideTo: 200, duration: 0.06, type: 'triangle', volume: 0.04, delay: 0.02 });
}

export function playTokenStep() {
  playTone({ frequency: 560, slideTo: 320, duration: 0.07, type: 'triangle', volume: 0.09 });
}

export function playCard(deckName = 'city') {
  const isChance = deckName === 'city';
  playTone({
    frequency: isChance ? 620 : 520,
    slideTo: isChance ? 880 : 740,
    duration: 0.16,
    type: 'sine',
    volume: 0.09,
  });
  playTone({
    frequency: isChance ? 280 : 240,
    duration: 0.1,
    type: 'triangle',
    volume: 0.045,
    delay: 0.05,
  });
}
