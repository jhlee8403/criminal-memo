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
    .match(/^(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})(?:[.일])?$/);
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
export const labelValue = (label, line) =>
  line.match(
    new RegExp(
      "^\\s*(?:\\d+[.)]\\s*)?" +
        labelPattern(label) +
        "\\s*[:：]?\\s+(.+?)\\s*$",
    ),
  )?.[1];
const hasLabel = (label, line) =>
  new RegExp(
    "^\\s*(?:\\d+[.)]\\s*)?" + labelPattern(label) + "(?:\\s|[:：]|$)",
  ).test(line);
const factsHeading = (line) =>
  /^\s*(?:(?:[IVX]+|[ⅠⅡⅢⅣ]+|\d+)[.)]?\s*)?(?:공\s*소\s*사\s*실|범\s*죄\s*사\s*실)(?=\s|[:：]|$|의)/.test(line);
const defendantLabel = (line) =>
  /^\s*(?:\d+[.)]\s*)?피\s*고\s*인(?=\s|[:：]|$)\s*[:：]?\s*(.*)$/.exec(line);
export class DefendantParser {
  static split(text) {
    const sections = [];
    let awaitingIdentity = false;
    let inNumberedIdentityList = false;
    for (const source of clean(text).split("\n")) {
      const line = source.trim();
      if (!line) continue;
      if (factsHeading(line)) break;
      const label = defendantLabel(line);
      if (label && !/^관\s*련\s*사\s*항/.test(label[1])) {
        const candidate = label[1].replace(/^\d+[.)]\s*/, "").trim();
        if (candidate) {
          sections.push({ identity: candidate, lines: [] });
          awaitingIdentity = false;
          inNumberedIdentityList = false;
        } else {
          awaitingIdentity = true;
          inNumberedIdentityList = true;
        }
        continue;
      }
      if (awaitingIdentity) {
        if (/^\d+[.)]\s*.+/.test(line) || /^[가-힣]{2,4}(?:\s|[（(,]|$)/.test(line)) {
          sections.push({ identity: line.replace(/^\d+[.)]\s*/, ""), lines: [] });
        }
        awaitingIdentity = false;
        continue;
      }
      if (inNumberedIdentityList && /^\d+[.)]\s*[가-힣]{2,4}(?:\s|[（(,]|$)/.test(line)) {
        sections.push({ identity: line.replace(/^\d+[.)]\s*/, ""), lines: [] });
        continue;
      }
      if (inNumberedIdentityList && !/^\d+[.)]/.test(line)) inNumberedIdentityList = false;
      sections.at(-1)?.lines.push(line);
    }
    return sections;
  }
  static parse(section, ocr) {
    const front = section.identity.match(/(?<!\d)(\d{6})(?!\d)/)?.[1] ?? "";
    return {
      id: crypto.randomUUID?.() ?? Math.random().toString(36),
      name: section.identity
        .split(/[（(]/)[0]
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
const values = (label, lines) =>
  lines.map((l) => labelValue(label, l)).filter((v) => v !== undefined);
export class ChargeParser {
  static parse(lines) {
    const output = [];
    let active = false;
    for (const line of lines) {
      const value = labelValue("죄명", line);
      if (value) {
        output.push(value);
        active = true;
      } else if (hasLabel("죄명", line)) {
        active = true;
      } else if (
        active &&
        /^\d+[.)]\s*/.test(line) &&
        !["피고인", "적용법조", "구속여부", "변호인"].some((l) =>
          hasLabel(l, line),
        )
      ) {
        output.push(line);
      } else if (line.trim()) active = false;
    }
    return output
      .flatMap((v) => v.split(/[,，、;]/))
      .map((v) => v.replace(/^\d+[.)]\s*/, "").trim())
      .filter(Boolean);
  }
}
export class CounselParser {
  static parse(lines, ocr) {
    const chunks = [];
    let gathering = false;
    for (const source of lines) {
      const line = clean(source).trim();
      if (!line) continue;
      const lead = /^변\s*호\s*인(?=\s|[:：]|$)\s*[:：]?\s*(.*)$/.exec(line);
      if (lead) {
        gathering = true;
        if (lead[1]) chunks.push(lead[1]);
        continue;
      }
      if (/^국\s*선\s*변\s*호\s*(?:사|인)\s+/.test(line)) {
        gathering = true;
        chunks.push(line);
        continue;
      }
      if (gathering && /^(?:담\s*당\s*변\s*호\s*(?:사|인)|소\s*속\s*변\s*호\s*사|법\s*무\s*법\s*인|변\s*호\s*사)(?=\s|[:：]|$)/.test(line)) {
        chunks.push(line);
        continue;
      }
      if (gathering) break;
    }
    const raw = chunks.join(" ").replace(/\s+/g, " ").trim();
    if (!raw) return { status: lines.some(l => /^변\s*호\s*인(?=\s|[:：]|$)/.test(l)) ? "needsReview" : "absentMissing", name: "" };
    if (/^(?:없음|해당없음|선임없음|미선임|X)$/.test(raw.replace(/\s/g, "")))
      return { status: "absentExplicit", name: "" };
    if (/[?？�]/.test(raw)) return { status: "needsReview", name: "" };

    const firm = /법\s*무\s*법\s*인\s*([가-힣A-Za-z0-9·]+)/.exec(raw)?.[1];
    const counselNames = (text) => [...new Set((text.match(/[가-힣]{2,4}/g) ?? [])
      .filter(v => !["담당", "변호사", "변호인", "국선", "법무", "법인", "소속", "대표"].includes(v)))];
    if (firm) {
      const afterFirm = raw.slice(raw.indexOf(firm) + firm.length)
        .replace(/^(?:\s*[,，、:]?\s*)?(?:(?:담당|소속|대표)\s*)?변\s*호\s*(?:사|인)\s*/, "");
      const names = counselNames(afterFirm);
      if (!names.length) return { status: "needsReview", name: "" };
      return { status: "named", name: firm + ") " + names.join(",") };
    }
    if (/국\s*선/.test(raw)) {
      const after = raw.replace(/^.*?국\s*선\s*(?:변\s*호\s*(?:사|인))?\s*[:：]?\s*/, "");
      const name = after.match(/^([가-힣]{2,4})/)?.[1];
      return name ? { status: "named", name: name + "(국선)" } : { status: "needsReview", name: "" };
    }
    const simple = raw.replace(/^(?:(?:담당|소속|대표)\s*)?변\s*호\s*(?:사|인)\s*/, "").trim();
    return { status: "named", name: simple };
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
    const names = new Set();
    const header = [];
    for (const line of lines) {
      if (factsHeading(line)) break;
      header.push(line);
    }
    for (let i = 0; i < header.length; i++) {
      const m = /^\s*검\s*사(?=\s|[:：]|$)\s*[:：]?\s*(.*)$/.exec(clean(header[i]));
      if (!m) continue;
      const text = (m[1] || header[i + 1] || "").trim();
      const candidate = text.match(/^([가-힣]{2,4})(?=\s|[（(,，、]|$)/)?.[1];
      if (candidate && !["서명", "날인", "직인", "서명날인"].includes(candidate))
        names.add(candidate);
    }
    return names.size === 1 ? [...names][0] : "";
  }
}
export class FilingDateParser {
  static parse(firstPage) {
    const explicit = values("기소일", firstPage.text.split("\n")).concat(
      values("공소제기일", firstPage.text.split("\n")),
    );
    const header = firstPage.ocr
      ? firstPage.text.split("\n").slice(0, 8)
      : firstPage.lines
          .filter((l) => l.y <= firstPage.height * 0.25)
          .map((l) => l.text);
    const dates = [
      ...new Set(
        (explicit.length ? explicit : header).map(parseDate).filter(Boolean),
      ),
    ];
    return dates.length === 1 ? dates[0] : null;
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
      draft.warnings.push("피고인을 찾지 못했습니다. 직접 입력하세요.");
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
