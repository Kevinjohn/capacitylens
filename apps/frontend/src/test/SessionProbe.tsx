/** Shows the signed-in user's id. The hook is a prop so assertions observe the same context instance. */
export function SessionProbe({ useAuth }: { useAuth: () => { user: { id: string } | null } }) {
  const { user } = useAuth();
  return <div>{`user:${user?.id ?? 'none'}`}</div>;
}
