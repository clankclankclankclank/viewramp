// Adapted from the supplied React Bits FuseButton for the static apps.
function createFuseUndo() {
  const root = document.createElement('span');
  root.className = 'fuse-button';
  root.dataset.phase = 'armed';
  root.dataset.fuse = 'bottom';
  root.hidden = true;
  root.style.cssText = '--fb-fuse:var(--accent);position:fixed;bottom:1.5rem;right:1.5rem;z-index:1000';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fuse-button__face fuse-button__undo';
  button.setAttribute('aria-keyshortcuts', 'Escape');
  button.append(document.createTextNode('↶ Undo'));
  const line = document.createElement('i');
  line.className = 'fuse-button__fuse';
  line.setAttribute('aria-hidden', 'true');
  button.append(line);
  root.append(button);
  document.body.append(root);
  let animation, restore;
  function dismiss() {
    animation?.cancel();
    animation = undefined;
    restore = undefined;
    root.hidden = true;
  }
  function undo() {
    if (!restore) return;
    const callback = restore;
    dismiss();
    callback();
  }
  function sync() {
    if (!animation) return;
    if (document.hidden || root.matches(':hover') || root.contains(document.activeElement)) animation.pause();
    else animation.play();
  }
  button.onclick = undo;
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && restore && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      undo();
    }
  });
  root.addEventListener('pointerenter', sync);
  root.addEventListener('pointerleave', sync);
  root.addEventListener('focusin', sync);
  root.addEventListener('focusout', () => queueMicrotask(sync));
  document.addEventListener('visibilitychange', sync);
  return callback => {
    dismiss();
    restore = callback;
    root.hidden = false;
    animation = line.animate([{transform:'scaleX(1)'}, {transform:'scaleX(0)'}],
      {duration:8000, easing:'linear', fill:'forwards'});
    animation.onfinish = dismiss;
    sync();
  };
}
