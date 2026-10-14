export async function api<T>(path: string, token?: string | null, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  const data = await response.json() as T & { error?: string }; if (!response.ok) throw new Error(data.error || 'Something interrupted the review. Please try again.'); return data as T;
}
