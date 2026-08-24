/**
 * "Recent" list on the empty-state screen. Persisted to localStorage
 * (per-machine, never leaves the device - same offline-by-default posture
 * as the rest of the app). Only files with a real filesystem path are
 * tracked, since re-opening a recent entry re-reads it from disk via IPC.
 */

const KEY = 'paperlight:recentFiles';
const MAX_ENTRIES = 5;

export function getRecentFiles() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** @param {{name: string, path: string, pageCount: number}} entry */
export function addRecentFile(entry) {
  if (!entry.path) return;
  try {
    const list = getRecentFiles().filter((f) => f.path !== entry.path);
    list.unshift({ name: entry.name, path: entry.path, pageCount: entry.pageCount, openedAt: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* best-effort - the app works fine without a persisted recent list */
  }
}

export function removeRecentFile(path) {
  try {
    const list = getRecentFiles().filter((f) => f.path !== path);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* no-op */
  }
}

/** Relative "2 h ago" / "3 days ago" style label. */
export function formatRelativeTime(ts) {
  const diffMs = Date.now() - ts;
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day} days ago`;
  const week = Math.round(day / 7);
  if (week < 5) return `${week} week${week > 1 ? 's' : ''} ago`;
  return new Date(ts).toLocaleDateString();
}
