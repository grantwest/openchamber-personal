import { describe, expect, test } from 'bun:test';

import { runtimeEndpointsMatch, runtimeIdentityMatches } from './sessionAuthGateState';

describe('credential runtime endpoint matching', () => {
  test('isolates sibling and nested deployments on the same origin', () => {
    expect(runtimeEndpointsMatch('https://host.example/a', 'https://host.example/b')).toBe(false);
    expect(runtimeEndpointsMatch('https://host.example/a', 'https://host.example/a/child')).toBe(false);
    expect(runtimeEndpointsMatch('https://host.example', 'https://host.example/a')).toBe(false);
    expect(runtimeEndpointsMatch('https://host.example/a', 'https://other.example/a')).toBe(false);
  });

  test('normalizes root URLs, trailing slashes, default ports and address-bar suffixes', () => {
    expect(runtimeEndpointsMatch('https://HOST.example:443/a///?session=s#message', 'https://host.example/a')).toBe(true);
    expect(runtimeEndpointsMatch('https://host.example', 'https://host.example/')).toBe(true);
    expect(runtimeEndpointsMatch('https://host.example/A', 'https://host.example/a')).toBe(false);
  });

  test('rejects empty, invalid, credential-bearing and non-HTTP endpoints', () => {
    for (const url of ['', 'not a URL', 'https://user:pass@host.example/a', 'capacitor://localhost']) {
      expect(runtimeEndpointsMatch(url, url)).toBe(false);
    }
  });

  test('allows native local loopback aliases only at the same protocol, port and root', () => {
    expect(runtimeEndpointsMatch('http://localhost:3001', 'http://127.0.0.1:3001', true)).toBe(true);
    expect(runtimeEndpointsMatch('http://[::1]:3001/a', 'http://localhost:3001/a/', true)).toBe(true);
    expect(runtimeEndpointsMatch('http://localhost:3001', 'http://127.0.0.1:3002', true)).toBe(false);
    expect(runtimeEndpointsMatch('http://localhost:3001', 'http://127.0.0.1:3001/a', true)).toBe(false);
    expect(runtimeEndpointsMatch('http://localhost:3001', 'https://localhost:3001', true)).toBe(false);
    expect(runtimeEndpointsMatch('http://localhost:3001', 'http://remote.example:3001', true)).toBe(false);
    expect(runtimeEndpointsMatch('http://localhost:3001', 'http://127.0.0.1:3001')).toBe(false);
  });
});

describe('runtimeIdentityMatches', () => {
  test('rejects async auth results after switching hosts', () => {
    expect(runtimeIdentityMatches(
      { apiBaseUrl: 'https://host-a.example', runtimeKey: 'host:a' },
      { apiBaseUrl: 'https://host-b.example', runtimeKey: 'host:b' },
    )).toBe(false);
  });

  test('accepts a credential refresh for the same host', () => {
    expect(runtimeIdentityMatches(
      { apiBaseUrl: 'https://host-a.example', runtimeKey: 'host:a' },
      { apiBaseUrl: 'https://host-a.example', runtimeKey: 'host:a' },
    )).toBe(true);
  });
});
