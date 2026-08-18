import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import type { CallDifficulty, CallPace, CallSettings, RoleId } from "@/shared/contract";
import type { ScenarioSelection } from "@/state/app-store";
import type { PresetAvatar } from "@/hooks/use-catalog";
import type { ApiError, CatalogItem } from "@/lib/api";
import {
  PRACTICE_ROLE_AVATAR_IDS,
  PRACTICE_SCENE_ID,
  resolveRoleSelection,
} from "@/lib/presets";
import { CALL_ROLES, DIFFICULTIES, PACES } from "@/lib/coaching";
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
  /** Phase 4 — coaching settings. */
  settings: CallSettings;
  onSettingsChange: (settings: CallSettings) => void;
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

/** One curated role card: the role + its pack avatar thumbnail (max 3, one per role). */
function RoleCard({
  role,
  avatar,
  active,
  onSelect,
}: {
  role: RoleId;
  avatar?: PresetAvatar;
  active: boolean;
  onSelect: () => void;
}) {
  const meta = CALL_ROLES[role];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors",
        active
          ? "border-primary bg-primary/5 ring-1 ring-ring"
          : "border-border bg-card hover:bg-accent/30",
      )}
    >
      <div className="flex h-28 items-center justify-center overflow-hidden rounded-md bg-muted/50">
        {avatar?.src ? (
          <img
            src={avatar.src}
            alt={avatar.name}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{meta.label}</span>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-0.5">
        <span className={cn("text-sm font-medium", active && "text-primary")}>{meta.label}</span>
        <span className="text-xs text-muted-foreground">{meta.description}</span>
      </div>
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
  settings,
  onSettingsChange,
}: ScenarioPickerProps) {
  const [role, setRole] = useState<RoleId>(settings.role);

  /* Follow externally-suggested role changes (auto-inferred from context). */
  useEffect(() => {
    setRole(settings.role);
  }, [settings.role]);

  /* The role's curated avatar (one of exactly three). Scene + voice follow the
     role pack — never user-selectable. */
  const currentAvatar = useMemo(() => {
    const id = PRACTICE_ROLE_AVATAR_IDS[role];
    return avatars.find((a) => a.id === id);
  }, [role, avatars]);

  const ready = Boolean(currentAvatar && !busy);

  const handleRoleChange = (next: RoleId) => {
    onSettingsChange({ ...settings, role: next });
  };

  const handleDifficultyChange = (difficulty: CallDifficulty) =>
    onSettingsChange({ ...settings, difficulty });

  const handlePaceChange = (pace: CallPace) => onSettingsChange({ ...settings, pace });

  const handleChoose = () => {
    const selection = resolveRoleSelection(role, avatars, scenes, voices, {
      avatarId: currentAvatar?.id ?? avatars[0]?.id ?? "",
      sceneId: PRACTICE_SCENE_ID,
      voiceId: voices[0]?.id ?? "",
    });
    if (!selection.avatarId || !selection.sceneId || !selection.voiceId) return;
    onChoose(selection);
  };

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
          <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <Sparkles className="size-3.5 text-accent" />
            Who answers the phone
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(CALL_ROLES) as RoleId[]).map((roleId) => (
              <RoleCard
                key={roleId}
                role={roleId}
                avatar={avatars.find((a) => a.id === PRACTICE_ROLE_AVATAR_IDS[roleId])}
                active={role === roleId}
                onSelect={() => handleRoleChange(roleId)}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Luna picks the right staff member from your document — you can switch if you prefer.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">Difficulty</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(DIFFICULTIES) as CallDifficulty[]).map((difficulty) => (
              <Option
                key={difficulty}
                label={DIFFICULTIES[difficulty].label}
                active={settings.difficulty === difficulty}
                onSelect={() => handleDifficultyChange(difficulty)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-primary">Pace</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(PACES) as CallPace[]).map((pace) => (
              <Option
                key={pace}
                label={PACES[pace].label}
                active={settings.pace === pace}
                onSelect={() => handlePaceChange(pace)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Scene and voice follow the role automatically.
        </p>
        <Button onClick={handleChoose} disabled={!ready} size="lg" className="gap-2">
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy ? "Writing your call…" : "Start simulation"}
          {!busy && <ChevronRight />}
        </Button>
      </div>
    </div>
  );
}
