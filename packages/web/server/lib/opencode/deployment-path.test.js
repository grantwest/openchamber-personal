import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';
import WebSocket from 'ws';
import { createDeploymentPathRuntime, normalizeBasePath, withDeploymentBasePath, withDeploymentBaseUrl } from './deployment-path.js';
import { createStaticRoutesRuntime } from './static-routes-runtime.js';
import { registerOpenCodeProxy } from './proxy.js';
import { createServerStartupRuntime } from './server-startup-runtime.js';
import { createMessageStreamWsRuntime } from '../event-stream/runtime.js';
import { createRequestSecurityRuntime } from '../security/request-security.js';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-deployment-test-'));
const originalDataDir = process.env.OPENCHAMBER_DATA_DIR;
let createUiAuth;
const cleanups = [];
const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://localhost:${server.address().port}`;
};

beforeAll(async () => {
  process.env.OPENCHAMBER_DATA_DIR = directory;
  ({ createUiAuth } = await import('../ui-auth/ui-auth.js'));
  fs.mkdirSync(path.join(directory, 'assets'));
  fs.mkdirSync(path.join(directory, 'folder'));
  const html = '<!doctype html><html><head><link href="/favicon.png"><link href="./assets/app.css"><script type="module" src="/assets/app.js"></script></head><body>app</body></html>';
  fs.writeFileSync(path.join(directory, 'index.html'), html);
  fs.writeFileSync(path.join(directory, 'mobile.html'), html.replace('>app<', '>mobile<'));
  fs.writeFileSync(path.join(directory, 'assets/app.js'), 'window.loaded=true;');
  fs.writeFileSync(path.join(directory, 'assets/app.css'), 'body { color: black; }');
  fs.writeFileSync(path.join(directory, 'sw.js'), '/* worker */');
});
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});
afterAll(() => {
  if (originalDataDir === undefined) delete process.env.OPENCHAMBER_DATA_DIR;
  else process.env.OPENCHAMBER_DATA_DIR = originalDataDir;
  fs.rmSync(directory, { recursive: true, force: true });
});

const fixture = async (basePath = '/openchamber', registerExtraRoutes = () => {}) => {
  const upstreamApp = express();
  upstreamApp.get('/api/event', (_req, res) => {
    res.type('text/event-stream');
    res.write('data: {"type":"server.connected"}\n\n');
    res.end();
  });
  upstreamApp.use(express.raw({ type: '*/*' }));
  upstreamApp.use((req, res) => res.json({ url: req.url, method: req.method, body: req.body?.toString(), authorization: req.headers.authorization }));
  const upstream = await listen(http.createServer(upstreamApp));
  const deployment = createDeploymentPathRuntime(basePath);
  const app = express();
  app.use(deployment.middleware);
  const auth = createUiAuth({
    password: 'test-password',
    readSettingsFromDiskMigrated: async () => ({}),
    clientAuthController: { authenticateBearerToken: async (token) => token === 'test-client' ? { ok: true, clientId: 'test' } : null },
  });
  cleanups.push(() => auth.dispose());
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/auth/session', express.json(), auth.handleSessionCreate);
  app.get('/auth/session', auth.handleSessionStatus);
  app.post('/auth/url-token', express.json(), auth.handleUrlAuthToken);
  app.get('/connect', (_req, res) => res.redirect(302, '/'));
  app.use('/api', auth.requireAuth);
  app.get('/api/echo', (req, res) => res.json({ url: req.originalUrl }));
  app.get('/api/headers', (_req, res) => {
    res.writeHead(302, {
      Location: '/auth/session?return=%2Fapi',
      'Set-Cookie': ['first=1; Path=/; HttpOnly; SameSite=Strict', 'second=2; Path=/auth; Secure'],
    });
    res.end();
  });
  app.get('/api/external', (_req, res) => res.redirect(302, 'https://example.com/login'));
  registerExtraRoutes(app);
  registerOpenCodeProxy(app, {
    fs, os, path,
    OPEN_CODE_READY_GRACE_MS: 0,
    getRuntime: () => ({ openCodePort: Number(new URL(upstream).port), isOpenCodeReady: true, openCodeNotReadySince: 0, isRestartingOpenCode: false }),
    getOpenCodeAuthHeaders: () => ({ Authorization: 'Bearer upstream-test' }),
    buildOpenCodeUrl: (requestPath) => `${upstream}${requestPath}`,
    ensureOpenCodeApiPrefix: () => {},
  });
  createStaticRoutesRuntime({
    fs, path, express, __dirname: directory,
    process: { env: { OPENCHAMBER_DIST_DIR: directory }, platform: process.platform },
    resolveProjectDirectory: async () => ({ directory: null }),
    buildOpenCodeUrl: (requestPath) => `${upstream}${requestPath}`,
    getOpenCodeAuthHeaders: () => ({}),
    readSettingsFromDiskMigrated: async () => ({}),
    normalizePwaAppName: (value, fallback) => z.string().min(1).catch(fallback).parse(value),
    normalizePwaOrientation: (_value, fallback) => fallback,
    isRequestAuthorized: async () => false,
  }).registerStaticRoutes(app);
  const server = http.createServer(app);
  const security = createRequestSecurityRuntime({ readSettingsFromDiskMigrated: async () => ({}) });
  const messageStream = createMessageStreamWsRuntime({
    server, uiAuthController: auth, ...security,
    buildOpenCodeUrl: (requestPath) => `${upstream}${requestPath}`,
    getOpenCodeAuthHeaders: () => ({}),
    processForwardedEventPayload: () => {}, wsClients: new Set(),
  });
  // This prepend models the spaces handler. It must see canonical paths too.
  let firstUpgradePath;
  server.prependListener('upgrade', (req) => { firstUpgradePath = req.url; });
  deployment.installUpgradeBoundary(server);
  const origin = await listen(server);
  cleanups.push(() => messageStream.close());
  return { origin, url: `${origin}${basePath}`, firstUpgradePath: () => firstUpgradePath };
};

