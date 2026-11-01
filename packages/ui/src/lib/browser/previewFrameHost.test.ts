import { afterEach, describe, expect, test } from 'bun:test';
import { configureRuntimeUrlResolver } from '../runtime-url';

import { previewUrlToFilePath, visibleFrameArea } from './previewFrameHost';

afterEach(() => {
  configureRuntimeUrlResolver({});
});

describe('previewUrlToFilePath', () => {
  test('names the previewed file and drops the grant', () => {
    expect(previewUrlToFilePath('http://127.0.0.1:3001/api/fs/preview/grant-1/Users/me/my%20site/index.html'))
      .toBe('/Users/me/my site/index.html');
  });

  test('gives a Windows path back without the leading slash', () => {
    expect(previewUrlToFilePath('http://127.0.0.1:3001/api/fs/preview/grant-1/C:/site/index.html'))
      .toBe('C:/site/index.html');
  });

  test('drops grants under the active hosted or remote service prefix', () => {
    configureRuntimeUrlResolver({ apiBaseUrl: 'https://host.example/tools/openchamber' });
    expect(previewUrlToFilePath('https://host.example/tools/openchamber/api/fs/preview/grant-1/tmp/my%20site/index.html?x=1'))
      .toBe('/tmp/my site/index.html');
    expect(previewUrlToFilePath('https://host.example/tools/openchamber/api/fs/preview/grant-1/C:/site/index.html'))
      .toBe('C:/site/index.html');
  });

  test('keeps URLs outside the configured preview mount unchanged', () => {
    configureRuntimeUrlResolver({ apiBaseUrl: 'https://host.example/openchamber' });
    const sibling = 'https://host.example/other/api/fs/preview/grant-1/tmp/index.html';
    const external = 'https://other.example/openchamber/api/fs/preview/grant-1/tmp/index.html';
    expect(previewUrlToFilePath(sibling)).toBe(sibling);
    expect(previewUrlToFilePath(external)).toBe(external);
  });

  test('reads a new runtime prefix after an endpoint switch', () => {
    configureRuntimeUrlResolver({ apiBaseUrl: 'https://host.example/first' });
    configureRuntimeUrlResolver({ apiBaseUrl: 'https://host.example/second/' });
    expect(previewUrlToFilePath('https://host.example/second/api/fs/preview/grant-1/tmp/index.html'))
      .toBe('/tmp/index.html');
  });

  test('leaves any other address as it is', () => {
    expect(previewUrlToFilePath('https://example.com/page')).toBe('https://example.com/page');
    expect(previewUrlToFilePath('about:blank')).toBe('about:blank');
  });
});

describe('visibleFrameArea', () => {
  const screen = { left: 0, top: 0, right: 1200, bottom: 800 };

  test('photographs the whole frame when all of it is on screen', () => {
    expect(visibleFrameArea({ left: 100, top: 100, right: 700, bottom: 500 }, [screen])).toEqual({
      window: { x: 100, y: 100, width: 600, height: 400 },
      viewport: { x: 0, y: 0, width: 600, height: 400 },
    });
  });

  test('photographs only the part a tall page shows, and says where it is in the page', () => {
    // A page 2000px tall, scrolled 300px above the chat's top edge at 60px.
    const chat = { left: 80, top: 60, right: 900, bottom: 760 };
    expect(visibleFrameArea({ left: 100, top: -240, right: 820, bottom: 1760 }, [screen, chat])).toEqual({
      window: { x: 100, y: 60, width: 720, height: 700 },
      viewport: { x: 0, y: 300, width: 720, height: 700 },
    });
  });

  test('gives nothing for a frame scrolled out of view', () => {
    expect(visibleFrameArea({ left: 100, top: 900, right: 700, bottom: 1300 }, [screen])).toBeNull();
  });
});
