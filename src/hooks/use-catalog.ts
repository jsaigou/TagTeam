import { useEffect, useState, useSyncExternalStore } from "react";

import {
  getAvatars,
  getScenes,
  getVoices,
  type ApiError,
  type CatalogItem,
} from "@/lib/api";
import { getEmail, subscribe } from "@/lib/auth";

/** Thumbnail key used for the avatar picker. */
const AVATAR_THUMBNAIL_KEY = "head";

export interface PresetAvatar {
  id: string;
  name: string;
  src: string;
}

function toPresetAvatar(item: CatalogItem): PresetAvatar {
  return {
    id: item.id,
    name: item.name,
    src: item.thumbnail_urls?.[AVATAR_THUMBNAIL_KEY] ?? "",
  };
}

interface CatalogData {
  avatars: PresetAvatar[];
  scenes: CatalogItem[];
  voices: CatalogItem[];
  isLoading: boolean;
  error: ApiError | null;
}

/**
 * Loads the Connect catalog (avatars, scenes, voices). Refetches whenever the
 * signed-in account changes so a re-login never serves a previous session's
 * data.
 */
export function useCatalog(): CatalogData {
  const accountKey = useSyncExternalStore(subscribe, () => getEmail() ?? "");
  const [data, setData] = useState<CatalogData>({
    avatars: [],
    scenes: [],
    voices: [],
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    setData((current) => ({ ...current, isLoading: true, error: null }));

    Promise.all([getAvatars(), getScenes(), getVoices()])
      .then(([avatars, scenes, voices]) => {
        if (cancelled) return;
        setData({
          avatars: avatars.items.map(toPresetAvatar),
          scenes: scenes.items,
          voices: voices.items,
          isLoading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData({
          avatars: [],
          scenes: [],
          voices: [],
          isLoading: false,
          error: (err instanceof Error ? err : new Error(String(err))) as ApiError,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  return data;
}
