// Resolve shared external-resource help copy at render time so it follows the active locale.
import { m } from "@/i18n";

/** The shared External / 3rd-party help copy (Resources tab + Settings → Additional resourcing options). */
export const externalExplainer = () => m.external_explainer();
