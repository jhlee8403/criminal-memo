import XCTest
import PDFKit
import UIKit
import MemoCore
@testable import CriminalMemo

final class FinalOutputTests: XCTestCase {
    private func field(_ name: String) throws -> CGRect {
        let layout = try TemplateLayout.bundled(), box = layout.box(name)
        return CGRect(x: box.x, y: layout.height - box.y - box.height, width: box.width, height: box.height)
    }
    private func assertColor(_ color: UIColor, red: Bool, file: StaticString = #filePath, line: UInt = #line) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        XCTAssertTrue(color.getRed(&r, green: &g, blue: &b, alpha: &a), file: file, line: line)
        XCTAssertEqual(r, red ? 1 : 0, accuracy: 0.02, file: file, line: line)
        XCTAssertEqual(g, 0, accuracy: 0.02, file: file, line: line)
        XCTAssertEqual(b, 0, accuracy: 0.02, file: file, line: line)
    }
    func testAttributedLineFitsAndPreservesEachColor() throws {
        let box = try TemplateLayout.bundled().box("detention")
        let rect = CGRect(x: box.x, y: box.y, width: box.width, height: box.height)
        for statuses: [Detention] in [[.detained], [.released], [.detained,.released], [.released,.detained], [.detained,.detained], [.released,.released], [.detained,.released,.detained]] {
            let glyphs = try DetentionOutput.glyphs(for: statuses)
            let line = try DetentionTextLayout.make(glyphs: glyphs, in: rect)
            XCTAssertEqual(line.text.string, glyphs.map(\.character).joined())
            XCTAssertTrue(rect.contains(line.bounds))
            for index in glyphs.indices {
                let color = try XCTUnwrap(line.text.attribute(.foregroundColor, at: index, effectiveRange: nil) as? UIColor)
                assertColor(color, red: glyphs[index].ink == .red)
            }
        }
        XCTAssertThrowsError(try DetentionTextLayout.make(glyphs: DetentionOutput.glyphs(for: Array(repeating: .detained, count: 100)), in: rect))
    }
    func testActualSamplePDFCounselAndDetentionFields() throws {
        let samples = Bundle(for: ApplePDFTests.self).urls(forResourcesWithExtension: "pdf", subdirectory: nil) ?? []
        for number in [1,2] {
            let url = try XCTUnwrap(samples.first { $0.lastPathComponent.precomposedStringWithCanonicalMapping == "공소장\(number).pdf" })
            let source = try PDFTextReader().read(url: url)
            let draft = ExtractionPipeline().extract(text: source.text)
            let output = try MemoPDFRenderer().render(draft)
            let pdf = try XCTUnwrap(PDFDocument(data: output)), page = try XCTUnwrap(pdf.page(at: 0))
            let counsel = page.selection(for: try field("counsel"))?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            XCTAssertEqual(counsel, number == 1 ? "" : "윤상일(국선)")
            let selection = try XCTUnwrap(page.selection(for: try field("detention")))
            let text = try XCTUnwrap(selection.string).trimmingCharacters(in: .whitespacesAndNewlines)
            let expected = number == 1 ? "O" : "OX"
            XCTAssertEqual(text, expected) // No numbers, whitespace, comma or newline.
            XCTAssertEqual(selection.selectionsByLine().count, 1)
            XCTAssertTrue(try field("detention").contains(selection.bounds(for: page)))
            let attributed = try XCTUnwrap(selection.attributedString)
            let range = (attributed.string as NSString).range(of: expected)
            XCTAssertNotEqual(range.location, NSNotFound)
            if range.location != NSNotFound {
                for (index, character) in expected.enumerated() {
                    let color = try XCTUnwrap(attributed.attribute(.foregroundColor, at: range.location + index, effectiveRange: nil) as? UIColor)
                    assertColor(color, red: character == "O")
                }
            }
            let attachment = XCTAttachment(data: output, uniformTypeIdentifier: "com.adobe.pdf")
            attachment.name = "최종 표시 규칙 공소장\(number)"; attachment.lifetime = .keepAlways; add(attachment)
        }
    }
    func testUnknownDefendantDetentionRequiresConfirmation() {
        var draft = CaseDraft()
        draft.defendants = [Defendant(name: "피고인", counsel: CounselInfo(status: .absentMissing))]
        XCTAssertThrowsError(try MemoPDFRenderer().render(draft)) { error in
            guard case MemoError.unconfirmedDetention = error else { return XCTFail("wrong error: \(error)") }
        }
    }
}
