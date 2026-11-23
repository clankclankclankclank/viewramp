const offerUndo = createFuseUndo();
function rememberViewramp() {
  const previous = structuredClone({datasets, notes: [...annotations]});
  return () => {
    ++importVersion;
    Object.assign(datasets, previous.datasets);
    annotations.clear();
    for (const [name, notes] of previous.notes) annotations.set(name, notes);
    saveNotes();
    $('import-progress').hidden = true;
    renderOverview();
    setCurveMenus();
    $('status').textContent = 'Change undone.';
  };
}
const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('en', {maximumFractionDigits: 2});
const format = value => value == null ? '—' : number.format(value);
const norm = value => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const datasets = {videos: [], daily: [], curves: new Map(), total: null};
const noteKey = 'viewramp-notes-v1';
const annotations = new Map();
try {
  for (const [name, notes] of JSON.parse(localStorage.getItem(noteKey) ?? '[]')) annotations.set(name, notes);
} catch { /* Notes are optional when storage is unavailable. */ }
function saveNotes() {
  try { localStorage.setItem(noteKey, JSON.stringify([...annotations])); } catch { /* Keep notes for this session. */ }
}
let importVersion = 0;

function parseExport(text, name) {
  const [heading, ...body] = recordsFrom(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), ',');
  if (!heading) throw new Error('Empty CSV.');
  const keys = heading.map(norm);
  const retention = keys.find(key => /^(audienceretention|retention|audiencewatchratio|absoluteaudienceretention)(percent)?$/.test(key));
  const timestamp = keys.find(key => /^(time|timestamp|elapsedtime|elapsedseconds|timeseconds|elapsedtimeseconds)$/.test(key));
  const get = (row, key) => (row[keys.indexOf(key)] ?? '').trim();
  const readNumber = (row, key) => {
    const value = get(row, key).replace(/[, %]/g, '');
    return value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  };
  const rows = body.filter(row => row.some(value => value.trim()));
  if (!rows.length) throw new Error('Header only. No data rows to load.');
  if (retention && timestamp) {
    const points = rows.map(row => {
      const time = get(row, timestamp);
      const seconds = time.includes(':') && /^\d+(?::\d{2}){1,2}(?:\.\d+)?$/.test(time)
        ? time.split(':').reduce((sum, part) => sum * 60 + Number(part), 0)
        : /^\d+(?:\.\d+)?$/.test(time) ? Number(time) : NaN;
      let percent = readNumber(row, retention);
      if (percent != null && retention === 'audiencewatchratio') percent *= 100;
      if (!Number.isFinite(seconds) || percent == null || percent < 0) throw new Error('Retention rows need a valid timestamp and percentage.');
      return {seconds, percent};
    }).sort((a, b) => a.seconds - b.seconds);
    return {curve: {name: name.replace(/\.csv$/i, ''), points}};
  }
  if (keys.includes('videotitle') && keys.includes('watchtimehours')) {
    let total = null;
    const videos = [];
    for (const row of rows) {
      const views = readNumber(row, 'views');
      const hours = readNumber(row, 'watchtimehours');
      const length = readNumber(row, 'duration');
      const published = get(row, 'videopublishtime') || get(row, 'publishdate');
      const entry = {length, published: parseDate(published, false) || parseDate(published.replace(/^([a-z]+) (\d{1,2}), (\d{4})$/i, '$2 $1 $3'), false) || '', title: get(row, 'videotitle'), views, hours, subs: readNumber(row, 'subscribers'),
        impressions: readNumber(row, 'thumbnailimpressions'), ctr: readNumber(row, 'thumbnailclickthroughrate'),
        viewed: views > 0 && length > 0 && hours != null ? hours * 3600 / views / length * 100 : null};
      entry.conversion = views > 0 && entry.subs != null ? 1000 * entry.subs / views : null;
      const time = /(?:T| )([01]\d|2[0-3]):[0-5]\d/.exec(published);
      const zoned = time && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(published) ? new Date(published) : null;
      entry.publishHour = zoned && Number.isFinite(+zoned) ? zoned.getUTCHours() : time ? Number(time[1]) : null;
      entry.publishDay = zoned && Number.isFinite(+zoned) ? zoned.getUTCDay()
        : entry.published ? new Date(entry.published + 'T00:00:00Z').getUTCDay() : null;
      if (get(row, 'content').toLowerCase() === 'total') total = entry;
      else if (entry.title) videos.push(entry);
    }
    return {videos, total};
  }
  if (keys.includes('date') && keys.includes('views')) {
    const daily = rows.map(row => ({date: get(row, 'date'), views: readNumber(row, 'views')}));
    if (daily.some(row => !parseDate(row.date, false) || row.views == null || row.views < 0)) throw new Error('Daily views need valid dates and view counts.');
    daily.sort((a,b) => a.date.localeCompare(b.date));
    return {daily};
  }
  throw new Error('Unrecognized YouTube CSV format.');
}

