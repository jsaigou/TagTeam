import { useEffect, useState } from "react";

/** Detect a real desktop/laptop webcam via `enumerateDevices`. Kept reactive to
 *  `devicechange` so plugging/unplugging a camera updates the setup buttons. */
export function useWebcamAvailable(): boolean {
  const [has, setHas] = useState(false);

  useEffect(() => {
    let active = true;
    const md = navigator.mediaDevices;
    const check = async () => {
      if (!md?.enumerateDevices) {
        if (active) setHas(false);
        return;
      }
      try {
        const devices = await md.enumerateDevices();
        if (active) setHas(devices.some((d) => d.kind === "videoinput"));
      } catch {
        if (active) setHas(false);
      }
    };
    void check();
    md?.addEventListener?.("devicechange", check);
    return () => {
      active = false;
      md?.removeEventListener?.("devicechange", check);
    };
  }, []);

  return has;
}