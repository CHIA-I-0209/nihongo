// 這台裝置的名稱（記在學習紀錄裡，方便看是哪台裝置答的題）
export function deviceName() {
  let id = null;
  try { id = localStorage.getItem('deviceId'); } catch (e) { /* 忽略 */ }
  if (!id) {
    const ua = navigator.userAgent;
    const kind = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Web';
    id = `${kind}-${Math.random().toString(36).slice(2, 6)}`;
    try { localStorage.setItem('deviceId', id); } catch (e) { /* 忽略 */ }
  }
  return id;
}
