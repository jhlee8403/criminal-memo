import Foundation
import UIKit
import PDFKit
import CryptoKit
import MemoCore

struct MemoPDFRenderer {
    func render(_ draft: CaseDraft, templateURL: URL? = Bundle.main.url(forResource: "memo-template", withExtension: "pdf")) throws -> Data {
        guard let url = templateURL else { throw MemoError.missingTemplate }
        let data = try Data(contentsOf: url)
        let layout = try TemplateLayout.bundled()
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == layout.templateSHA256,
              let provider = CGDataProvider(data: data as CFData),
              let source = CGPDFDocument(provider), source.numberOfPages > 0,
              let first = source.page(at: 1) else { throw MemoError.changedTemplate }
        let firstBounds = first.getBoxRect(.mediaBox)
        guard abs(firstBounds.width - layout.width) < 0.01,
              abs(firstBounds.height - layout.height) < 0.01, first.rotationAngle == 0 else { throw MemoError.changedTemplate }
        let renderer = UIGraphicsPDFRenderer(bounds: firstBounds)
        var renderingError: Error?
        let result = renderer.pdfData { output in
          do {
            for number in 1...source.numberOfPages {
                guard let page = source.page(at: number) else { throw MemoError.invalidPDF }
                let bounds = page.getBoxRect(.mediaBox)
                output.beginPage(withBounds: CGRect(origin: .zero, size: bounds.size), pageInfo: [:])
                let context = output.cgContext
                context.saveGState()
                context.translateBy(x: -bounds.minX, y: bounds.height + bounds.minY)
                context.scaleBy(x: 1, y: -1)
                context.drawPDFPage(page)
                context.restoreGState()
                if number - 1 == layout.pageIndex { try draw(draft, layout: layout, context: context) }
            }
          } catch { renderingError = error }
        }
        if let renderingError { throw renderingError }
        return result
    }

    private func rect(_ name: String, _ layout: TemplateLayout) -> CGRect {
        let b = layout.box(name)
        return CGRect(x: b.x, y: b.y, width: b.width, height: b.height)
    }

    private func draw(_ draft: CaseDraft, layout: TemplateLayout, context: CGContext) throws {
        for (key, text, label) in [
            ("defendants", draft.numberedDefendants, "피고인"),
            ("charges", draft.numberedCharges, "죄명"),
            ("prosecutor", draft.prosecutor, "검사"),
            ("counsel", draft.counselText, "변호인"),
            ("indictmentDate", draft.indictmentDate?.text ?? "", "기소일")
        ] { try drawText(text, in: rect(key, layout), label: label) }
        let detention = rect("detention", layout)
        if draft.detention == .detained {
            context.setStrokeColor(UIColor.red.cgColor); context.setLineWidth(1.8)
            context.strokeEllipse(in: CGRect(x: detention.midX - 7, y: detention.midY - 7, width: 14, height: 14))
        } else if draft.detention == .released {
            try drawText("X", in: detention, label: "구속", alignment: .center)
        }
        context.setStrokeColor(UIColor.red.cgColor); context.setLineWidth(1.3)
        if draft.marksJuvenile { context.strokeEllipse(in: rect("juvenile", layout)) }
        if draft.marksMandatoryCounsel { context.strokeEllipse(in: rect("mandatoryCounsel", layout)) }
    }

    private func drawText(_ text: String, in rect: CGRect, label: String, alignment: NSTextAlignment = .left) throws {
        guard !text.isEmpty else { return }
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment; paragraph.lineBreakMode = .byWordWrapping
        for size in stride(from: 11.0, through: 8.0, by: -0.5) {
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: size), .foregroundColor: UIColor.black, .paragraphStyle: paragraph
            ]
            let measured = (text as NSString).boundingRect(with: CGSize(width: rect.width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
            if ceil(measured.height) <= rect.height && ceil(measured.width) <= rect.width {
                (text as NSString).draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes, context: nil)
                return
            }
        }
        throw MemoError.overflow(label)
    }
}