function element(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}

function renderVideos() {
  const query = $('search').value.toLowerCase().trim();
  const key = $('sort').value;
  const length = $('video-length').value;
  const from = $('published-from').value;
  const to = $('published-to').value;
  const rows = datasets.videos.filter(video => {
    const band = video.length == null ? '' : video.length <= 60 ? 'short' : video.length <= 300 ? 'medium' : 'long';
    return video.title.toLowerCase().includes(query) && (!length || band === length) &&
      (!from || (video.published && video.published >= from)) && (!to || (video.published && video.published <= to));
  })
    .sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));
  for (const [index, id] of ['compare-a', 'compare-b'].entries()) {
    const select = $(id);
    const previous = Number(select.value);
    const wasSelected = select.selectedIndex !== -1;
    select.replaceChildren(...rows.map(video => new Option(video.title, datasets.videos.indexOf(video))));
    const retained = wasSelected ? rows.indexOf(datasets.videos[previous]) : -1;
    select.selectedIndex = retained >= 0 ? retained : Math.min(index, rows.length - 1);
  }
  if (rows.length > 1 && $('compare-a').value === $('compare-b').value) {
    $('compare-b').selectedIndex = $('compare-a').selectedIndex === 0 ? 1 : 0;
  }
  renderComparison();
  renderPublishing(rows);
  if (!rows.length) {
    const row = element('tr');
    const message = element('td', 'No videos match these filters.');
    message.colSpan = 7;
    row.append(message);
    $('videos').replaceChildren(row);
    return;
  }
  $('videos').replaceChildren(...rows.map(video => {
    const row = element('tr');
    for (const val of [video.title, format(video.views), format(video.hours) + (video.hours == null ? '' : ' h'),
      video.viewed == null ? '—' : format(video.viewed) + '%', video.ctr == null ? '—' : format(video.ctr) + '%', format(video.subs), format(video.conversion)]) row.append(element('td', val));
    return row;
  }));
}

