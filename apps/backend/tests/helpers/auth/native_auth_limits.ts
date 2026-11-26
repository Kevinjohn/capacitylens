import type { ApiClient } from '@japa/api-client';
import app from '@adonisjs/core/services/app';
import { defineConfig } from '@adonisjs/core/http';
import env from '#start/env';

export type MutableKey = 'CAPACITYLENS_RATE_LIMIT';

export type Cleanup = (callback: () => void) => void;

export function captureEnvironment(cleanup: Cleanup, keys: MutableKey[]) {
  const previous = new Map(keys.map((key) => [key, env.get(key)]));
  cleanup(() => {
    for (const [key, value] of previous) env.set(key, value ?? '');
  });
}

export function setEnvironment(key: MutableKey, value: string) {
  env.set(key, value);
}

/** Proxy trust is read once at boot, so tests switch the booted server's setting directly. */
export const httpConfig = () => app.config.get<ReturnType<typeof defineConfig>>('app.http');

export function trustProxyHeaders(trusted: boolean) {
  httpConfig().trustProxy = trusted ? defineConfig({}).trustProxy : () => false;
}

/** A public, rate-limited read: signed out, it answers 401 until the client's budget runs out. */
export async function requestSignedOutSession(client: ApiClient, forwardedIp?: string) {
  const request = client.visit('api.session.show');
  if (forwardedIp) request.header('x-forwarded-for', forwardedIp);
  return request.send();
}

export async function responseStatus(response: Promise<{ status(): number }>) {
  const resolvedResponse = await response;
  return resolvedResponse.status();
}

export async function signIn(
  client: ApiClient,
  forwardedIp?: string,
  email = 'private-limit@example.test'
) {
  const request = client.visit('api.session.store').header('sec-fetch-site', 'same-origin');
  if (forwardedIp) request.header('x-forwarded-for', forwardedIp);
  return request.json({ email, password: 'never-store-this-password-012345' }).send();
}
