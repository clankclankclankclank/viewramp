const csvAliases = {
  date: ['date', 'transactiondate', 'txndate', 'postingdate', 'posteddate', 'valuedate', 'bookingdate', 'completeddate', 'timestamp'],
  description: ['description', 'narration', 'merchant', 'payee', 'name', 'details', 'particulars', 'memo', 'remarks', 'transactiondescription'],
  category: ['category', 'label', 'classification', 'subcategory'],
  subcategory: ['subcategory', 'subgroup'],
  amount: ['amount', 'transactionamount', 'txnamount', 'signedamount', 'netamount', 'amountinr', 'amountrs'],
  debit: ['debit', 'debitamount', 'debitamt', 'withdrawal', 'withdrawalamount', 'withdrawalamt', 'moneyout', 'paidout', 'outflow', 'dr'],
  credit: ['credit', 'creditamount', 'creditamt', 'deposit', 'depositamount', 'depositamt', 'moneyin', 'paidin', 'inflow', 'cr'],
  direction: ['type', 'transactiontype', 'direction', 'drcr', 'crdr', 'debitcredit', 'creditdebit', 'amounttype'],
  currency: ['currency', 'currencycode', 'ccy']
};

function recordsFrom(source, separator) {
  const delimiter = separator === '\t' ? '\\t' : separator;
  const field = new RegExp('(?:"((?:[^"]|"")*)"|([^"' + delimiter + '\\n]*))([' + delimiter + '\\n]|$)', 'y');
  const records = [];
  let position = 0;
  let row = [];
  while (position < source.length || row.length) {
    field.lastIndex = position;
    const match = field.exec(source);
    if (!match) throw new Error('Invalid quoting near CSV record ' + (records.length + 1) + '.');
    position = field.lastIndex;
    row.push(match[1] === undefined ? match[2] : match[1].replace(/""/g, '"'));
    if (match[3] !== separator) {
      records.push(row);
      row = [];
    }
  }
  return records;
}

const currencyCodes = new Set(Intl.supportedValuesOf('currency'));
const currencySymbols = {'₹': 'INR', '€': 'EUR', '£': 'GBP', '$': 'USD', '¥': 'JPY', '₩': 'KRW'};
const currencyDigits = currency => new Intl.NumberFormat('en', {style: 'currency', currency}).resolvedOptions().maximumFractionDigits;

function currencyHint(value) {
  const code = value.trim().toUpperCase();
  if (currencyCodes.has(code)) return code;
  return currencySymbols[code] || (/^RS\.?$/.test(code) ? 'INR' : '');
}

function amountTokens(value) {
  return value.match(/[A-Z]{3}|₹|€|£|\$|¥|₩|\bRs\.?/gi) ?? [];
}

function chooseCurrency(rows, keys, headings, fallback) {
  const fields = [keys.amount, keys.debit, keys.credit].filter(index => index >= 0);
  const explicit = new Set();
  const symbols = new Set();
  for (const row of rows) {
    const raw = row[keys.currency]?.trim();
    if (raw) {
      const currency = currencyHint(raw);
      if (!currency) throw new Error('Unknown currency: ' + raw + '. Use a currency code such as USD.');
      explicit.add(currency);
    }
  }
  for (const index of fields) {
    const values = [headings[index], ...rows.map(row => row[index] ?? '')];
    for (const value of values) {
      for (const token of amountTokens(value)) {
        const currency = currencyHint(token);
        if (!currency) continue;
        if (token === '$' || token === '¥') symbols.add(token);
        else explicit.add(currency);
      }
    }
  }
  if (explicit.size > 1) throw new Error('This CSV contains mixed currencies. Import one currency per ledger.');
  const named = [...explicit][0];
  for (const symbol of symbols) {
    const supported = symbol === '$' ? ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'MXN'] : ['JPY', 'CNY'];
    if (!named || !supported.includes(named)) explicit.add(currencySymbols[symbol]);
  }
  if (explicit.size > 1) throw new Error('This CSV contains mixed currencies. Import one currency per ledger.');
  return [...explicit][0] || fallback;
}

