import XCTest
import PDFKit
import UIKit
import MemoCore
@testable import CriminalMemo

final class ApplePDFTests: XCTestCase {
    private func template() throws -> URL {
        try XCTUnwrap(Bundle.main.url(forResource: "memo-template", withExtension: "pdf"))
    }
    private func sample(_ number: Int) throws -> URL {
        let urls = Bundle(for: Self.self).urls(forResourcesWithExtension: "pdf", subdirectory: nil) ?? []
        return try XCTUnwrap(urls.first { $0.lastPathComponent.precomposedStringWithCanonicalMapping == "공소장\(number).pdf" })
    }
    func testPDFKitReadsActualSamples() throws {
        for number in [1,2] {
            let extracted = try PDFTextReader().read(url: sample(number))
            XCTAssertTrue(extracted.ocrPages.isEmpty)
            let draft = ExtractionPipeline().extract(text: extracted.text)
            if number == 1 {
                XCTAssertEqual(draft.numberedDefendants, "1. 이민주")
                XCTAssertEqual(draft.numberedCharges, "1. 상해\n2. 폭행치상")
                XCTAssertEqual(draft.prosecutor, "이승엽")
                XCTAssertEqual(draft.birthAssessments[0].age, 40)
                XCTAssertFalse(draft.birthAssessments[0].canApplyAgeMarks)
            } else {
                XCTAssertEqual(draft.defendants.map(\.name), ["김유나", "이영수"])
                XCTAssertEqual(draft.defendants.map { $0.counsel.text }, ["윤상일(국선)", "X"])
                XCTAssertEqual(draft.defendants.map(\.detention), [.detained, .released])
                XCTAssertEqual(draft.birthAssessments.map(\.age), [54,55])
            }
        }
    }
    func testVisionReadsRasterizedScan() throws {
        // Create an image-only copy of the real sample; there is no embedded text.
        let original = try XCTUnwrap(PDFDocument(url: sample(1)))
        let page = try XCTUnwrap(original.page(at: 0))
        let bounds = page.bounds(for: .mediaBox)
        let image = page.thumbnail(of: CGSize(width: bounds.width * 3, height: bounds.height * 3), for: .mediaBox)
        let data = UIGraphicsPDFRenderer(bounds: bounds).pdfData { ctx in ctx.beginPage(); image.draw(in: bounds) }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        try data.write(to: url); defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertTrue((PDFDocument(data: data)?.string ?? "").isEmpty)
        let extracted = try PDFTextReader().read(url: url)
        XCTAssertEqual(extracted.ocrPages, [1])
        XCTAssertTrue(extracted.text.contains("공소"))
        // OCR quality varies by OS. This asserts the actual required fields, rather than only nonempty output.
        let draft = ExtractionPipeline().extract(text: extracted.text, readability: .needsReview)
        XCTAssertTrue(draft.hasUnconfirmedCounsel)
        XCTAssertFalse(draft.birthAssessments[0].canApplyAgeMarks)
        XCTAssertEqual(draft.defendants.first?.name, "이민주")
        XCTAssertEqual(draft.prosecutor, "이승엽")
        XCTAssertEqual(draft.charges, ["상해", "폭행치상"])
    }
    func testGeneratedPDFPreservesTemplateAndAddsText() throws {
        var draft = CaseDraft()
        draft.defendants = [Defendant(name: "가상피고인", counsel: CounselInfo(status: .absentExplicit), charges: ["가상죄명", "시험죄명"], detention: .detained)]
        draft.prosecutor = "가상검사"
        draft.indictmentDate = CivilDate(2025,8,22)
        let data = try MemoPDFRenderer().render(draft)
        let output = try XCTUnwrap(PDFDocument(data: data))
        let source = try XCTUnwrap(PDFDocument(url: template()))
        XCTAssertEqual(output.pageCount, source.pageCount)
        for index in 0..<source.pageCount {
            let before = try XCTUnwrap(source.page(at: index))
            let after = try XCTUnwrap(output.page(at: index))
            XCTAssertEqual(before.bounds(for: .mediaBox).width, after.bounds(for: .mediaBox).width, accuracy: 0.01)
            XCTAssertEqual(before.bounds(for: .mediaBox).height, after.bounds(for: .mediaBox).height, accuracy: 0.01)
            for word in (before.string ?? "").components(separatedBy: .whitespacesAndNewlines).filter({ !$0.isEmpty }) {
                XCTAssertTrue((after.string ?? "").contains(word), "original text lost: \(word)")
            }
        }
        XCTAssertTrue((output.string ?? "").contains("가상피고인"))
        XCTAssertTrue((output.string ?? "").contains("2025.08.22"))
        let layout = try TemplateLayout.bundled()
        let outputPage = try XCTUnwrap(output.page(at: 0))
        for (text, field) in [("가상피고인", "defendants"), ("가상죄명", "charges"), ("가상검사", "prosecutor"), ("2025.08.22", "indictmentDate")] {
            let selection = try XCTUnwrap(output.findString(text, withOptions: []).first)
            let pdfBounds = selection.bounds(for: outputPage)
            let topBounds = CGRect(x: pdfBounds.minX, y: layout.height - pdfBounds.maxY, width: pdfBounds.width, height: pdfBounds.height)
            let box = layout.box(field)
            let expected = CGRect(x: box.x, y: box.y, width: box.width, height: box.height).insetBy(dx: -1, dy: -1)
            XCTAssertTrue(expected.contains(topBounds), "iOS text outside mapped field: \(field)")
        }
        let outputURL = FileManager.default.temporaryDirectory.appendingPathComponent("memo-apple-test-output.pdf")
        try data.write(to: outputURL)
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "com.adobe.pdf")
        attachment.name = "실제 iOS 렌더러 출력 좌표 검토용"; attachment.lifetime = .keepAlways
        add(attachment)
        try FileManager.default.removeItem(at: outputURL)
    }
    func testUnconfirmedCounselBlocksRendering() {
        var draft = CaseDraft(); draft.defendants = [Defendant(name: "미확인")]
        XCTAssertThrowsError(try MemoPDFRenderer().render(draft)) { error in
            guard case MemoError.unconfirmedCounsel = error else { return XCTFail("wrong error: \(error)") }
        }
    }
    func testActualMultiDefendantRenderingFitsCounselAndDetention() throws {
        let extracted = try PDFTextReader().read(url: sample(2))
        let draft = ExtractionPipeline().extract(text: extracted.text)
        let data = try MemoPDFRenderer().render(draft)
        let pdf = try XCTUnwrap(PDFDocument(data: data))
        XCTAssertTrue((pdf.string ?? "").contains("윤상일"))
        XCTAssertTrue((pdf.string ?? "").contains("김유나"))
        XCTAssertTrue((pdf.string ?? "").contains("이영수"))
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "com.adobe.pdf")
        attachment.name = "피고인별 변호인·구속 표시"; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testOversizedTextFailsInsteadOfTruncating() {
        var draft = CaseDraft(); draft.prosecutor = String(repeating: "검사이름", count: 500)
        XCTAssertThrowsError(try MemoPDFRenderer().render(draft))
    }
    func testDifferentTemplateIsRejected() throws {
        let data = UIGraphicsPDFRenderer(bounds: CGRect(x: 0,y: 0,width: 595,height: 841)).pdfData { $0.beginPage() }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".pdf")
        try data.write(to: url); defer { try? FileManager.default.removeItem(at: url) }
        XCTAssertThrowsError(try MemoPDFRenderer().render(CaseDraft(), templateURL: url))
    }
}
