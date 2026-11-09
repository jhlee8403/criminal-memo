import {
  IndictmentParser,
  ProsecutorParser,
  ChargeParser,
  CounselParser,
  DetentionParser,
  labelValue,
  hasLabel,
  parseDate,
} from "./core.js";
export const OCR_LIMITS = Object.freeze({
  targetDPI: 300,
  regionDPI: 400,
  maxPixels: 9_000_000,
  maxRegionPixels: 3_000_000,
  maxSide: 4300,
  maxAttemptsPerPage: 6,
  maxAttempts: 32,
  maxMilliseconds: 120_000,
  jobTimeout: 30_000,
  maxRegionsPerPage: 4,
});
export const compact = (v) => JSON.stringify(v)?.replace(/\s/g, "") ?? "";
export function textQuality(page, index = 0) {
  const t = page.text ?? "",
    useful = (t.match(/[\p{L}\p{N}]/gu) || []).length,
    broken = (t.match(/[\ufffd\ue000-\uf8ff\u0000-\u0008]/g) || []).length,
    labels = ["피고인", "죄명", "검사", "적용법조"].filter((label) =>
      new RegExp([...label].join("\\s*")).test(t),
    );
  const reasons = [];
  if (ChargeParser.ambiguous(t.split("\n")))
    reasons.push("죄명 줄바꿈 해석 불명확");
  if (useful < 20) reasons.push("유효 문자 부족");
  if (broken > 0) reasons.push("깨진 문자/사설 문자");
  if (useful >= 20 && !labels.length) reasons.push("업무 항목명 미검출");
  if (index === 0 && !ProsecutorParser.parse(t.split("\n")))
    reasons.push("검사 이름 누락/복수 후보");
  if (/죄\s*명/.test(t) && !ChargeParser.parse(t.split("\n")).length)
    reasons.push("죄명 값 누락");
  if ((t.match(/[ㄱ-ㅎㅏ-ㅣ]/g) || []).length > Math.max(3, useful * 0.08))
    reasons.push("분리된 한글 자모 과다");
  return {
    useful,
    broken,
    labelCount: labels.length,
    suspect: reasons.length > 0,
    reasons,
  };
}
export function normalizeOCRLines(data, scale = 1) {
  const lines = data.lines?.length ? data.lines : [];
  return lines.map((l) => ({
    text: l.text.trim(),
    x: l.bbox.x0 / scale,
    y: l.bbox.y1 / scale,
    box: [
      l.bbox.x0 / scale,
      l.bbox.y0 / scale,
      (l.bbox.x1 - l.bbox.x0) / scale,
      (l.bbox.y1 - l.bbox.y0) / scale,
    ],
    items: (l.words ?? []).map((w) => ({
      str: w.text,
      x: w.bbox.x0 / scale,
      y: w.bbox.y1 / scale,
      w: (w.bbox.x1 - w.bbox.x0) / scale,
      h: (w.bbox.y1 - w.bbox.y0) / scale,
      confidence: w.confidence,
    })),
    w: (l.bbox.x1 - l.bbox.x0) / scale,
    h: (l.bbox.y1 - l.bbox.y0) / scale,
    confidence: l.confidence,
  }));
}
export function searchLabel(label, text) {
  const prefix = text
    .replace(/^\s*\d+[.)]\s*/, "")
    .replace(/[\s_:：、]/g, "")
    .slice(0, 2);
  if (prefix.length !== 2 || !/^[가-힣]{2}$/.test(prefix)) return false;
  return (
    [...prefix].filter((c, i) => c !== label[i]).length <= 1 &&
    (prefix[0] === label[0] || prefix[1] === label[1])
  );
}
export function anchorRows(lines) {
  const labels = [
    "검사",
    "죄명",
    "피고인",
    "변호인",
    "구속여부",
    "적용법조",
    "직업",
    "주거",
    "등록기준지",
  ];
  return lines.flatMap((line) => {
    if (!line.items?.length) return [line];
    const items = [...line.items].sort((a, b) => a.x - b.x),
      starts = [];
    for (let i = 0; i < items.length; i++)
      for (const label of labels) {
        let prefix = "";
        for (let j = i; j < Math.min(items.length, i + label.length); j++) {
          prefix += items[j].str.replace(/\s/g, "");
          if (prefix === label) {
            starts.push(i);
            break;
          }
          if (!label.startsWith(prefix)) break;
        }
      }
    const unique = [...new Set(starts)].sort((a, b) => a - b);
    if (!unique.length) return [line];
    return unique.map((start, i) => {
      const group = items.slice(start, unique[i + 1]);
      return {
        ...line,
        text: group.map((i) => i.str).join(" "),
        items: group,
        x: group[0].x,
        w: Math.max(...group.map((i) => i.x + i.w)) - group[0].x,
      };
    });
  });
}
export function locateRegions(pages) {
  const regions = [];
  let cursor = -1;
  let inFacts = false;
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const rows = anchorRows(page.lines ?? []);
    for (let i = 0; i < rows.length; i++) {
      const line = rows[i];
      if (/^(?:[IVX]+[.)]\s*)?공\s*소\s*사\s*실/.test(line.text))
        inFacts = true;
      if (inFacts) continue;
      if (hasLabel("피고인", line.text) && !/관\s*련\s*사\s*항/.test(line.text))
        cursor++;
      const field =
        hasLabel("검사", line.text) ||
        (line.y < page.height * 0.35 && searchLabel("검사", line.text))
          ? "prosecutor"
          : hasLabel("죄명", line.text) ||
              (cursor >= 0 && searchLabel("죄명", line.text))
            ? "charges"
            : hasLabel("피고인", line.text) &&
                !/관\s*련\s*사\s*항/.test(line.text)
              ? "name"
              : hasLabel("변호인", line.text)
                ? "counsel"
                : hasLabel("구속여부", line.text)
                  ? "detention"
                  : pageIndex === 0 &&
                      line.y < page.height * 0.25 &&
                      parseDate(line.text)
                    ? "filingDate"
                    : null;
      if (!field) continue;
      const h = Math.max(10, line.h ?? 12),
        next = rows
          .slice(i + 1)
          .find((l) =>
            ["적용법조", "구속여부", "변호인", "피고인", "직업"].some((label) =>
              hasLabel(label, l.text),
            ),
          );
      const x = Math.max(0, (line.x ?? 0) - h),
        y = Math.max(0, line.y - h * 1.5),
        bottom =
          field === "prosecutor"
            ? line.y + h * 2
            : Math.min(
                next ? next.y - h * 0.5 : line.y + h * 5,
                line.y + h * 6,
              );
      let valueOnly = false;
      let roi = [
        x,
        y,
        Math.max(h, page.width - x),
        Math.max(h * 2, bottom - y),
      ];
      if (["prosecutor", "charges"].includes(field) && line.items?.length) {
        const items = [...line.items].sort((a, b) => a.x - b.x);
        const label = field === "prosecutor" ? "검사" : "죄명";
        let prefix = "",
          end = -1;
        for (let k = 0; k < items.length; k++) {
          prefix += items[k].str.replace(/\s/g, "");
          if (
            prefix === label ||
            (prefix.length === 2 && searchLabel(label, prefix))
          ) {
            end = k;
            break;
          }
          if (!label.startsWith(prefix)) break;
        }
        const values =
          end >= 0
            ? items
                .slice(end + 1)
                .filter(
                  (i) =>
                    /[\p{L}\p{N}]/u.test(i.str) && !/^[_:：\s]+$/.test(i.str),
                )
            : [];
        if (values.length) {
          const left = Math.min(...values.map((i) => i.x)),
            right = Math.max(...values.map((i) => i.x + i.w));
          roi = [
            Math.max(0, left - h * 0.6),
            Math.max(0, line.y - h * 1.2),
            Math.min(page.width - left + h * 0.6, right - left + h * 1.2),
            h * 1.7,
          ];
          if (field === "charges") {
            const continuation = rows
              .slice(i + 1)
              .filter(
                (r) =>
                  r.y < (next?.y ?? line.y + h * 6) &&
                  r.y > line.y &&
                  r.text.trim(),
              );
            if (continuation.length) {
              const last = continuation.at(-1);
              roi[3] = last.y + h * 0.6 - roi[1];
              roi[0] = Math.max(
                0,
                Math.min(roi[0], ...continuation.map((r) => r.x ?? roi[0])) -
                  h * 0.3,
              );
              roi[2] = Math.min(
                page.width - roi[0],
                Math.max(
                  right,
                  ...continuation.map((r) => (r.x ?? 0) + (r.w ?? 0)),
                ) -
                  roi[0] +
                  h * 0.6,
              );
            }
          }
          valueOnly = true;
        }
      }
      regions.push({
        key: ["name", "charges", "counsel", "detention"].includes(field)
          ? `person.${cursor}.${field}`
          : field,
        field,
        page: pageIndex + 1,
        personIndex: ["name", "charges", "counsel", "detention"].includes(field)
          ? cursor
          : null,
        box: roi,
        valueOnly,
        textHeight: Math.max(4, line.h ?? h),
        singleLine:
          field === "prosecutor" ||
          (valueOnly &&
            !rows
              .slice(i + 1)
              .some(
                (r) =>
                  r.y < (next?.y ?? line.y + h * 6) &&
                  r.y > line.y &&
                  r.text.trim(),
              )),
        anchor: line.text,
        method:
          !["prosecutor", "charges"].includes(field) ||
          hasLabel(field === "prosecutor" ? "검사" : "죄명", line.text)
            ? "label-position-context"
            : "approx-label-context",
      });
    }
    if (pageIndex === 0 && !regions.some((r) => r.field === "prosecutor"))
      regions.push({
        key: "prosecutor",
        field: "prosecutor",
        page: 1,
        personIndex: null,
        box: [
          page.width * 0.4,
          page.height * 0.035,
          page.width * 0.59,
          page.height * 0.25,
        ],
        anchor: "",
        method: "relative-header-fallback",
      });
  }
  return regions;
}
export function parseDocument(pages, usedOCR = false) {
  return IndictmentParser.parse({
    pages,
    text: pages.map((p) => p.text).join("\n"),
    usedOCR,
  });
}
export const getField = (d, key) => {
  if (key === "prosecutor" || key === "filingDate") return d[key];
  const [, index, field] = key.split(".");
  return d.defendants[+index]?.[field];
};
export function setField(d, key, value) {
  if (key === "prosecutor" || key === "filingDate") {
    d[key] = value;
    return;
  }
  const [, index, field] = key.split(".");
  if (d.defendants[+index])
    d.defendants[+index][field] = structuredClone(value);
}
export function meaningful(value) {
  return (
    value !== undefined &&
    value !== null &&
    value !== "" &&
    (!Array.isArray(value) || value.length > 0)
  );
}
export function buildEvidence(draft, sources, regions = []) {
  const keys = [
    "prosecutor",
    "filingDate",
    ...draft.defendants.flatMap((p, i) =>
      ["name", "charges", "counsel", "detention", "birthDigits"].map(
        (f) => `person.${i}.${f}`,
      ),
    ),
  ];
  return keys.map((key) => {
    const field = key.split(".").at(-1),
      index = key.startsWith("person.") ? +key.split(".")[1] : null;
    const label =
      {
        prosecutor: "검사",
        filingDate: "기소일",
        name: "피고인",
        birthDigits: "생년월일 앞 6자리",
        charges: "죄명",
        counsel: "변호인",
        detention: "구속",
      }[field] + (index === null ? "" : ` (${index + 1})`);
    const candidates = [];
    for (const source of sources) {
      if (index !== null) {
        const person = source.draft.defendants[index],
          reference = draft.defendants[index];
        if (!person) continue;
        const aligned =
          compact(person.name) === compact(reference.name) ||
          (person.birthDigits && person.birthDigits === reference.birthDigits);
        if (!aligned && field !== "name") continue;
      }
      const value = getField(source.draft, key);
      if (!meaningful(value)) continue;
      const location = regions.find((r) => r.key === key);
      if (
        source.kind === "ocr" &&
        location &&
        !source.pages?.includes(location.page)
      )
        continue;
      candidates.push({
        value,
        source: source.kind,
        page: location?.page ?? null,
        box: location?.box ?? null,
        confidence: source.confidence ?? null,
        method: source.method ?? "",
        trusted: source.trustedPages
          ? source.trustedPages.includes(location?.page ?? 1)
          : source.trusted,
        ambiguous:
          field === "charges" &&
          !!source.draft.defendants[index]?.chargeNeedsReview,
        alignmentUncertain:
          index !== null &&
          compact(source.draft.defendants[index]?.name) !==
            compact(draft.defendants[index]?.name),
      });
    }
    const result = {
      key,
      label,
      required: [
        "prosecutor",
        "charges",
        "name",
        "detention",
        "filingDate",
      ].includes(field),
      candidates,
      selectedValue: null,
      finalValue: null,
      manualValue: null,
      needsReview: false,
      conflict: false,
    };
    reconcile(result);
    return result;
  });
}
export function reconcile(field) {
  const valid = field.candidates.filter(
    (c) =>
      meaningful(c.value) &&
      c.value !== "unknown" &&
      c.value?.status !== "needsReview",
  );
  const values = [...new Set(valid.map((c) => compact(c.value)))];
  field.conflict = values.length > 1;
  if (field.userConfirmed) {
    field.needsReview = false;
    return field;
  }
  const trusted = valid.find(
    (c) => c.trusted && !c.alignmentUncertain && !c.ambiguous,
  );
  field.needsReview =
    field.conflict || !values.length || (!trusted && field.required);
  // Auto fill only unambiguous, trusted evidence; confidence alone is never a decision.
  field.selectedValue = field.conflict ? null : (trusted?.value ?? null);
  field.finalValue = field.selectedValue;
  const eligible =
    field.key === "prosecutor" || field.key?.endsWith(".charges");
  if (
    eligible &&
    !field.conflict &&
    !trusted &&
    values.length === 1 &&
    !valid.some((c) => c.ambiguous)
  ) {
    const whole = valid.some((c) => c.source === "ocr"),
      roi = new Set(
        valid.filter((c) => c.source === "precision").map((c) => c.method),
      );
    if (whole && roi.size >= 2) {
      field.selectedValue = field.finalValue = valid[0].value;
      field.needsReview = false;
      field.autoSelectionReason =
        "전체 OCR와 서로 다른 전처리의 영역 OCR가 일치 (원문 대조 필요)";
    }
  }
  if (field.verificationIncomplete && !field.userConfirmed) {
    field.needsReview = true;
    field.finalValue = field.selectedValue = null;
  }
  return field;
}
export function applyEvidence(draft, evidence) {
  draft.evidence = evidence;
  for (const f of evidence) {
    if (f.finalValue !== null) setField(draft, f.key, f.finalValue);
    else if (f.required && f.needsReview) {
      const key = f.key.split(".").at(-1);
      setField(
        draft,
        f.key,
        key === "charges"
          ? []
          : key === "detention"
            ? "unknown"
            : key === "filingDate"
              ? null
              : "",
      );
    }
  }
  return draft;
}
export function chooseField(draft, key, value, manual = false) {
  const f = draft.evidence?.find((f) => f.key === key);
  setField(draft, key, value);
  if (key.endsWith(".birthDigits")) {
    const person = draft.defendants[+key.split(".")[1]];
    if (person) person.confirmedBirthDate = "";
  }
  if (key.endsWith(".charges")) {
    const index = +key.split(".")[1];
    if (draft.defendants[index])
      draft.defendants[index].chargeNeedsReview = false;
  }
  if (f) {
    f.userConfirmed = true;
    f.finalValue = structuredClone(value);
    f.selectedValue = manual ? null : structuredClone(value);
    f.manualValue = manual ? structuredClone(value) : null;
    f.needsReview = false;
  }
}
export function precisionValues(field, text, { allowBare = false } = {}) {
  const lines = text.split("\n");
  if (field === "prosecutor") {
    const anchored = ProsecutorParser.candidates(lines);
    if (anchored.length) return anchored;
    const value = text.replace(/[_\s:：]/g, "");
    return /^[가-힣]{2,8}$/.test(value) && !/검사|죄명|공소장|적용/.test(value)
      ? [value]
      : [];
  }
  if (field === "charges") {
    const values = ChargeParser.parse(
      allowBare && !lines.some((l) => hasLabel("죄명", l))
        ? ["죄명", ...lines]
        : lines,
    );
    if (
      !values.length ||
      values.some((v) => {
        const letters = (v.match(/[\p{L}\p{N}]/gu) || []).length,
          ko = (v.match(/[가-힣]/g) || []).length;
        return (
          ko < 2 ||
          ko / Math.max(1, letters) < 0.65 ||
          /제\s*\d+\s*조|적\s*용\s*법\s*조/.test(v)
        );
      })
    )
      return [];
    return [values];
  }
  if (field === "filingDate")
    return [...new Set(lines.map(parseDate).filter(Boolean))];
  if (field === "detention") {
    const result = DetentionParser.parse(
      lines.some((l) => hasLabel("구속여부", l))
        ? lines
        : ["구속여부 " + text.trim()],
    );
    return result === "unknown" ? [] : [result];
  }
  if (field === "counsel") {
    const value = CounselParser.parse(lines, false);
    if (value.status !== "absentMissing")
      return value.status === "needsReview" ? [] : [value];
    const name = text.replace(/[_\s:：]/g, "");
    return /^[가-힣]{2,8}(?:\(국선\))?$/.test(name)
      ? [{ status: "named", name }]
      : [];
  }
  if (field === "birthDigits")
    return [...new Set(text.match(/(?<!\d)\d{6}(?!\d)/g) ?? [])];
  if (field === "name") {
    const raw = lines.map((l) => labelValue("피고인", l)).find(Boolean) ?? text;
    const name = raw
      .split(/[（(]/)[0]
      .replace(/^[_\s:：]+/, "")
      .replace(/\s/g, "");
    return /^[가-힣]{2,8}$/.test(name) ? [name] : [];
  }
  return [];
}
