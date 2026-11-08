import Foundation

public struct FieldBox: Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public init(_ values: [Double]) {
        precondition(values.count == 4)
        x = values[0]; y = values[1]; width = values[2]; height = values[3]
    }
    public func bottomLeftY(pageHeight: Double) -> Double { pageHeight - y - height }
}

public struct TemplateLayout: Decodable, Sendable {
    public let templateSHA256: String
    public let pageIndex: Int
    public let width: Double
    public let height: Double
    public let fields: [String: [Double]]
    public func box(_ name: String) -> FieldBox { FieldBox(fields[name]!) }
    public static func bundled() throws -> TemplateLayout {
        guard let url = Bundle.module.url(forResource: "template-layout", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}
