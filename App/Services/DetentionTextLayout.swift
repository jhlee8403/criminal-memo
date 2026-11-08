import UIKit
import MemoCore

/// One unbroken attributed line. Measurement and drawing use the same text/fonts.
struct DetentionTextLayout {
    let text: NSAttributedString
    let origin: CGPoint
    let bounds: CGRect

    static func make(glyphs: [DetentionGlyph], in field: CGRect) throws -> DetentionTextLayout {
        for size in stride(from: 14.0, through: 8.0, by: -0.5) {
            let text = NSMutableAttributedString(string: "")
            for glyph in glyphs {
                text.append(NSAttributedString(string: glyph.character, attributes: [
                    .font: UIFont.monospacedSystemFont(ofSize: CGFloat(size), weight: .regular),
                    .foregroundColor: glyph.ink == .red ? UIColor.red : UIColor.black
                ]))
            }
            // size() measures a single line; there is no word wrapping, newline or clipping.
            let measured = text.size()
            if ceil(measured.width) <= field.width && ceil(measured.height) <= field.height {
                let origin = CGPoint(x: field.midX - measured.width / 2, y: field.midY - measured.height / 2)
                return DetentionTextLayout(text: text, origin: origin, bounds: CGRect(origin: origin, size: measured))
            }
        }
        // Never truncate, wrap, or silently skip defendants when space is exhausted.
        throw MemoError.overflow("구속 표시 (한 줄)")
    }
}
