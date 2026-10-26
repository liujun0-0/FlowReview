export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export const reportId = window.location.pathname.split('/')[2];
export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const token = window.location.hash.slice(1);
  const response = await fetch(`/api/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new ApiError(result.error || `本地服务错误 ${response.status}`, response.status); }
  return response.json();
}
