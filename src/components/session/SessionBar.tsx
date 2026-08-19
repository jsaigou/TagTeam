import { Smartphone } from "lucide-react";
import { useSession } from "@/state/session-context";
import { cn } from "@/lib/utils";

/** Compact device indicator for the call screen header. */
export function DeviceBadge() {
  const { devices } = useSession();
  const count = devices.filter((d) => d.connected).length;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        count > 0 && "text-primary",
      )}
    >
      <Smartphone className="size-3.5" />
      {count > 0 ? `${count} phone connected` : "No phone connected"}
    </span>
  );
}