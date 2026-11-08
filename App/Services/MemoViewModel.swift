import Foundation
import SwiftUI
import MemoCore

@MainActor
final class MemoViewModel: ObservableObject {
    @Published var draft = CaseDraft()
    @Published var sourceText = ""
    @Published var sourceData: Data?
    @Published var outputData: Data?
    @Published var busy = false
    @Published var errorMessage: String?
    @Published var extractionNote = ""
    @Published var reviewed = false

    func load(_ url: URL, forceOCR: Bool) {
        busy = true; errorMessage = nil; reviewed = false; outputData = nil
        sourceText = ""; sourceData = nil; draft = CaseDraft(); extractionNote = ""
        Task {
            do {
                let loaded = try await Task.detached(priority: .userInitiated) {
                    let scope = url.startAccessingSecurityScopedResource()
                    defer { if scope { url.stopAccessingSecurityScopedResource() } }
                    let extracted = try PDFTextReader().read(url: url, forceOCR: forceOCR)
                    return (extracted, try Data(contentsOf: url))
                }.value
                sourceData = loaded.1
                sourceText = loaded.0.text
                draft = ExtractionPipeline().extract(text: loaded.0.text)
                extractionNote = loaded.0.ocrPages.isEmpty ? "PDF 텍스트 직접 추출" : "OCR 사용 페이지: \(loaded.0.ocrPages.map(String.init).joined(separator: ", "))"
                if !loaded.0.lowConfidencePages.isEmpty {
                    draft.warnings.append("OCR 신뢰도가 낮은 페이지: \(loaded.0.lowConfidencePages.map(String.init).joined(separator: ", ")). 원문 대조가 필요합니다.")
                }
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }

    func generate(dateText: String) {
        guard dateText.isEmpty || CivilDate.parse(dateText) != nil else { errorMessage = MemoError.invalidDate.localizedDescription; return }
        draft.indictmentDate = CivilDate.parse(dateText)
        guard reviewed else { errorMessage = "원문과 추출 결과를 먼저 검토하세요."; return }
        let snapshot = draft
        busy = true; errorMessage = nil; outputData = nil
        Task {
            do {
                outputData = try await Task.detached(priority: .userInitiated) { try MemoPDFRenderer().render(snapshot) }.value
            } catch { errorMessage = error.localizedDescription }
            busy = false
        }
    }
}
