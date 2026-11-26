import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ForgotPassword } from './ForgotPassword';
import { m } from '@/i18n';
import { createRequestLog } from '@/test/readAccountFetchCall';

describe('ForgotPassword', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['malformed address', 'address beyond the UTF-8 byte allowance'])(
    'keeps recovery feedback neutral and rejects a %s',
    async (invalidKind) => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      render(<ForgotPassword />);

      fireEvent.click(screen.getByRole('button', { name: m.sign_in_forgot_password() }));
      const email =
        invalidKind === 'malformed address' ? 'not-an-address' : `${'é'.repeat(124)}@x.test`;
      fireEvent.change(screen.getByLabelText(m.sign_in_email()), { target: { value: email } });
      fireEvent.click(screen.getByRole('button', { name: m.sign_in_send_reset_link() }));

      expect(screen.getByRole('alert')).toHaveTextContent(m.identity_err_email());
      // The client reaches fetch asynchronously; give a request time to arrive.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('normalizes a valid recovery address before submitting it', async () => {
    const requests = createRequestLog();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.record(input, init);
      return Response.json({ ok: true });
    });
    vi.stubGlobal('fetch', fetch);
    render(<ForgotPassword />);

    fireEvent.click(screen.getByRole('button', { name: m.sign_in_forgot_password() }));
    fireEvent.change(screen.getByLabelText(m.sign_in_email()), {
      target: { value: '  Owner@Example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: m.sign_in_send_reset_link() }));

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [request] = await requests.read();
    expect(JSON.parse(String(request?.body))).toEqual({ email: 'owner@example.com' });
    expect(await screen.findByRole('status')).toHaveTextContent(m.sign_in_reset_confirmation());
  });

  it('shows recovery-specific feedback when the reset request is rejected', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(Response.json({ error: 'Private server detail.' }, { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    render(<ForgotPassword />);

    fireEvent.click(screen.getByRole('button', { name: m.sign_in_forgot_password() }));
    fireEvent.change(screen.getByLabelText(m.sign_in_email()), {
      target: { value: 'bruce@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: m.sign_in_send_reset_link() }));

    expect(await screen.findByRole('alert')).toHaveTextContent(m.sign_in_reset_request_failed());
    expect(screen.getByRole('alert')).not.toHaveTextContent('Private server detail.');
  });
});
