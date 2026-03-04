const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return false;

      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) return false;

      const data = await res.json();
      if (data.token) localStorage.setItem('token', data.token);
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
      return !!data.token;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function clearAuthAndRedirect() {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');
  window.location.href = '/login';
}

async function handle401(retryFn: () => Promise<Response>): Promise<Response> {
  if (typeof window === 'undefined') throw new Error('Unauthorized');

  const refreshed = await tryRefreshToken();
  if (!refreshed) {
    clearAuthAndRedirect();
    throw new Error('Unauthorized');
  }

  return retryFn();
}

async function request(path: string, options: RequestInit = {}) {
  const buildHeaders = () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  const doFetch = () =>
    fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        ...buildHeaders(),
        ...(options.headers as Record<string, string> || {}),
      },
    });

  let res = await doFetch();

  if (res.status === 401) {
    res = await handle401(doFetch);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg = typeof data === 'object' && (data?.error || data?.message)
      ? (data.error || data.message)
      : text || res.statusText;
    throw new Error(msg);
  }

  return data;
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, body?: any) =>
    request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path: string, body?: any) =>
    request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path: string, body?: any) =>
    request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (path: string) => request(path, { method: 'DELETE' }),
  upload: async (path: string, formData: FormData) => {
    const doFetch = () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      return fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
    };

    let res = await doFetch();

    if (res.status === 401) {
      res = await handle401(doFetch);
    }

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) {
      const msg = typeof data === 'object' && (data?.error || data?.message)
        ? (data.error || data.message)
        : text || res.statusText;
      throw new Error(msg);
    }
    return data;
  },
  downloadBlob: async (path: string, body?: any): Promise<Blob> => {
    const doFetch = () => {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      return fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    };

    let res = await doFetch();

    if (res.status === 401) {
      res = await handle401(doFetch);
    }

    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try { const j = JSON.parse(text); msg = j.error || j.message || text; } catch {}
      throw new Error(msg);
    }

    return res.blob();
  },
};
