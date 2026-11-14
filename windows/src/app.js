import * as services from "./services.js";
import * as core from "./core.js";
const $ = id => document.getElementById(id);
const state = { source: null, output: null, draft: null, outputBytes: null, tab: "source", zoom: 1, renderToken: 0, busy: false };
function status(text, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function busy(value) {
  state.busy = value;
  $("file").disabled = value;
  $("analyze").disabled = value || !state.source;
  $("forceOCR").disabled = value;
}
function clearOutput() {
  if (state.output) { void state.output.destroy(); state.output = null; }
  state.outputBytes = null;
  $("outputTab").disabled = true;
  $("export").hidden = true;
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
    for (let n = 1; n <= doc.numPages; n++) {
      const canvas = await services.PDFTextExtractor.render(await doc.getPage(n), state.zoom * 1.25);
      if (token !== state.renderToken) return;
      $("canvasHost").append(canvas);
    }
  } catch (error) {
    if (token === state.renderToken) status(error.message, true);
  }
}
function line(label, value) {
  const p = document.createElement("p");
  p.textContent = label + ": " + (value || "(자동 추출 실패)");
  return p;
}
function showExtraction() {
  const d = state.draft;
  $("editor").hidden = false;
  $("people").replaceChildren(
    line("검사", d.prosecutor),
    line("기소일", d.filingDate),
    ...d.defendants.flatMap((p, i) => [
      line(`피고인 ${i + 1}`, p.name),
      line("생년월일 앞 6자리", p.birthDigits),
      line("죄명", p.charges.join(", ")),
      line("변호인", p.counsel.status === "named" ? p.counsel.name : p.counsel.status === "needsReview" ? "(판정 불가)" : "기재 없음"),
      line("구속 여부", p.detention === "detained" ? "O" : p.detention === "released" ? "X" : "(판정 불가)")
    ])
  );
  const errors = core.validateDraft(d);
  $("warnings").textContent = errors.length
    ? "메모를 자동 생성할 수 없습니다. 추출 실패 항목:\n" + errors.join("\n")
    : "필수 항목을 모두 자동 추출했습니다.";
  return errors;
}
$("file").onchange = async () => {
  if (!$("file").files[0]) return;
  busy(true);
  clearOutput();
  state.draft = null;
  $("editor").hidden = true;
  $("rawText").textContent = "";
  try {
    if (state.source) await state.source.destroy();
    state.source = await services.PDFInputService.open($("file").files[0]);
    $("fileInfo").textContent = `${$("file").files[0].name} · ${state.source.numPages}페이지`;
    state.tab = "source";
    await preview();
    status("공소장을 불러왔습니다. 자동 분석을 시작하세요.");
  } catch (error) {
    state.source = null;
    status(error.message, true);
  } finally { busy(false); }
};
$("analyze").onclick = async () => {
  if (!state.source || state.busy) return;
  busy(true);
  clearOutput();
  $("editor").hidden = true;
  try {
    const extracted = await services.analyze(state.source, {
      forceOCR: $("forceOCR").checked,
      progress: (s, p) => status(`${s}${Number.isFinite(p) ? " · " + Math.round(p * 100) + "%" : ""}`)
    });
    state.draft = core.IndictmentParser.parse(extracted);
    $("rawText").textContent = extracted.text;
    const errors = showExtraction();
    if (errors.length) {
      status("자동 추출 실패: " + errors.join(" / ") + ". 수동 입력은 제공하지 않습니다.", true);
      return;
    }
    const data = await services.MemoPDFRenderer.render(state.draft);
    state.output = await services.PDFInputService.fromBytes(data);
    state.outputBytes = data;
    state.tab = "output";
    $("outputTab").disabled = false;
    $("export").hidden = false;
    await preview();
    status("필수 항목 자동 추출 및 메모 생성 완료. 생성된 PDF를 확인하여 저장하세요.");
  } catch (error) {
    status("자동 분석 또는 PDF 생성 실패: " + error.message, true);
  } finally { busy(false); }
};
$("save").onclick = () => {
  if (state.outputBytes) services.PDFExportService.download(state.outputBytes, "형사신건메모");
};
for (const [id, tab] of [["sourceTab", "source"], ["outputTab", "output"], ["textTab", "text"]])
  $(id).onclick = () => { state.tab = tab; void preview(); };
for (const [id, delta] of [["zoomIn", 0.25], ["zoomOut", -0.25]])
  $(id).onclick = () => {
    state.zoom = Math.max(0.5, Math.min(2, state.zoom + delta));
    $("zoomLabel").textContent = Math.round(state.zoom * 100) + "%";
    void preview();
  };
window.CM = { ...services, ...core, getDraft: () => state.draft };
services.PDFInputService.fromBytes(services.bytes(window.CM_DOCUMENTS.template))
  .then(async pdf => {
    $("templateInfo").textContent = "내장 원본 양식: " + pdf.numPages + "페이지 (출력 시 첫 페이지만 사용)";
    await pdf.destroy();
  })
  .catch(error => status(error.message, true));
status("초기 Windows v1 자동 추출 시험판 · 문서를 외부로 전송하지 않습니다.");
