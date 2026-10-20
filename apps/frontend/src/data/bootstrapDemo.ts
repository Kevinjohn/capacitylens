import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import type { StoreApi } from "zustand";
import type { StoreState } from "@/store/types";

/** Installs the temporary demo seed directly into the app store. */
export function bootstrapDemo(store: StoreApi<StoreState>, seed: AppData = emptyAppData()): void {
  store.getState().replaceAll(seed);
  store.getState().setHydrated(true);
}