function renderPublishing(rows) {
  const groups = Array.from({length: 7}, () => Array.from({length: 25}, () => ({sum:0, count:0})));
  for (const video of rows) {
    if (video.publishDay == null || video.views == null) continue;
    const cell = groups[video.publishDay][video.publishHour ?? 24];
    cell.sum += video.views;
    cell.count++;
  }
  const target = $('publishing-heatmap');
  const hours = Array.from({length:25}, (_, hour) => hour)
    .filter(hour => groups.some(day => day[hour].count));
  if (!hours.length) target.textContent = 'No upload dates with views in this selection.';
  else {
    const table = element('table');
    const heading = table.createTHead().insertRow();
    for (const text of ['Day', ...hours.map(hour => hour === 24 ? 'Date only' : String(hour).padStart(2,'0') + ':00')]) {
      const cell = element('th', text); cell.scope = 'col'; heading.append(cell);
    }
    const body = table.createTBody();
    const maximum = Math.max(1, ...groups.flat().map(cell => cell.count ? cell.sum / cell.count : 0));
    for (const [day, name] of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].entries()) {
      const row = body.insertRow();
      const header = element('th', name); header.scope = 'row'; row.append(header);
      for (const hour of hours) {
        const {sum, count} = groups[day][hour];
        const cell = row.insertCell();
        cell.textContent = count ? format(sum / count) : '—';
        if (count) {
          cell.style.backgroundColor = 'rgba(255, 105, 98, ' + (.08 + .28 * sum / count / maximum) + ')';
          cell.title = count + (count === 1 ? ' video' : ' videos');
        }
      }
    }
    target.replaceChildren(table);
  }
  const counted = rows.filter(video => video.views != null).sort((a,b) => a.views - b.views);
  const list = $('video-outliers');
  list.replaceChildren();
  if (counted.length < 5) {
    $('outlier-summary').textContent = 'At least five videos with views are needed.';
    return;
  }
  const quantile = fraction => {
    const index = (counted.length - 1) * fraction;
    const low = Math.floor(index);
    return counted[low].views + (index - low) * (counted[Math.ceil(index)].views - counted[low].views);
  };
  const upper = quantile(.75);
  const threshold = upper + 1.5 * (upper - quantile(.25));
  const outliers = counted.filter(video => video.views > threshold).reverse();
  $('outlier-summary').textContent = (outliers.length ? 'Flagged above ' : 'No videos above ') + format(threshold) + ' views in this selection.';
  list.append(...outliers.map(video => element('li', video.title + ' · ' + format(video.views) + ' views')));
}

function renderComparison() {
  const table = element('table');
  const a = datasets.videos[$('compare-a').value];
  const b = datasets.videos[$('compare-b').value];
  const target = $('comparison');
  if (!a || !b || a === b) {
    target.textContent = 'Choose two different videos to compare.';
    return;
  }
  const head = table.createTHead().insertRow();
  for (const label of ['Metric', a.title, b.title, 'Change (second − first)']) {
    const th = element('th', label);
    th.scope = 'col';
    head.append(th);
  }
  const body = table.createTBody();
  for (const [key, label, suffix, unit] of [
    ['length', 'Duration', ' s'], ['views', 'Views', ''], ['hours', 'Watch time', ' h'],
    ['viewed', 'Average viewed', '%', ' pp'], ['ctr', 'Impressions CTR', '%', ' pp'],
    ['subs', 'Net subscribers', ''], ['conversion', 'Net subscribers per 1K views', '']
  ]) {
    const row = body.insertRow();
    const heading = element('th', label);
    heading.scope = 'row';
    row.append(heading);
    for (const value of [a[key], b[key]]) row.insertCell().textContent = value == null ? '—' : format(value) + suffix;
    const change = a[key] == null || b[key] == null ? null : b[key] - a[key];
    row.insertCell().textContent = change == null ? '—' : (change > 0 ? '+' : '') + format(change) + (unit ?? suffix);
  }
  target.replaceChildren(table);
}

function renderOverview() {
  const {videos, daily, total} = datasets;
  $('overview').hidden = !videos.length && !daily.length && !total;
  $('daily-section').hidden = !daily.length;
  $('videos-section').hidden = !videos.length;
  const sum = (rows, field) => rows.some(row => row[field] != null)
    ? rows.reduce((total, row) => total + (row[field] ?? 0), 0) : null;
  const cards = [['Views', total?.views ?? sum(videos.length ? videos : daily, 'views')],
    ['Watch time (hours)', total?.hours ?? sum(videos, 'hours')],
    ['Net subscribers', total?.subs ?? sum(videos, 'subs')],
    ['Thumbnail impressions', total?.impressions ?? sum(videos, 'impressions')],
    ['Impressions CTR', total?.ctr, '%']];
  $('metrics').replaceChildren(...cards.filter(([,value]) => value != null).map(([name, value, suffix = '']) => {
    const card = element('div');
    card.append(element('dt', name), element('dd', format(value) + suffix));
    return card;
  }));
  renderAnimatedGraph($('daily-line'), [
    {label:'Daily views', color:'#ff6962', values:daily.map(day => day.views)}
  ], format);
  const peak = daily.reduce((max, day) => Math.max(max, day.views), 1);
  $('daily').replaceChildren(...daily.map(day => {
    const detail = day.date + ' · ' + format(day.views) + ' views';
    const bar = element('button');
    bar.type = 'button';
    bar.title = detail;
    bar.setAttribute('aria-label', detail);
    bar.style.setProperty('--height', (day.views / peak * 96) + 'px');
    const show = () => { $('day-detail').textContent = detail; };
    for (const event of ['pointerenter','focus','click']) bar.addEventListener(event, show);
    return bar;
  }));
  $('day-detail').textContent = daily.length ? daily[0].date + ' to ' + daily.at(-1).date : '';
  renderVideos();

}

