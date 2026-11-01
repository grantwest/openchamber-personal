import { describe, expect, test } from 'bun:test';
import { deploymentUrl, getDeploymentApiBaseUrl, getDeploymentBasePath } from './deployment-path';

type DeploymentWindow = {
  location: { origin: string };
  __OPENCHAMBER_BASE_PATH__?: string;
};

describe('hosted deployment paths', () => {
  const withWindow = (value: DeploymentWindow | undefined, callback: () => void): void => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, value });
    try {
      callback();
    } finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  };

  test('keeps server-side resource URLs unchanged without a window', () => {
    withWindow(undefined, () => {
      expect(getDeploymentBasePath()).toBe('');
      expect(getDeploymentApiBaseUrl()).toBe('');
      expect(deploymentUrl('/sw.js')).toBe('/sw.js');
    });
  });

  test('keeps root-hosted resource URLs unchanged', () => {
    withWindow({ location: { origin: 'https://lab.example' } }, () => {
      expect(getDeploymentBasePath()).toBe('');
      expect(getDeploymentApiBaseUrl()).toBe('');
      expect(deploymentUrl('/sw.js')).toBe('/sw.js');
    });
  });

  test('scopes resources and the default API to the deployment', () => {
    withWindow({ location: { origin: 'https://lab.example' }, __OPENCHAMBER_BASE_PATH__: '/tools/openchamber' }, () => {
      expect(getDeploymentApiBaseUrl()).toBe('https://lab.example/tools/openchamber');
      expect(deploymentUrl('/')).toBe('/tools/openchamber/');
      expect(deploymentUrl('/sw.js')).toBe('/tools/openchamber/sw.js');
      expect(deploymentUrl('https://other.example/image.png')).toBe('https://other.example/image.png');
      expect(deploymentUrl('//other.example/image.png')).toBe('//other.example/image.png');
      expect(deploymentUrl('#symbol')).toBe('#symbol');
    });
  });

  test('does not derive a network API from a native origin', () => {
    withWindow({ location: { origin: 'capacitor://localhost' }, __OPENCHAMBER_BASE_PATH__: '/openchamber' }, () => {
      expect(getDeploymentApiBaseUrl()).toBe('');
    });
  });
});
