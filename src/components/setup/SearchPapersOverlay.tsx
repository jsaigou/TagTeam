import { createPortal } from "react-dom";
import { useAvatarWindowRect } from "@/hooks/use-avatar-window-rect";

/** Papers appearing one by one in front of Luna while she searches — the
 *  visual of her working through reference material. Purely decorative. */
export function SearchPapersOverlay() {
  const rect = useAvatarWindowRect();
  const rectStyle = (): React.CSSProperties => ({
    top: rect.top,
    left: rect.left,
    width: rect.size,
    height: rect.size,
  });
  const papers = [
    { left: "12%", top: "18%", rot: "-14deg", delay: 0 },
    { left: "46%", top: "34%", rot: "9deg", delay: 0.4 },
    { left: "24%", top: "52%", rot: "-4deg", delay: 0.8 },
    { left: "56%", top: "12%", rot: "16deg", delay: 1.2 },
    { left: "38%", top: "64%", rot: "-20deg", delay: 1.6 },
  ];
  /* Portaled to <body> so its z-30 beats the avatar stage (z-20) — inside
     the screens' `relative z-10` wrapper it would paint behind her. */
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-30 overflow-hidden rounded-2xl"
      style={rectStyle()}
    >
      <style>{`
        @keyframes tt-paper-in {
          0% { opacity: 0; transform: translate(-80%, -130%) rotate(-50deg); }
          70% { opacity: 1; }
          100% { opacity: 1; transform: translate(0, 0) rotate(var(--rot)); }
        }
        @keyframes tt-paper-float {
          0%, 100% { transform: translate(0, 0) rotate(var(--rot)); }
          50% { transform: translate(0, -7px) rotate(calc(var(--rot) + 3deg)); }
        }
      `}</style>
      {papers.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-[3px] shadow-md ring-1 ring-black/10"
          style={{
            left: p.left,
            top: p.top,
            width: "32%",
            height: "22%",
            ["--rot" as string]: p.rot,
            background:
              "linear-gradient(to bottom, #fff 0%, #f7f5f0 100%)",
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0 5px, rgba(0,0,0,.09) 5px 6px), linear-gradient(to bottom, #fff 0%, #f7f5f0 100%)",
            animation: `tt-paper-in .55s ease-out ${p.delay}s both, tt-paper-float 2.8s ease-in-out ${p.delay + 0.55}s infinite`,
          }}
        />
      ))}
    </div>,
    document.body,
  );
}
