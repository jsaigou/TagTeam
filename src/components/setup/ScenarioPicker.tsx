import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import type { CallDifficulty, CallPace, CallSettings, RoleId } from "@/shared/contract";
import type { PresetAvatar } from "@/hooks/use-catalog";
import type { ApiError } from "@/lib/api";
import { PRACTICE_ROLE_AVATAR_IDS } from "@/lib/presets";
import { CALL_ROLES, DIFFICULTIES, PACES } from "@/lib/coaching";
import {
  DEPARTMENTS,
  DEPARTMENT_IDS,
  leavesForDepartment,
  type DepartmentId,
} from "@/lib/scenario-taxonomy";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ScenarioPickerProps = {
  /** Starts a real run (server graph — classify-then-fill, target grounding)
   *  for the given objective text and the practice role/avatar to launch
   *  with. Replaces the old onChoose(selection)/pipeline.runSim path. */
  onStart: (objective: string, role: RoleId) => void;
  busy: boolean;
  avatars: PresetAvatar[];
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

/** One curated role card: the role + its pack avatar thumbnail (max 3, one
 *  per role) — the City Hall department's sub-picker (unchanged from before
 *  the taxonomy overhaul: these three roles are staff WITHIN one department,
 *  an orthogonal choice from which department the call is about). */
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

/** One department card — the top-level "what is this call about" choice. */
function DepartmentCard({
  id,
  label,
  active,
  onSelect,
}: {
  id: DepartmentId;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-primary bg-primary/5 ring-1 ring-ring"
          : "border-border bg-card hover:bg-accent/30",
      )}
    >
      <span className={cn("text-sm font-medium", active && "text-primary")}>{label}</span>
      <span className="text-xs text-muted-foreground">
        {leavesForDepartment(id).length} call type{leavesForDepartment(id).length === 1 ? "" : "s"}
      </span>
    </button>
  );
}

const GOV_DEPARTMENT: DepartmentId = "gov";
/** No per-leaf avatar exists in the Perxona catalog yet outside the three
 *  curated City Hall roles — every non-gov department launches with the
 *  reception pack (a generic front-desk avatar) until dedicated assets
 *  exist. Tracked as a known limitation, not silently papered over. */
const DEFAULT_LEAF_ROLE: RoleId = "reception";

export function ScenarioPicker({
  onStart,
  busy,
  avatars,
  isLoading,
  error,
  settings,
  onSettingsChange,
}: ScenarioPickerProps) {
  const [department, setDepartment] = useState<DepartmentId | null>(null);
  const [leafId, setLeafId] = useState<string | null>(null);
  const [role, setRole] = useState<RoleId>(settings.role);

  const leaves = useMemo(
    () => (department && department !== GOV_DEPARTMENT ? leavesForDepartment(department) : []),
    [department],
  );

  const currentAvatar = useMemo(() => {
    const id = PRACTICE_ROLE_AVATAR_IDS[role];
    return avatars.find((a) => a.id === id);
  }, [role, avatars]);

  const handleDepartmentChange = (next: DepartmentId) => {
    setDepartment(next);
    setLeafId(null);
    if (next !== GOV_DEPARTMENT) {
      setRole(DEFAULT_LEAF_ROLE);
      onSettingsChange({ ...settings, role: DEFAULT_LEAF_ROLE });
    }
  };

  const handleRoleChange = (next: RoleId) => {
    setRole(next);
    onSettingsChange({ ...settings, role: next });
  };

  const handleDifficultyChange = (difficulty: CallDifficulty) =>
    onSettingsChange({ ...settings, difficulty });

  const handlePaceChange = (pace: CallPace) => onSettingsChange({ ...settings, pace });

  const ready =
    !busy &&
    department != null &&
    (department === GOV_DEPARTMENT ? Boolean(currentAvatar) : leafId != null);

  const handleStart = () => {
    if (!ready || !department) return;
    if (department === GOV_DEPARTMENT) {
      onStart("I need to call city hall about a matter.", role);
      return;
    }
    const leaf = leaves.find((l) => l.id === leafId);
    if (!leaf) return;
    onStart(leaf.examples[0] ?? leaf.label, DEFAULT_LEAF_ROLE);
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
            {department == null ? "What's this call about" : DEPARTMENTS[department].label}
          </p>

          {department == null && (
            <div className="grid gap-2 sm:grid-cols-2">
              {DEPARTMENT_IDS.map((id) => (
                <DepartmentCard
                  key={id}
                  id={id}
                  label={DEPARTMENTS[id].label}
                  active={department === id}
                  onSelect={() => handleDepartmentChange(id)}
                />
              ))}
            </div>
          )}

          {department != null && (
            <button
              type="button"
              onClick={() => setDepartment(null)}
              className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" />
              Choose a different kind of call
            </button>
          )}

          {department === GOV_DEPARTMENT && (
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
          )}

          {department != null && department !== GOV_DEPARTMENT && (
            <div className="grid gap-2 sm:grid-cols-2">
              {leaves.map((leaf) => (
                <Option
                  key={leaf.id}
                  label={leaf.label}
                  active={leafId === leaf.id}
                  onSelect={() => setLeafId(leaf.id)}
                />
              ))}
            </div>
          )}
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
          {department === GOV_DEPARTMENT
            ? "Scene and voice follow the role automatically."
            : "Luna will research the real place and ground the call in what she finds."}
        </p>
        <Button onClick={handleStart} disabled={!ready} size="lg" className="gap-2">
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {busy ? "Writing your call…" : "Start simulation"}
          {!busy && <ChevronRight />}
        </Button>
      </div>
    </div>
  );
}
