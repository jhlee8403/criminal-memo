import {
  OCR_LIMITS,
  textQuality,
  normalizeOCRLines,
  locateRegions,
  parseDocument,
  buildEvidence,
  reconcile,
  applyEvidence,
  precisionValues,
  meaningful,
} from "./diagnostics.js";
import {
  renderOCR,
  preprocess,
  estimateNativeDPI,
  estimateSkew,
} from "./image-processing.js";
const clock = () => performance.now();
export async function recognizeRegion(
  page,
  region,
  ocr,
  {
    psm = 7,
    language = "kor+eng",
    methods = ["original", "contrast"],
    budget = () => true,
    progress = () => {},
  } = {},
) {
  const records = [];
  const rendered = await renderOCR(page, {
    box: region.box,
    dpi: OCR_LIMITS.regionDPI,
    maxPixels: OCR_LIMITS.maxRegionPixels,
  });
  try {
    for (const method of methods) {
      if (!budget(region.page)) break;
      progress(`정밀 OCR ${region.field} · ${method}`, 0);
      let input = rendered.canvas,
        normalized = null;
      if (
        region.textHeight &&
        (psm === 7 || region.singleLine) &&
        region.textHeight * rendered.plan.scale > 44
      ) {
        const factor = 36 / (region.textHeight * rendered.plan.scale);
        normalized = document.createElement("canvas");
        normalized.width = Math.max(1, Math.floor(input.width * factor));
        normalized.height = Math.max(1, Math.floor(input.height * factor));
        normalized
          .getContext("2d")
          .drawImage(input, 0, 0, normalized.width, normalized.height);
        input = normalized;
      }
      const processed = preprocess(input, method),
        start = clock();
      try {
        const result = await ocr.recognize(processed.canvas, { psm, language });
        records.push({
          ...region,
          text: result.text,
          engine: ocr.engine ?? "tesseract",
          values: precisionValues(region.field, result.text, {
            allowBare: region.valueOnly || region.method === "manual",
          }),
          confidence: result.confidence,
          psm,
          language,
          method,
          angle: processed.angle,
          renderDPI: rendered.plan.effectiveDPI,
          effectiveDPI:
            rendered.plan.effectiveDPI * (input.width / rendered.canvas.width),
          estimatedPeakBytes:
            processed.estimatedPeakBytes + rendered.plan.estimatedRGBABytes,
          elapsedMs: clock() - start + processed.elapsedMs,
        });
      } catch (e) {
        records.push({
          ...region,
          text: "",
          values: [],
          method,
          psm,
          language,
          error: e.message,
          elapsedMs: clock() - start,
        });
      } finally {
        processed.canvas.width = processed.canvas.height = 1;
        if (normalized) normalized.width = normalized.height = 1;
      }
    }
  } finally {
    rendered.canvas.width = rendered.canvas.height = 1;
  }
  return records;
}
export async function analyzeHybrid(
  pdf,
  {
    extractPage,
    createOCR,
    forceOCR = false,
    verifyCritical = true,
    progress = () => {},
    fieldSettings = {},
    limits = {},
  } = {},
) {
  const cap = { ...OCR_LIMITS, ...limits },
    start = clock(),
    ocr = createOCR(progress),
    diagnostic = {
      version: "2.2-experimental",
      pages: [],
      fields: [],
      attempts: 0,
      elapsedMs: 0,
      limits: cap,
      limitReasons: [],
      estimatedImagePeakBytes: 0,
      heapBefore: performance.memory?.usedJSHeapSize ?? null,
      heapAfter: null,
    },
    counts = new Map();
  const budget = (page) => {
    if (
      diagnostic.attempts >= cap.maxAttempts ||
      clock() - start > cap.maxMilliseconds ||
      (counts.get(page) ?? 0) >= cap.maxAttemptsPerPage
    ) {
      const reason = `${page}페이지: 재인식 횟수/시간 한도에 도달했습니다.`;
      if (!diagnostic.limitReasons.includes(reason))
        diagnostic.limitReasons.push(reason);
      return false;
    }
    diagnostic.attempts++;
    counts.set(page, (counts.get(page) ?? 0) + 1);
    return true;
  };
  const embedded = [],
    chosen = [];
  let usedOCR = false;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      progress(`페이지 ${n}/${pdf.numPages} · 내장 텍스트 검사`, 0);
      const page = await pdf.getPage(n),
        native = await extractPage(page),
        quality = textQuality(native, n - 1),
        record = {
          page: n,
          embedded: native,
          quality,
          wholeOCR: [],
          precision: [],
          decisions: [],
          nativeDPI: null,
        };
      embedded.push(native);
      diagnostic.pages.push(record);
      let selected = native;
      if (forceOCR || quality.suspect) {
        record.decisions.push(
          forceOCR ? "사용자가 전체 OCR 선택" : quality.reasons.join(", "),
        );
        if (
          diagnostic.attempts >= cap.maxAttempts ||
          clock() - start >= cap.maxMilliseconds
        ) {
          record.ocrSkipped = true;
          record.decisions.push("OCR 예산 소진: 이 페이지는 추가 확인 필요");
          diagnostic.limitReasons.push(
            `${n}페이지 OCR 미처리: 원문 확인 후 수동 보완이 필요합니다.`,
          );
          chosen.push(native);
          continue;
        }
        record.nativeDPI = await estimateNativeDPI(page);
        const rendered = await renderOCR(page, {
          dpi: cap.targetDPI,
          maxPixels: cap.maxPixels,
        });
        try {
          for (const [method, psm] of [
            ["original", 3],
            [
              estimateSkew(rendered.canvas) !== 0
                ? "deskew-denoise"
                : "adaptive",
              6,
            ],
          ]) {
            if (
              method !== "original" &&
              !record.wholeOCR.some(
                (r) =>
                  r.confidence < 80 ||
                  textQuality({ ...native, text: r.text }, n - 1).suspect,
              )
            )
              break;
            if (!budget(n)) break;
            const processed = preprocess(rendered.canvas, method),
              stage = clock();
            try {
              const data = await ocr.recognize(processed.canvas, { psm });
              const lines = normalizeOCRLines(data, rendered.plan.scale);
              const result = {
                text: data.text,
                lines,
                confidence: data.confidence,
                method,
                psm,
                language: "kor+eng",
                elapsedMs: clock() - stage + processed.elapsedMs,
                effectiveDPI: rendered.plan.effectiveDPI,
                estimatedPeakBytes:
                  processed.estimatedPeakBytes +
                  rendered.plan.estimatedRGBABytes,
              };
              record.wholeOCR.push(result);
              diagnostic.estimatedImagePeakBytes = Math.max(
                diagnostic.estimatedImagePeakBytes,
                result.estimatedPeakBytes,
              );
            } catch (e) {
              record.wholeOCR.push({
                text: "",
                lines: [],
                confidence: 0,
                method,
                psm,
                error: e.message,
                elapsedMs: clock() - stage,
              });
            } finally {
              processed.canvas.width = processed.canvas.height = 1;
            }
          }
        } finally {
          rendered.canvas.width = rendered.canvas.height = 1;
        }
        // Routing chooses an anchor/working text only. All valid field candidates remain separately reviewable.
        const viable = record.wholeOCR
          .filter((r) => r.text.trim())
          .sort((a, b) => {
            const aq = textQuality({ ...native, text: a.text }, n - 1),
              bq = textQuality({ ...native, text: b.text }, n - 1);
            return (
              aq.reasons.length - bq.reasons.length ||
              b.confidence - a.confidence
            );
          });
        if (viable.length && (forceOCR || quality.suspect)) {
          selected = {
            ...native,
            text: viable[0].text,
            lines: viable[0].lines,
            ocr: true,
          };
          usedOCR = true;
          record.decisions.push(
            "OCR을 작업 텍스트로 사용; 후보 간 충돌은 별도 검토",
          );
        } else if (quality.suspect)
          record.decisions.push("OCR도 읽지 못함; 수동 입력 필요");
      } else record.decisions.push("내장 텍스트 유지");
      chosen.push(selected);
    }
    const draft = parseDocument(chosen, usedOCR),
      regions = locateRegions(chosen),
      sources = [
        {
          kind: "embedded",
          draft: parseDocument(embedded),
          trustedPages: diagnostic.pages
            .filter((p) => !p.quality.suspect)
            .map((p) => p.page),
        },
      ];
    // Each whole-page variant is represented in a separate document to preserve disagreement.
    const maxVariants = Math.max(
      0,
      ...diagnostic.pages.map((p) => p.wholeOCR.length),
    );
    for (let v = 0; v < maxVariants; v++) {
      const pages = embedded.map((p, i) => {
        const r = diagnostic.pages[i].wholeOCR[v];
        return r?.text ? { ...p, text: r.text, lines: r.lines, ocr: true } : p;
      });
      sources.push({
        kind: "ocr",
        draft: parseDocument(pages),
        trusted: false,
        pages: diagnostic.pages
          .filter((p) => p.wholeOCR[v]?.text)
          .map((p) => p.page),
        method: `whole-${v}`,
      });
    }
    const evidence = buildEvidence(draft, sources, regions);
    const focus = regions.filter((r) =>
      ["prosecutor", "charges"].includes(r.field),
    );
    for (const region of focus) {
      const record = diagnostic.pages[region.page - 1],
        field = evidence.find((f) => f.key === region.key);
      if (!field) continue;
      if (
        region.personIndex !== null &&
        (region.personIndex < 0 ||
          region.personIndex >= draft.defendants.length)
      ) {
        record.decisions.push(
          "죄명 구간과 피고인 연결이 불확실하여 자동 적용하지 않음",
        );
        continue;
      }
      const needs =
        verifyCritical ||
        forceOCR ||
        record.quality.suspect ||
        !meaningful(field.finalValue) ||
        field.conflict;
      if (!needs) continue;
      record.regionsProcessed ??= 0;
      if (record.regionsProcessed >= cap.maxRegionsPerPage) {
        diagnostic.limitReasons.push(
          `${region.page}페이지: 자동 영역 수 한도, 추가 영역은 수동으로 선택하세요.`,
        );
        continue;
      }
      record.regionsProcessed++;
      const settings = fieldSettings[region.field] ?? {},
        psm = settings.psm ?? (region.field === "prosecutor" ? 7 : 6),
        language = settings.language ?? "kor+eng";
      const results = await recognizeRegion(
        await pdf.getPage(region.page),
        region,
        ocr,
        {
          psm,
          language,
          methods: settings.methods ?? ["original", "contrast"],
          budget,
          progress,
        },
      );
      record.precision.push(...results);
      if (!results.length) {
        field.verificationIncomplete = true;
        field.needsReview = true;
        field.finalValue = field.selectedValue = null;
      }
      for (const result of results) {
        diagnostic.estimatedImagePeakBytes = Math.max(
          diagnostic.estimatedImagePeakBytes,
          result.estimatedPeakBytes ?? 0,
        );
        for (const value of result.values) {
          field.candidates.push({
            value,
            source: "precision",
            page: region.page,
            box: region.box,
            confidence: result.confidence,
            method: `${result.method}/PSM${psm}/${language}`,
            trusted: false,
          });
        }
      }
      reconcile(field);
    }
    // If a critical ROI yielded nothing, verify the whole page once even when
    // its selectable layer looked plausible. This catches incorrect hidden OCR layers.
    if (verifyCritical) {
      for (const record of diagnostic.pages) {
        const failed = [
          ...new Set(
            record.precision.filter((r) => !r.values.length).map((r) => r.key),
          ),
        ].filter(
          (key) =>
            !record.precision.some((r) => r.key === key && r.values.length),
        );
        if (!failed.length || record.wholeOCR.length) continue;
        if (!budget(record.page)) continue;
        const page = await pdf.getPage(record.page),
          rendered = await renderOCR(page, {
            dpi: cap.targetDPI,
            maxPixels: cap.maxPixels,
          }),
          stage = clock();
        try {
          const result = await ocr.recognize(rendered.canvas, { psm: 6 });
          const lines = normalizeOCRLines(result, rendered.plan.scale);
          record.wholeOCR.push({
            text: result.text,
            engine: ocr.engine ?? "tesseract",
            lines,
            confidence: result.confidence,
            method: "critical-fallback",
            psm: 6,
            elapsedMs: clock() - stage,
            effectiveDPI: rendered.plan.effectiveDPI,
          });
          record.decisions.push(
            "정밀 영역에서 필수값 미검출: 선택 가능한 텍스트가 있어도 전체 OCR 대조",
          );
          usedOCR = true;
          const pages = embedded.map((p, i) =>
            i === record.page - 1
              ? { ...p, text: result.text, lines, ocr: true }
              : p,
          );
          const extra = buildEvidence(
            draft,
            [
              {
                kind: "ocr",
                draft: parseDocument(pages),
                trusted: false,
                pages: [record.page],
                method: "critical-fallback",
                confidence: result.confidence,
              },
            ],
            locateRegions(pages),
          );
          for (const f of evidence) {
            const found = extra.find((e) => e.key === f.key);
            if (found) {
              f.candidates.push(...found.candidates);
              reconcile(f);
            }
          }
          // A bad hidden text layer can provide incorrect word widths/positions.
          // Relocate from OCR geometry once, rather than reusing that bad rectangle.
          const relocated = locateRegions(pages)
            .filter((r) => failed.includes(r.key) && r.page === record.page)
            .sort(
              (a, b) =>
                (a.field === "charges" ? -1 : 1) -
                (b.field === "charges" ? -1 : 1),
            );
          for (const region of relocated) {
            if (
              diagnostic.attempts >= cap.maxAttempts ||
              (counts.get(record.page) ?? 0) >= cap.maxAttemptsPerPage
            )
              break;
            const results = await recognizeRegion(page, region, ocr, {
              psm: region.field === "prosecutor" ? 7 : 6,
              methods: ["original"],
              budget,
              progress,
            });
            record.precision.push(
              ...results.map((r) => ({
                ...r,
                method: "ocr-relocated/" + r.method,
              })),
            );
            const field = evidence.find((f) => f.key === region.key);
            if (!field) continue;
            for (const r of results)
              for (const value of r.values)
                field.candidates.push({
                  value,
                  source: "precision",
                  page: region.page,
                  box: region.box,
                  confidence: r.confidence,
                  method: "ocr-relocated/" + r.method,
                  trusted: false,
                });
            reconcile(field);
          }
        } catch (e) {
          record.decisions.push("전체 재대조 실패: " + e.message);
        } finally {
          rendered.canvas.width = rendered.canvas.height = 1;
        }
        for (const key of failed) {
          const f = evidence.find((f) => f.key === key);
          if (f && !f.candidates.some((c) => c.source === "ocr")) {
            f.needsReview = true;
            f.finalValue = f.selectedValue = null;
            record.decisions.push(key + ": 추가 검증 실패. 원문 확인 필요");
          }
        }
      }
    }
    // Missing labels/regions are visible; never invent a field from a fixed sample rectangle.
    for (const f of evidence)
      if (f.required && !f.candidates.length)
        diagnostic.limitReasons.push(
          `${f.label}: 자동 후보 없음. 수동 영역 지정 또는 직접 입력이 필요합니다.`,
        );
    if (usedOCR)
      for (const f of evidence)
        if (
          f.key.endsWith(".counsel") &&
          f.finalValue?.status === "absentMissing"
        ) {
          f.finalValue = f.selectedValue = null;
          f.needsReview = true;
        }
    const skipped = diagnostic.pages
      .filter((p) => p.ocrSkipped)
      .map((p) => p.page);
    if (skipped.length)
      draft.incompleteAnalysis = { pages: skipped, confirmed: false };
    draft.warnings.push(...diagnostic.limitReasons);
    applyEvidence(draft, evidence);
    diagnostic.fields = evidence;
    diagnostic.elapsedMs = clock() - start;
    diagnostic.heapAfter = performance.memory?.usedJSHeapSize ?? null;
    return {
      pages: chosen,
      text: chosen.map((p) => p.text).join("\n"),
      usedOCR,
      draft,
      diagnostics: diagnostic,
    };
  } finally {
    await ocr.close();
  }
}
