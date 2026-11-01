import { z } from 'zod';

const deploymentRelativePathSchema = z.string().regex(/^\/(?!\/)/);
const writeHeadReasonSchema = z.string().nullish();

// Deployment paths are server configuration, never a forwarded request header.
export const normalizeBasePath = (value = '') => {
  const candidate = value.trim();
  if (!candidate || candidate === '/') return '';
  const basePath = candidate.endsWith('/') ? candidate.slice(0, -1) : candidate;
  if (!/^\/(?:[A-Za-z0-9_~.-]+\/)*[A-Za-z0-9_~.-]+$/.test(basePath)
    || basePath.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('OPENCHAMBER_BASE_PATH must be an absolute path with plain, non-empty segments');
  }
  if (/^\/(?:api|auth|health)(?:\/|$)/i.test(basePath)) {
    throw new Error('OPENCHAMBER_BASE_PATH cannot use the reserved api, auth or health roots');
  }
  return basePath;
};

export const withDeploymentBasePath = (basePath, value) => {
  if (!basePath) return value;
  const parsed = deploymentRelativePathSchema.safeParse(value);
  return parsed.success ? `${basePath}${parsed.data}` : value;
};

// Only call this for URLs this server owns, such as a tunnel's public URL.
export const withDeploymentBaseUrl = (basePath, value) => {
  if (!basePath || !value) return value;
  const url = new URL(value);
  url.pathname = withDeploymentBasePath(basePath, url.pathname);
  return url.toString().replace(/\/$/, '');
};

export const injectDeploymentBaseHtml = (html, basePath = '') => {
  // Portable builds need an explicit document base on root deep refreshes too.
  const rewritten = html.replace(/\b(href|src)(\s*=\s*)(["'])(\/[^"']*)\3/gi, (_match, attribute, equals, quote, value) => (
    `${attribute}${equals}${quote}${withDeploymentBasePath(basePath, value)}${quote}`
  ));
  const injection = `<base href="${basePath}/"><script>window.__OPENCHAMBER_BASE_PATH__=${JSON.stringify(basePath)};</script>`;
  return rewritten.replace(/<head\b[^>]*>/i, (head) => `${head}${injection}`);
};

const rewriteResponseHeaders = (res, basePath) => {
  const rewriteHeader = (name, value) => {
    if (name.toLowerCase() === 'location') return withDeploymentBasePath(basePath, value);
    if (name.toLowerCase() !== 'set-cookie') return value;
    const rewriteCookie = (cookie) => String(cookie).replace(/(;\s*Path=)(\/[^;]*)/i, (_match, attribute, path) => (
      `${attribute}${withDeploymentBasePath(basePath, path)}`
    ));
    return Array.isArray(value) ? value.map(rewriteCookie) : rewriteCookie(value);
  };
  let writingHead = false;
  const setHeader = res.setHeader;
  res.setHeader = function (name, value) {
    return setHeader.call(this, name, writingHead ? value : rewriteHeader(name, value));
  };
  // http-proxy can pass headers directly to writeHead without setHeader.
  const writeHead = res.writeHead;
  res.writeHead = function (status, reason, headers) {
    const rewriteHeaders = (values) => {
      if (Array.isArray(values)) {
        return values.map((value, index) => index % 2 ? rewriteHeader(values[index - 1], value) : value);
      }
      return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, rewriteHeader(name, value)]));
    };
    writingHead = true;
    try {
      const parsedReason = writeHeadReasonSchema.safeParse(reason);
      if (!parsedReason.success) return writeHead.call(this, status, rewriteHeaders(reason));
      return writeHead.call(this, status, parsedReason.data, headers ? rewriteHeaders(headers) : headers);
    } finally {
      writingHead = false;
    }
  };
};

export const createDeploymentPathRuntime = (value) => {
  const basePath = normalizeBasePath(value);
  const canonicalize = (req) => {
    req.openchamberBasePath = '';
    if (!basePath) return true;
    const rawUrl = req.url || '/';
    const queryAt = rawUrl.indexOf('?');
    const pathname = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt);
    const query = queryAt === -1 ? '' : rawUrl.slice(queryAt);
    if (pathname === basePath || pathname.startsWith(`${basePath}/`)) {
      const canonicalPath = pathname.slice(basePath.length) || '/';
      if (canonicalPath.startsWith('//') || canonicalPath.includes('\\')) return false;
      req.openchamberBasePath = basePath;
      req.deploymentPathNeedsSlash = pathname === basePath;
      // Auth allowlists and the OpenCode proxy both consult originalUrl.
      req.url = `${canonicalPath}${query}`;
      req.originalUrl = req.url;
      return true;
    }
    // Existing native clients, server callbacks and the relay use canonical
    // paths. This is routing compatibility only: every auth/origin gate runs.
    return /^\/(?:api|auth)(?:\/|\?|$)/i.test(rawUrl) || /^\/health(?:\?|$)/.test(rawUrl);
  };

  return {
    middleware(req, res, next) {
      if (!canonicalize(req)) return res.status(404).end();
      if (!req.openchamberBasePath) return next();
      rewriteResponseHeaders(res, basePath);
      // A trailing slash makes relative assets work before the app starts.
      if (req.deploymentPathNeedsSlash) return res.redirect(308, req.url);
      next();
    },
    installUpgradeBoundary(server) {
      // Installed after all endpoint handlers, including the spaces prepend.
      // Node runs the remaining handlers after this one. A refused request gets
      // an unclaimed path so no endpoint can subsequently take its socket.
      server.prependListener('upgrade', (req, socket) => {
        if (canonicalize(req)) return;
        req.url = '/';
        req.originalUrl = '/';
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      });
    },
  };
};
