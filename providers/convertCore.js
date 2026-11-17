// Unit and currency conversion, pure logic (no Shell imports):
//   gjs -m tests/test_convert_core.js
// "10 km to mi", "70 f in c", "2 GiB to MB", "100 usd to inr", "₹500 to $".

// factor = how many base units one unit is. Aliases are matched exactly
// first (so "MB" ≠ "Mb"), then lowercased.
const UNIT_TABLE = {
  length: {
    base: 'm',
    units: {
      mm: [0.001, 'mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres'],
      cm: [0.01, 'cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres'],
      m: [1, 'm', 'meter', 'meters', 'metre', 'metres'],
      km: [1000, 'km', 'kilometer', 'kilometers', 'kilometre', 'kilometres'],
      in: [0.0254, 'in', 'inch', 'inches', '"'],
      ft: [0.3048, 'ft', 'foot', 'feet', "'"],
      yd: [0.9144, 'yd', 'yard', 'yards'],
      mi: [1609.344, 'mi', 'mile', 'miles'],
      nmi: [1852, 'nmi', 'nautical mile', 'nautical miles'],
    },
  },
  mass: {
    base: 'kg',
    units: {
      mg: [1e-6, 'mg', 'milligram', 'milligrams'],
      g: [0.001, 'g', 'gram', 'grams', 'gm'],
      kg: [1, 'kg', 'kilogram', 'kilograms', 'kilo', 'kilos'],
      t: [1000, 't', 'tonne', 'tonnes', 'ton', 'tons'],
      oz: [0.028349523125, 'oz', 'ounce', 'ounces'],
      lb: [0.45359237, 'lb', 'lbs', 'pound', 'pounds'],
      st: [6.35029318, 'st', 'stone', 'stones'],
    },
  },
  volume: {
    base: 'l',
    units: {
      ml: [0.001, 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
      l: [1, 'l', 'liter', 'liters', 'litre', 'litres'],
      m3: [1000, 'm3', 'm³', 'cubic meter', 'cubic meters'],
      tsp: [0.00492892159375, 'tsp', 'teaspoon', 'teaspoons'],
      tbsp: [0.01478676478125, 'tbsp', 'tablespoon', 'tablespoons'],
      floz: [0.0295735295625, 'floz', 'fl oz', 'fluid ounce', 'fluid ounces'],
      cup: [0.2365882365, 'cup', 'cups'],
      pt: [0.473176473, 'pt', 'pint', 'pints'],
      qt: [0.946352946, 'qt', 'quart', 'quarts'],
      gal: [3.785411784, 'gal', 'gallon', 'gallons'],
    },
  },
  area: {
    base: 'm2',
    units: {
      cm2: [1e-4, 'cm2', 'cm²', 'square centimeter', 'square centimeters'],
      m2: [1, 'm2', 'm²', 'sqm', 'square meter', 'square meters'],
      km2: [1e6, 'km2', 'km²', 'square kilometer', 'square kilometers'],
      ft2: [0.09290304, 'ft2', 'ft²', 'sqft', 'square foot', 'square feet'],
      ha: [1e4, 'ha', 'hectare', 'hectares'],
      acre: [4046.8564224, 'acre', 'acres', 'ac'],
      mi2: [2589988.110336, 'mi2', 'mi²', 'sqmi', 'square mile', 'square miles'],
    },
  },
  speed: {
    base: 'm/s',
    units: {
      'm/s': [1, 'm/s', 'mps'],
      'km/h': [1 / 3.6, 'km/h', 'kmh', 'kph', 'kmph'],
      mph: [0.44704, 'mph', 'mi/h'],
      kn: [0.514444, 'kn', 'knot', 'knots'],
      'ft/s': [0.3048, 'ft/s', 'fps'],
    },
  },
  time: {
    base: 's',
    units: {
      ms: [0.001, 'ms', 'millisecond', 'milliseconds'],
      s: [1, 's', 'sec', 'secs', 'second', 'seconds'],
      min: [60, 'min', 'mins', 'minute', 'minutes'],
      h: [3600, 'h', 'hr', 'hrs', 'hour', 'hours'],
      day: [86400, 'd', 'day', 'days'],
      week: [604800, 'wk', 'week', 'weeks'],
      year: [31557600, 'y', 'yr', 'year', 'years'],
    },
  },
  data: {
    base: 'B',
    units: {
      bit: [0.125, 'bit', 'bits'],
      B: [1, 'B', 'byte', 'bytes'],
      KB: [1e3, 'KB', 'kB', 'kilobyte', 'kilobytes'],
      MB: [1e6, 'MB', 'megabyte', 'megabytes'],
      GB: [1e9, 'GB', 'gigabyte', 'gigabytes'],
      TB: [1e12, 'TB', 'terabyte', 'terabytes'],
      KiB: [1024, 'KiB', 'kibibyte', 'kibibytes'],
      MiB: [1048576, 'MiB', 'mebibyte', 'mebibytes'],
      GiB: [1073741824, 'GiB', 'gibibyte', 'gibibytes'],
      TiB: [1099511627776, 'TiB', 'tebibyte', 'tebibytes'],
      Mbit: [125000, 'Mbit', 'Mbps', 'megabit', 'megabits'],
      Gbit: [125000000, 'Gbit', 'Gbps', 'gigabit', 'gigabits'],
    },
  },
};

const TEMPERATURE = {
  C: ['c', '°c', 'celsius', 'centigrade'],
  F: ['f', '°f', 'fahrenheit'],
  K: ['k', 'kelvin', 'kelvins'],
};

const CURRENCY_ALIASES = {
  $: 'USD', dollar: 'USD', dollars: 'USD', usd: 'USD',
  '€': 'EUR', euro: 'EUR', euros: 'EUR',
  '£': 'GBP', pound: 'GBP', pounds: 'GBP', quid: 'GBP',
  '₹': 'INR', rupee: 'INR', rupees: 'INR', rs: 'INR',
  '¥': 'JPY', yen: 'JPY',
  '₩': 'KRW', won: 'KRW',
  '₽': 'RUB', ruble: 'RUB', rubles: 'RUB',
  '₺': 'TRY', lira: 'TRY',
  '฿': 'THB', baht: 'THB',
  yuan: 'CNY', rmb: 'CNY',
  dirham: 'AED', dirhams: 'AED',
};

// Exact-case alias → [category, unit], then a lowercase fallback map.
const EXACT = new Map();
const LOWER = new Map();
for (const [category, { units }] of Object.entries(UNIT_TABLE)) {
  for (const [unit, [, ...aliases]] of Object.entries(units)) {
    for (const a of aliases) {
      EXACT.set(a, [category, unit]);
      // Lowercase fallback, but never let bits and bytes collide: "mb" means
      // megabytes, the more common intent.
      if (!LOWER.has(a.toLowerCase())) LOWER.set(a.toLowerCase(), [category, unit]);
    }
  }
}

export function findUnit(name) {
  const n = name.trim().replace(/\s+/g, ' ');
  for (const [unit, aliases] of Object.entries(TEMPERATURE)) {
    if (aliases.includes(n.toLowerCase()) || n === `°${unit}`) return ['temperature', unit];
  }
  return EXACT.get(n) ?? LOWER.get(n.toLowerCase()) ?? null;
}

/** ISO code ("INR") for a currency name, symbol or code, else null. */
export function findCurrency(name, rates) {
  const n = name.trim().toLowerCase();
  const code = CURRENCY_ALIASES[n] ?? CURRENCY_ALIASES[name.trim()] ?? n.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  // Without rates yet, only recognize codes we know by alias or common ones.
  if (rates) return code in rates ? code : null;
  return Object.values(CURRENCY_ALIASES).includes(code) ? code : null;
}

// The trailing space is a lookahead, so "12 in to cm" also finds " to".
const SEPARATOR_RE = /\s+(?:to|in|into|as|->|=)(?=\s)/gi;
const NUMBER_RE = /^[-+]?(?:\d[\d,]*(?:\.\d+)?|\d+,\d+|\.\d+)$/;

function parseAmountAndUnit(left) {
  // "10 km", "10km", "1,000.5 usd" — or "$10", "rs 500"
  const numFirst = /^([-+]?[\d.,]+)\s*(\D.*)$/.exec(left);
  const numLast = /^(\D+?)\s*([-+]?[\d.,]+)$/.exec(left);
  let amountText; let unit;
  if (numFirst) [, amountText, unit] = numFirst;
  else if (numLast) [, unit, amountText] = numLast;
  else return null;
  if (!NUMBER_RE.test(amountText)) return null;
  // "1,000.5": commas group thousands; a lone comma ("2,5") is a decimal point.
  const normalized = amountText.includes('.') || /,\d{3}(?!\d)/.test(amountText)
    ? amountText.replace(/,/g, '')
    : amountText.replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? { amount, unit: unit.trim() } : null;
}

/**
 * Split "10 km to mi" / "₹500 in usd" into {amount, from, to} (unit names as
 * typed), or null. The amount may come before or after the from-unit. "in" is
 * both a unit (inch) and a separator, so every separator position is tried:
 * "12 in to cm" splits at "to".
 */
export function parseConversion(text) {
  const t = (text ?? '').trim();
  for (const sep of t.matchAll(SEPARATOR_RE)) {
    const left = t.slice(0, sep.index).trim();
    const to = t.slice(sep.index + sep[0].length).trim();
    const parsed = left && to ? parseAmountAndUnit(left) : null;
    if (parsed?.unit) return { amount: parsed.amount, from: parsed.unit, to };
  }
  return null;
}

function convertTemperature(v, from, to) {
  const c = from === 'C' ? v : from === 'F' ? (v - 32) * 5 / 9 : v - 273.15;
  return to === 'C' ? c : to === 'F' ? c * 9 / 5 + 32 : c + 273.15;
}

/** Up to 6 significant digits, grouped, no exponent for normal ranges. */
export function formatNumber(x, maxFraction = null) {
  if (!Number.isFinite(x)) return String(x);
  const abs = Math.abs(x);
  if (abs !== 0 && (abs < 1e-6 || abs >= 1e15)) return x.toPrecision(6);
  return x.toLocaleString('en-US', maxFraction === null
    ? { maximumSignificantDigits: 6 }
    : { minimumFractionDigits: maxFraction, maximumFractionDigits: maxFraction });
}

/**
 * Unit conversion for the text, or null.
 * @returns {{category, from, to, amount, value, text}}
 */
export function convertUnits(text) {
  const p = parseConversion(text);
  if (!p) return null;
  const a = findUnit(p.from);
  const b = findUnit(p.to);
  if (!a || !b || a[0] !== b[0]) return null;
  const [category, fromUnit] = a;
  const [, toUnit] = b;
  let value;
  if (category === 'temperature') {
    value = convertTemperature(p.amount, fromUnit, toUnit);
  } else {
    const units = UNIT_TABLE[category].units;
    value = p.amount * units[fromUnit][0] / units[toUnit][0];
  }
  // °C and °F, but kelvin is plain K (SI).
  const sym = (u) => (category === 'temperature' && u !== 'K' ? `°${u}` : u);
  return {
    category, from: fromUnit, to: toUnit, amount: p.amount, value,
    text: `${formatNumber(p.amount)} ${sym(fromUnit)} = ${formatNumber(value)} ${sym(toUnit)}`,
    copy: String(Number(value.toPrecision(10))),
  };
}

/**
 * Currency conversion for the text, or null when it is not one.
 * @param {object|null} rates - {CODE: units per 1 USD} or null (not loaded)
 * @returns {{from, to, amount, value?, text, pending?}} pending = recognized
 *   but no rates yet
 */
export function convertCurrency(text, rates) {
  const p = parseConversion(text);
  if (!p) return null;
  const from = findCurrency(p.from, rates);
  const to = findCurrency(p.to, rates);
  if (!from || !to) return null;
  if (!rates) return { from, to, amount: p.amount, pending: true, text: 'Fetching exchange rates…' };
  const value = p.amount / rates[from] * rates[to];
  return {
    from, to, amount: p.amount, value,
    text: `${formatNumber(p.amount, 2)} ${from} = ${formatNumber(value, 2)} ${to}`,
    copy: value.toFixed(2),
  };
}
