/**
 * Simulation engine: given a parsed document summary + the caller's grounding
 * answers (and a voice/register preset), produces a realistic 6-10 turn
 * municipal-office phone call plus its glossary.
 */
import type { GlossaryEntry, GroundingAnswer, SimScript } from "../shared/contract";
import {
  chatJson,
  isSimulationRaw,
  type ChatMessage,
  type ChatOptions,
} from "./llm";
import type { DocSummary } from "./doc-parser";
import { reconcileSimulation } from "./glossary";
import { SIM_SCHEMA_TEXT, bureaucratSystemPrompt } from "../prompts/bureaucrat";

export type VoicePresetId = "formal" | "standard" | "friendly";

export type VoicePreset = {
  id: VoicePresetId;
  label: string;
  /** Japanese guidance injected into the bureaucrat persona prompt. */
  guidance: string;
};

export const VOICE_PRESETS: Record<VoicePresetId, VoicePreset> = {
  formal: {
    id: "formal",
    label: "Formal",
    guidance:
      "【雰囲気】極めて丁寧で格式のある対応にしてください。窓口職員らしい厳格さは保ちつつ、ゆっくり落ち着いた印象で、定型表現（〜でございます、〜させていただきます、恐れ入りますが）を多めに使ってください。",
  },
  standard: {
    id: "standard",
    label: "Standard",
    guidance:
      "【雰囲気】市役所の一般的な電話対応として、丁寧で自然な話し方にしてください。過度に格式張らず、かといって砕けすぎない、実際の職員らしい親切で穏やかな対応にしてください。",
  },
  friendly: {
    id: "friendly",
    label: "Friendly",
    guidance:
      "【雰囲気】親しみやすく温かい対応にしてください。外国人居住者にも伝わりやすいよう少しゆっくりめに、必要に応じてやさしい表現で案内してください。ただし丁寧語は崩さないでください。",
  },
};

export const DEFAULT_VOICE_PRESET: VoicePresetId = "standard";

export type GenerateSimulationOptions = {
  preset?: VoicePresetId;
  config?: ChatOptions["config"];
  timeoutMs?: number;
};

export type SimulationResult = { script: SimScript; glossary: GlossaryEntry[] };

/** Render the doc summary + grounding answers as the user message for the model. */
export function buildSimulationContext(
  docSummary: DocSummary,
  answers: GroundingAnswer[],
): string {
  const lines = [
    "【解析した書類】",
    `文書の種類: ${docSummary.documentType}`,
    `発行元: ${docSummary.issuingAgency}`,
    `目的: ${docSummary.purpose}`,
    `重要項目: ${docSummary.keyFields.join("、")}`,
    "",
    "【電話の目的（利用者の回答）】",
    ...answers.map((a) => `- ${a.questionId}: ${a.answer}`),
    "",
    "上記の情報をもとに、市役所の担当者との電話のやり取りを台本化してください。1ターン目は必ず担当者（bureaucrat）の応答で始めてください。",
  ];
  return lines.join("\n");
}

/**
 * Generate a simulation script + glossary. The returned script is reconciled
 * against the contract (alternating turns, 6-10 turns, vocab ids present in
 * the glossary) before being returned.
 */
export async function generateSimulation(
  docSummary: DocSummary,
  answers: GroundingAnswer[],
  options: GenerateSimulationOptions = {},
): Promise<SimulationResult> {
  const preset = VOICE_PRESETS[options.preset ?? DEFAULT_VOICE_PRESET];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${bureaucratSystemPrompt(preset.guidance)}\n\n【JSONスキーマ】\n${SIM_SCHEMA_TEXT}`,
    },
    { role: "user", content: buildSimulationContext(docSummary, answers) },
  ];

  const raw = await chatJson(messages, isSimulationRaw, "SimulationRaw", {
    config: options.config,
    timeoutMs: options.timeoutMs ?? 90_000,
  });

  return reconcileSimulation({
    script: { scenarioTitle: raw.scenarioTitle, turns: raw.turns },
    glossary: raw.glossary,
  });
}
