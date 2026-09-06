"use client";

import { useState } from "react";
import {
  storeMetaConsentPreference,
  type MetaConsentState,
} from "@/lib/meta-consent";
import { setMetaPixelConsent } from "@/lib/meta-pixel";
import styles from "./meta-consent.module.css";

export function MetaMeasurementPreference({
  initialState,
}: {
  initialState: MetaConsentState;
}) {
  const [enabled, setEnabled] = useState(initialState === "granted");

  function updatePreference(nextEnabled: boolean) {
    const preference = nextEnabled ? "granted" : "denied";
    storeMetaConsentPreference(preference);
    setMetaPixelConsent(nextEnabled);
    setEnabled(nextEnabled);
  }

  return (
    <div className={styles.preferenceControl}>
      <div>
        <strong>Meta advertising measurement</strong>
        <span>{enabled ? "Enabled for this browser" : "Disabled for this browser"}</span>
      </div>
      <label className={styles.switchLabel}>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => updatePreference(event.target.checked)}
        />
        <span aria-hidden="true" />
        <b>{enabled ? "On" : "Off"}</b>
      </label>
    </div>
  );
}
