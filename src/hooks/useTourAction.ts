import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePermissionStatus, useRole } from "@/auth/permissionContext";
import { isDemoMode } from "@/data/apiConfig";
import { useOfflineState } from "@/data/useOfflineState";
import { m } from "@/i18n";
import { startTour } from "@/lib/tour";

/** Owns the permission-aware lifecycle for the role tour launcher. */
export function useTourAction(setNotice: (message: string, tone: "error") => void) {
  const navigate = useNavigate();
  const role = useRole();
  const permissionStatus = usePermissionStatus();
  const offline = useOfflineState();
  const tourInFlight = useRef(false);
  const [tourBusy, setTourBusy] = useState(false);
  const canShowTour = (permissionStatus === "resolved" || permissionStatus === "not-applicable") && !offline.readOnly;

  const showTour = async (): Promise<void> => {
    if (!canShowTour || tourInFlight.current) return;
    tourInFlight.current = true;
    setTourBusy(true);
    try {
      await startTour({
        role,
        navigate: (path) => {
          void navigate(path);
        },
        serverMode: !isDemoMode(),
      });
    } catch {
      console.error("GettingStarted: tour failed to start");
      setNotice(m.gs_tour_failed(), "error");
    } finally {
      tourInFlight.current = false;
      setTourBusy(false);
    }
  };
  return { canShowTour, tourBusy, showTour };
}
