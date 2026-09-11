/** Formats an invite instant in the viewer's locale without redundant seconds or current year. */
export function formatInviteExpiry(expiresAt: string, now = new Date()) {
  const expiry = new Date(expiresAt);
  const currentYear = now.getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(expiry.getFullYear() === currentYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  }).format(expiry);
}
