/** Karaoke speech tracking — pure logic, no React.
 *
 *  The presenter SDK only reports sentence-level progress
 *  (PLAYING_SPEECH_TEXT fires when a sentence STARTS being spoken) plus
 *  PERFORMANCE_START/END boundaries — there are no word timings anywhere.
 *  So the reveal runs on a nominal per-"beat" clock and re-anchors to reality
 *  every time a sentence starts, which keeps long pauses between sentences
 *  from skewing the highlight.
 *
 *  A "beat" is one Japanese mora-ish step (~MS_PER_BEAT); latin text weighs
 *  less per character because more characters fit per second.
 */

/** Hiragana/Katakana/Han plus the punctuation that should ride along with the
 *  preceding chunk instead of becoming its own tiny word. */
const CJK_RE = /[〶〷\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・、。！？「」『』（）：；…～]/u;

/** Nominal milliseconds per beat. Calibrated against the default ja voice;
 *  chunk re-anchoring absorbs most of the error anyway. */
export const MS_PER_BEAT = 170;

/** Latin characters weigh less — roughly 2.4 latin chars per mora step. */
const LATIN_WEIGHT = 0.42;

function charWeight(ch: string): number {
  return CJK_RE.test(ch) ? 1 : LATIN_WEIGHT;
}

export type KaraokeWord = {
  text: string;
  /** Whitespace that preceded this word in the original string. */
  pre: string;
  beats: number;
};

export type KaraokeTimeline = {
  words: KaraokeWord[];
  totalBeats: number;
};

function isMostlyCjk(token: string): boolean {
  let cjk = 0;
  for (const ch of token) if (CJK_RE.test(ch)) cjk += 1;
  return cjk * 2 >= token.length;
}

/** Split a display line into karaoke words. Latin text splits on whitespace;
 *  CJK has no spaces, so dense-CJK tokens are chopped into ~2-character
 *  chunks (punctuation stays glued to what precedes it) — the familiar
 *  karaoke-subtitle granularity. */
export function splitKaraokeWords(text: string): KaraokeWord[] {
  const words: KaraokeWord[] = [];
  const tokenRe = /\S+/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text))) {
    const pre = text.slice(lastEnd, m.index);
    lastEnd = m.index + m[0].length;
    const token = m[0];
    if (!isMostlyCjk(token) || token.length <= 3) {
      words.push({
        text: token,
        pre,
        beats: [...token].reduce((sum, ch) => sum + charWeight(ch), 0),
      });
      continue;
    }
    // Dense CJK: accumulate characters until the chunk carries ~2 mora.
    let chunk = "";
    let chunkBeats = 0;
    for (const ch of token) {
      chunk += ch;
      chunkBeats += charWeight(ch);
      if (chunkBeats >= 2) {
        words.push({ text: chunk, pre: words.length === 0 ? pre : "", beats: chunkBeats });
        chunk = "";
        chunkBeats = 0;
      }
    }
    if (chunk) {
      words.push({ text: chunk, pre: words.length === 0 ? pre : "", beats: Math.max(chunkBeats, 0.5) });
    }
  }
  return words;
}

/** Rough total duration used before the first sentence anchor arrives. */
export function estimateSpeechMs(text: string): number {
  let beats = 0;
  for (const ch of text) beats += charWeight(ch);
  return Math.max(500, beats * MS_PER_BEAT);
}

/** Tokenize + weight a display line into a beat timeline. */
export function buildTimeline(text: string): KaraokeTimeline {
  const words = splitKaraokeWords(text);
  return { words, totalBeats: words.reduce((sum, w) => sum + w.beats, 0) };
}

export type WordProgress = { index: number; frac: number };

/** Map a beat position onto (fully-sung word index, fraction into it). */
export function wordProgressAt(timeline: KaraokeTimeline, targetBeat: number): WordProgress {
  const count = timeline.words.length;
  if (count === 0) return { index: 0, frac: 1 };
  const b = Math.max(0, Math.min(timeline.totalBeats, targetBeat));
  let cum = 0;
  for (let i = 0; i < count; i += 1) {
    const beats = timeline.words[i].beats;
    if (b < cum + beats || i === count - 1) {
      return { index: i, frac: beats <= 0 ? 1 : Math.min(1, Math.max(0, (b - cum) / beats)) };
    }
    cum += beats;
  }
  return { index: count - 1, frac: 1 };
}

/** What UI consumers read each animation frame. */
export type SpeechView = {
  id: number;
  /** Exactly the text being spoken (motion markup stripped). */
  text: string;
  /** Fully-sung word index + fraction within the current word. */
  index: number;
  frac: number;
  /** True once PERFORMANCE_END fired — consumers render plain text again. */
  done: boolean;
};

/** Per-utterance reveal state machine. */
export class KaraokeTracker {
  private text = "";
  private timeline: KaraokeTimeline | null = null;
  private anchorBeat = 0;
  private anchorTime = 0;
  private scanFrom = 0;
  private finished = true;

  start(text: string, now: number): void {
    this.text = text;
    this.timeline = buildTimeline(text);
    this.anchorBeat = 0;
    this.anchorTime = now;
    this.scanFrom = 0;
    this.finished = false;
  }

  getText(): string {
    return this.text;
  }

  /** A PLAYING_SPEECH_TEXT event: `chunk` is the sentence that just started.
   *  Re-anchor so everything before it counts as sung from now on. */
  onChunk(chunk: string, now: number): void {
    if (!this.timeline || this.finished || !chunk) return;
    // Chunks arrive in speaking order; tolerate small overlaps.
    const at = this.text.indexOf(chunk, Math.max(0, this.scanFrom - chunk.length));
    if (at < 0) return;
    this.scanFrom = at + chunk.length;
    this.anchorBeat = this.beatsAtChar(at);
    this.anchorTime = now;
  }

  finish(): void {
    this.finished = true;
  }

  isFinished(): boolean {
    return this.finished;
  }

  progress(now: number): Omit<SpeechView, "id" | "text"> {
    if (!this.timeline || this.finished) {
      return { index: Math.max(0, (this.timeline?.words.length ?? 1) - 1), frac: 1, done: true };
    }
    const elapsed = now - this.anchorTime;
    return { ...wordProgressAt(this.timeline, this.anchorBeat + elapsed / MS_PER_BEAT), done: false };
  }

  /** Beat position of a character offset within the original text. */
  private beatsAtChar(charAt: number): number {
    if (!this.timeline) return 0;
    let acc = 0;
    let beats = 0;
    for (const w of this.timeline.words) {
      const wordStart = acc + w.pre.length;
      const wordEnd = wordStart + w.text.length;
      if (wordEnd <= charAt) {
        // Fully before the anchor — all of it counts.
        beats += w.beats;
        acc = wordEnd;
        continue;
      }
      if (wordStart >= charAt) break;
      // Anchor lands inside this word — count the partial slice and stop.
      beats += w.beats * ((charAt - wordStart) / Math.max(1, w.text.length));
      break;
    }
    return beats;
  }
}

/** Presenter speech content can embed motion markup (e.g. "[MOTION …]")
 *  before the spoken text; the SDK strips it before speaking, so the display
 *  text must too. */
export function stripMotionMarkup(content: string): string {
  return content
    .replace(/\s*\[(?:MOTION|FACE)[^\]]*\]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
