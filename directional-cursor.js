const shortestArc = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

(() => {
  const stage = document.documentElement;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:48px;height:48px;pointer-events:none;z-index:2147483647;display:none';
    document.body.append(canvas);
    const style = document.createElement('style');
    style.textContent = 'html[data-directional-cursor],html[data-directional-cursor] * {cursor:none!important}';
    document.head.append(style);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = 48;
    const scale = window.devicePixelRatio || 1;
    canvas.width = canvas.height = size * scale;
    ctx.scale(scale, scale);
    const shape = new Path2D('M 15 0 L -11 -13 Q -15 -15 -14 -10 L -10 -1 Q -9 0 -10 2 L -14 11 Q -15 15 -11 13 L 15 1 Q 17 0 15 0 Z');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let active = false;
    let pointerId;
    let x = 0, y = 0, targetX = 0, targetY = 0;
    let angle = -2.35, heading = angle;
    let originX = 0, originY = 0;
    let turnVelocity = 0;
    let pressed = false, zoom = 1, previous = 0, frame = 0;

    function render(now) {
      const dt = previous ? Math.min(40, now - previous) : 16;
      previous = now;
      const follow = 1 - Math.exp(-dt / 17);
      const pressEase = 1 - Math.exp(-dt / 75);
      x += (targetX - x) * (motion.matches ? 1 : follow);
      y += (targetY - y) * (motion.matches ? 1 : follow);
      if (motion.matches) {
        angle = heading;
        turnVelocity = 0;
      } else {
        const step = dt / 1000;
        const error = shortestArc(angle, heading);
        // A damped spring eases into a turn and settles without bouncing.
        const decay = Math.exp(-16 * step);
        const impulse = turnVelocity - 16 * error;
        angle += error + (-error + impulse * step) * decay;
        turnVelocity = (turnVelocity - 16 * impulse * step) * decay;
      }
      zoom += ((pressed && !motion.matches ? .88 : 1) - zoom) * pressEase;
      canvas.style.transform = `translate3d(${x - 24}px,${y - 24}px,0) rotate(${angle}rad) scale(${zoom})`;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(24, 24);
      ctx.fillStyle = '#171614';
      ctx.strokeStyle = '#f2eee8';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.fill(shape);
      ctx.stroke(shape);
      ctx.restore();
      frame = requestAnimationFrame(render);
    }

    function activate(event) {
      active = true;
      pointerId = event.pointerId;
      x = targetX = originX = event.clientX;
      y = targetY = originY = event.clientY;
      previous = 0;
      turnVelocity = 0;
      stage.dataset.directionalCursor = '';
      canvas.style.display = 'block';
      frame = requestAnimationFrame(render);
    }
    function move(event) {
      if (event.target.closest?.('dialog[open], input, textarea, select, [contenteditable]')) {
        if (active) stop();
        return;
      }
      if (!active) {
        if (event.pointerType === 'touch') return;
        activate(event);
      }
      if (event.pointerId !== pointerId) return;
      targetX = event.clientX;
      targetY = event.clientY;
      const dx = targetX - originX, dy = targetY - originY;
      if (Math.hypot(dx, dy) < 15) return;
      const direction = Math.atan2(dy, dx);
      if (Math.abs(shortestArc(heading, direction)) >= Math.PI / 15) {
        heading = direction;
      }
      originX = targetX;
      originY = targetY;
    }
    function stop() {
      active = pressed = false;
      delete stage.dataset.directionalCursor;
      canvas.style.display = 'none';
      cancelAnimationFrame(frame);
    }
    function down(event) {
      if (!active) return;
      if (event.pointerId === pointerId) pressed = true;
    }
    function up(event) {
      if (event.pointerId !== pointerId) return;
      pressed = false;
      if (event.pointerType === 'touch') stop();
    }

    const listeners = [['pointermove', move], ['pointerleave', stop], ['pointerdown', down], ['pointercancel', stop]];
    for (const [type, listener] of listeners) stage.addEventListener(type, listener);
    window.addEventListener('pointerup', up);
    window.addEventListener('blur', stop);
})();
