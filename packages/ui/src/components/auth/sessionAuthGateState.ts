export type GateState = 'pending' | 'authenticated' | 'locked' | 'error' | 'rate-limited';

export type RuntimeIdentity = {
  apiBaseUrl: string;
  runtimeKey: string;
};

const runtimeEndpoint = (value: string): URL | null => {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url;
  } catch {
    return null;
  }
};

const isLoopbackHostname = (hostname: string): boolean => (
  ['localhost', '127.0.0.1', '::1'].includes(hostname.replace(/^\[|\]$/g, ''))
);

/** Saved credentials belong to one service root. Queries and fragments are not part of that root. */
export const runtimeEndpointsMatch = (left: string, right: string, allowLoopbackAliases = false): boolean => {
  const leftUrl = runtimeEndpoint(left);
  const rightUrl = runtimeEndpoint(right);
  if (!leftUrl || !rightUrl) return false;
  if (leftUrl.pathname !== rightUrl.pathname) return false;
  if (leftUrl.origin === rightUrl.origin) return true;
  return allowLoopbackAliases
    && isLoopbackHostname(leftUrl.hostname)
    && isLoopbackHostname(rightUrl.hostname)
    && leftUrl.protocol === rightUrl.protocol
    && leftUrl.port === rightUrl.port;
};

export const runtimeIdentityMatches = (left: RuntimeIdentity, right: RuntimeIdentity): boolean => {
  return left.apiBaseUrl === right.apiBaseUrl && left.runtimeKey === right.runtimeKey;
};
