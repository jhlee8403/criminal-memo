import Foundation
import PDFKit
import Vision
import UIKit

struct ExtractedDocument: Sendable {
    let text: String
    let ocrPages: [Int]
    let lowConfidencePages: [Int]
}

enum MemoError: LocalizedError {
    case invalidPDF, lockedPDF, tooLarge, unreadablePage(Int), emptyText
    case missingTemplate, changedTemplate, overflow(String), invalidDate, unconfirmedCounsel
    var errorDescription: String? {
        switch self {
        case .invalidPDF: return "읽을 수 없는 PDF입니다."
        case .lockedPDF: return "암호화된 PDF입니다. 잠금을 해제한 사본을 가져오세요."
        case .tooLarge: return "1차 버전은 50MB 이하, 100페이지 이하 PDF를 지원합니다."
        case .unreadablePage(let page): return "\(page)페이지의 텍스트를 읽지 못했습니다. 원문을 확인하세요."
        case .emptyText: return "문서에서 텍스트를 찾지 못했습니다."
        case .missingTemplate: return "번들에서 원본 형사메모 양식을 찾지 못했습니다."
        case .changedTemplate: return "분석된 원본 양식과 다른 PDF입니다. 좌표를 재검증해야 합니다."
        case .overflow(let field): return "\(field) 내용이 지정된 칸에 들어가지 않습니다. 내용을 줄인 뒤 다시 생성하세요."
        case .unconfirmedCounsel: return "판독이 불확실한 피고인의 변호인 기재 여부를 먼저 확인하세요."
        case .invalidDate: return "기소일을 YYYY.MM.DD 형식으로 입력하세요."
        }
    }
}

struct PDFTextReader {
    // PDFKit/Vision objects remain on this worker; nothing is sent to a server.
    func read(url: URL, forceOCR: Bool = false) throws -> ExtractedDocument {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey])
        guard (values.fileSize ?? 0) <= 50 * 1024 * 1024 else { throw MemoError.tooLarge }
        guard let pdf = PDFDocument(url: url) else { throw MemoError.invalidPDF }
        guard !pdf.isLocked else { throw MemoError.lockedPDF }
        guard pdf.pageCount > 0, pdf.pageCount <= 100 else { throw MemoError.tooLarge }
        var texts: [String] = [], ocrPages: [Int] = [], lowConfidence: [Int] = []
        for index in 0..<pdf.pageCount {
            try Task.checkCancellation()
            guard let page = pdf.page(at: index) else { throw MemoError.unreadablePage(index + 1) }
            let result: (String, Bool) = try autoreleasepool {
                let embedded = page.string ?? ""
                let useful = embedded.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.count
                if !forceOCR && useful >= 20 { return (embedded, false) }
                ocrPages.append(index + 1)
                let bounds = page.bounds(for: .mediaBox)
                guard bounds.width > 0, bounds.height > 0 else { throw MemoError.unreadablePage(index + 1) }
                // PDFKit thumbnail honors page rotation. Bound image size to avoid OCR memory spikes.
                let scale = min(3, 2800 / max(bounds.width, bounds.height))
                let image = page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
                guard let cgImage = image.cgImage else { throw MemoError.unreadablePage(index + 1) }
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.recognitionLanguages = ["ko-KR", "en-US"]
                request.usesLanguageCorrection = false
                try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
                let observations = (request.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }
                // Group fragments from the same row before sorting horizontally. Vision may
                // return a label and its value as separate observations.
                var rows: [[VNRecognizedTextObservation]] = []
                for observation in observations {
                    if let last = rows.last, let anchor = last.first,
                       abs(anchor.boundingBox.midY - observation.boundingBox.midY) < min(anchor.boundingBox.height, observation.boundingBox.height) * 0.5 {
                        rows[rows.count - 1].append(observation)
                    } else { rows.append([observation]) }
                }
                let candidates = observations.compactMap { $0.topCandidates(1).first }
                let text = rows.map { row in
                    row.sorted { $0.boundingBox.minX < $1.boundingBox.minX }
                        .compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
                }.joined(separator: "\n")
                guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw MemoError.unreadablePage(index + 1) }
                return (text, candidates.contains { $0.confidence < 0.8 })
            }
            if result.1 { lowConfidence.append(index + 1) }
            texts.append(result.0)
        }
        guard !texts.joined().trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw MemoError.emptyText }
        return ExtractedDocument(text: texts.joined(separator: "\n\n"), ocrPages: ocrPages, lowConfidencePages: lowConfidence)
    }
}
