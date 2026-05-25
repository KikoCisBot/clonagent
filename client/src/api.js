export async function api(path, opts = {}) {
  const r = await fetch(path, {
    credentials: 'include',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 401) {
    // Reload to show the login screen
    if (path !== '/api/auth/whoami' && path !== '/api/auth/login') window.location.reload();
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    let parsed;
    try { parsed = JSON.parse(txt); } catch {}
    throw new Error(parsed?.error || `${r.status} ${r.statusText}`);
  }
  if (r.headers.get('content-type')?.includes('application/json')) return r.json();
  return r.text();
}

export function streamSSE(path, onMessage, onError) {
  const es = new EventSource(path, { withCredentials: true });
  es.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch {}
  };
  es.onerror = (e) => { onError && onError(e); };
  return () => es.close();
}
