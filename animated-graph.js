// Draw a smooth curve through the imported values without overshooting them.
function renderAnimatedGraph(canvas, series, formatValue) {
  canvas.stopGraph?.();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const values = series.flatMap(line => line.values);
  canvas.hidden = !values.length;
  if (!values.length) return;
  let low = Math.min(0, ...values);
  let high = Math.max(0, ...values);
  if (high === low) high = low + 1;
  const padding = (high - low) * .1;
  low -= padding;
  high += padding;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame, start;
  let width, height;

  function draw(time) {
    start ??= time;
    const progress = motion.matches ? 1 : Math.min(1, (time - start) / 1250);
    const reveal = progress * progress * (3 - 2 * progress);
    const top = 16, bottom = height - 17, left = 14, right = width - 14;
    const y = value => bottom - (value - low) / (high - low) * (bottom - top);
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--line').trim() || '#333';
    ctx.setLineDash([4, 5]);
    for (let i = 0; i < 5; i++) {
      const level = top + (bottom - top) * i / 4;
      ctx.beginPath();
      ctx.moveTo(left, level);
      ctx.lineTo(right, level);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, left + (right - left) * reveal + 7, height);
    ctx.clip();
    for (const line of series) {
      const points = line.values.map((value, i) => ({
        x: line.values.length === 1 ? width / 2 : left + (right - left) * i / (line.values.length - 1),
        y: y(value)
      }));
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      points.forEach((point, i) => {
        if (!i) return ctx.moveTo(point.x, point.y);
        const previous = points[i - 1];
        const middle = (previous.x + point.x) / 2;
        ctx.bezierCurveTo(middle, previous.y, middle, point.y, point.x, point.y);
      });
      ctx.stroke();
      const radius = points.length > 20 ? 3 : 5;
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = line.color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#f5f3ff';
        ctx.stroke();
      }
    }
    ctx.restore();
    if (progress < 1) frame = requestAnimationFrame(draw);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    const scale = devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.scale(scale, scale);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  }
  canvas.setAttribute('aria-label', series.map(line => line.label + ' ranges from ' +
    formatValue(Math.min(...line.values)) + ' to ' + formatValue(Math.max(...line.values))).join('. '));
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  canvas.stopGraph = () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
