import { ExternalLink, Scale } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

/**
 * Attributions for the technology and open-source software TagTeam is built
 * on. Pinned to the dependency versions actually shipped (see package.json /
 * SETUP.md). No vendored license texts are reproduced here — links point to
 * each project's canonical source.
 */
type Credit = {
  name: string;
  by?: string;
  license: string;
  link?: string;
  note?: string;
};

const PLATFORM: Credit[] = [
  {
    name: "Perxona Connect Platform",
    by: "Perxona",
    license: "Commercial",
    link: "https://perxona.ai",
    note: "Hosts the <sv-presenter> avatar runtime + speech synthesis (loaded from Perxona's CDN under the Connect Kit terms).",
  },
];

const SPEECH: Credit[] = [
  {
    name: "Silero VAD",
    by: "Silero Team",
    license: "MIT",
    link: "https://github.com/snakers4/silero-vad",
    note: "Voice activity detection for voice-activated talk mode.",
  },
  {
    name: "@ricky0123/vad-web",
    by: "ricky0123",
    license: "ISC",
    link: "https://github.com/ricky0123/vad",
    note: "Browser wrapper that runs Silero VAD in a Web Worker.",
  },
  {
    name: "onnxruntime-web",
    by: "Microsoft",
    license: "MIT",
    link: "https://github.com/microsoft/onnxruntime",
    note: "In-browser inference engine for the Silero VAD model.",
  },
  {
    name: "whisper.cpp",
    by: "Georgi Gerganov",
    license: "MIT",
    link: "https://github.com/ggerganov/whisper.cpp",
    note: "Self-hosted speech-to-text for live conversation.",
  },
  {
    name: "FFmpeg",
    by: "FFmpeg project",
    license: "LGPL-2.1-or-later",
    link: "https://ffmpeg.org",
    note: "Optional audio normalization for BYO-TTS mode.",
  },
];

const BACKEND: Credit[] = [
  {
    name: "Express",
    by: "OpenJS Foundation",
    license: "MIT",
    link: "https://github.com/expressjs/express",
  },
  {
    name: "ws",
    by: "Einar Otto Stangvik",
    license: "MIT",
    link: "https://github.com/websockets/ws",
    note: "WebSocket session hub.",
  },
  {
    name: "better-auth",
    by: "better-auth",
    license: "MIT",
    link: "https://github.com/better-auth/better-auth",
  },
  {
    name: "better-sqlite3",
    by: "Joshua Wise",
    license: "MIT",
    link: "https://github.com/WiseLibs/better-sqlite3",
  },
  {
    name: "Drizzle ORM",
    by: "Drizzle Team",
    license: "Apache-2.0",
    link: "https://github.com/drizzle-team/drizzle-orm",
  },
];

const FRONTEND: Credit[] = [
  {
    name: "React",
    by: "Meta",
    license: "MIT",
    link: "https://github.com/facebook/react",
  },
  {
    name: "Vite",
    by: "VoidZero",
    license: "MIT",
    link: "https://github.com/vitejs/vite",
  },
  {
    name: "TypeScript",
    by: "Microsoft",
    license: "Apache-2.0",
    link: "https://github.com/microsoft/TypeScript",
  },
  {
    name: "Tailwind CSS",
    by: "Tailwind Labs",
    license: "MIT",
    link: "https://github.com/tailwindlabs/tailwindcss",
  },
  {
    name: "shadcn/ui",
    by: "shadcn",
    license: "MIT",
    link: "https://ui.shadcn.com",
    note: "Component primitives (button, dialog, input, …), vendored into this repo.",
  },
  {
    name: "radix-ui",
    by: "WorkOS",
    license: "MIT",
    link: "https://github.com/radix-ui/primitives",
  },
  {
    name: "lucide-react",
    by: "Lucide",
    license: "ISC",
    link: "https://github.com/lucide-icons/lucide",
  },
  {
    name: "clsx",
    by: "Luke Edwards",
    license: "MIT",
    link: "https://github.com/lukeed/clsx",
  },
  {
    name: "tailwind-merge",
    by: "Dcastil",
    license: "MIT",
    link: "https://github.com/dcastil/tailwind-merge",
  },
];

const UTILITIES: Credit[] = [
  {
    name: "qrcode",
    by: "Soldair",
    license: "MIT",
    link: "https://github.com/soldair/node-qrcode",
    note: "Phone-pairing QR generation.",
  },
  {
    name: "jsQR",
    by: "Cosmo Wolfe",
    license: "Apache-2.0",
    link: "https://github.com/cozmo/jsQR",
    note: "In-app camera QR scanning.",
  },
  {
    name: "OpenCV.js",
    by: "OpenCV team",
    license: "Apache-2.0",
    link: "https://github.com/opencv/opencv",
    note: "Document edge-detect + crop for page scanning.",
  },
  {
    name: "Vitest",
    by: "VoidZero",
    license: "MIT",
    link: "https://github.com/vitest-dev/vitest",
  },
  {
    name: "oxlint",
    by: "Oxc",
    license: "MIT",
    link: "https://github.com/oxc-project/oxc",
  },
];

const GROUPS: { title: string; items: Credit[] }[] = [
  { title: "Avatar platform", items: PLATFORM },
  { title: "Speech & audio", items: SPEECH },
  { title: "Server & data", items: BACKEND },
  { title: "Frontend", items: FRONTEND },
  { title: "Utilities & tooling", items: UTILITIES },
];

function CreditRow({ credit }: { credit: Credit }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-lg border px-3 py-2">
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{credit.name}</span>
        {credit.by && <span className="text-xs text-muted-foreground">by {credit.by}</span>}
        <Badge variant="outline" className="ml-auto text-[10px]">
          {credit.license}
        </Badge>
      </span>
      {credit.note && <span className="text-xs text-muted-foreground">{credit.note}</span>}
      {credit.link && (
        <a
          href={credit.link}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-0.5 inline-flex items-center gap-1 self-start text-xs text-primary hover:underline"
        >
          {credit.link.replace(/^https?:\/\/(www\.)?/, "")}
          <ExternalLink className="size-3" />
        </a>
      )}
    </li>
  );
}

/** Tech + open-source attributions dialog (Help → or footer link). */
export function AttributionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-4 text-primary" />
            Attributions
          </DialogTitle>
          <DialogDescription>
            The technology and open-source software behind TagTeam. Versions are pinned to what this
            build actually ships; full license texts live at each project's repository.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60svh] pr-3">
          <div className="flex flex-col gap-4">
            {GROUPS.map((group) => (
              <section key={group.title} className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {group.items.map((credit) => (
                    <CreditRow key={credit.name} credit={credit} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
