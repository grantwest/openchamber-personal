declare global {
  interface Window {
    /** Server-validated deployment prefix, without a trailing slash. Empty at the origin root. */
    __OPENCHAMBER_BASE_PATH__?: string;
  }
}

/** The hosted UI's path stays independent of the currently selected remote runtime. */
export const getDeploymentBasePath = (): string => {
  return globalThis.window?.__OPENCHAMBER_BASE_PATH__ || '';
};

/** Resolve an application-owned root path, leaving external URLs and fragment links intact. */
export const deploymentUrl = (path: string): string => {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${getDeploymentBasePath()}${path}`;
};

/** Preserve root-hosted relative requests and native runtime URLs by default. */
export const getDeploymentApiBaseUrl = (): string => {
  const prefix = getDeploymentBasePath();
  if (!prefix) return '';
  const origin = globalThis.window?.location.origin ?? '';
  return /^https?:\/\//.test(origin) ? `${origin}${prefix}` : '';
};
