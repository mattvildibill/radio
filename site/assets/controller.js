export function safeSource(url) {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}
export function duration(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
export function ago(date, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(date).getTime()) / 60000));
  if (!minutes) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