const login = async (url) => {
  const response = await fetch(`${url}/auth/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie');
  return { cookie: cookie.split(';', 1)[0], header: cookie };
};
const socketResult = (url, headers = {}) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url.replace(/^http/, 'ws'), { headers, handshakeTimeout: 3000 });
  socket.once('unexpected-response', (_req, response) => {
    response.resume();
    socket.terminate();
    resolve(response.statusCode);
  });
  socket.once('message', (data) => {
    socket.terminate();
    resolve(JSON.parse(data.toString()));
  });
  socket.once('error', (error) => {
    if (!error.message.includes('WebSocket was closed before')) reject(error);
  });
});

describe('deployment path HTTP and upgrade boundary', () => {
  it('normalizes configuration and refuses ambiguous or injectable paths', () => {
    for (const value of [undefined, '', ' ', '/']) expect(normalizeBasePath(value)).toBe('');
    expect(normalizeBasePath('/tools/openchamber/')).toBe('/tools/openchamber');
    for (const value of ['/api', '/auth', '/health', '/API/nested']) expect(() => normalizeBasePath(value)).toThrow('reserved');
    expect(withDeploymentBasePath('/assets', '/assets/app.js')).toBe('/assets/assets/app.js');
    expect(withDeploymentBaseUrl('/openchamber', 'https://tunnel.example')).toBe('https://tunnel.example/openchamber');
    expect(withDeploymentBaseUrl('', 'https://tunnel.example')).toBe('https://tunnel.example');
    for (const value of ['relative', '//other', '/a//b', '/a/..', '/./a', '/a?b', '/a#b', '/a%2fb', '/a\\b', '/<script>', '/a\n/']) {
      expect(() => normalizeBasePath(value)).toThrow('OPENCHAMBER_BASE_PATH');
    }
  });

  it('serves canonical health, prefixed static assets, entry HTML and deep refreshes', async () => {
    const { url, origin } = await fixture();
    expect(await (await fetch(`${url}/health`)).json()).toEqual({ ok: true });
    expect((await fetch(`${origin}/openchamber-other/health`)).status).toBe(404);
    expect((await fetch(`${origin}/assets/app.js`)).status).toBe(404);
    for (const entry of ['/', '/index.html', '/mobile.html', '/session/nested/']) {
      const response = await fetch(url + entry);
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain('<head><base href="/openchamber/"><script>window.__OPENCHAMBER_BASE_PATH__="/openchamber";</script>');
      expect(html).toContain('src="/openchamber/assets/app.js"');
      expect(html).toContain('href="./assets/app.css"');
    }
    const asset = await fetch(`${url}/assets/app.js`);
    expect(await asset.text()).toBe('window.loaded=true;');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${url}/sw.js`)).headers.get('cache-control')).toBe('no-store');
    expect((await fetch(`${url}/missing.js`)).status).toBe(404);
  });

  it('preserves query strings on slash, static directory and connect redirects', async () => {
    const { url } = await fixture();
    for (const [request, target, status] of [
      ['?session=a%2Fb', '/openchamber/?session=a%2Fb', 308],
      ['/folder?q=a%2Fb', '/openchamber/folder/?q=a%2Fb', 301],
      ['/connect', '/openchamber/', 302],
    ]) {
      const response = await fetch(url + request, { redirect: 'manual' });
      expect(response.status).toBe(status);
      expect(response.headers.get('location')).toBe(target);
    }
  });

  it('scopes issued and cleared auth cookies and retains API auth and URL-token allowlists', async () => {
    const { url, origin } = await fixture();
    const session = await login(url);
    expect(session.header).toContain('Path=/openchamber/; HttpOnly; SameSite=Strict');
    const denied = await fetch(`${url}/api/echo`);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('set-cookie')).toContain('Path=/openchamber/');
    expect(denied.headers.get('set-cookie')).toContain('Max-Age=0');
    const headers = { Cookie: session.cookie };
    const echoed = await fetch(`${url}/api/echo?q=a%2Fb`, { headers });
    expect(await echoed.json()).toEqual({ url: '/api/echo?q=a%2Fb' });
    const minted = await fetch(`${url}/auth/url-token`, { method: 'POST', headers });
    const { token } = await minted.json();
    expect((await fetch(`${url}/api/echo?oc_url_token=${token}`)).status).toBe(401);
    expect((await fetch(`${url}/api/event?oc_url_token=${token}`)).status).toBe(200);
    // The relay and local callback clients retain canonical routes and auth.
    expect((await fetch(`${origin}/api/echo`)).status).toBe(401);
    expect((await fetch(`${origin}/api/echo`, { headers: { Authorization: 'Bearer test-client' } })).status).toBe(200);
  });

  it('rewrites direct writeHead headers without changing external redirects', async () => {
    const { url } = await fixture();
    const headers = { Authorization: 'Bearer test-client' };
    const response = await fetch(`${url}/api/headers`, { headers, redirect: 'manual' });
    expect(response.headers.get('location')).toBe('/openchamber/auth/session?return=%2Fapi');
    expect(response.headers.getSetCookie()).toEqual([
      'first=1; Path=/openchamber/; HttpOnly; SameSite=Strict',
      'second=2; Path=/openchamber/auth; Secure',
    ]);
    const external = await fetch(`${url}/api/external`, { headers, redirect: 'manual' });
    expect(external.headers.get('location')).toBe('https://example.com/login');
  });

  it('preserves writeHead overloads and non-string response headers', async () => {
    const cases = [
      ['status', (res) => res.writeHead(302)],
      ['reason', (res) => res.writeHead(302, 'Moved')],
      ['headers', (res, headers) => res.writeHead(302, headers)],
      ['reason-headers', (res, headers) => res.writeHead(302, 'Moved', headers)],
      ['undefined-reason', (res, headers) => res.writeHead(302, undefined, headers)],
      ['null-reason', (res, headers) => res.writeHead(302, null, headers)],
      ['raw-headers', (res) => res.writeHead(302, ['Location', '/next', 'X-Count', 7])],
      ['reason-raw-headers', (res) => res.writeHead(302, 'Moved', ['Location', '/next', 'X-Count', 7])],
    ];
    const { url } = await fixture('/openchamber', (app) => {
      for (const [name, write] of cases) {
        app.get(`/api/overloads/${name}`, (_req, res) => {
          res.setHeader('Location', '/next');
          res.setHeader('X-Count', 7);
          write(res, { Location: '/next', 'X-Count': 7 });
          res.end();
        });
      }
      app.get('/api/numeric-location', (_req, res) => {
        res.writeHead(302, { Location: 7, 'X-Count': 8 });
        res.end();
      });
    });
    for (const [name] of cases) {
      const response = await fetch(`${url}/api/overloads/${name}`, {
        headers: { Authorization: 'Bearer test-client' }, redirect: 'manual',
      });
      expect(response.status).toBe(302);
      expect(response.headers.get('location'), name).toBe('/openchamber/next');
      expect(response.headers.get('x-count'), name).toBe('7');
    }
    const response = await fetch(`${url}/api/numeric-location`, {
      headers: { Authorization: 'Bearer test-client' }, redirect: 'manual',
    });
    expect(response.headers.get('location')).toBe('7');
    expect(response.headers.get('x-count')).toBe('8');
    for (const value of [7, null, undefined, ['/next'], { path: '/next' }, Buffer.from('/next')]) {
      expect(withDeploymentBasePath('/openchamber', value)).toBe(value);
    }
  });

  it('keeps OpenCode paths, bodies, credentials, encoded queries and SSE streaming intact', async () => {
    const { url } = await fixture();
    const headers = { Authorization: 'Bearer test-client', 'Content-Type': 'application/json' };
    const response = await fetch(`${url}/api/probe?directory=%2Ftmp%2Fa&x=a%2Fb`, { method: 'POST', headers, body: '{"text":"hello"}' });
    expect(await response.json()).toEqual({ url: '/api/probe?directory=%2Ftmp%2Fa&x=a%2Fb', method: 'POST', body: '{"text":"hello"}', authorization: 'Bearer upstream-test' });
    const stream = await fetch(`${url}/api/event`, { headers });
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.headers.get('x-accel-buffering')).toBe('no');
    expect(stream.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(await stream.text()).toContain('data: {"type":"server.connected"}\n\n');
  });

  it('canonicalizes upgrades before prepended handlers and preserves real auth and origin gates', async () => {
    const { url, origin, firstUpgradePath } = await fixture();
    expect(await socketResult(`${url}/api/global/event/ws`, { Origin: origin })).toBe(401);
    const session = await login(url);
    const minted = await fetch(`${url}/auth/url-token`, { method: 'POST', headers: { Cookie: session.cookie } });
    const { token } = await minted.json();
    const socketUrl = `${url}/api/global/event/ws?oc_url_token=${token}`;
    expect(await socketResult(socketUrl, { Origin: 'https://untrusted.example' })).toBe(403);
    expect(await socketResult(socketUrl, { Origin: 'null' })).toBe(403);
    expect(await socketResult(socketUrl, { Origin: origin })).toMatchObject({ type: 'ready', scope: 'global' });
    expect(firstUpgradePath()).toBe(`/api/global/event/ws?oc_url_token=${token}`);
    // Root relay upgrade traffic uses the same token and loopback origin gate.
    expect(await socketResult(`${origin}/api/global/event/ws?oc_url_token=${token}`, { Origin: origin })).toMatchObject({ type: 'ready' });
    expect(await socketResult(`${origin}/wrong/api/global/event/ws`)).toBe(404);
    expect(await socketResult(`${url}//api/global/event/ws`)).toBe(404);
  });

  it('keeps guest assets, scoped tokens, CSP paths and OAuth callbacks under the prefix', async () => {
    const { registerGuestRoutes } = await import('../guests/routes.js');
    const packageRoot = path.join(directory, 'guest-package');
    fs.mkdirSync(packageRoot);
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'frame-test', version: '1.0.0', openchamber: {
      apiVersion: 1, contributes: { panel: { id: 'frame-test', name: 'Frame Test', icon: 'apps', entry: 'index.html' } },
    } }));
    fs.writeFileSync(path.join(packageRoot, 'index.html'), '<script src="main.js"></script>');
    fs.writeFileSync(path.join(packageRoot, 'main.js'), 'window.guest=true;');
    const { url } = await fixture('/openchamber', (app) => registerGuestRoutes(app, { openchamberDataDir: directory, resolveGitBinaryForSpawn: () => 'git' }));
    const headers = { Authorization: 'Bearer test-client', 'Content-Type': 'application/json' };
    const installed = await fetch(`${url}/api/guests`, { method: 'POST', headers, body: JSON.stringify({ path: packageRoot }) });
    expect(installed.status).toBe(201);
    const { grant } = await (await fetch(`${url}/api/guests/frame-test/frame-grant`, { method: 'POST', headers })).json();
    const guest = await fetch(`${url}/api/guest-files/${grant}/index.html`, { headers });
    expect(guest.status).toBe(200);
    expect(guest.headers.get('content-security-policy')).toContain(`/openchamber/api/guest-files/${grant}/`);
    expect(await guest.text()).toContain('src="main.js"');
    const minted = await fetch(`${url}/auth/url-token?scope=guest:frame-test`, { method: 'POST', headers });
    const { token } = await minted.json();
    expect((await fetch(`${url}/api/guests/frame-test/index.html?oc_url_token=${token}`)).status).toBe(200);
    expect((await fetch(`${url}/api/event?oc_url_token=${token}`)).status).toBe(401);
    const oauthRoot = path.join(directory, 'oauth-package');
    fs.cpSync(packageRoot, oauthRoot, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(oauthRoot, 'package.json'), 'utf8'));
    manifest.name = 'oauth-test';
    manifest.openchamber.contributes.panel.id = 'oauth-test';
    manifest.openchamber.contributes.integration = { name: 'OAuth Test', description: 'Test integration', oauth: {
      authorizeUrl: 'https://auth.example.com/authorize', tokenUrl: 'https://auth.example.com/token', apiOrigin: 'https://api.example.com',
    } };
    fs.writeFileSync(path.join(oauthRoot, 'package.json'), JSON.stringify(manifest));
    const installedOauth = await fetch(`${url}/api/guests`, { method: 'POST', headers, body: JSON.stringify({ path: oauthRoot }) });
    expect(installedOauth.status, JSON.stringify(await installedOauth.json())).toBe(201);
    const status = await (await fetch(`${url}/api/guests/oauth-test/oauth/status`, { headers })).json();
    expect(status.redirectUri).toBe(`${url}/api/guests/oauth-test/oauth/callback`);
  });

  it('advertises prefixed tunnel connect links while the tunnel controller keeps its origin', async () => {
    const server = http.createServer((_req, res) => res.end());
    cleanups.push(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
    let activeTunnel;
    let advertised;
    const startup = createServerStartupRuntime({
      process: { env: { OPENCHAMBER_BASE_PATH: '/openchamber' } },
      server, crypto: { randomUUID: () => 'test-tunnel' },
      startTunnelWithNormalizedRequest: async () => ({ publicUrl: 'https://tunnel.example', mode: 'quick' }),
      readSettingsFromDiskMigrated: async () => ({}), normalizeTunnelBootstrapTtlMs: () => 1000,
      tunnelAuthController: {
        setActiveTunnel: (value) => { activeTunnel = value; },
        issueBootstrapToken: () => ({ token: 'test-bootstrap' }),
      },
      TUNNEL_MODE_QUICK: 'quick',
    });
    await startup.startListeningAndMaybeTunnel({
      port: 0, bindHost: 'localhost', startupTunnelRequest: { provider: 'test', mode: 'quick' },
      onTunnelReady: (url, connectUrl) => { advertised = { url, connectUrl }; },
    });
    expect(activeTunnel.publicUrl).toBe('https://tunnel.example');
    expect(advertised).toEqual({ url: 'https://tunnel.example/openchamber', connectUrl: 'https://tunnel.example/openchamber/connect?t=test-bootstrap' });
  });

  it('keeps manifest URLs inside the deployment path', async () => {
    const { url } = await fixture('/tools/openchamber');
    const manifest = await (await fetch(`${url}/manifest.webmanifest`)).json();
    expect(manifest).toMatchObject({ id: '/tools/openchamber/', start_url: '/tools/openchamber/', scope: '/tools/openchamber/' });
    expect(manifest.icons.every((icon) => icon.src.startsWith('/tools/openchamber/'))).toBe(true);
    expect(manifest.shortcuts[0].url).toBe('/tools/openchamber/?settings=appearance');
  });

  it('resolves document-relative build assets on a root deployment deep refresh', async () => {
    const { url } = await fixture('');
    for (const entry of ['/', '/index.html', '/mobile.html', '/deep/link', '/deep/link/']) {
      const pageUrl = `${url}${entry}`;
      const page = await fetch(pageUrl);
      const html = await page.text();
      expect(page.status).toBe(200);
      const baseHref = html.match(/<base href="([^"]*)">/)?.[1];
      const assetHref = html.match(/href="(\.\/assets\/app.css)"/)?.[1];
      expect(baseHref).toBe('/');
      expect(assetHref).toBe('./assets/app.css');
      const assetUrl = new URL(assetHref, new URL(baseHref, pageUrl));
      expect(assetUrl.pathname).toBe('/assets/app.css');
      const asset = await fetch(assetUrl);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toBe('body { color: black; }');
    }
  });

  it('preserves root defaults for HTML, cookies, API paths and upgrades', async () => {
    const { url, origin } = await fixture('');
    const html = await (await fetch(`${url}/`)).text();
    expect(html).toContain('window.__OPENCHAMBER_BASE_PATH__=""');
    expect(html).toContain('<base href="/">');
    expect(html).toContain('src="/assets/app.js"');
    const session = await login(url);
    expect(session.header).toContain('Path=/;');
    expect(await socketResult(`${url}/api/global/event/ws`, { Cookie: session.cookie, Origin: origin })).toMatchObject({ type: 'ready' });
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });
});
