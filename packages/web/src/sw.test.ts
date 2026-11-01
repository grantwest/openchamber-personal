import { afterEach, describe, expect, it, vi } from 'vitest';

type PushFixture = { title: string; icon?: string };

type WorkerEvent = {
  data?: { json: () => PushFixture };
  notification?: { close: () => void; data: unknown };
  waitUntil: (task: Promise<unknown>) => void;
};

const client = (url: string, visible = false) => ({
  url,
  visibilityState: visible ? 'visible' : 'hidden',
  focused: visible,
  navigate: vi.fn(async () => undefined),
  focus: vi.fn(async () => undefined),
});

const installWorker = async (scope: string, windows = [client('https://example.com/other/', true)]) => {
  const addEventListener = vi.fn<(type: string, listener: (event: WorkerEvent) => void) => void>();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  vi.stubGlobal('self', {
    registration: { scope, showNotification },
    clients: { matchAll: vi.fn(async () => windows), openWindow },
    addEventListener,
  });
  await import('./sw');

  const dispatch = async (type: string, fields: Omit<WorkerEvent, 'waitUntil'>) => {
    const listener = addEventListener.mock.calls.find(([name]) => name === type)?.[1];
    if (!listener) throw new Error(`Missing worker listener: ${type}`);
    const tasks: Promise<unknown>[] = [];
    listener({ ...fields, waitUntil: (task) => { tasks.push(task); } });
    await Promise.all(tasks);
  };
  return { dispatch, showNotification, openWindow };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('deployment-scoped service worker', () => {
  it.each(['https://example.com/', 'https://example.com/openchamber/'])(
    'resolves notification icons under %s', async (scope) => {
      const { dispatch, showNotification } = await installWorker(scope, []);
      await dispatch('push', { data: { json: () => ({ title: 'Ready' }) } });
      expect(showNotification).toHaveBeenCalledWith('Ready', expect.objectContaining({
        icon: `${scope}apple-touch-icon-180x180.png`,
        badge: `${scope}favicon-32.png`,
      }));
    },
  );

  it('does not suppress push when a different hosted application is visible', async () => {
    const { dispatch, showNotification } = await installWorker('https://example.com/openchamber/');
    await dispatch('push', { data: { json: () => ({ title: 'Ready', icon: '/pwa-192.png' }) } });
    expect(showNotification).toHaveBeenCalledWith('Ready', expect.objectContaining({
      icon: 'https://example.com/openchamber/pwa-192.png',
    }));
  });

  it('suppresses push when this deployment is visible', async () => {
    const { dispatch, showNotification } = await installWorker('https://example.com/openchamber/', [
      client('https://example.com/openchamber/?session=current', true),
    ]);
    await dispatch('push', { data: { json: () => ({ title: 'Ready' }) } });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('uses the deployment window and preserves legacy root-absolute push links', async () => {
    const other = client('https://example.com/other/');
    const app = client('https://example.com/openchamber/');
    const { dispatch, openWindow } = await installWorker('https://example.com/openchamber/', [other, app]);
    await dispatch('notificationclick', {
      notification: { close: vi.fn(), data: { url: '/?session=ses_1' } },
    });
    expect(other.navigate).not.toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
    expect(app.navigate).toHaveBeenCalledWith('https://example.com/openchamber/?session=ses_1');
    expect(app.focus).toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it.each([
    [{ sessionId: 'ses_1' }, 'https://example.com/openchamber/?session=ses_1'],
    [{ url: '/openchamber/?session=ses_1' }, 'https://example.com/openchamber/?session=ses_1'],
    [{}, 'https://example.com/openchamber/'],
    [{ url: 'https://other.example/' }, 'https://example.com/openchamber/'],
  ])('opens a scoped window for notification data %j', async (data, target) => {
    const { dispatch, openWindow } = await installWorker('https://example.com/openchamber/');
    await dispatch('notificationclick', { notification: { close: vi.fn(), data } });
    expect(openWindow).toHaveBeenCalledWith(target);
  });
});
