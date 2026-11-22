const $ = id => document.getElementById(id);
const number = new Intl.NumberFormat('en', {maximumFractionDigits: 2});
const format = value => value == null ? '—' : number.format(value);
const norm = value => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const datasets = {videos: [], daily: [], curves: new Map(), total: null};
const annotations = new Map();
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
      const entry = {title: get(row, 'videotitle'), views, hours, subs: readNumber(row, 'subscribers'),
        impressions: readNumber(row, 'thumbnailimpressions'), ctr: readNumber(row, 'thumbnailclickthroughrate'),
        viewed: views > 0 && length > 0 && hours != null ? hours * 3600 / views / length * 100 : null};
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
  const rows = datasets.videos.filter(video => video.title.toLowerCase().includes(query))
    .sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));
  $('videos').replaceChildren(...rows.map(video => {
    const row = element('tr');
    for (const val of [video.title, format(video.views), format(video.hours) + (video.hours == null ? '' : ' h'),
      video.viewed == null ? '—' : format(video.viewed) + '%', video.ctr == null ? '—' : format(video.ctr) + '%', format(video.subs)]) row.append(element('td', val));
    return row;
  }));
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
  $('note-time').max = first.points.at(-1).seconds;
  $('notes').replaceChildren(...notes.map((note,index) => {
    const row = element('li', format(note.seconds) + 's · ' + note.text);
    const remove = element('button', 'Remove');
    remove.type = 'button';
    remove.className = 'link-button';
    remove.onclick = () => { notes.splice(index, 1); renderCurves(); };
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
  let loaded = 0;
  const errors = [];
  for (const result of results) {
    if (result.error) { errors.push(result.error); continue; }
    const {curve, ...overview} = result.data;
    if (curve) datasets.curves.set(curve.name, curve);
    Object.assign(datasets, overview);
    loaded++;
  }
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
  const notes = annotations.get(name) ?? [];
  notes.push({seconds: Number($('note-time').value), text});
  notes.sort((a,b) => a.seconds - b.seconds);
  annotations.set(name, notes);
  event.currentTarget.reset();
  renderCurves();
};
window.addEventListener('resize', renderCurves);
