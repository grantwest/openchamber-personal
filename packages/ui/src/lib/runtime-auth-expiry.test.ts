import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { configureRuntimeUrlResolver } from './runtime-url';
import { observeRuntimeAuthResponse, useAuthSessionStore } from './runtime-auth-expiry';

const originalFetch = globalThis.fetch;
let requests: string[] = [];
let clock = Date.now();
const now = spyOn(Date, 'now');
afterAll(() => now.mockRestore());

beforeEach(() => {
  clock += 16_000;
  now.mockReturnValue(clock);
  requests = [];
  useAuthSessionStore.getState().markAuthenticated();
  configureRuntimeUrlResolver({ apiBaseUrl: 'https://host.example/openchamber' });
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
    requests.push(input instanceof Request ? input.url : input.toString());
    return new Response(null, { status: 401 });
  }, originalFetch);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureRuntimeUrlResolver({});
  useAuthSessionStore.getState().markAuthenticated();
});

const waitForExpired = async () => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (useAuthSessionStore.getState().state === 'expired') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(useAuthSessionStore.getState().state).toBe('expired');
};

describe('runtime auth response classification', () => {
  test('confirms a prefixed 401 through the active service root', async () => {
    observeRuntimeAuthResponse('https://host.example/openchamber/api/config', 401);
    await waitForExpired();
    expect(requests).toEqual(['https://host.example/openchamber/auth/session']);
  });

  test('keeps provider failures distinct and coalesces a burst of suspicions', async () => {
    globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
      requests.push(input instanceof Request ? input.url : input.toString());
      return new Response(null, { status: 200 });
    }, originalFetch);
    for (let index = 0; index < 3; index += 1) {
      observeRuntimeAuthResponse('https://host.example/openchamber/api/config?next=/auth/session', 401);
    }
    for (let attempt = 0; requests.length === 0 && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual(['https://host.example/openchamber/auth/session']);
    expect(useAuthSessionStore.getState().state).toBe('ok');
  });

  test('preserves root-hosted and native remote runtime confirmation', async () => {
    configureRuntimeUrlResolver({ apiBaseUrl: 'https://remote.example' });
    observeRuntimeAuthResponse('https://remote.example/api/config', 401);
    await waitForExpired();
    expect(requests).toEqual(['https://remote.example/auth/session']);
  });

  test('ignores siblings, prefix lookalikes and other origins', () => {
    for (const url of [
      'https://host.example/api/config',
      'https://host.example/other/api/config',
      'https://host.example/openchamber-other/api/config',
      'https://other.example/openchamber/api/config',
    ]) observeRuntimeAuthResponse(url, 401);
    expect(requests).toEqual([]);
    expect(useAuthSessionStore.getState().state).toBe('ok');
  });

  test('keeps login and pairing failures excluded under the prefix', () => {
    observeRuntimeAuthResponse('https://host.example/openchamber/auth/session?retry=1', 401);
    observeRuntimeAuthResponse('https://host.example/openchamber/api/client-auth/pairing/redeem', 401);
    observeRuntimeAuthResponse('https://host.example/openchamber/api/config', 403);
    expect(requests).toEqual([]);
  });

  test('ignores the previous service root after switching runtimes', async () => {
    configureRuntimeUrlResolver({ apiBaseUrl: 'https://host.example/second' });
    observeRuntimeAuthResponse('https://host.example/openchamber/api/config', 401);
    expect(requests).toEqual([]);
    observeRuntimeAuthResponse('https://host.example/second/api/config', 401);
    await waitForExpired();
    expect(requests).toEqual(['https://host.example/second/auth/session']);
  });

  test('does not expire a new runtime from an old confirmation response', async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    globalThis.fetch = Object.assign(async (input: string | URL | Request) => {
      requests.push(input instanceof Request ? input.url : input.toString());
      return pending;
    }, originalFetch);
    observeRuntimeAuthResponse('https://host.example/openchamber/api/config', 401);
    for (let attempt = 0; requests.length === 0 && attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(requests).toEqual(['https://host.example/openchamber/auth/session']);
    configureRuntimeUrlResolver({ apiBaseUrl: 'https://host.example/second' });
    release(new Response(null, { status: 401 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useAuthSessionStore.getState().state).toBe('ok');
  });

  test('confirms relative root routes used by relay transport', async () => {
    configureRuntimeUrlResolver({});
    observeRuntimeAuthResponse('/api/config', 401);
    await waitForExpired();
    expect(requests).toEqual(['/auth/session']);
  });
});