function mapHeader(row) {
  const headers = row.map(value => value.replace(/(?:\s|\()([a-z]{3})\)?\s*$/i, (match, code) =>
    currencyCodes.has(code.toUpperCase()) ? '' : match
  ).toLowerCase().replace(/[^a-z0-9]/g, ''));
  return Object.fromEntries(Object.entries(csvAliases).map(([key, aliases]) => [
    key, aliases.map(alias => headers.indexOf(alias)).find(index => index >= 0) ?? -1
  ]));
}

function detectCsv(source, allowManual = false) {
  let manual;
  let best;
  for (const separator of [',', ';', '\t', '|']) {
    let records;
    try { records = recordsFrom(source, separator); } catch { continue; }
    for (const [index, row] of records.slice(0, 30).entries()) {
      if (allowManual && row.length >= 2 && row.every(value => value.trim()) && (!manual || row.length > manual.width)) {
        manual = {records: records.slice(index + 1), keys: mapHeader(row), index, width: row.length, headings: row};
      }
      const keys = mapHeader(row);
      if (keys.date < 0 || (keys.amount < 0 && keys.debit < 0 && keys.credit < 0)) continue;
      const score = Object.values(keys).filter(key => key >= 0).length;
      if (!best || score > best.score) best = { records: records.slice(index + 1), keys, index, score, width: row.length, headings: row };
      break;
    }
  }
  if (!best && manual) return manual;
  if (!best) throw new Error('Could not detect a CSV header. Include a date and an amount, or debit and credit columns. Check that quoted fields are closed.');
  return best;
}

function numericDate(value) {
  return /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(value);
}

function parseDate(value, monthFirst) {
  const iso = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[T ].*)?$/.exec(value);
  const numeric = numericDate(value);
  const named = /^(\d{1,2})[ .\/-]([a-z]{3,9})[ .\/-](\d{2}|\d{4})$/i.exec(value);
  let year, month, day;
  if (iso) [, year, month, day] = iso;
  else if (numeric) {
    const [, first, second, last] = numeric;
    [year, month, day] = monthFirst ? [last, first, second] : [last, second, first];
  } else if (named) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    [, day, month, year] = named;
    month = String(months.indexOf(month.toLowerCase().slice(0, 3)) + 1);
  } else return null;
  if (year.length === 2) year = '20' + year;
  const date = year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
  const normalized = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+normalized) && normalized.toISOString().slice(0, 10) === date ? date : null;
}

function parseMoney(input, currency = 'INR') {
  const digits = currencyDigits(currency);
  let value = input.trim().replace(/[A-Z]{3}|₹|€|£|\$|¥|₩|\bRs\.?/gi, token => currencyHint(token) ? '' : token).replace(/[\s\u00a0]/g, '');
  if (!value || /^[-–—]$/.test(value)) return null;
  const marker = /^(.*?)(CR|DR)$/i.exec(value);
  if (marker) value = marker[1];
  const parenthesized = /^\((.*)\)$/.exec(value);
  if (parenthesized) value = '-' + parenthesized[1];
  const parts = /^([+-]?)(\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.(\d{1,4}))?$/.exec(value);
  if (!parts || (parts[3]?.length ?? 0) > digits) throw new Error('use a valid ' + currency + ' amount');
  const [, sign, rupees, fraction = ''] = parts;
  const magnitude = Number(rupees.replaceAll(',', '') + fraction.padEnd(digits, '0'));
  if (!Number.isSafeInteger(magnitude)) throw new Error('amount exceeds the supported limit');
  if (sign === '-' && marker?.[2].toLowerCase() === 'cr') throw new Error('credit marker conflicts with the amount sign');
  return sign === '-' || marker?.[2].toLowerCase() === 'dr' ? -magnitude : magnitude;
}

