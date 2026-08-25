/**
 * Sprint 1 job step support (Switchboard Plan) — template-based script
 * assembly for a classified, well-supported taxonomy leaf. This is the
 * actual "classify, then fill" fast path from feedback point 5: when
 * `classifyScenario` confidently matches a leaf that has real module +
 * vocab-pack content, `planScenario.mjs` can call `assembleScript` here
 * INSTEAD of an LLM call — the script comes from fixed, native-authored
 * lines plus the confirmed target's real facts (name, and any posted rule,
 * e.g. hours), not generation from a blank page.
 *
 * A leaf with no content here (every leaf outside the Appointments pilot,
 * for now) falls through to the existing full LLM generation — unchanged,
 * which is what keeps "handle anything thrown at it" true regardless of how
 * complete the taxonomy is.
 *
 * Reuses `reconcileSimulation` (server/glossary.mjs) so an assembled script
 * satisfies the exact same contract (alternation, 6-10 turns, vocab ids
 * resolved) an LLM-generated one does — one validation path regardless of
 * source.
 */
import { readFileSync } from "node:fs";
import { reconcileSimulation } from "./glossary.mjs";

const CONTENT_DIR = new URL("../content/", import.meta.url);

function loadJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, CONTENT_DIR), "utf8"));
}

// Department module sets — one file per department that has assembly
// content. Sprint 1 ships only "appt"; a later sprint adds its department's
// file here the same way.
const MODULE_SETS = {
  appt: loadJson("scenario-modules/appt.json"),
};

// leafId -> vocab pack. Only leaves with real content appear here.
const VOCAB_PACKS = Object.fromEntries(
  [
    "appt.doctor_dentist",
    "appt.restaurant",
    "appt.salon_laser",
    "appt.cancel_reschedule",
  ].map((leafId) => [leafId, loadJson(`vocab-packs/${leafId}.json`)]),
);

const BOOKING_OPENING_LINE = {
  "appt.doctor_dentist": { jp: "予約を取りたいのですが。", en: "I'd like to make an appointment." },
  "appt.restaurant": { jp: "予約をお願いしたいのですが。", en: "I'd like to make a reservation." },
  "appt.salon_laser": {
    jp: "施術の予約をお願いしたいのですが。",
    en: "I'd like to book a treatment session.",
  },
};

const SCENARIO_TITLES = {
  "appt.doctor_dentist": "診療の予約の電話",
  "appt.restaurant": "レストランの予約の電話",
  "appt.salon_laser": "美容脱毛の予約の電話",
  "appt.cancel_reschedule": "予約変更の電話",
};

const DEFAULT_PRESET = "standard";

/** True when `leafId` has real module + vocab-pack content — the fast path
 *  applies; otherwise the caller should fall back to full LLM generation. */
export function hasAssemblyContent(leafId) {
  return Object.prototype.hasOwnProperty.call(VOCAB_PACKS, leafId);
}

function departmentForLeaf(leafId) {
  return leafId.split(".")[0];
}

/** Resolve one module line for `leafId`'s department in the given voice
 *  preset, substituting `{facilityName}` when the target's name is known. */
function modLine(leafId, modId, preset, target) {
  const dept = departmentForLeaf(leafId);
  const set = MODULE_SETS[dept];
  const variants = set?.modules?.[modId];
  const variant = variants?.[preset] ?? variants?.[DEFAULT_PRESET];
  if (!variant) {
    throw new Error(`No module content for ${dept}/${modId}/${preset}`);
  }
  // "こちら"/"us" are real, grammatical, deliberately generic fallbacks —
  // planScenario's graph path always has a confirmed target by this point
  // (architecture principle 6: confirmTarget is a hard dep), so this only
  // matters for a direct/test call with no target.
  const name = target?.name?.trim();
  const fill = (text, fallback) => text.replaceAll("{facilityName}", name || fallback);
  return {
    jp: fill(variant.jp, "こちら").trim(),
    en: variant.en ? fill(variant.en, "us").trim() : undefined,
  };
}

/** A posted "hours" rule, appended to the scheduling line so a conflicting
 *  request (e.g. "how about Sunday?") is headed off before the user even
 *  asks — the concrete case from feedback point 5. */
function hoursCallout(target) {
  const rule = (target?.rules ?? []).find((r) => r.kind === "hours");
  if (!rule?.rule) return null;
  return {
    jp: `なお、${rule.rule}となっておりますので、あらかじめご了承くださいませ。`,
    en: `Please note: ${rule.rule}.`,
  };
}

