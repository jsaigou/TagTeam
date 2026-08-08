import type { CatalogItem } from "@/lib/api";
import type { PresetAvatar } from "@/hooks/use-catalog";
import { cn } from "@/lib/utils";

export interface StageSelection {
  avatarId: string;
  sceneId: string;
  voiceId: string;
}

interface ControlBarProps {
  avatars: PresetAvatar[];
  scenes: CatalogItem[];
  voices: CatalogItem[];
  selection: StageSelection;
  onAvatarChange: (avatarId: string) => void;
  onSceneChange: (sceneId: string) => void;
  onVoiceChange: (voiceId: string) => void;
  /** Start the call — runs from this click, which is the resume-audio gesture. */
  onLaunch: () => void;
  isLoading?: boolean;
  isLaunching?: boolean;
}

/** Avatar / scene / voice pickers wired to the Connect catalog, with the
 *  user-gesture entry point that launches the presenter session. */
export function ControlBar({
  avatars,
  scenes,
  voices,
  selection,
  onAvatarChange,
  onSceneChange,
  onVoiceChange,
  onLaunch,
  isLoading = false,
  isLaunching = false,
}: ControlBarProps) {
  const canLaunch =
    !isLoading && !isLaunching && selection.avatarId && selection.sceneId;

  return (
    <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
      <div
        className={cn(
          "flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-border",
          "bg-card/90 p-4 shadow-lg backdrop-blur-sm sm:flex-row sm:items-end",
        )}
      >
        <SelectField
          label="Avatar"
          value={selection.avatarId}
          onChange={onAvatarChange}
          disabled={isLoading}
          placeholder="Select avatar"
          options={avatars.map((avatar) => ({
            value: avatar.id,
            label: avatar.name,
          }))}
        />
        <SelectField
          label="Scene"
          value={selection.sceneId}
          onChange={onSceneChange}
          disabled={isLoading}
          placeholder="Select scene"
          options={scenes.map((scene) => ({
            value: scene.id,
            label: scene.name,
          }))}
        />
        <SelectField
          label="Voice"
          value={selection.voiceId}
          onChange={onVoiceChange}
          disabled={isLoading}
          placeholder="Select voice"
          options={voices.map((voice) => ({
            value: voice.id,
            label: voice.name,
          }))}
        />

        <button
          type="button"
          onClick={onLaunch}
          disabled={!canLaunch}
          className={cn(
            "h-10 shrink-0 rounded-lg bg-primary px-5 text-sm font-medium",
            "text-primary-foreground transition-colors",
            "hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {isLaunching ? "Starting…" : "Start call"}
        </button>
      </div>
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  disabled?: boolean;
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: SelectFieldProps) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={cn(
          "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm",
          "text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