function guessCategory(description, amount) {
  if (amount > 0) return 'Income';
  const rules = [
    ['Housing', /\b(rent|landlord|mortgage)\b/i],
    ['Groceries', /\b(grocer(?:y|ies)|supermarket|bigbasket|blinkit|zepto)\b/i],
    ['Transport', /\b(uber|ola|metro|train|fuel|parking|bus)\b/i],
    ['Utilities', /\b(internet|broadband|electricity|water bill|airtel|jio)\b/i],
    ['Dining', /\b(cafe|coffee|restaurant|zomato|swiggy)\b/i]
  ];
  return rules.find(([, pattern]) => pattern.test(description))?.[0] ?? 'Uncategorized';
}

function parseCsv(source, fallback = 'INR', layout) {
  const { records, keys, index, width, headings } = layout ?? inspectCsv(source);
  if (keys.date < 0 || (keys.amount < 0 && keys.debit < 0 && keys.credit < 0)) {
    throw new Error('Choose a date column and at least one amount, debit, or credit column.');
  }
  const rows = records.filter(row => row.some(value => value.trim()));
  if (!rows.length) throw new Error('The CSV has no transactions.');
  const currency = chooseCurrency(rows, keys, headings, fallback);
  const numericDates = rows.map(row => numericDate(row[keys.date]?.trim() ?? '')).filter(Boolean);
  const dmy = numericDates.some(([, first]) => Number(first) > 12);
  const mdy = numericDates.some(([, , second]) => Number(second) > 12);
  if (dmy && mdy) throw new Error('Mixed day-first and month-first dates. Convert dates to YYYY-MM-DD.');

  let knownTotal = 0;
  let inferred = 0;
  const split = keys.debit >= 0 || keys.credit >= 0;
  const transactions = rows.map((row, rowIndex) => {
    const get = key => row[keys[key]]?.trim() ?? '';
    try {
      if (row.length > width) throw new Error('more fields than the header; quote amounts or descriptions containing delimiters');
      const date = parseDate(get('date'), mdy);
      if (!date) throw new Error('use a valid transaction date');
      const description = get('description') || 'Transaction';
      let amount;
      if (split) {
        const debit = parseMoney(get('debit'), currency);
        const credit = parseMoney(get('credit'), currency);
        if (debit && credit) throw new Error('enter either a debit or a credit');
        if (debit !== null || credit !== null) amount = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
      }
      if (amount === undefined) {
        amount = parseMoney(get('amount'), currency);
        if (amount === null) throw new Error('missing transaction amount');
        const direction = get('direction').toLowerCase();
        if (/^(debit|dr|expense|outflow|withdrawal|money out|payment)$/.test(direction)) amount = -Math.abs(amount);
        else if (/^(credit|cr|income|inflow|deposit|money in|refund)$/.test(direction)) {
          if (amount < 0) throw new Error('credit type conflicts with the amount sign');
        } else if (direction && amount > 0) throw new Error('unrecognized transaction type: ' + direction);
      }
      knownTotal += Math.abs(amount);
      if (!Number.isSafeInteger(knownTotal)) throw new Error('total exceeds the supported limit');
      const category = get('category');
      const suggested = category || guessCategory(description, amount);
      if (!category && suggested !== 'Uncategorized') inferred++;
      return { date, month: date.slice(0, 7), description, category: suggested, subcategory: keys.subcategory === keys.category ? '' : get('subcategory'), amount };
    } catch (error) {
      throw new Error('Transaction ' + (rowIndex + 1) + ': ' + error.message + '.');
    }
  }).sort((a, b) => b.date.localeCompare(a.date));

  return {
    transactions,
    currency,
    inferred,
    format: split ? 'Debit / credit' : keys.direction >= 0 ? 'Amount + type' : 'Signed amount',
    assumedDayFirst: numericDates.length > 0 && !dmy && !mdy,
    headerRecord: index + 1
  };
}

function inspectCsv(source, allowManual = false) {
  return detectCsv(source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), allowManual);
}
