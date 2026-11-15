// Pure business rules: no browser, filesystem or network dependencies.
export const AGE_RULES = Object.freeze({
  juvenileUnder: 19,
  mandatoryOver: 70,
});
export const numbered = (v) =>
  v
    .filter((s) => s.trim())
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
export const counselText = (d) =>
  d.defendants
    .filter((p) => p.counsel.status === "named")
    .map((p) => p.counsel.name.trim())
    .filter(Boolean)
    .join("\n");
export function detentionGlyphs(people) {
  if (people.some((p) => !["detained", "released"].includes(p.detention)))
    throw Error("피고인별 구속 여부를 확인하세요.");
  return people.map((p) => ({
    text: p.detention === "detained" ? "O" : "X",
    color: p.detention === "detained" ? "red" : "black",
  }));
}
export function validDate(y, m, d) {
  if (![y, m, d].every(Number.isInteger) || y < 1 || y > 9999) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(y, m - 1, d);
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
export function parseDate(s) {
  const m = s
    ?.trim()
    .match(
      /^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*(?:[.일])?$/,
    );
  if (!m || !validDate(+m[1], +m[2], +m[3])) return null;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}
// The auto-only experiment must never infer a century from an indictment's stated age.
// YYMMDD cannot uniquely identify a full birth year; leave age-based marks unconfirmed.
export function birthAssessment(person, filingDate) {
  const front = String(person.birthDigits ?? "").trim();
  const filing = parseDate(filingDate);
  if (!/^\d{6}$/.test(front))
    return { resolved: false, birth: null, age: null, warnings: ["주민등록번호 앞 6자리 추출 실패"] };
  const yy = Number(front.slice(0, 2));
  const month = Number(front.slice(2, 4));
  const day = Number(front.slice(4, 6));
  if (!validDate(2000 + yy, month, day) && !validDate(1900 + yy, month, day))
    return { resolved: false, birth: null, age: null, warnings: ["유효하지 않은 생년월일 앞 6자리"] };
  if (!filing)
    return { resolved: false, birth: null, age: null, warnings: ["기소일을 자동 추출하지 못했습니다"] };
  return {
    resolved: false,
    birth: null,
    age: null,
    warnings: ["YYMMDD만으로 출생 세기를 확정할 수 없어 소년·필요적국선 자동 원 표시를 보류합니다."],
  };
}
export function ageMarks(draft, rules = AGE_RULES) {
  const ages = draft.defendants.map((p) =>
    birthAssessment(p, draft.filingDate),
  );
  return {
    juvenile: ages.some((a) => a.resolved && a.age < rules.juvenileUnder),
    mandatory: ages.some((a) => a.resolved && a.age > rules.mandatoryOver),
  };
}
const clean = (s) =>
  s
    .normalize("NFC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u00a0\u3000]/g, " ");
const labelPattern = (label) => [...label].join("\\s*");
const fieldLabels = [
  "공소제기일",
  "기소일자",
  "기소일",
  "작성일자",
  "작성일",
  "검사",
  "피고인",
  "성명",
  "주민등록번호",
  "생년월일",
  "직업",
  "주거",
  "주소",
  "등록기준지",
  "죄명",
  "적용법조",
  "구속여부",
  "변호인",
  "사건번호",
  "수신자",
  "발신자",
  "제목",
];
const fieldHead = new RegExp(
  "^\\s*(?:\\d+[.)]\\s*)?(" +
    fieldLabels.map(labelPattern).join("|") +
    ")(?:\\s*[:：]\\s*|\\s+|$)(.*)$",
);
const bodyHead =
  /^(?:(?:[IVX]+|\d+)[.)]\s*)?(?:공\s*소\s*사\s*실|범\s*죄\s*사\s*실|증\s*거\s*방\s*법|첨\s*부\s*서\s*류)/;
const heading = (line) => {
  const m = clean(line).match(fieldHead);
  return m ? { label: m[1].replace(/\s/g, ""), value: m[2].trim() } : null;
};
export const labelValue = (label, line) => {
  const field = heading(line);
  return field?.label === label && field.value ? field.value : undefined;
};
const hasLabel = (label, line) => heading(line)?.label === label;
// Read a field until the next known label/body heading, including unnumbered wraps.
// The same boundary rules are used for all fields so values cannot cross defendants.
const fields = (lines) => {
  const result = [];
  let current;
  for (const raw of lines) {
    const line = clean(raw).trim();
    if (bodyHead.test(line)) break;
    const field = heading(line);
    if (field) {
      current = { label: field.label, parts: field.value ? [field.value] : [] };
      result.push(current);
    } else if (line && current) current.parts.push(line);
  }
  return result;
};
const values = (label, lines) =>
  fields(lines)
    .filter((f) => f.label === label)
    .map((f) => f.parts.join("\n"));
export class DefendantParser {
  static split(text) {
    const sections = [];
    let pending = false;
    const lines = clean(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      if (bodyHead.test(line)) break;
      const field = heading(line);
      if (field?.label === "피고인") {
        if (/관\s*련\s*사\s*항/.test(field.value)) continue;
        pending = true;
        if (field.value) {
          sections.push({ identity: field.value, lines: [] });
          pending = false;
        }
      } else if (pending && field?.label === "성명") {
        if (field.value) {
          sections.push({ identity: field.value, lines: [] });
          pending = false;
        }
      } else if (pending && !field) {
        sections.push({ identity: line.replace(/^\d+[.)]\s*/, ""), lines: [] });
        pending = false;
      } else if (
        !field &&
        /^\d+[.)]\s*\S+/.test(line) &&
        sections.length &&
        (/^\d+[.)]\s*[^()（）：:\d]+[（(]\s*\d{6}/.test(line) ||
          ["성명", "주민등록번호", "생년월일", "직업", "주거", "주소"].includes(
            heading(lines[index + 1] ?? "")?.label,
          ))
      ) {
        sections.push({ identity: line.replace(/^\d+[.)]\s*/, ""), lines: [] });
      } else {
        sections.at(-1)?.lines.push(line);
        if (field && field.label !== "성명") pending = false;
      }
    }
    return sections;
  }
  static parse(section, ocr) {
    const firstField = section.lines.findIndex((l) => heading(l));
    const identity = [
      section.identity,
      ...section.lines.slice(0, firstField < 0 ? section.lines.length : firstField),
      ...values("주민등록번호", section.lines),
      ...values("생년월일", section.lines),
    ].join("\n");
    const front = identity.match(/(?<!\d)(\d{6})(?!\d)/)?.[1] ?? "";
    const named = values("성명", section.lines)[0]?.split("\n")[0];
    return {
      id: crypto.randomUUID?.() ?? Math.random().toString(36),
      name: (named || section.identity)
        .split(/[（(\n]/)[0]
        .replace(/\d{6}.*$/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^[_、:：\s]+/, "")
        .trim(),
      birthDigits: front,
      birthReview: ocr,
      counsel: CounselParser.parse(section.lines, ocr),
      charges: ChargeParser.parse(section.lines),
      detention: DetentionParser.parse(section.lines),
    };
  }
}
export class ChargeParser {
  static parse(lines) {
    return values("죄명", lines).flatMap((v) => {
      // Newline is a separate charge unless an open parenthesis proves a wrapped title.
      const result = [];
      let balance = 0,
        chunk = "";
      const flush = () => {
        const value = chunk
          .replace(/^\s*(?:\d+[.)]|[가-힣][.)])\s*/, "")
          .trim();
        if (value) result.push(value);
        chunk = "";
      };
      for (const c of v) {
        if ("(（".includes(c)) balance++;
        if (")）".includes(c)) balance = Math.max(0, balance - 1);
        if (/[,，、;；\n]/.test(c) && balance === 0) flush();
        else if (c !== "\n") chunk += c;
      }
      flush();
      return result;
    });
  }
}
export class CounselParser {
  static parse(lines, ocr) {
    const list = values("변호인", lines),
      none = ["없음", "해당없음", "선임없음", "미선임", "X"];
    let status,
      name = "";
    if (!list.length && !lines.some((l) => hasLabel("변호인", l)))
      status = "absentMissing";
    else if (
      list.length &&
      list.every((v) => none.includes(v.replace(/\s/g, "")))
    )
      status = "absentExplicit";
    else if (
      !list.length ||
      list.some(
        (v) =>
          none.includes(v.replace(/\s/g, "")) ||
          /판독|확인불가|[?？�]|^[:：\s]*$/.test(v),
      )
    )
      status = "needsReview";
    else {
      status = "named";
      name = list.join("\n");
    }
    return { status: ocr ? "needsReview" : status, name };
  }
}
export class DetentionParser {
  static parse(lines) {
    const list = values("구속여부", lines);
    const states = list.map((s) => {
      s = s.replace(/\s/g, "");
      if (/^불구속(?:기소)?$/.test(s)) return "released";
      if (
        /^구속(?:기소)?$/.test(s) ||
        /^\d{4}[.년]\d{1,2}[.월]\d{1,2}[.일]?구속$/.test(s)
      )
        return "detained";
      return "unknown";
    });
    return states.length && states.every((s) => s === states[0])
      ? states[0]
      : "unknown";
  }
}
export class ProsecutorParser {
  static parse(lines) {
    // Names may be on the next line, spaced by PDF text items, and followed by a signature.
    const names = [
      ...new Set(
        values("검사", lines)
          .map((s) =>
            s
              .split("\n")[0]
              .replace(/[_＿]+.*$/, "")
              .replace(
                /\s*(?:[（(]인[）)]|[（(]서명[）)]|[（(]날인[）)])\s*$/,
                "",
              )
              .replace(/\s/g, "")
              .trim(),
          )
          .filter((s) => /^[가-힣]{2,10}$/.test(s)),
      ),
    ];
    return names.length === 1 ? names[0] : "";
  }
}
export class FilingDateParser {
  static parse(firstPage) {
    if (!firstPage) return null;
    const lines = clean(firstPage.text).split(/\r?\n/);
    const explicitFields = fields(lines).filter((f) =>
      ["기소일", "기소일자", "공소제기일"].includes(f.label),
    );
    const header = firstPage.ocr
      ? lines.slice(0, 8)
      : (firstPage.lines ?? [])
          .filter((l) => l.y <= firstPage.height * 0.25)
          .map((l) => clean(l.text));
    const candidates = explicitFields.length
      ? explicitFields.map((f) => f.parts.join(" "))
      : header.map((l, i) => {
          // Join only date-shaped fragments; never join an arrest/identity field into a date.
          if (!/^\s*\d{4}\s*[.년/\-]/.test(l)) return "";
          let date = l.trim();
          for (
            let j = i + 1;
            j < header.length && j <= i + 2 && !parseDate(date);
            j++
          ) {
            if (!/^\s*[\d\s.월일/\-]+$/.test(header[j])) break;
            date += " " + header[j].trim();
          }
          return date;
        });
    const dates = [...new Set(candidates.map(parseDate).filter(Boolean))];
    // Explicit but invalid/conflicting dates must not silently fall back to another header date.
    return dates.length === 1 &&
      (!explicitFields.length || candidates.every(parseDate))
      ? dates[0]
      : null;
  }
}
export class IndictmentParser {
  static parse(document) {
    const text = clean(document.text),
      sections = DefendantParser.split(text),
      lines = text.split("\n");
    const draft = {
      defendants: sections.map((s) =>
        DefendantParser.parse(s, document.usedOCR),
      ),
      prosecutor: ProsecutorParser.parse(lines),
      filingDate: FilingDateParser.parse(document.pages[0]),
      warnings: [],
    };
    if (!draft.defendants.length)
      draft.warnings.push("피고인 이름을 자동 추출하지 못했습니다.");
    if (!draft.prosecutor) draft.warnings.push("검사 이름을 확인하세요.");
    if (!draft.filingDate)
      draft.warnings.push("첫 페이지 기소일을 확정하지 못했습니다.");
    return draft;
  }
}
export function validateDraft(draft) {
  const errors = [];
  if (!draft.prosecutor?.trim()) errors.push("검사 이름 자동 추출 실패");
  if (!parseDate(draft.filingDate)) errors.push("기소일 자동 추출 실패");
  if (!draft.defendants.length) errors.push("피고인 자동 추출 실패");
  draft.defendants.forEach((p, i) => {
    const prefix = `피고인 ${i + 1}: `;
    if (!p.name?.trim()) errors.push(prefix + "이름 자동 추출 실패");
    if (!p.birthDigits || !/^\d{6}$/.test(p.birthDigits))
      errors.push(prefix + "생년월일 앞 6자리 자동 추출 실패");
    if (!p.charges?.length) errors.push(prefix + "죄명 자동 추출 실패");
    if (p.detention === "unknown") errors.push(prefix + "구속 여부 자동 추출 실패");
    if (p.counsel.status === "needsReview") errors.push(prefix + "변호인 기재 상태 자동 추출 실패");
    if (p.counsel.status === "named" && !p.counsel.name?.trim())
      errors.push(prefix + "변호인 이름 자동 추출 실패");
  });
  return errors;
}
export function emptyDefendant() {
  return {
    id: crypto.randomUUID?.() ?? Math.random().toString(36),
    name: "",
    birthDigits: "",
    statedAge: null,
    birthReview: false,
    charges: [],
    counsel: { status: "needsReview", name: "" },
    detention: "unknown",
  };
}
