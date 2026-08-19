import { useCallback, useEffect, useState } from "react";

/**
 * Scanner availability. Browsers have no standard "document scanner" API, so a
 * real scanner cannot be auto-detected today. The reliable reveal path is a
 * Settings toggle ("Document scanner connected") persisted to localStorage and
 * broadcast so the setup-screen buttons update reactively. This is also the
 * extension point for a future WebUSB / OS-bridge probe.
 */
const KEY = "tagteam.scanner-connected";
const EVENT = "tagteam:scanner";

export function isScannerConnected(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setScannerConnected(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable — button simply won't show */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useScannerAvailable(): boolean {
  const [on, setOn] = useState(isScannerConnected);

  useEffect(() => {
    const sync = () => setOn(isScannerConnected());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  return on;
}

/** Expose the toggle for the Settings dialog (reads live value via state). */
export function useScannerSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(isScannerConnected);
  const toggle = useCallback((next: boolean) => {
    setScannerConnected(next);
    setOn(next);
  }, []);
  return [on, toggle];
}