// Technical indicators for the Research chart. Pure functions over plain arrays, so they're
// unit-tested in node (test/unit.test.js). Every output has the input's length, with null where
// there isn't enough history yet. Bars are { time, open, high, low, close, volume, date }.

export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    count++;
    if (count > n) { sum -= values[i - n]; count--; }
    if (count === n) out[i] = sum / n;
  }
  return out;
}

// Seeded with the simple average of the first n values (the usual convention).
export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let prev = values.slice(0, n).reduce((s, v) => s + v, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function bollinger(values, n = 20, k = 2) {
  const mid = sma(values, n);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    const m = mid[i];
    let ss = 0;
    for (let j = i - n + 1; j <= i; j++) ss += (values[j] - m) ** 2;
    const sd = Math.sqrt(ss / n); // population sd, as Bollinger defined it
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return { mid, upper, lower };
}

// Wilder's RSI.
export function rsi(values, n = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = val();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signalN = 9) {
  const ef = ema(values, fast), es = ema(values, slow);
  const line = values.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const start = line.findIndex((v) => v != null);
  const signal = new Array(values.length).fill(null);
  if (start >= 0) {
    const sig = ema(line.slice(start), signalN);
    sig.forEach((v, i) => { signal[start + i] = v; });
  }
  const hist = line.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { macd: line, signal, hist };
}

// Wilder's average true range.
export function atr(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  const tr = bars.map((b, i) => {
    const prev = i ? bars[i - 1].close : b.close;
    return Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
  });
  if (bars.length < n) return out;
  let a = tr.slice(0, n).reduce((s, v) => s + v, 0) / n;
  out[n - 1] = a;
  for (let i = n; i < bars.length; i++) {
    a = (a * (n - 1) + tr[i]) / n;
    out[i] = a;
  }
  return out;
}

// Volume-weighted average price, restarting each trading day (intraday bars only).
export function vwap(bars) {
  const out = new Array(bars.length).fill(null);
  let day = null, pv = 0, vol = 0;
  bars.forEach((b, i) => {
    if (b.date !== day) { day = b.date; pv = 0; vol = 0; }
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * (b.volume || 0);
    vol += b.volume || 0;
    out[i] = vol ? pv / vol : typical;
  });
  return out;
}

export function heikinAshi(bars) {
  const out = [];
  bars.forEach((b, i) => {
    const close = (b.open + b.high + b.low + b.close) / 4;
    const open = i ? (out[i - 1].open + out[i - 1].close) / 2 : (b.open + b.close) / 2;
    out.push({ ...b, open, close, high: Math.max(b.high, open, close), low: Math.min(b.low, open, close) });
  });
  return out;
}

// What the chart's indicator menu offers. `pane: "price"` overlays the price; "own" gets its
// own pane below. `short` is the chip name, `group` and `description` drive the picker, and
// `glossary` is the key in public/glossary.js.
export const INDICATORS = {
  sma: { label: "Moving average (SMA)", short: "SMA", group: "Trend", glossary: "sma", description: "Average closing price over the last N bars. Smooths out the noise.", pane: "price", params: [{ key: "n", label: "Length", def: 50, min: 2, max: 400 }] },
  ema: { label: "Exponential moving average (EMA)", short: "EMA", group: "Trend", glossary: "ema", description: "A moving average that weights recent closes more, so it turns sooner.", pane: "price", params: [{ key: "n", label: "Length", def: 21, min: 2, max: 400 }] },
  bb: { label: "Bollinger Bands", short: "BB", group: "Trend", glossary: "bollinger", description: "A 20-bar average with bands 2 standard deviations above and below.", pane: "price", params: [{ key: "n", label: "Length", def: 20, min: 2, max: 200 }, { key: "k", label: "Std devs", def: 2, min: 0.5, max: 4, step: 0.5 }] },
  vwap: { label: "VWAP (intraday)", short: "VWAP", group: "Trend", glossary: "vwap", description: "Average price weighted by volume, restarting each day. Shows on 1D and 5D.", pane: "price", params: [] },
  vol: { label: "Volume", short: "Volume", group: "Volume", glossary: "volume", description: "Shares traded in each bar, green when the close was up, red when down.", pane: "own", params: [] },
  rsi: { label: "RSI", short: "RSI", group: "Momentum", glossary: "rsi", description: "Momentum from 0 to 100; above 70 often called overbought, below 30 oversold.", pane: "own", params: [{ key: "n", label: "Length", def: 14, min: 2, max: 100 }] },
  macd: { label: "MACD", short: "MACD", group: "Momentum", glossary: "macd", description: "Gap between the 12 and 26 bar EMAs, with a 9 bar signal line.", pane: "own", params: [{ key: "fast", label: "Fast", def: 12, min: 2, max: 100 }, { key: "slow", label: "Slow", def: 26, min: 3, max: 200 }, { key: "signal", label: "Signal", def: 9, min: 2, max: 50 }] },
  atr: { label: "Average true range (ATR)", short: "ATR", group: "Volatility", glossary: "atr", description: "Average size of each bar's full range. How much the price moves, not which way.", pane: "own", params: [{ key: "n", label: "Length", def: 14, min: 2, max: 100 }] },
};
