import { useEffect, useState } from "react";
import { m } from "@/i18n";
import type { JoiningPolicySettings } from "@capacitylens/shared/account/types";
import { teamAccessClient } from "../../account/teamAccessClient";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { JoiningPolicySection } from "./JoiningPolicySection";

type LoadState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; settings: JoiningPolicySettings };

/** Account-keyed caller: only the authenticated Owner/Admin mounts this control-plane read. */
export function JoiningPolicyPanel({ accountId, role }: { accountId: string; role: "owner" | "admin" }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void teamAccessClient.readJoiningPolicy(accountId)
      .then((result) => {
        if (!current) return;
        setState(result.kind === "ok" ? { kind: "ready", settings: result.value } : { kind: "failed" });
      })
      .catch(() => { if (current) setState({ kind: "failed" }); });
    return () => { current = false; };
  }, [accountId, attempt]);

  if (state.kind === "loading") return null;
  if (state.kind === "failed") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{m.joining_policy_load_failed()}</AlertDescription>
        <Button type="button" size="sm" variant="outline" onClick={() => {
          setState({ kind: "loading" });
          setAttempt((value) => value + 1);
        }}>{m.joining_policy_retry()}</Button>
      </Alert>
    );
  }
  if (role === "admin") return <JoiningPolicySection role="admin" settings={state.settings} />;
  return <JoiningPolicySection role="owner" settings={state.settings} onSave={async (settings) => {
    const result = await teamAccessClient.setJoiningPolicy(accountId, settings);
    if (result.kind !== "ok") throw new Error("Joining policy was not saved.");
    setState({ kind: "ready", settings: result.value });
  }} />;
}
