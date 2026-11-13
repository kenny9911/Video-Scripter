// Text boxes that fit what is written in them, and that the writer can still size by hand.
//
//   automatic   a box grows and shrinks with its text, from the rows it starts with up to about two thirds of
//               the window; past that it scrolls inside
//   by hand     dragging the corner sets the height. The box then never gets smaller than that by itself, and
//               still grows when the text needs more. Dragged smaller than its text, it stays that small and
//               scrolls, until it is dragged again.
//
// autosizeAll() wires every textarea on the page and every one added later. A box that should be left alone
// says so with data-autosize="off".

const wired = new WeakMap(); // textarea -> { manual, locked, width }
const ROOM = 0.66; // of the window's height

/** Where the page is scrolled, so that measuring a box (which collapses it for a moment) does not move anything. */
function scrolled(el) {
  const kept = [];
  for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollTop) kept.push([p, p.scrollTop]);
  const y = window.scrollY;
  return () => {
    for (const [p, top] of kept) p.scrollTop = top;
    if (window.scrollY !== y) window.scrollTo(window.scrollX, y);
  };
}

/** Size a box to its text now. Nothing happens while it is not on screen: it has no size to measure. */
export function fit(area) {
  const state = wired.get(area);
  if (!state || !area.isConnected || !area.clientWidth) return;
  const restore = scrolled(area);
  const frame = area.offsetHeight - area.clientHeight; // borders
  area.style.height = 'auto';
  const need = area.scrollHeight + frame;
  const cap = Math.max(220, Math.round(window.innerHeight * ROOM));
  const height = state.locked ? state.manual : Math.max(state.manual, Math.min(need, cap));
  area.style.height = `${height}px`;
  area.style.overflowY = need > height + 1 ? 'auto' : 'hidden';
  state.width = area.clientWidth;
  restore();
}

/** Make one textarea fit its text, and remember a height set by dragging its corner. */
export function autosize(area) {
  if (!(area instanceof HTMLTextAreaElement) || wired.has(area) || area.dataset.autosize === 'off') return area;
  const state = { manual: 0, locked: false, width: 0 };
  wired.set(area, state);
  area.style.resize = 'vertical';
  area.style.fieldSizing = 'fixed'; // the height is set here, so a browser that sizes boxes itself does not do it twice
  area.addEventListener('input', () => fit(area));
  // A drag on the corner: the height differs when the pointer is let go.
  area.addEventListener('pointerdown', () => {
    const before = area.offsetHeight;
    const done = () => {
      window.removeEventListener('pointerup', done, true);
      window.removeEventListener('pointercancel', done, true);
      const now = area.offsetHeight;
      if (Math.abs(now - before) < 2) return;
      state.manual = now;
      state.locked = area.scrollHeight > area.clientHeight + 1; // smaller than its text: it stays, and scrolls
      area.style.overflowY = state.locked ? 'auto' : 'hidden';
    };
    window.addEventListener('pointerup', done, true);
    window.addEventListener('pointercancel', done, true);
  });
  // Shown for the first time (a folded section, a dialog), or made wider or narrower: the text wraps differently.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => area.clientWidth !== state.width && fit(area)).observe(area);
  fit(area);
  return area;
}

/** Fit every wired box again: after text was put into them by the page rather than typed. */
export function refit(root = document) {
  for (const area of root.querySelectorAll('textarea')) fit(area);
}

/** Wire every textarea on the page, and every one that is added to it later. */
export function autosizeAll(root = document.body) {
  for (const area of root.querySelectorAll('textarea')) autosize(area);
  new MutationObserver((changes) => {
    for (const change of changes) {
      for (const node of change.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches('textarea')) autosize(node);
        for (const area of node.querySelectorAll?.('textarea') || []) autosize(area);
      }
    }
  }).observe(root, { childList: true, subtree: true });
  window.addEventListener('resize', () => refit(root));
}
