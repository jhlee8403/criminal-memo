import { reconcile, applyEvidence, compact } from "../diagnostics.js";
// Run engines sequentially only on explicit request. Unknown identity matches
// stay in a separate raw report rather than attaching another person's crimes.
export function mergeEngineResults(primary, secondary) {
  const draft = primary.draft,
    other = secondary.draft,
    unmatched = [];
  for (const sf of other.evidence ?? []) {
    let key = sf.key;
    if (key.startsWith("person.")) {
      const index = +key.split(".")[1],
        p = other.defendants[index];
      const matches = draft.defendants
        .map((q, i) => ({ q, i }))
        .filter(
          ({ q }) =>
            p?.name &&
            q.name === p.name &&
            (!p.birthDigits ||
              !q.birthDigits ||
              p.birthDigits === q.birthDigits),
        );
      if (matches.length !== 1) {
        unmatched.push(sf);
        continue;
      }
      key = key.replace(/^person\.\d+\./, `person.${matches[0].i}.`);
    }
    const field = draft.evidence.find((f) => f.key === key);
    if (!field) {
      unmatched.push(sf);
      continue;
    }
    const fromOCR = sf.candidates
      .filter((c) => c.source !== "embedded")
      .map((c) => ({
        ...c,
        engine: "paddle",
        method: `Paddle/${c.method ?? "whole"}`,
        trusted: false,
      }));
    field.candidates.push(...fromOCR);
    const values = new Set(
      field.candidates
        .filter((c) => c.value != null)
        .map((c) => compact(c.value)),
    );
    // Explicit comparison never resolves disagreements by engine/confidence vote.
    if (values.size > 1) {
      field.userConfirmed = false;
      field.manualValue = null;
    }
    reconcile(field);
  }
  applyEvidence(draft, draft.evidence);
  primary.diagnostics.comparison = {
    engine: "paddle",
    elapsedMs: secondary.diagnostics.elapsedMs,
    unmatched,
    defendants: other.defendants.map((p) => ({
      name: p.name,
      birthDigits: p.birthDigits,
    })),
    pages: secondary.diagnostics.pages,
  };
  for (let i = 0; i < primary.diagnostics.pages.length; i++) {
    const a = primary.diagnostics.pages[i],
      b = secondary.diagnostics.pages[i];
    a.wholeOCR.push(...(b?.wholeOCR ?? []));
    a.precision.push(...(b?.precision ?? []));
  }
  primary.diagnostics.attempts += secondary.diagnostics.attempts;
  primary.diagnostics.elapsedMs += secondary.diagnostics.elapsedMs;
  primary.engine = "compare";
  return primary;
}
