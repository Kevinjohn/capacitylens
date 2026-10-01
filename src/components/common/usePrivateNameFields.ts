import { useState } from "react";
import { canSeePrivateNames } from "@capacitylens/shared/domain/access";
import { normalizeCodeName } from "@capacitylens/shared/domain/privateNames";
import { useRole } from "../../auth/permissionContext";
import type { FieldError as FormFieldError } from "../../hooks/useFieldError";
import { parseName } from "../../lib/validation";

interface PrivateNameSource {
  isPrivate?: boolean;
  codeName?: string;
}

interface PrivacyPatch {
  isPrivate?: true | undefined;
  codeName?: string | undefined;
}

export function usePrivateNameFields(source: PrivateNameSource | undefined, fail: FormFieldError["fail"]) {
  const role = useRole();
  const canManagePrivacy = role === null || canSeePrivateNames(role);
  const protectedName = source?.isPrivate === true && !canManagePrivacy;
  const [isPrivate, setIsPrivate] = useState(source?.isPrivate ?? false);
  const [codeName, setCodeName] = useState(source?.codeName ?? "");

  const parsePrivacyPatch = (): PrivacyPatch | null => {
    if (!canManagePrivacy) return {};
    if (!isPrivate) return { isPrivate: undefined, codeName: undefined };
    const cleanCodeName = parseName(normalizeCodeName(codeName), fail, "codeName");
    return cleanCodeName ? { isPrivate: true, codeName: cleanCodeName } : null;
  };

  return {
    canManagePrivacy,
    protectedName,
    isPrivate,
    setIsPrivate,
    codeName,
    setCodeName,
    parsePrivacyPatch,
  };
}

export type PrivateNameFieldsState = ReturnType<typeof usePrivateNameFields>;