function bookingTurnPlan(leafId, preset, target) {
  const scheduling = modLine(leafId, "mod4_scheduling", preset, target);
  const callout = hoursCallout(target);
  return [
    { speaker: "bureaucrat", ...modLine(leafId, "mod1_greeting", preset, target) },
    { speaker: "user", ...BOOKING_OPENING_LINE[leafId] },
    { speaker: "bureaucrat", ...modLine(leafId, "mod2_identity", preset, target) },
    { speaker: "user", jp: "はい、田中と申します。", en: "Yes, my name is Tanaka." },
    {
      speaker: "bureaucrat",
      jp: callout ? `${scheduling.jp} ${callout.jp}` : scheduling.jp,
      en: scheduling.en && callout ? `${scheduling.en} ${callout.en}` : scheduling.en,
    },
    { speaker: "user", jp: "来週の土曜日はいかがでしょうか。", en: "How about next Saturday?" },
    {
      speaker: "bureaucrat",
      jp: "かしこまりました。それでは、そちらのお日にちで承ります。",
      en: "Understood. We'll book you for that date.",
    },
    { speaker: "user", jp: "承知しました。よろしくお願いいたします。", en: "Understood, thank you." },
    { speaker: "bureaucrat", ...modLine(leafId, "mod5_closing", preset, target) },
  ];
}

function cancelRescheduleTurnPlan(preset, target) {
  const leafId = "appt.cancel_reschedule";
  const scheduling = modLine(leafId, "mod4_scheduling", preset, target);
  const callout = hoursCallout(target);
  return [
    { speaker: "bureaucrat", ...modLine(leafId, "mod1_greeting", preset, target) },
    { speaker: "user", jp: "予約の変更をお願いしたいのですが。", en: "I'd like to change my appointment." },
    { speaker: "bureaucrat", ...modLine(leafId, "mod6_cancel_reschedule", preset, target) },
    { speaker: "user", jp: "はい、今週の金曜日の予約です。", en: "Yes, it's for this Friday." },
    {
      speaker: "bureaucrat",
      jp: callout ? `${scheduling.jp} ${callout.jp}` : scheduling.jp,
      en: scheduling.en && callout ? `${scheduling.en} ${callout.en}` : scheduling.en,
    },
    { speaker: "user", jp: "来週の月曜日に変更したいです。", en: "I'd like to change it to next Monday." },
    {
      speaker: "bureaucrat",
      jp: "かしこまりました。それでは、そちらの日程に変更いたします。",
      en: "Understood. We'll change it to that date.",
    },
    { speaker: "user", jp: "ありがとうございます。", en: "Thank you." },
    { speaker: "bureaucrat", ...modLine(leafId, "mod5_closing", preset, target) },
  ];
}

/**
 * Assemble a script + glossary for `leafId` from prebuilt content, with no
 * LLM call. Throws if `hasAssemblyContent(leafId)` is false — callers must
 * check first (planScenario.mjs falls back to full generation in that case).
 *
 * @param {string} leafId
 * @param {{ target?: { name?: string, rules?: { kind: string, rule: string }[] } | null, preset?: string }} opts
 */
export function assembleScript(leafId, { target, preset } = {}) {
  if (!hasAssemblyContent(leafId)) {
    throw new Error(`No assembly content for leaf "${leafId}"`);
  }
  const voicePreset = preset && MODULE_SETS[departmentForLeaf(leafId)]?.modules?.mod1_greeting?.[preset]
    ? preset
    : DEFAULT_PRESET;

  const turnPlan =
    leafId === "appt.cancel_reschedule" ? cancelRescheduleTurnPlan(voicePreset, target) : bookingTurnPlan(leafId, voicePreset, target);

  const vocabPack = VOCAB_PACKS[leafId];
  const vocabIds = vocabPack.entries.map((e) => e.id);

  const turns = turnPlan.map((turn, i) => ({
    id: `t${i + 1}`,
    speaker: turn.speaker,
    jp: turn.jp,
    en: turn.en,
    // Every turn references the whole pack rather than hand-picking per
    // line — reconcileScript only keeps ids that exist in the glossary, so
    // this is safe, and the learner sees the full pack as they go.
    vocab: turn.speaker === "bureaucrat" ? vocabIds : [],
  }));

  return reconcileSimulation({
    script: { scenarioTitle: SCENARIO_TITLES[leafId] ?? "予約の電話", turns },
    glossary: vocabPack.entries,
  });
}
