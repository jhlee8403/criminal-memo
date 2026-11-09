import * as diagnostics from "./diagnostics.js";
import * as services from "./services.js";
import * as core from "./core.js";
const $ = (id) => document.getElementById(id);
const state = {
  source: null,
  output: null,
  draft: null,
  busy: false,
  tab: "source",
  page: 1,
  zoom: 1,
  renderToken: 0,
  outputBytes: null,
  analysis: null,
  selectedRegion: null,
};
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
};
function busy(value) {
  state.busy = value;
  for (const el of document.querySelectorAll(
    "aside button,aside input,aside select,aside textarea,#ocrTools button,#ocrTools select,#ocrTools input,#evidence button",
  ))
    el.disabled = value;
  $("analyze").disabled = value || !state.source;
  $("rerunRegion").disabled = value || !state.selectedRegion;
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
    state.page = Math.max(1, Math.min(state.page, doc.numPages));
    $("previewPage").replaceChildren(
      ...Array.from({ length: doc.numPages }, (_, index) => {
        const o = document.createElement("option");
        o.value = index + 1;
        o.textContent = `${index + 1} / ${doc.numPages}`;
        return o;
      }),
    );
    $("previewPage").value = state.page;
    for (const i of [state.page]) {
      const canvas = await services.PDFTextExtractor.render(
        await doc.getPage(i),
        state.zoom * 1.25,
      );
      if (token !== state.renderToken) return;
      const wrapper = document.createElement("div");
      wrapper.className = "page-wrap";
      canvas.style.margin = "0";
      wrapper.append(canvas);
      $("canvasHost").append(wrapper);
      if (state.tab === "source")
        attachRegionSelection(canvas, wrapper, i, doc);
    }
  } catch (e) {
    if (token === state.renderToken) status(e.message, true);
  }
}
function input(label, value, type, onChange, fieldKey = null) {
  const l = document.createElement("label");
  l.textContent = label;
  const el = document.createElement(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") el.type = type;
  el.value = value ?? "";
  el.addEventListener("input", () => {
    onChange(el.value);
    if (fieldKey)
      diagnostics.chooseField(
        state.draft,
        fieldKey,
        diagnostics.getField(state.draft, fieldKey),
        true,
      );
    renderDiagnostics();
    invalidate();
    warnings();
  });
  l.append(el);
  return l;
}
function select(label, value, choices, onChange, fieldKey = null) {
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
    if (fieldKey)
      diagnostics.chooseField(
        state.draft,
        fieldKey,
        diagnostics.getField(state.draft, fieldKey),
        true,
      );
    renderDiagnostics();
    invalidate();
    warnings();
  };
  l.append(el);
  return l;
}
function renderPeople() {
  $("people").replaceChildren();
  $("regionPerson").replaceChildren(
    ...state.draft.defendants.map((p, i) => {
      const option = document.createElement("option");
      option.value = i;
      option.textContent = `${i + 1}. ${p.name}`;
      return option;
    }),
  );
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
      input(
        "이름",
        p.name,
        "text",
        (v) => (p.name = v),
        `person.${index}.name`,
      ),
      input(
        "생년월일 앞 6자리 YYMMDD",
        p.birthDigits,
        "text",
        (v) => {
          p.birthDigits = v;
          p.confirmedBirthDate = "";
          const dateInput = card.querySelector('input[type="date"]');
          if (dateInput) dateInput.value = "";
          refresh();
        },
        `person.${index}.birthDigits`,
      ),
      input(
        "직접 확인한 전체 생년월일 YYYY-MM-DD",
        p.confirmedBirthDate,
        "date",
        (v) => {
          p.confirmedBirthDate = v;
          refresh();
        },
      ),
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
        `person.${index}.charges`,
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
        `person.${index}.counsel`,
      ),
      input(
        "변호인 이름 (이름이 있는 경우만 출력)",
        p.counsel.name,
        "text",
        (v) => (p.counsel.name = v),
        `person.${index}.counsel`,
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
        `person.${index}.detention`,
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
  state.page = 1;
  state.draft = null;
  state.analysis = null;
  state.selectedRegion = null;
  renderDiagnostics();
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
      engine: $("ocrEngine").value,
      forceOCR: $("forceOCR").checked,
      verifyCritical: $("verifyCritical").checked,
      fieldSettings: {
        prosecutor: {
          psm: +$("prosecutorPSM").value,
          language: $("prosecutorLanguage").value,
        },
        charges: {
          psm: +$("chargesPSM").value,
          language: $("chargesLanguage").value,
        },
      },
      progress: (s, p) =>
        status(`${s}${Number.isFinite(p) ? ` · ${Math.round(p * 100)}%` : ""}`),
    });
    state.analysis = extracted;
    state.draft = extracted.draft ?? core.IndictmentParser.parse(extracted);
    $("incompleteReview").hidden =
      !state.draft.incompleteAnalysis?.pages.length;
    $("confirmIncomplete").checked = false;
    renderDiagnostics();
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
  diagnostics.chooseField(
    state.draft,
    "prosecutor",
    $("prosecutor").value,
    true,
  );
  renderDiagnostics();
  invalidate();
  warnings();
};
$("filingDate").oninput = () => {
  diagnostics.chooseField(
    state.draft,
    "filingDate",
    $("filingDate").value,
    true,
  );
  renderDiagnostics();
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
    state.page = 1;
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
window.CM = {
  ...services,
  ...core,
  ...diagnostics,
  getDraft: () => state.draft,
  getAnalysis: () => state.analysis,
};
// Exposed library API powers the feasibility and browser regression tests; no telemetry.
services.PDFInputService.fromBytes(services.bytes(window.CM_DOCUMENTS.template))
  .then(async (pdf) => {
    $("templateInfo").textContent =
      `내장 원본 양식: ${pdf.numPages}페이지. 첫 페이지를 사용하여 1페이지로 출력합니다.`;
    await pdf.destroy();
  })
  .catch((e) => status(e.message, true));
status("로컬 실행 준비됨 · 문서는 외부로 전송하지 않습니다.");

function renderDiagnostics() {
  const diag = state.analysis?.diagnostics;
  $("diagnostics").hidden = !diag;
  if (!diag) return;
  const pageSelect = $("diagnosticPage"),
    previous = pageSelect.value;
  pageSelect.replaceChildren(
    ...diag.pages.map((p) => {
      const o = document.createElement("option");
      o.value = p.page;
      o.textContent = `${p.page}페이지`;
      return o;
    }),
  );
  if (previous) pageSelect.value = previous;
  const record = diag.pages[+(pageSelect.value || 1) - 1],
    stage = $("diagnosticStage").value;
  const output =
    stage === "embedded"
      ? record.embedded
      : stage === "whole"
        ? record.wholeOCR
        : stage === "precision"
          ? record.precision
          : {
              quality: record.quality,
              decisions: record.decisions,
              nativeDPI: record.nativeDPI,
              attempts: diag.attempts,
              elapsedMs: diag.elapsedMs,
              estimatedImagePeakBytes: diag.estimatedImagePeakBytes,
              heapBefore: diag.heapBefore,
              heapAfter: diag.heapAfter,
              limits: diag.limitReasons,
              comparison: diag.comparison
                ? {
                    engine: diag.comparison.engine,
                    elapsedMs: diag.comparison.elapsedMs,
                    unmatched: diag.comparison.unmatched,
                    defendants: diag.comparison.defendants,
                  }
                : null,
            };
  $("diagnosticText").textContent =
    typeof output === "string" ? output : JSON.stringify(output, null, 2);
  $("evidence").replaceChildren();
  for (const field of state.draft?.evidence ?? []) {
    const card = document.createElement("div");
    card.className = "evidence-card";
    const title = document.createElement("strong");
    title.textContent =
      field.label +
      (field.conflict
        ? " · 후보 충돌"
        : field.needsReview
          ? " · 확인 필요"
          : " · 선택됨");
    card.append(title);
    const chosen = document.createElement("p");
    chosen.textContent = `최종: ${field.finalValue === null ? "미선택" : JSON.stringify(field.finalValue)}${field.manualValue !== null ? " (직접 수정)" : ""}`;
    card.append(chosen);
    for (const c of field.candidates) {
      const row = document.createElement("div");
      const text = document.createElement("span");
      text.textContent = `${c.engine ?? ""} ${c.source} · ${c.page ?? "?"}쪽 · ${c.method ?? ""} · 신뢰도 ${c.confidence ?? "없음"}: ${JSON.stringify(c.value)}`;
      const button = document.createElement("button");
      button.className = "secondary";
      button.textContent = "이 후보 적용";
      button.onclick = () => {
        diagnostics.chooseField(state.draft, field.key, c.value);
        $("prosecutor").value = state.draft.prosecutor;
        $("filingDate").value = state.draft.filingDate ?? "";
        invalidate();
        renderPeople();
        renderDiagnostics();
        warnings();
      };
      const locate = document.createElement("button");
      locate.className = "secondary";
      locate.textContent = "원문 위치";
      locate.disabled = !c.page || !c.box;
      locate.onclick = () => showLocation(c);
      row.append(text, button, locate);
      card.append(row);
    }
    $("evidence").append(card);
  }
}
$("diagnosticPage").onchange = renderDiagnostics;
$("diagnosticStage").onchange = renderDiagnostics;
function attachRegionSelection(canvas, wrapper, pageNumber, doc) {
  let start = null,
    overlay = null;
  const point = (e) => {
    const b = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(b.width, e.clientX - b.left)),
      Math.max(0, Math.min(b.height, e.clientY - b.top)),
    ];
  };
  canvas.onpointerdown = (e) => {
    if (!$("regionMode").checked || state.busy) return;
    e.preventDefault();
    start = point(e);
    canvas.setPointerCapture(e.pointerId);
    wrapper.querySelector(".region-box")?.remove();
    overlay = document.createElement("div");
    overlay.className = "region-box";
    wrapper.append(overlay);
  };
  canvas.onpointermove = (e) => {
    if (!start) return;
    const end = point(e);
    Object.assign(overlay.style, {
      left: Math.min(start[0], end[0]) + "px",
      top: Math.min(start[1], end[1]) + "px",
      width: Math.abs(end[0] - start[0]) + "px",
      height: Math.abs(end[1] - start[1]) + "px",
    });
  };
  canvas.onpointerup = async (e) => {
    if (!start) return;
    const end = point(e),
      a = start;
    start = null;
    const b = canvas.getBoundingClientRect(),
      unit = (await doc.getPage(pageNumber)).getViewport({ scale: 1 });
    const box = [
      (Math.min(a[0], end[0]) / b.width) * unit.width,
      (Math.min(a[1], end[1]) / b.height) * unit.height,
      (Math.abs(end[0] - a[0]) / b.width) * unit.width,
      (Math.abs(end[1] - a[1]) / b.height) * unit.height,
    ];
    if (box[2] < 3 || box[3] < 3) {
      status("영역을 조금 더 크게 선택하세요.", true);
      return;
    }
    state.selectedRegion = { page: pageNumber, box };
    $("rerunRegion").disabled = false;
    $("selectionInfo").textContent =
      `${pageNumber}쪽 영역 선택 (${Math.round(box[2])} × ${Math.round(box[3])} pt)`;
  };
}
$("rerunRegion").onclick = async () => {
  if (!state.selectedRegion || !state.draft) return;
  busy(true);
  const field = $("regionField").value,
    index = +$("regionPerson").value,
    key = ["prosecutor", "filingDate"].includes(field)
      ? field
      : `person.${index}.${field}`,
    region = {
      ...state.selectedRegion,
      field,
      key,
      personIndex: key.startsWith("person.") ? index : null,
      method: "manual",
      anchor: "",
    };
  state.draft.evidence ??= [];
  if (!state.analysis)
    state.analysis = {
      diagnostics: {
        pages: Array.from({ length: state.source.numPages }, (_, i) => ({
          page: i + 1,
          embedded: { text: "" },
          wholeOCR: [],
          precision: [],
          quality: {},
          decisions: ["수동 영역 OCR"],
        })),
        limitReasons: [],
        fields: state.draft.evidence,
        attempts: 0,
        elapsedMs: 0,
      },
    };
  const ocr = services.createOCREngine($("regionEngine").value, (s, p) =>
    status(`${s} ${Math.round((p ?? 0) * 100)}%`),
  );
  try {
    const results = await services.recognizeRegion(
      await state.source.getPage(region.page),
      region,
      ocr,
      {
        psm: +$("regionPSM").value,
        language: $("fieldLanguage").value,
        methods: [$("preprocess").value],
      },
    );
    state.analysis.diagnostics.manualAttempts =
      (state.analysis.diagnostics.manualAttempts ?? 0) + results.length;
    state.analysis.diagnostics.pages[region.page - 1].precision.push(
      ...results,
    );
    let target = state.draft.evidence.find((f) => f.key === key);
    if (!target) {
      target = {
        key,
        label: field,
        required: true,
        candidates: [],
        selectedValue: null,
        finalValue: null,
        manualValue: null,
        needsReview: true,
        conflict: false,
      };
      state.draft.evidence.push(target);
    }
    for (const r of results)
      for (const value of r.values)
        target.candidates.push({
          value,
          source: "precision",
          engine: $("regionEngine").value,
          page: region.page,
          box: region.box,
          confidence: r.confidence,
          method: `수동/${r.method}/PSM${r.psm}`,
          trusted: false,
        });
    diagnostics.reconcile(target);
    invalidate();
    renderDiagnostics();
    warnings();
    status(
      "선택 영역 OCR 완료. 진단의 후보를 확인하여 적용하거나 직접 수정하세요.",
    );
  } catch (e) {
    status(e.message, true);
  } finally {
    await ocr.close();
    busy(false);
  }
};

$("previewPage").onchange = () => {
  state.page = +$("previewPage").value;
  void preview();
};
async function showLocation(candidate) {
  if (!candidate.box || !candidate.page) return;
  state.tab = "source";
  state.page = candidate.page;
  await preview();
  const wrapper = $("canvasHost").querySelector(".page-wrap"),
    canvas = wrapper?.querySelector("canvas");
  if (!canvas) return;
  const view = (await state.source.getPage(candidate.page)).getViewport({
      scale: 1,
    }),
    [x, y, w, h] = candidate.box;
  const marker = document.createElement("div");
  marker.className = "region-box";
  Object.assign(marker.style, {
    left: (x / view.width) * canvas.clientWidth + "px",
    top: (y / view.height) * canvas.clientHeight + "px",
    width: (w / view.width) * canvas.clientWidth + "px",
    height: (h / view.height) * canvas.clientHeight + "px",
  });
  wrapper.append(marker);
  marker.scrollIntoView({ block: "center", inline: "center" });
}

$("confirmIncomplete").onchange = () => {
  if (state.draft.incompleteAnalysis)
    state.draft.incompleteAnalysis.confirmed = $("confirmIncomplete").checked;
  invalidate();
  warnings();
};
