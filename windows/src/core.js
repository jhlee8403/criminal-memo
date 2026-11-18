// Pure business rules: no browser, filesystem or network dependencies.
export const AGE_RULES = Object.freeze({
  juvenileUnder: 19,
  mandatoryAtLeast: 70,
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
export function detentionGlyphs(people, { partial = false } = {}) {
  if (!partial && people.some((p) => !["detained", "released"].includes(p.detention)))
    throw Error("피고인별 구속 여부를 확인하세요.");
  return people.map((p) => ({
    text: p.detention === "detained" ? "O" : p.detention === "released" ? "X" : " ",
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
// Only YYMMDD and the first suffix digit survive extraction. Tail length is
// preserved when masking, so an incomplete resident token cannot become valid.
export function redactResidentNumbers(text) {
  return String(text ?? "").replace(/(?<!\d)(\d{6}\s*[-－]\s*)([0-9Xx*●•?](?:[ \t]*[0-9Xx*●•?]){0,6}[0-9Xx*●•?]*)/g,
    (_, front, tail) => { const compact=tail.replace(/[ \t]/g, ""); return front+compact[0]+"*".repeat(compact.length-1); });
}
export function residentBirth(identity) {
  const safe=redactResidentNumbers(identity);
  const front=safe.match(/(?<!\d)(\d{6})(?!\d)/)?.[1] ?? "";
  const matches=[...safe.matchAll(/(?<!\d)(\d{6})\s*[-－]\s*([*Xx●•?0-9]+)/g)]
    .filter(m=>m[1]===front);
  const digits=[...new Set(matches.map(m=>m[2][0]))];
  const complete=matches.length>0 && matches.every(m=>/^[1-4][*Xx●•?0-9]{6}$/.test(m[2]));
  return {birthDigits:front,birthCenturyDigit:complete && digits.length===1?digits[0]:""};
}
export function birthAssessment(person, filingDate) {
  const unresolved=message=>({resolved:false,birth:null,age:null,warnings:[message]});
  const front=String(person.birthDigits ?? "").trim();
  const marker=String(person.birthCenturyDigit ?? "");
  if(!/^\d{6}$/.test(front))return unresolved("주민등록번호 앞 6자리 추출 실패");
  if(!/^[1-4]$/.test(marker))return unresolved("세기 판정 숫자(하이픈 뒤 첫 자리 1~4)를 확인할 수 없어 나이 표시를 보류합니다.");
  if(person.birthReview)return unresolved("OCR 생년월일을 확정할 수 없어 나이 표시를 보류합니다.");
  const year=(Number(marker)<=2?1900:2000)+Number(front.slice(0,2));
  const month=Number(front.slice(2,4)),day=Number(front.slice(4,6));
  if(!validDate(year,month,day))return unresolved("유효하지 않은 생년월일");
  const filing=parseDate(filingDate);
  if(!filing)return unresolved("기소일을 자동 추출하지 못했습니다");
  const birth=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  if(birth>filing)return unresolved("생년월일이 기소일 이후여서 나이 표시를 보류합니다.");
  const [fy,fm,fd]=filing.split('-').map(Number);
  return {resolved:true,birth,age:fy-year-Number(fm<month || (fm===month && fd<day)),warnings:[]};
}
export function ageMarks(draft, rules = AGE_RULES) {
  const ages = draft.defendants.map((p) =>
    birthAssessment(p, draft.filingDate),
  );
  return {
    juvenile: ages.some((a) => a.resolved && a.age < rules.juvenileUnder),
    mandatory: draft.defendants.some(p => p.detention === "detained") || ages.some((a) => a.resolved && a.age >= rules.mandatoryAtLeast),
  };
}
export function juvenileGlyphs(draft) {
  return draft.defendants.map(p=>{
    const age=birthAssessment(p,draft.filingDate);
    return {text:!age.resolved?' ':age.age<AGE_RULES.juvenileUnder?'O':'X',color:age.resolved&&age.age<AGE_RULES.juvenileUnder?'red':'black'};
  });
}
const juryTitles=new Set(['특수상해','특수공갈','특정범죄가중처벌등에관한법률위반(도주치상)','특정범죄가중처벌등에관한법률위반(도주치사)']);
const normalizedCharge=value=>String(value).normalize('NFC').replace(/[（]/g,'(').replace(/[）]/g,')').replace(/\s/g,'');
// Exact parsed charge membership only: this is a user-defined classification,
// not a final legal decision about participation in a jury trial.
export function juryGlyph(draft) {
  if(draft.defendants.some(p=>p.charges.some(c=>juryTitles.has(normalizedCharge(c)))))return {text:'O',color:'red'};
  if(draft.defendants.length && draft.defendants.every(p=>p.chargesComplete===true && p.charges.length))return {text:'X',color:'black'};
  return {text:' ',color:'black'};
}
export function chargesComplete(lines, ocr=false) {
  const raw=values('죄명',lines),charges=ChargeParser.parse(lines);
  if(ocr || !raw.length || !charges.length)return false;
  if(raw.some(v=>!v.trim() || /[,，、;；]\s*$|[.]{2,}|…|판독|미상|불명|불상|확인\s*필요|추출\s*실패|알\s*수\s*없|외\s*\d|등\s*$|[?□�]/.test(v)))return false;
  return charges.every(c=>{
    const title=normalizedCharge(c);let balance=0;
    for(const char of title){if(char==='(')balance++;if(char===')'&&--balance<0)return false;}
    return balance===0 && /[가-힣]{2}/.test(title) && ![...juryTitles].some(target=>target!==title && target.startsWith(title));
  });
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
const sectionPrefix = /^(?:(?:[IVXⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+|\d+)\s*[.．。)）]?\s*)?/;
const sectionTitle = (line) => clean(line).trim().replace(sectionPrefix, "");
const isBodyHeading = (line) =>
  /^(?:공\s*소\s*사\s*실|범\s*죄\s*사\s*실|증\s*거\s*방\s*법|첨\s*부)(?:\s|서|$)/.test(
    sectionTitle(line),
  );
const identityHead = (line) =>
  /^피\s*고\s*인\s*관\s*련\s*사\s*항/.test(sectionTitle(line));
const metadata =
  /열\s*람\s*복\s*사\s*용|출\s*력\s*자|다\s*운\s*로\s*드\s*일\s*시|제\s*출\s*일\s*시/;
const pageNumber =
  /^\s*(?:[-–—]\s*\d+\s*[-–—]|\d+\s*[/／]\s*\d+|\d+\s*(?:쪽|페이지)|\d+)\s*$/;
// Remove known page furniture before collecting field continuations, including a
// timestamp on the next line of a metadata label. Never remove arbitrary prose.
const contentLines = (lines) => {
  const output = [];
  let metadataContinuation = false;
  for (const raw of lines) {
    const line = clean(raw).trim();
    if (metadata.test(line)) {
      metadataContinuation = true;
      continue;
    }
    if (!line) continue;
    if (metadataContinuation && /^[\d\s.년월일:/\-]+$/.test(line)) continue;
    metadataContinuation = false;
    if (pageNumber.test(line)) continue;
    output.push(line);
  }
  return output;
};
const heading = (line) => {
  const m = clean(line).replace(/^(\s*(?:\d+[.)]\s*)?구\s*속\s*여\s*부)\s*[.．]\s*/, "$1 ").match(fieldHead);
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
  for (const line of contentLines(lines)) {
    if (isBodyHeading(line)) break;
    if (identityHead(line)) {
      current = null;
      continue;
    }
    // A standalone counsel title ends the preceding field, while titles inside
    // an existing counsel field remain part of its multiline value.
    const field = heading(line) ?? (current?.label !== "변호인" ? CounselParser.heading(line) : null);
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
    const lines = contentLines(clean(redactResidentNumbers(text)).split(/\r?\n/));
    for (const [index, line] of lines.entries()) {
      if (!line) continue;
      if (isBodyHeading(line)) break;
      if (identityHead(line)) continue;
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
  static parse(section, ocr, {caseType} = {}) {
    const firstField = section.lines.findIndex((l) => heading(l));
    const identity = [
      section.identity,
      ...section.lines.slice(
        0,
        firstField < 0 ? section.lines.length : firstField,
      ),
      ...values("주민등록번호", section.lines),
      ...values("생년월일", section.lines),
    ].join("\n");
    const birth = residentBirth(identity);
    const named = values("성명", section.lines)[0]?.split("\n")[0];
    return {
      id: crypto.randomUUID?.() ?? Math.random().toString(36),
      name: (named || section.identity)
        .split(/[（(\n]/)[0]
        .replace(/\d{6}.*$/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^[_、:：\s]+/, "")
        .trim(),
      ...birth,
      birthReview: ocr,
      counsel: CounselParser.parse(section.lines, ocr),
      charges: ChargeParser.parse(section.lines),
      chargesComplete: chargesComplete(section.lines, ocr),
      detention: DetentionParser.parse(section.lines, {caseType}),
    };
  }
}
export class ChargeParser {
  static parse(lines) {
    return values("죄명", lines).flatMap((v) => {
      // Parenthetical qualifiers on the next line belong to the preceding title.
      // Bare unnumbered charge lines still form separate charges.
      const result = [];
      let balance = 0,
        chunk = "";
      const flush = () => {
        const value = chunk
          .replace(/^\s*(?:\d+[.)]|[가-힣][.)])\s*/, "")
          .trim();
        if (value)
          result.push(
            value
              .replace(/[（(]\s*/g, "(")
              .replace(/\s*[）)]/g, ")")
              .replace(/\s+([()])/g, "$1"),
          );
        chunk = "";
      };
      const joined = v.replace(/\n\s*(?=[（(])/g, "");
      for (const c of joined) {
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
  static heading(line) {
    const match = clean(line).match(/^\s*(?:\d+[.)]\s*)?(국\s*선\s*변\s*호\s*[인사]|변\s*호\s*사)(?:\s*[:：]\s*|\s+|$)(.*)$/);
    return match ? { label: "변호인", value: `${match[1]} ${match[2]}`.trim() } : null;
  }
  static parse(lines, ocr) {
    const list = values("변호인", lines),
      none = ["없음", "해당없음", "선임없음", "미선임", "미기재", "X"];
    let status,
      name = "",
      firm = "",
      lawyers = [];
    if (!list.length)
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
      const organizations = list.filter((v) => /^법\s*무\s*법\s*인/.test(v));
      if (organizations.length) {
        const firms = [], names = [], displays = [];
        let incomplete = organizations.length !== list.length;
        for (const value of organizations) {
          // The 담당변호사 marker separates the firm from its lawyers, with or
          // without parentheses and across PDF line breaks.
          const rest = value.replace(/^법\s*무\s*법\s*인\s*/, "");
          const match = rest.match(/^([\s\S]+?)\s*(?:[（(]\s*)?담\s*당\s*변\s*호\s*사\s*[:：]?\s*([\s\S]+)$/);
          const company = (match?.[1] ?? rest).replace(/\s+/g, " ").trim();
          firms.push("법무법인 " + company);
          const people = (match?.[2] ?? "").replace(/\s*[）)]\s*$/, "")
            .split(/[,，、]/)
            .flatMap((part) => {
              // Clear document instructions are not a list of lawyer names.
              if (/서류\s*(?:제출|목록)|확인\s*필요|(?:공소|범죄)\s*사실|추가\s*서류/.test(part)) {
                incomplete = true;
                return [];
              }
              // PDF wrapping can split one three-syllable name (e.g. 강\n가상).
              // Repair only 1+2 / 2+1 syllables within the same comma-delimited
              // segment. Newlines between complete names remain delimiters.
              const lines = part.split("\n").map((line) => line.trim()).join("\n");
              return lines
                .replace(/(^|\n)([가-힣])\n([가-힣]{2})(?=\n|$)/g, "$1$2$3")
                .replace(/(^|\n)([가-힣]{2})\n([가-힣])(?=\n|$)/g, "$1$2$3")
                .split("\n");
            })
            .flatMap((part) => {
              const value = part.replace(/변\s*호\s*사/g, "").trim();
              if (!value) return [];
              const tokens = value.split(/\s+/);
              return tokens.every((n) => /^[가-힣]{2,10}$/.test(n))
                ? tokens : [value.replace(/\s/g, "")];
            });
          if (!company || !people.length || people.some((n) => !/^[가-힣]{2,10}$/.test(n)))
            incomplete = true;
          else {
            names.push(...people);
            displays.push(`${company}) ${people.join(" ")}`);
          }
        }
        firm = firms.join("\n");
        // Preserve every listed name and its original order, including repeats.
        lawyers = names;
        status = incomplete ? "needsReview" : "named";
        name = incomplete ? "" : displays.join("\n");
      } else {
        const output = [];
        let incomplete = false, explicitNone = false;
        const stripTitles = (value) => {
          let appointed = false, titled = false, match;
          value = value.trim();
          while ((match = value.match(/^(국\s*선\s*변\s*호\s*[인사]|변\s*호\s*인|변\s*호\s*사)(?=\s|[:：]|$)\s*[:：]?\s*/))) {
            titled = true;
            appointed ||= /국\s*선/.test(match[1]);
            value = value.slice(match[0].length).trim();
          }
          return { value, appointed, titled };
        };
        for (const raw of list) {
          const group = stripTitles(raw);
          if (none.includes(group.value.replace(/\s/g, ""))) {
            explicitNone = true;
            continue;
          }
          const parts = group.value.replace(/\n\s*(?=[（(]\s*국\s*선\s*[）)])/g, "").split(/[,，、\n]/).filter((v) => v.trim());
          if (!parts.length) incomplete = true;
          for (const part of parts) {
            const entry = stripTitles(part);
            const suffix = /[（(]\s*국\s*선\s*[）)]\s*$/;
            const appointed = (entry.titled ? entry.appointed : group.appointed) || suffix.test(entry.value);
            const value = entry.value.replace(suffix, "").trim();
            const tokens = value.split(/\s+/);
            const people = tokens.every((n) => /^[가-힣]{2,5}$/.test(n))
              ? tokens : [value.replace(/\s/g, "")];
            if (people.some((n) => !/^[가-힣]{2,5}$/.test(n) ||
              /미정|미상|불명|불상|예정|선정|선임|확인|판독|불가|없음|알수없음|신청|대기|담당|사무소|^국선$|^변호사$|^변호인$|^국선변호사$|^국선변호인$/.test(n))) {
              incomplete = true;
              continue;
            }
            output.push(...people.map((n) => n + (appointed ? "(국선)" : "")));
          }
        }
        incomplete ||= explicitNone && output.length > 0;
        status = incomplete ? "needsReview" : explicitNone ? "absentExplicit" : "named";
        name = incomplete ? "" : output.join("\n");
      }
    }
    return { status: ocr ? "needsReview" : status, name, firm, lawyers };
  }
}
export class DetentionParser {
  static parse(lines, {caseType} = {}) {
    const list = values("구속여부", lines);
    if (!list.length) return caseType === "고정" ? "released" : "unknown";
    const date = "\\d{4}[.년/\\-]\\d{1,2}[.월/\\-]\\d{1,2}[.일]?";
    const detained = new RegExp(`^(?:${date})?구속(?:기소)?(?:[（(](?:${date})?체포[）)])?$`);
    const states = list.map(value => {
      const s=value.replace(/\s/g, "");
      if (/^불구속(?:기소)?$/.test(s)) return "released";
      return detained.test(s) ? "detained" : "unknown";
    });
    return states.every(s => s === states[0]) ? states[0] : "unknown";
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
                /\s*(?:[（(]\s*인\s*[）)]|[（(]\s*서명\s*[）)]|[（(]\s*날인\s*[）)])\s*$/,
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
    return this.assess(firstPage).date;
  }
  static assess(firstPage) {
    const candidates = [];
    const result = (date, reason = "") => ({ date, reason, candidates });
    if (!firstPage) return result(null, "첫 페이지가 없습니다.");
    const raw = clean(firstPage.text).split(/\r?\n/);
    const lines = contentLines(raw);
    const beforeIdentity = [];
    for (const line of lines) {
      if (isBodyHeading(line) || identityHead(line) || hasLabel("피고인", line))
        break;
      beforeIdentity.push(line);
    }
    const readDate = (source, start) => {
      let value = source[start] ?? "";
      for (
        let j = start + 1;
        j <= start + 2 && j < source.length && !parseDate(value);
        j++
      ) {
        if (!/^[\d\s.년월일/\-]+$/.test(source[j])) break;
        value += " " + source[j];
      }
      return parseDate(value);
    };
    const explicit = fields(beforeIdentity).filter((f) =>
      ["기소일", "기소일자", "공소제기일"].includes(f.label),
    );
    for (const f of explicit) {
      let found=false;
      for(const [i,line] of f.parts.entries()){
        if(!/^[\d\s.년월일/\-]+$/.test(line))break;
        if(i===0 || /^\d{4}\s*[.년/\-]/.test(line)){
          candidates.push({source:"explicit",date:readDate(f.parts,i)});found=true;
        }
      }
      if(!found)candidates.push({source:"explicit",date:null});
    }
    for (const [i, line] of beforeIdentity.entries()) {
      if (!heading(line) && /검\s*찰\s*청|공\s*소\s*청/.test(line))
        candidates.push({
          source: "body",
          date: readDate(beforeIdentity, i + 1),
        });
    }
    // Copy/download/submission metadata is never filing-date evidence.
    const contextual = candidates;
    if (!contextual.length && !raw.some((l) => metadata.test(l))) {
      const header = firstPage.ocr
        ? lines.slice(0, 8)
        : contentLines(
            (firstPage.lines ?? [])
              .filter((l) => l.y <= firstPage.height * 0.25)
              .map((l) => l.text),
          );
      for (const [i, line] of header.entries()) {
        const previous = (header[i - 1] ?? "").replace(/\s/g, "");
        if (
          beforeIdentity.includes(line) &&
          !/범죄일시|구속일|구속여부|체포일|생년월일/.test(previous) &&
          /^\d{4}\s*[.년/\-]/.test(line)
        )
          candidates.push({ source: "header", date: readDate(header, i) });
      }
    }
    // A valid explicit filing-date field takes priority over an agency header date.
    // Conflicting or unreadable candidates at the selected priority remain unresolved.
    const explicitEvidence=candidates.filter(c=>c.source==='explicit');
    const evidence = explicitEvidence.length?explicitEvidence:candidates;
    if (!evidence.length)
      return result(
        null,
        "공소장 본문 날짜 또는 명시된 기소일 근거를 찾지 못했습니다.",
      );
    if (evidence.some((c) => !c.date))
      return result(
        null,
        "공소장 본문 날짜 또는 명시된 기소일을 판독하지 못했습니다.",
      );
    const dates = [...new Set(evidence.map((c) => c.date))];
    if (dates.length !== 1)
      return result(null, "공소장 본문 날짜와 다른 기소일 후보가 충돌합니다.");
    return result(dates[0]);
  }
}
export class IndictmentParser {
  static parse(document, {caseType} = {}) {
    const text = clean(redactResidentNumbers(document.text)),
      sections = DefendantParser.split(text),
      lines = text.split("\n"),
      filingDateAssessment = FilingDateParser.assess(document.pages[0]);
    const draft = {
      defendants: sections.map((s) =>
        DefendantParser.parse(s, document.usedOCR, {caseType}),
      ),
      prosecutor: ProsecutorParser.parse(lines),
      filingDate: filingDateAssessment.date,
      filingDateAssessment,
      warnings: [],
    };
    if (!draft.defendants.length)
      draft.warnings.push("피고인 이름을 자동 추출하지 못했습니다.");
    if (!draft.prosecutor) draft.warnings.push("검사 이름을 확인하세요.");
    if (!draft.filingDate) draft.warnings.push(filingDateAssessment.reason);
    return draft;
  }
}
export function validateDraft(draft) {
  const errors = [];
  if (!draft.prosecutor?.trim()) errors.push("검사 이름 자동 추출 실패");
  if (!parseDate(draft.filingDate))
    errors.push(
      "기소일 자동 추출 실패" +
        (draft.filingDateAssessment?.reason
          ? ": " + draft.filingDateAssessment.reason
          : ""),
    );
  if (!draft.defendants.length) errors.push("피고인 자동 추출 실패");
  draft.defendants.forEach((p, i) => {
    const prefix = `피고인 ${i + 1}: `;
    if (!p.name?.trim()) errors.push(prefix + "이름 자동 추출 실패");
    if (!p.birthDigits || !/^\d{6}$/.test(p.birthDigits))
      errors.push(prefix + "생년월일 앞 6자리 자동 추출 실패");
    if (!p.charges?.length) errors.push(prefix + "죄명 자동 추출 실패");
    if (p.detention === "unknown")
      errors.push(prefix + "구속 여부 자동 추출 실패");
    if (p.counsel.status === "needsReview")
      errors.push(prefix + "변호인 기재 상태 자동 추출 실패");
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
    birthCenturyDigit: "",
    chargesComplete: false,
    statedAge: null,
    birthReview: false,
    charges: [],
    counsel: { status: "needsReview", name: "" },
    detention: "unknown",
  };
}
