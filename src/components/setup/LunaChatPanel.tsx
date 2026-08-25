import { useRef, useState } from "react";
import { Paperclip, Send } from "lucide-react";
import type { GuideChatState } from "@/hooks/use-guide-chat";
import type { ChatSearch } from "@/hooks/use-setup-chat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatBox, type ChatEntry } from "./ChatBox";
import { SearchStatusLine } from "./SearchStatusLine";
import { CandidateConfirm } from "./CandidateConfirm";
import { TalkButton } from "./TalkButton";

/** Persistent chat with Luna — transcript + text input + Talk mic + attach. */
export function LunaChatPanel({
  messages,
  state,
  supported,
  search,
  candidate,
  onStart,
  onStop,
  onSend,
  onCandidateAnswer,
  onAttach,
}: {
  messages: ChatEntry[];
  state: GuideChatState;
  supported: boolean;
  search: ChatSearch | null;
  candidate: string | null;
  onStart: () => void;
  onStop: () => void;
  onSend: (text: string) => void;
  onCandidateAnswer: (answer: "yes" | "no") => void;
  /** Workflow 3 — a letter/screenshot picked straight in the chat. */
  onAttach: (file: File) => void;
}) {
  const [draft, setDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const text = draft.trim();
    // Never gated on `thinking`: turns are queued server-side of the hook, so
    // messages typed while Luna thinks wait their turn instead of vanishing
    // (the old drop-on-busy read as a dead Send button).
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <ChatBox messages={messages} />
      {search && <SearchStatusLine search={search} />}
      {candidate && <CandidateConfirm name={candidate} onAnswer={onCandidateAnswer} />}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAttach(file);
            e.target.value = "";
          }}
        />
        <Button
          size="icon"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={!onAttach}
          aria-label="Add a letter or screenshot"
          title="Add a letter or screenshot"
        >
          <Paperclip className="size-4" />
        </Button>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Tell Luna your task… or tap Talk"
          rows={1}
          className="min-h-9 resize-none"
        />
        <Button
          size="icon"
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="Send to Luna"
          title="Send"
        >
          <Send className="size-4" />
        </Button>
        <TalkButton state={state} supported={supported} onStart={onStart} onStop={onStop} />
      </div>
    </div>
  );
}
