// Runs before first paint so a saved light/dark choice never flashes the other theme.
// With no saved choice the page follows the system setting (see styles.css).
try {
  const t = localStorage.getItem('video-scripter.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {}
