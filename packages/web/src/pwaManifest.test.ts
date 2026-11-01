import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const manifestScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!manifestScript) throw new Error('Missing manifest bootstrap script');

describe('portable PWA manifests', () => {
  it.each(['', '/openchamber'])('uses deployment path "%s" in the inline fallback', async (basePath) => {
    const blobs: Blob[] = [];
    class ManifestURL extends URL {
      static createObjectURL(blob: Blob): string {
        blobs.push(blob);
        return 'blob:manifest';
      }
      static revokeObjectURL(): void {}
    }
    const manifestLink = { href: '' };
    const fetchManifest = vi.fn(async () => new Response(null, { status: 404 }));
    const storage = new Map<string, string>([
      ['openchamber.pwaRecentSessions', JSON.stringify([{ sessionId: 'ses_1', title: 'Recent' }])],
    ]);
    runInNewContext(manifestScript, {
      window: { __OPENCHAMBER_BASE_PATH__: basePath },
      location: { origin: 'https://example.com', search: '' },
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
      },
      document: {
        documentElement: { setAttribute: vi.fn() },
        querySelector: () => null,
        createElement: () => manifestLink,
        head: { appendChild: vi.fn() },
      },
      fetch: fetchManifest,
      Blob,
      URL: ManifestURL,
      URLSearchParams,
      AbortController,
      setTimeout,
      clearTimeout,
    });
    await vi.waitFor(() => expect(manifestLink.href).toBe('blob:manifest'));
    const manifest = JSON.parse(await blobs[0].text());
    const baseUrl = `https://example.com${basePath}/`;
    expect(manifest).toMatchObject({ id: baseUrl, start_url: baseUrl, scope: baseUrl });
    expect(fetchManifest).toHaveBeenCalledWith(`${baseUrl}manifest.webmanifest?orientation=system`, expect.any(Object));
    for (const icon of manifest.icons) expect(icon.src.startsWith(baseUrl)).toBe(true);
    for (const shortcut of manifest.shortcuts) expect(shortcut.url.startsWith(baseUrl)).toBe(true);
  });

  it('resolves static manifest resources relative to the manifest URL', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/site.webmanifest', import.meta.url), 'utf8'));
    const manifestUrl = 'https://example.com/openchamber/site.webmanifest';
    for (const field of ['id', 'start_url', 'scope']) {
      expect(new URL(manifest[field], manifestUrl).href).toBe('https://example.com/openchamber/');
    }
    for (const icon of manifest.icons) {
      expect(new URL(icon.src, manifestUrl).pathname.startsWith('/openchamber/')).toBe(true);
    }
  });
});
