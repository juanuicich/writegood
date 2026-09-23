/** The Jev question for each pass: the literal instructions and criteria
 *  sent to the API, and the severity band each pass uses.
 *
 *  This is the single source the code reads. The snapshot in
 *  bench/rules/jev-2026-09-23/ documents the same text for a human reading
 *  the rule set, the way the LLM passes' rule files do. Keep the two in
 *  sync by hand; there is no shared loader. */
import type { NoulQuestion } from "./jev-client";
import type { Candidate } from "./candidates";

export type Severity = "low" | "medium" | "high";

/** Kept as a finding once the Noul probability reaches this. Below it, the
 *  candidate is treated as a decoy or an excluded case.
 *
 *  passive-actor sits lower than the other two. A probe against
 *  draft-essay.md found Jev scoring a real, gold-listed miss ("The
 *  combination was forgotten", 0.43 — the rule's own low-severity band)
 *  almost the same as a genuine decoy ("My bike was stolen", 0.42, actor
 *  unknown and irrelevant per the rule). 0.5 loses the real miss; 0.4 is
 *  the compromise. The two stay close at any threshold — see the "what did
 *  not work" note in bench/results/<date>-jev.md. */
export const KEEP_THRESHOLD: Record<"nominalization" | "passive-actor" | "filler-words", number> = {
  nominalization: 0.5,
  "passive-actor": 0.4,
  "filler-words": 0.5,
};

/** Severity from probability alone, as the task allows. Documented here so
 *  a result can be read without the code: 0.5–0.65 low, 0.65–0.85 medium,
 *  0.85–1.0 high. */
export function severityFromProbability(p: number): Severity {
  if (p >= 0.85) return "high";
  if (p >= 0.65) return "medium";
  return "low";
}

export function nominalizationQuestion(c: Candidate): NoulQuestion {
  return {
    type: "noul",
    instructions: {
      sentence: c.sentence,
      candidate: c.quote,
      question:
        "In `sentence`, does `candidate` show a buried verb: an action or a quality named as a noun " +
        "(such as decision, failure, analysis, agreement) while the clause's real verb is weak (a form of " +
        "be, or make, give, take, have, do, conduct, perform, provide, occur, or take place)? Answer yes " +
        "only when the noun could instead be the sentence's main verb and the sentence would state the " +
        "same action more directly.",
    },
    criteria: {
      true:
        "The clause's real action is hidden in the noun, carried by a weak verb; rewriting the noun as " +
        "the main verb keeps the same meaning.",
      false:
        "The verb is already a strong, specific action; or the noun is the standard name of a thing, an " +
        "event, or a concept the text discusses, not a hidden action; or the noun just refers back to an " +
        "action already stated in an earlier sentence.",
    },
  };
}

export function passiveActorQuestion(c: Candidate): NoulQuestion {
  return {
    type: "noul",
    instructions: {
      sentence: c.sentence,
      candidate: c.quote,
      question:
        "In `sentence`, is `candidate` a passive or impersonal verb whose actor is missing, where neither " +
        "the sentence nor its surrounding context names the actor or makes it obvious, and the reader " +
        "needs to know who acted because the action is a decision, an error, a cost, or a claim someone " +
        "is responsible for?",
    },
    criteria: {
      true: "The clause hides who is responsible for a decision, an error, a cost, or a claim, and the text never says.",
      false:
        "The actor is named, including in a 'by' phrase; or the actor is obvious from context; or the " +
        "actor is unknown or irrelevant, such as a historical fact or a date; or this is a methods " +
        "passive where the author is plainly the actor; or the phrase is really an adjective, such as " +
        "'is closed', 'is based on', 'is located in'.",
    },
  };
}

export function fillerWordQuestion(c: Candidate): NoulQuestion {
  return {
    type: "noul",
    instructions: {
      sentence: c.sentence,
      candidate: c.quote,
      question:
        "If `candidate` is removed from `sentence`, does the sentence still state the same fact, with the " +
        "same scope and the same certainty? Answer yes if removing it changes nothing but emphasis, a " +
        "hedge, or a claim of obviousness.",
    },
    criteria: {
      true: "Removing the word or phrase leaves the same fact, the same scope, and the same certainty; it was filler.",
      false:
        "Removing it changes the meaning, such as 'very first' or 'not quite finished'; or it states real " +
        "uncertainty, such as 'probably'; or it is 'actually' marking a contrast with what the reader " +
        "expects; or it is inside a quotation, dialogue, or a title.",
    },
  };
}
