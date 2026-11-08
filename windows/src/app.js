import * as services from "./services.js";
import * as core from "./core.js";
const $ = (id) => document.getElementById(id);
const state = {
  source: null,
  output: null,
  draft: null,
  busy: false,
  tab: "source",
  zoom: 1,
  renderToken: 0,
  outputBytes: null,
};
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
};
function busy(value) {
  state.busy = value;
  for (const el of document.querySelectorAll(
    "aside button,aside input,aside select,aside textarea",
  ))
    el.disabled = value;
  $("analyze").disabled = value || !state.source;
}
function invalidate() {
  state.outputBytes = null;
  $("outputTab").disabled = true;
  $("export").hidden = true;
  $("reviewed").checked = false;
  if (state.output) {
    state.output.destroy();
    state.output = null;
  }
  if (state.tab === "output") {
    state.tab = "source";
    void preview();
  }
}
function warnings() {
  if (!state.draft) return;
  const list = [...state.draft.warnings, ...core.validateDraft(state.draft)];
  for (const p of state.draft.defendants) {
    const a = core.birthAssessment(p, state.draft.filingDate);
    list.push(...a.warnings.map((w) => `${p.name}: ${w}`));
  }
  $("warnings").textContent = [...new Set(list)].join("\n");
}
async function preview() {
  const token = ++state.renderToken;
  $("rawText").hidden = state.tab !== "text";
  $("canvasHost").hidden = state.tab === "text";
  if (state.tab === "text") return;
  const doc = state.tab === "output" ? state.output : state.source;
  if (!doc) return;
  $("canvasHost").replaceChildren();
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const canvas = await services.PDFTextExtractor.render(
        await doc.getPage(i),
        state.zoom * 1.25,
      );
      if (token !== state.renderToken) return;
      $("canvasHost").append(canvas);
    }
  } catch (e) {
    if (token === state.renderToken) status(e.message, true);
  }
}
function input(label, value, type, onChange) {
  const l = document.createElement("label");
  l.textContent = label;
  const el = document.createElement(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") el.type = type;
  el.value = value ?? "";
  el.addEventListener("input", () => {
    onChange(el.value);
    invalidate();
    warnings();
  });
  l.append(el);
  return l;
}
function select(label, value, choices, onChange) {
  const l = document.createElement("label");
  l.textContent = label;
  const el = document.createElement("select");
  for (const [id, text] of choices) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = text;
    el.append(o);
  }
  el.value = value;
  el.onchange = () => {
    onChange(el.value);
    invalidate();
    warnings();
  };
  l.append(el);
  return l;
}
function renderPeople() {
  $("people").replaceChildren();
  state.draft.defendants.forEach((p, index) => {
    const card = document.createElement("div");
    card.className = "person";
    const h = document.createElement("h3");
    h.textContent = `피고인 ${index + 1}`;
    card.append(h);
    const note = document.createElement("p");
    note.className = "birth-note";
    const refresh = () => {
      const a = core.birthAssessment(p, state.draft.filingDate);
      note.textContent =
        (a.birth
          ? `${a.resolved ? "확정" : "미확정 후보"} ${a.birth} · 기소일 기준 만 ${a.age ?? "?"}세\n`
          : "") + a.warnings.join("\n");
    };
    card.append(
      input("이름", p.name, "text", (v) => (p.name = v)),
      input("생년월일 앞 6자리 YYMMDD", p.birthDigits, "text", (v) => {
        p.birthDigits = v;
        refresh();
      }),
      input("공소장 기재 나이", p.statedAge, "number", (v) => {
        p.statedAge = v === "" ? null : Number(v);
        refresh();
      }),
      input("직접 확인한 출생 연도 YYYY", p.confirmedYear, "text", (v) => {
        p.confirmedYear = v;
        refresh();
      }),
      note,
      input(
        "죄명 (한 줄에 하나)",
        p.charges.join("\n"),
        "textarea",
        (v) =>
          (p.charges = v
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)),
      ),
      select(
        "변호인 기재 상태",
        p.counsel.status,
        [
          ["named", "이름 기재"],
          ["absentExplicit", "없음 명시 (빈칸)"],
          ["absentMissing", "항목 미기재 (빈칸)"],
          ["needsReview", "판독 불확실 · 확인 필요"],
        ],
        (v) => (p.counsel.status = v),
      ),
      input(
        "변호인 이름 (이름이 있는 경우만 출력)",
        p.counsel.name,
        "text",
        (v) => (p.counsel.name = v),
      ),
      select(
        "구속 여부",
        p.detention,
        [
          ["unknown", "확인 필요"],
          ["detained", "구속 · 빨간 O"],
          ["released", "불구속 · 검은 X"],
        ],
        (v) => (p.detention = v),
      ),
    );
    refresh();
    const remove = document.createElement("button");
    remove.className = "danger";
    remove.textContent = "이 피고인 삭제";
    remove.onclick = () => {
      state.draft.defendants.splice(index, 1);
      invalidate();
      renderPeople();
      warnings();
    };
    card.append(remove);
    $("people").append(card);
  });
}
$("file").onchange = async () => {
  if (!$("file").files[0]) return;
  busy(true);
  invalidate();
  $("editor").hidden = true;
  state.draft = null;
  $("rawText").textContent = "";
  try {
    if (state.source) await state.source.destroy();
    state.source = null;
    state.source = await services.PDFInputService.open($("file").files[0]);
    $("fileInfo").textContent =
      `${$("file").files[0].name} · ${state.source.numPages}페이지`;
    state.tab = "source";
    await preview();
    status("PDF를 읽었습니다. 문서 분석을 시작하세요.");
  } catch (e) {
    status(e.message, true);
  } finally {
    busy(false);
  }
};
$("analyze").onclick = async () => {
  if (!state.source) return;
  busy(true);
  invalidate();
  try {
    const extracted = await services.analyze(state.source, {
      forceOCR: $("forceOCR").checked,
      progress: (s, p) =>
        status(`${s}${Number.isFinite(p) ? ` · ${Math.round(p * 100)}%` : ""}`),
    });
    state.draft = core.IndictmentParser.parse(extracted);
    $("rawText").textContent = extracted.text;
    $("prosecutor").value = state.draft.prosecutor;
    $("filingDate").value = state.draft.filingDate ?? "";
    $("editor").hidden = false;
    renderPeople();
    warnings();
    status(
      extracted.usedOCR
        ? "OCR 분석 완료. 이름·숫자·변호인·출생 연도를 원문과 대조하세요."
        : "텍스트 분석 완료. 원문과 대조해 수정하세요.",
    );
  } catch (e) {
    state.draft = {
      defendants: [],
      prosecutor: "",
      filingDate: null,
      warnings: [
        "자동 분석 실패. 아래 항목을 원문과 대조하여 직접 입력하세요.",
      ],
    };
    $("editor").hidden = false;
    $("prosecutor").value = "";
    $("filingDate").value = "";
    renderPeople();
    warnings();
    status(
      e.message +
        "\n자동 분석을 완료하지 못했습니다. 수동 입력으로 계속할 수 있습니다.",
      true,
    );
  } finally {
    busy(false);
  }
};
$("prosecutor").oninput = () => {
  state.draft.prosecutor = $("prosecutor").value;
  invalidate();
  warnings();
};
$("filingDate").oninput = () => {
  state.draft.filingDate = $("filingDate").value;
  invalidate();
  renderPeople();
  warnings();
};
$("addPerson").onclick = () => {
  state.draft.defendants.push(core.emptyDefendant());
  invalidate();
  renderPeople();
  warnings();
};
$("generate").onclick = async () => {
  if (!$("reviewed").checked) {
    status("원문 대조 확인란을 선택하세요.", true);
    return;
  }
  busy(true);
  try {
    const data = await services.MemoPDFRenderer.render(state.draft);
    state.output = await services.PDFInputService.fromBytes(data);
    state.outputBytes = data;
    state.tab = "output";
    $("outputTab").disabled = false;
    $("export").hidden = false;
    await preview();
    status("메모를 생성했습니다. 모든 페이지를 확인한 뒤 저장하세요.");
  } catch (e) {
    status(e.message, true);
  } finally {
    busy(false);
  }
};
$("save").onclick = () => {
  if (state.outputBytes)
    services.PDFExportService.download(state.outputBytes, $("filename").value);
};
for (const [id, tab] of [
  ["sourceTab", "source"],
  ["outputTab", "output"],
  ["textTab", "text"],
])
  $(id).onclick = () => {
    state.tab = tab;
    void preview();
  };
for (const [id, delta] of [
  ["zoomIn", 0.25],
  ["zoomOut", -0.25],
])
  $(id).onclick = () => {
    state.zoom = Math.max(0.5, Math.min(2, state.zoom + delta));
    $("zoomLabel").textContent = Math.round(state.zoom * 100) + "%";
    void preview();
  };
window.CM = { ...services, ...core, getDraft: () => state.draft };
// Exposed library API powers the feasibility and browser regression tests; no telemetry.
services.PDFInputService.fromBytes(services.bytes(window.CM_DOCUMENTS.template))
  .then(async (pdf) => {
    $("templateInfo").textContent =
      `내장 원본 양식: ${pdf.numPages}페이지. 출력 시 모든 원본 페이지를 보존합니다.`;
    await pdf.destroy();
  })
  .catch((e) => status(e.message, true));
status("로컬 실행 준비됨 · 문서는 외부로 전송하지 않습니다.");