function setCurveMenus() {
  const first = $('curve-a').value;
  const second = $('curve-b').value;
  const names = [...datasets.curves.keys()];
  $('curve-a').replaceChildren(...names.map(name => new Option(name, name)));
  $('curve-b').replaceChildren(new Option('None', ''), ...names.map(name => new Option(name, name)));
  $('curve-a').value = names.includes(first) ? first : names[0] ?? '';
  $('curve-b').value = names.includes(second) ? second : '';
  $('curves').hidden = !names.length;
  renderCurves();
}

function renderCurves() {
  const first = datasets.curves.get($('curve-a').value);
  if (!first) return;
  const second = datasets.curves.get($('curve-b').value);
  const curves = second && second !== first ? [first, second] : [first];
  const canvas = $('curve-chart');
  const {width, height} = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.font = '12px system-ui';
  const margin = 45;
  const maxTime = Math.max(1, ...curves.map(curve => curve.points.at(-1).seconds));
  const maxPercent = Math.max(100, ...curves.map(curve => curve.points.reduce((max,p) => Math.max(max,p.percent),0)));
  const x = value => margin + (width - margin - 12) * value / maxTime;
  const y = value => height - 25 - (height - 40) * value / maxPercent;
  for (const tick of [0, 25, 50, 75, 100]) {
    ctx.strokeStyle = '#503432';
    ctx.beginPath(); ctx.moveTo(margin, y(tick)); ctx.lineTo(width - 12, y(tick)); ctx.stroke();
    ctx.fillStyle = '#c1a9a5';
    ctx.fillText(tick + '%', 2, y(tick) + 4);
  }
  ctx.fillText('0s', margin, height - 7);
  ctx.textAlign = 'right';
  ctx.fillText(format(maxTime) + 's', width - 12, height - 7);
  curves.forEach((curve, index) => {
    ctx.strokeStyle = index ? '#ffc08e' : '#ff6962';
    ctx.lineWidth = 2;
    ctx.beginPath();
    curve.points.forEach((point, i) => {
      if (i) ctx.lineTo(x(point.seconds), y(point.percent));
      else ctx.moveTo(x(point.seconds), y(point.percent));
    });
    ctx.stroke();
  });
  const notes = annotations.get(first.name) ?? [];
  for (const note of notes) {
    if (note.seconds > maxTime) continue;
    ctx.strokeStyle = '#e7b7b4';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(note.seconds), 15); ctx.lineTo(x(note.seconds), height - 25); ctx.stroke();
  }
  $('curve-detail').textContent = curves.map((curve,index) => (index ? 'Peach' : 'Red') + ' · ' + curve.name).join(' / ');
  const drops = first.points.slice(1).map((point, i) => ({
    point, drop: first.points[i].percent - point.percent, previous: first.points[i].seconds
  })).filter(({point, drop, previous}) => drop > 0 && point.seconds > previous)
    .sort((a,b) => b.drop - a.drop).slice(0, 3);
  $('curve-drops').replaceChildren(...drops.map(({point, drop, previous}) => {
    const item = element('li', '−' + format(drop) + ' pp from ' + format(previous) + 's to ');
    const button = element('button', format(point.seconds) + 's');
    button.type = 'button';
    button.className = 'link-button';
    button.onclick = () => {
      $('note-time').value = point.seconds;
      $('note-text').focus();
    };
    item.append(button);
    return item;
  }));
  if (!drops.length) $('curve-drops').append(element('li', 'No drops in this export.'));
  $('export-notes').disabled = !notes.length;
  $('note-time').max = first.points.at(-1).seconds;
  $('notes').replaceChildren(...notes.map((note,index) => {
    const row = element('li', format(note.seconds) + 's · ' + note.text);
    const remove = element('button', 'Remove');
    remove.type = 'button';
    remove.className = 'link-button';
    remove.onclick = () => { const restore = rememberViewramp(); notes.splice(index, 1); saveNotes(); renderCurves(); offerUndo(restore); };
    row.append(remove);
    return row;
  }));
  const table = element('table');
  const headings = element('tr');
  for (const heading of ['Video','Time','Retention']) {
    const th = element('th',heading); th.scope = 'col'; headings.append(th);
  }
  const head = table.createTHead(); head.append(headings);
  const body = table.createTBody();
  for (const curve of curves) for (const point of curve.points) {
    const row = body.insertRow();
    for (const val of [curve.name, format(point.seconds) + 's', format(point.percent) + '%']) row.insertCell().textContent = val;
  }
  $('curve-values').replaceChildren(table);
}

