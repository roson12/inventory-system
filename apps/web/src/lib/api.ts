export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

export async function ensureCsrf(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const res = await fetch('/api/auth/csrf', { credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, 'CSRF_UNAVAILABLE', 'Could not start a session');
  const json = await res.json();
  csrfToken = json.data.csrfToken as string;
  return csrfToken;
}

export function clearCsrf() {
  csrfToken = null;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  rawBody?: BodyInit;
}

async function rawRequest(path: string, options: RequestOptions = {}, retried = false): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };
  if (method !== 'GET') {
    headers['x-csrf-token'] = await ensureCsrf();
  }

  let body: BodyInit | undefined = options.rawBody;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers,
    body,
  });

  if (res.status === 403) {
    const clone = await res.clone().json().catch(() => null);
    if (clone?.error?.code === 'CSRF_FAILED' && !retried) {
      await ensureCsrf(true);
      return rawRequest(path, options, true);
    }
  }
  return res;
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const res = await rawRequest(path, options);
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'));
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? 'REQUEST_FAILED',
      json?.error?.message ?? `Request failed (${res.status})`,
      json?.error?.details,
    );
  }
  return (json?.data ?? json) as T;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export async function apiPage<T = unknown>(path: string): Promise<Page<T>> {
  const res = await rawRequest(path);
  if (res.status === 401) window.dispatchEvent(new CustomEvent('auth:unauthorized'));
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? 'REQUEST_FAILED',
      json?.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return json as Page<T>;
}

export function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  return api<T>(path, { method: 'POST', rawBody: form });
}
