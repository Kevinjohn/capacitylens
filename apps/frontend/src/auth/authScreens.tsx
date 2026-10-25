/** Shows an accessible loading status, optionally as a full-screen overlay. */
export function AuthLoading({ message, overlay = false }: { message: string; overlay?: boolean }) {
  const status = (
    <p
      role="status"
      aria-live="polite"
      className="rounded-md bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm"
    >
      {message}
    </p>
  );
  return overlay ? (
    <div className="fixed inset-0 z-(--z-index-modal) flex items-center justify-center bg-black/40 p-6">{status}</div>
  ) : (
    <main className="flex min-h-screen items-center justify-center p-6">{status}</main>
  );
}
