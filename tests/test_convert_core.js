// Unit tests for providers/convertCore.js. Run: gjs -m tests/test_convert_core.js
import {
  parseConversion, convertUnits, convertCurrency, findUnit, findCurrency, formatNumber,
} from '../providers/convertCore.js';
import System from 'system';

let failed = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) print(`ok   ${name}`);
  else { failed++; print(`FAIL ${name}\n     got      ${a}\n     expected ${e}`); }
}
const u = (t) => convertUnits(t)?.text ?? null;

// parsing
eq('parse 10 km to mi', parseConversion('10 km to mi'), { amount: 10, from: 'km', to: 'mi' });
eq('parse no space, "in"', parseConversion('10km in m'), { amount: 10, from: 'km', to: 'm' });
eq('parse symbol first', parseConversion('₹500 to usd'), { amount: 500, from: '₹', to: 'usd' });
eq('parse grouping', parseConversion('1,000.5 usd to inr').amount, 1000.5);
eq('parse thousands comma', parseConversion('1,000 usd to inr').amount, 1000);
eq('parse decimal comma', parseConversion('2,5 kg to lb').amount, 2.5);
eq('parse multi-word unit', parseConversion('3 nautical miles to km'), { amount: 3, from: 'nautical miles', to: 'km' });
eq('not a conversion', [parseConversion('go to market'), parseConversion('10 km'), parseConversion('how to cook')], [null, null, null]);

// units
eq('km → mi', u('10 km to mi'), '10 km = 6.21371 mi');
eq('long names', u('5 kilometers in meters'), '5 km = 5,000 m');
eq('inch → cm', u('12 in to cm'), '12 in = 30.48 cm');
eq('kg → lb', u('70 kg to lbs'), '70 kg = 154.324 lb');
eq('temperature f → c', u('98.6 f to c'), '98.6 °F = 37 °C');
eq('temperature c → k', u('0 celsius in kelvin'), '0 °C = 273.15 K');
eq('negative temperature', u('-40 c to f'), '-40 °C = -40 °F');
eq('data GiB → MB (case matters)', u('2 GiB to MB'), '2 GiB = 2,147.48 MB');
eq('lowercase mb = megabytes', u('1 gb to mb'), '1 GB = 1,000 MB');
eq('bits', u('100 Mbps to MB'), '100 Mbit = 12.5 MB');
eq('speed', u('100 km/h to mph'), '100 km/h = 62.1371 mph');
eq('time', u('90 min to h'), '90 min = 1.5 h');
eq('area', u('1 acre to m2'), '1 acre = 4,046.86 m2');
eq('volume', u('1 gal to l'), '1 gal = 3.78541 l');
eq('different categories: none', u('10 km to kg'), null);
eq('unknown unit: none', u('10 parsecs to km'), null);
eq('copy value', convertUnits('10 km to mi').copy, '6.213711922');
eq('findUnit', [findUnit('Feet'), findUnit('°C'), findUnit('nope')], [['length', 'ft'], ['temperature', 'C'], null]);

// currency
const rates = { USD: 1, INR: 83, EUR: 0.9, JPY: 150 };
const c = (t, r = rates) => convertCurrency(t, r)?.text ?? null;
eq('usd → inr', c('100 usd to inr'), '100.00 USD = 8,300.00 INR');
eq('symbols', c('₹830 to $'), '830.00 INR = 10.00 USD');
eq('names', c('50 euros in dollars'), '50.00 EUR = 55.56 USD');
eq('cross rate', c('1000 yen to inr'), '1,000.00 JPY = 553.33 INR');
eq('unknown code with rates', c('10 xyz to usd'), null);
eq('no rates yet: pending for known currencies', convertCurrency('10 usd to inr', null).pending, true);
eq('no rates yet: unknown codes ignored', convertCurrency('10 abc to def', null), null);
eq('units are not currencies', c('10 km to mi'), null);
eq('copy value', convertCurrency('100 usd to inr', rates).copy, '8300.00');
eq('findCurrency', [findCurrency('rupees', rates), findCurrency('£', null), findCurrency('km', rates)], ['INR', 'GBP', null]);
eq('formatNumber', [formatNumber(1234567.891), formatNumber(0.000123456789), formatNumber(1e20)], ['1,234,570', '0.000123457', '1.00000e+20']);

print(failed ? `\n${failed} failed` : '\nall passed');
System.exit(failed ? 1 : 0);
