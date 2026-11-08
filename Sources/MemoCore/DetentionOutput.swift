import Foundation

public enum DetentionInk: String, Equatable, Sendable { case red, black }

public struct DetentionGlyph: Equatable, Sendable {
    public let character: String
    public let ink: DetentionInk
}

public enum DetentionOutputError: Error, Equatable {
    /// One-based defendant positions. No partial output is returned.
    case confirmationRequired([Int])
}

public enum DetentionOutput {
    public static func glyphs(for statuses: [Detention]) throws -> [DetentionGlyph] {
        let unknown = statuses.enumerated().filter { $0.element == .unknown }.map { $0.offset + 1 }
        guard unknown.isEmpty else { throw DetentionOutputError.confirmationRequired(unknown) }
        return statuses.map { status in
            DetentionGlyph(character: status == .detained ? "O" : "X", ink: status == .detained ? .red : .black)
        }
    }
}
