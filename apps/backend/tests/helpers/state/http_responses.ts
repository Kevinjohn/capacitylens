import { readFile } from 'node:fs/promises';

/** The headers every response, success or early error, carries. */
export const securityHeaders = [
  'content-security-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'referrer-policy',
  'x-content-type-options',
  'x-frame-options',
];

/** The content security policy the static shell and its assets are served with. */
export const strictPolicy =
  "default-src 'self';script-src 'self';style-src 'self';style-src-attr 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self';frame-ancestors 'none';object-src 'none';base-uri 'none';form-action 'self'";

/** The responses main recorded for each read path, replayed by the read-path tests. */
export const recordedResponses = JSON.parse(
  await readFile(new URL('../../fixtures_main_responses.json', import.meta.url), 'utf8')
) as {
  responses: Array<{
    method: 'GET' | 'POST';
    path: string;
    status: number;
    body: unknown;
    headers: Record<string, string>;
  }>;
};
