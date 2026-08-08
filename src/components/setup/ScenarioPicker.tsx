import { useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import type { ScenarioSelection } from "@/state/app-store";
import type { PresetAvatar } from "@/hooks/use-catalog";
import type { ApiError, CatalogItem } from "@/lib/api";
import { PRACTICE_AVATAR_ID, PRACTICE_SCENE_ID } from "@/lib/presets";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScenarioPickerProps = {
  onChoose: (scenario: ScenarioSelection) => void;
  busy: boolean;
  avatars: PresetAvatar[];
  scenes: CatalogItem[];
  voices: CatalogItem[];
  isLoading: boolean;
  error: ApiError | null;
};

type OptionProps = {
  label: string;
  description?: string;
  active: boolean;
  onSelect: () => void;
};

function Option({ label, description, active, onSelect }: OptionProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border px-4 py-3 text-left transition-colors",
        active
          ? "border-primary bg-primary/5 ring-1 ring-ring"
          : "border-border bg-card hover:bg-accent/30",
      )}
    >
      <span className={cn("text-sm font-medium", active && "text-primary")}>{label}</span>
      {description && <span className="text-xs text-muted-foreground">{description}</span>}
    </button>
  );
}

export function ScenarioPicker({
  onChoose,
  busy,
  avatars,
  scenes,
  voices,
  isLoading,
  error,
}: ScenarioPickerProps) {
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);

  const defaultAvatar = avatars.some((a) => a.id === PRACTICE_AVATAR_ID)
    ? PRACTICE_AVATAR_ID
    : avatars[0]?.id;
  const defaultScene = scenes.some((s) => s.id === PRACTICE_SCENE_ID)
    ? PRACTICE_SCENE_ID
    : scenes[0]?.id;
  const currentAvatar = avatarId ?? defaultAvatar;
  const currentScene = sceneId ?? defaultScene;
  const currentVoice = voiceId ?? voices[0]?.id;

  const ready = Boolean(currentAvatar && currentScene && currentVoice && !busy);

  if (isLoading) {
    return <p className="py-8 text-center text-muted-foreground">Loading scenario catalog…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error.message}
        </p>
      )}

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">Avatar</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {avatars.map((a) => (
              <Option
                key={a.id}
                label={a.name}
                active={a.id === currentAvatar}
                onSelect={() => setAvatarId(a.id)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">Scene</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {scenes.map((s) => (
              <Option
                key={s.id}
                label={s.name}
                active={s.id === currentScene}
                onSelect={() => setSceneId(s.id)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">Voice</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {voices.map((v) => (
              <Option
                key={v.id}
                label={v.name}
                active={v.id === currentVoice}
                onSelect={() => setVoiceId(v.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Sparkles className="size-4 text-accent" />
          You can change the avatar mid-call later.
        </p>
        <Button
          onClick={() =>
            onChoose({
              avatarId: currentAvatar!,
              sceneId: currentScene!,
              voiceId: currentVoice!,
            })
          }
          disabled={!ready}
          size="lg"
        >
          Start simulation
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
