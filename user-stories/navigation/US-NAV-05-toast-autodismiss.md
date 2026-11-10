# US-NAV-05 — Read and dismiss action notices

As a company member, I want action feedback announced without blocking the page so that I can understand the result and continue.

**Status:** Current

**Access:** Owner, Admin, Editor, Viewer

**Entry:** Application live notice; Close toast button when present

**Documentation:** [Help](../../docs-src/using/help.md)

**Source:** [useAppShellController.ts](../../apps/frontend/src/components/useAppShellController.ts); [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx)

## Acceptance criteria

- Notices are announced in a polite live region; informational notices clear automatically and errors remain until dismissed.

## User flow

```mermaid
flowchart TD
  human1["An action produces a notice"]
  human2["Notice appears in the page live region"]
  human3["Info notice closes after its display period"]
  human4["Warning or error notice remains until dismissed"]
  human1 --> human2
  human2 --> human3
  human1 --> human4
```

## Code flow

```mermaid
flowchart TD
  producer["Store setNotice publishes notice"] --> bridge["useNoticeBridge watches notice"]
  bridge --> toast["showNoticeToast chooses Sonner duration"]
  toast --> host["AppShellToaster renders toast and close control"]
  toast --> clear["dismiss or auto-close clears same notice"]
```

**Code references:** [useAppShellController.ts](../../apps/frontend/src/components/useAppShellController.ts); [AppShell.tsx](../../apps/frontend/src/components/AppShell.tsx); [runtimeSlice.ts](../../apps/frontend/src/store/slices/runtimeSlice.ts)
