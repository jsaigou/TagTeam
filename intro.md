# TagTeam

**Your personal Japanese call coach — an AI avatar that helps non-native residents master real bureaucracy phone calls, one word at a time.**

---

## The problem

Living in Japan means phone calls: the ward office about your health insurance, the dentist to book an appointment, the tax office about a renewal notice. For millions of non-native residents, these calls are a wall of anxiety:

- Rapid, natural-speed Japanese with formal *keigo* you never practiced
- Procedures you can't follow and vocabulary you've never seen
- Zero ability to pause and ask for help while the call is happening
- And no safe place to practice — real officials are real consequences

A wrong word costs a re-do; silence costs confidence. TagTeam turns that wall into a safe, repeatable practice room.

## The solution

Practice the real call with a live 3D avatar *before* you ever dial. TagTeam reads the actual document you received — a photo of the notice — or lets you describe the issue in your own words, grounds exactly why you're calling, then runs a realistic Japanese phone conversation with a character whose entire job is to help you succeed.

## How it works

1. **Ground** — Upload a photo of your letter/notice, or just describe the issue. TagTeam asks 1–2 quick English questions to pin down your call's objective.
2. **Research (optional)** — Pull reference info about the office you're calling (real web results via SearXNG + Firecrawl), so the practice mirrors reality instead of a generic script.
3. **Practice** — A receptionist avatar runs a natural, authentic-speed Japanese call: *first visit? My Number card? Preferred time?* You answer; the avatar responds like the real office.
4. **Review** — A scan-friendly cheat sheet captures your goal, the exact if-then phrases for the real call, and what to practice.

## Your practice assistant, Luna

- **Luna** (cc051_meeks) greets you, waves to get your attention before you begin, and speaks an English welcome the moment you tap **Get started**.
- Luna guides you through setup, swaps into the practice role for your call (the receptionist), then returns to walk you through your cheat sheet — one consistent character across the whole journey.
- Pre-recorded Perxona motion clips (greeting wave, laugh, talk) and live speech events give her a warm, alive presence.

## The in-call co-pilot

- **Live vocabulary hints** — as the avatar speaks, the current turn's Kanji + furigana + English appear at 5x size, highlighting the words being said *right now* (driven by the presenter's speech events).
- **Tap Help** — a quick visual hint; the call keeps playing.
- **Hold Help** — pauses the call at the next turn boundary; the avatar verbally breaks down what was said, then you resume.
- The call is paced sentence-by-sentence through the presenter queue, so "hold" works naturally at turn boundaries.

## Try it

One click: **Get started → "Try the demo — book a dentist appointment" → Start call.** Or upload any notice and watch TagTeam build the call around it — the dentist demo even checks if you're a first-time patient and whether you have your **My Number card**.

## Built with

- **Perxona Connect Kit** — the `<sv-presenter>` avatar Web Component (Connect tokens minted via a thin backend proxy; real avatar/scene/voice/motion catalogs).
- **OpenAI-compatible LLM** (foundry `gemma4-26b-a4b-nothink`) — document grounding, simulation script + glossary generation, cheat sheets.
- **React 19 + Vite + TypeScript + Tailwind CSS**.