async function importExports(files) {
  const version = ++importVersion;
  const progress = $('import-progress');
  progress.hidden = false;
  $('status').textContent = '';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  await new Promise(resolve => window.setTimeout(resolve, reduceMotion ? 0 : 650));
  const results = await Promise.all(files.map(async file => {
    try { return {data: parseExport(await file.text(), file.name)}; }
    catch (error) { return {error: file.name + ' — ' + error.message}; }
  }));
  if (version !== importVersion) return;
  progress.hidden = true;
  const restore = rememberViewramp();
  let loaded = 0;
  const errors = [];
  for (const result of results) {
    if (result.error) { errors.push(result.error); continue; }
    const {curve, ...overview} = result.data;
    if (curve) datasets.curves.set(curve.name, curve);
    Object.assign(datasets, overview);
    loaded++;
  }
  if (loaded) offerUndo(restore);
  $('status').textContent = (loaded ? 'Loaded ' + loaded + ' ' + (loaded === 1 ? 'export. ' : 'exports. ') : '') + errors.join(' ');
  renderOverview();
  setCurveMenus();
}

$('files').onchange = event => {
  const files = [...event.currentTarget.files];
  event.currentTarget.value = '';
  if (files.length) importExports(files);
};
$('sample').onclick = () => importExports(retentionSamples.map(file => ({name: file.name, text: () => file.text})));
$('search').oninput = renderVideos;
$('sort').onchange = renderVideos;
$('curve-a').onchange = renderCurves;
$('curve-b').onchange = renderCurves;
$('note-form').onsubmit = event => {
  event.preventDefault();
  const name = $('curve-a').value;
  const text = $('note-text').value.trim();
  if (!text || !name) return;
  const restore = rememberViewramp();
  const notes = annotations.get(name) ?? [];
  notes.push({seconds: Number($('note-time').value), text});
  notes.sort((a,b) => a.seconds - b.seconds);
  annotations.set(name, notes);
  saveNotes();
  offerUndo(restore);
  event.currentTarget.reset();
  renderCurves();
};
for (const id of ['video-length', 'published-from', 'published-to']) $(id).onchange = renderVideos;
for (const id of ['compare-a', 'compare-b']) $(id).onchange = renderComparison;
$('export-notes').onclick = () => {
  const notes = annotations.get($('curve-a').value) ?? [];
  if (!notes.length) return;
  const file = new Blob([notes.map(note => format(note.seconds) + 's — ' + note.text).join('\n')], {type: 'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(file);
  const link = element('a');
  link.href = url;
  link.download = 'viewramp-notes.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('resize', renderCurves);
