const compact = (v) => JSON.stringify(v)?.replace(/\s/g, "");
const printable = (field, value) =>
  field === "counsel" ? (value?.name ?? "") : value;
export function scoreHybrid(d, expected) {
  const entries = ["prosecutor", "filingDate"].map((field) => ({
    field,
    key: field,
    expected: expected[field],
    actual: d[field],
  }));
  expected.names.forEach((name, index) => {
    const p = d.defendants[index];
    for (const field of [
      "name",
      "charges",
      "counsel",
      "birthDigits",
      "detention",
    ])
      entries.push({
        field,
        index,
        key: `person.${index}.${field}`,
        expected: field === "name" ? name : expected[field][index],
        actual: p ? printable(field, p[field]) : null,
      });
  });
  return entries.map((row) => {
    const evidence = d.evidence?.find((f) => f.key === row.key),
      p = d.defendants[row.index],
      candidates = (evidence?.candidates ?? []).map((c) =>
        printable(row.field, c.value),
      );
    // OCR counsel can keep a readable name while requiring explicit review.
    if (
      row.field === "counsel" &&
      p?.counsel.status === "needsReview" &&
      p.counsel.name
    )
      candidates.push(p.counsel.name);
    const correct = compact(row.actual) === compact(row.expected),
      candidateCorrect = candidates.some(
        (v) => compact(v) === compact(row.expected),
      );
    const pending =
      !!(evidence && (evidence.needsReview || evidence.finalValue === null)) ||
      (row.field === "counsel" && p?.counsel.status === "needsReview");
    const missing =
      row.actual == null ||
      row.actual === "" ||
      row.actual === "unknown" ||
      (Array.isArray(row.actual) && !row.actual.length);
    return {
      ...row,
      candidates,
      conflict: !!evidence?.conflict,
      classification: pending
        ? candidateCorrect
          ? "candidateIncluded"
          : candidates.length
            ? "userReview"
            : "unrecognized"
        : correct
          ? "autoCorrect"
          : missing
            ? "unrecognized"
            : "autoWrong",
      requiresUserReview: pending,
    };
  });
}
