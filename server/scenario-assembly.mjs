/**
 * Job step support for the Switchboard Plan's "classify, then fill" fast
 * path (feedback point 5): when `classifyScenario` confidently matches a
 * leaf that has real module + vocab-pack content, `planScenario.mjs` calls
 * `assembleScript` here INSTEAD of an LLM call — the script comes from
 * fixed, native-authored lines plus the confirmed target's real facts
 * (name, and any posted rule, e.g. hours), not generation from a blank page.
 *
 * A leaf with no content here falls through to the existing full LLM
 * generation — unchanged, which is what keeps "handle anything thrown at
 * it" true regardless of how complete the taxonomy is.
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
// content.
const MODULE_SETS = {
  appt: loadJson("scenario-modules/appt.json"),
  medical: loadJson("scenario-modules/medical.json"),
  banking: loadJson("scenario-modules/banking.json"),
};

// leafId -> { shape }. Only leaves with a real turn-plan shape AND a vocab
// pack appear here — this is the actual hasAssemblyContent registry.
const ASSEMBLY_LEAVES = {
  "appt.doctor_dentist": "booking",
  "appt.restaurant": "booking",
  "appt.salon_laser": "booking",
  "appt.cancel_reschedule": "cancel_reschedule",
  "medical.symptom_common": "symptom_triage",
  "medical.symptom_sti": "symptom_triage",
  "medical.symptom_injury": "symptom_triage",
  "medical.symptom_skin_concern": "symptom_triage",
  "banking.lost_card": "lost_card",
};

const VOCAB_PACKS = Object.fromEntries(
  Object.keys(ASSEMBLY_LEAVES).map((leafId) => [leafId, loadJson(`vocab-packs/${leafId}.json`)]),
);

const BOOKING_OPENING_LINE = {
  "appt.doctor_dentist": { jp: "予約を取りたいのですが。", en: "I'd like to make an appointment." },
  "appt.restaurant": { jp: "予約をお願いしたいのですが。", en: "I'd like to make a reservation." },
  "appt.salon_laser": {
    jp: "施術の予約をお願いしたいのですが。",
    en: "I'd like to book a treatment session.",
  },
};

// Kept clinical and calm throughout — including for medical.symptom_sti and
// medical.symptom_skin_concern, which carry real anxiety for whoever is
// rehearsing them. No euphemism, no alarm.
const SYMPTOM_OPENING_LINE = {
  "medical.symptom_common": {
    jp: "熱と喉の痛みがあるので、診ていただきたいのですが。",
    en: "I have a fever and a sore throat, and I'd like to be seen.",
  },
  "medical.symptom_sti": {
    jp: "性感染症の検査を受けたいのですが。",
    en: "I'd like to get tested for an STI.",
  },
  "medical.symptom_injury": {
    jp: "腕をぶつけて痛みがあるので、診ていただきたいのですが。",
    en: "I hurt my arm and it's painful, and I'd like to be seen.",
  },
  "medical.symptom_skin_concern": {
    jp: "ほくろの形が変わってきた気がして、診ていただきたいのですが。",
    en: "A mole seems to have changed shape and I'd like to have it checked.",
  },
};

const SCENARIO_TITLES = {
  "appt.doctor_dentist": "診療の予約の電話",
  "appt.restaurant": "レストランの予約の電話",
  "appt.salon_laser": "美容脱毛の予約の電話",
  "appt.cancel_reschedule": "予約変更の電話",
  "medical.symptom_common": "体調不良についての電話",
  "medical.symptom_sti": "性感染症の検査についての電話",
  "medical.symptom_injury": "けがについての電話",
  "medical.symptom_skin_concern": "ほくろについての電話",
  "banking.lost_card": "カード紛失の電話",
};

const DEFAULT_PRESET = "standard";

/** True when `leafId` has a real turn-plan shape + vocab pack — the fast
 *  path applies; otherwise the caller should fall back to full LLM
 *  generation. */
export function hasAssemblyContent(leafId) {
  return Object.prototype.hasOwnProperty.call(ASSEMBLY_LEAVES, leafId);
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

/** A posted "hours" rule, spliced into a line so a conflicting request
 *  (e.g. "how about Sunday?") is headed off before the user even asks —
 *  the concrete case from feedback point 5. */
function hoursCallout(target) {
  const rule = (target?.rules ?? []).find((r) => r.kind === "hours");
  if (!rule?.rule) return null;
  return {
    jp: `なお、${rule.rule}となっておりますので、あらかじめご了承くださいませ。`,
    en: `Please note: ${rule.rule}.`,
  };
}

/** Splice an optional callout onto the end of a module/inline line. */
function withCallout(line, callout) {
  if (!callout) return line;
  return {
    jp: `${line.jp} ${callout.jp}`,
    en: line.en ? `${line.en} ${callout.en}` : undefined,
  };
}

function bookingTurnPlan(leafId, preset, target) {
  const scheduling = withCallout(modLine(leafId, "mod4_scheduling", preset, target), hoursCallout(target));
  return [
    { speaker: "bureaucrat", ...modLine(leafId, "mod1_greeting", preset, target) },
    { speaker: "user", ...BOOKING_OPENING_LINE[leafId] },
    { speaker: "bureaucrat", ...modLine(leafId, "mod2_identity", preset, target) },
    { speaker: "user", jp: "はい、田中と申します。", en: "Yes, my name is Tanaka." },
    { speaker: "bureaucrat", ...scheduling },
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
  const scheduling = withCallout(modLine(leafId, "mod4_scheduling", preset, target), hoursCallout(target));
  return [
    { speaker: "bureaucrat", ...modLine(leafId, "mod1_greeting", preset, target) },
    { speaker: "user", jp: "予約の変更をお願いしたいのですが。", en: "I'd like to change my appointment." },
    { speaker: "bureaucrat", ...modLine(leafId, "mod6_cancel_reschedule", preset, target) },
    { speaker: "user", jp: "はい、今週の金曜日の予約です。", en: "Yes, it's for this Friday." },
    { speaker: "bureaucrat", ...scheduling },
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

/** Greeting asks what's wrong (not what they want) → identity → a triage
 *  question → book a visit. Shared by all four medical.* leaves — only the
 *  opening line (what they're actually calling about) differs. */
function symptomTriageTurnPlan(leafId, preset, target) {
  const scheduling = withCallout(modLine(leafId, "mod4_scheduling", preset, target), hoursCallout(target));
  return [
    { speaker: "bureaucrat", ...modLine(leafId, "mod1_greeting", preset, target) },
    { speaker: "user", ...SYMPTOM_OPENING_LINE[leafId] },
    { speaker: "bureaucrat", ...modLine(leafId, "mod2_identity", preset, target) },
    { speaker: "user", jp: "田中と申します。", en: "My name is Tanaka." },
    { speaker: "bureaucrat", jp: "いつ頃からその症状がありますか。", en: "Since when have you had this?" },
    { speaker: "user", jp: "2日前からです。", en: "Since two days ago." },
    { speaker: "bureaucrat", ...scheduling },
    { speaker: "user", jp: "来週の水曜日はいかがでしょうか。", en: "How about next Wednesday?" },
    { speaker: "bureaucrat", ...modLine(leafId, "mod5_closing", preset, target) },
  ];
}

/** The test case for how far full prebuild can go (see the plan) — minimal
 *  branching, identity verification (name/DOB, last 4 digits of the card)
 *  carries most of the call's weight. */
function lostCardTurnPlan(preset, target) {
  const leafId = "banking.lost_card";
  const stopConfirm = withCallout(
    { jp: "確認が取れました。ただいまよりカードの利用を停止いたします。", en: "That's confirmed. We'll suspend the card's use effective immediately." },
    hoursCallout(target),
  );
  return [
    { speaker: "bureaucrat", ...modLine(leafId, "mod1_greeting", preset, target) },
    {
      speaker: "user",
      jp: "カードを紛失してしまったので、利用を止めていただきたいのですが。",
      en: "I've lost my card and would like to have its use stopped.",
    },
    { speaker: "bureaucrat", ...modLine(leafId, "mod2_identity", preset, target) },
    { speaker: "user", jp: "田中太郎です。生年月日は1990年5月10日です。", en: "Taro Tanaka. Date of birth May 10, 1990." },
    {
      speaker: "bureaucrat",
      jp: "かしこまりました。念のため、カード番号の下4桁をお伺いできますでしょうか。",
      en: "Understood. Just to confirm, could I ask for the last 4 digits of the card number?",
    },
    { speaker: "user", jp: "1234です。", en: "1234." },
    { speaker: "bureaucrat", ...stopConfirm },
    { speaker: "user", jp: "ありがとうございます。", en: "Thank you." },
    { speaker: "bureaucrat", ...modLine(leafId, "mod5_closing", preset, target) },
  ];
}

const TURN_PLAN_BUILDERS = {
  booking: (leafId, preset, target) => bookingTurnPlan(leafId, preset, target),
  cancel_reschedule: (leafId, preset, target) => cancelRescheduleTurnPlan(preset, target),
  symptom_triage: (leafId, preset, target) => symptomTriageTurnPlan(leafId, preset, target),
  lost_card: (leafId, preset, target) => lostCardTurnPlan(preset, target),
};

/**
 * Assemble a script + glossary for `leafId` from prebuilt content, with no
 * LLM call. Throws if `hasAssemblyContent(leafId)` is false — callers must
 * check first (planScenario.mjs falls back to full generation in that case).
 *
 * @param {string} leafId
 * @param {{ target?: { name?: string, rules?: { kind: string, rule: string }[] } | null, preset?: string }} opts
 */
export function assembleScript(leafId, { target, preset } = {}) {
  const shape = ASSEMBLY_LEAVES[leafId];
  if (!shape) {
    throw new Error(`No assembly content for leaf "${leafId}"`);
  }
  const voicePreset =
    preset && MODULE_SETS[departmentForLeaf(leafId)]?.modules?.mod1_greeting?.[preset] ? preset : DEFAULT_PRESET;

  const turnPlan = TURN_PLAN_BUILDERS[shape](leafId, voicePreset, target);

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
    script: { scenarioTitle: SCENARIO_TITLES[leafId] ?? "電話の練習", turns },
    glossary: vocabPack.entries,
  });
}
