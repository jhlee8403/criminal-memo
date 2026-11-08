import Foundation

public enum Detention: String, CaseIterable, Codable, Sendable {
    case unknown, detained, released
    public var label: String {
        switch self { case .unknown: return "확인 필요"; case .detained: return "구속"; case .released: return "불구속" }
    }
    public var mark: String { self == .detained ? "O" : self == .released ? "X" : "" }
}

public struct Defendant: Identifiable, Equatable, Codable, Sendable {
    public var id = UUID()
    public var name: String
    public var residentNumber: String
    public init(name: String = "", residentNumber: String = "") {
        self.name = name; self.residentNumber = residentNumber
    }
}

public struct CaseDraft: Equatable, Codable, Sendable {
    public var defendants: [Defendant] = []
    public var charges: [String] = []
    public var prosecutor = ""
    public var counsel = ""
    public var noCounsel = false
    public var indictmentDate: CivilDate?
    public var detention: Detention = .unknown
    public var warnings: [String] = []
    public init() {}
    public var numberedDefendants: String { Self.numbered(defendants.map(\.name)) }
    public var numberedCharges: String { Self.numbered(charges) }
    public var counselText: String { noCounsel ? "X" : counsel }
    public static func numbered(_ values: [String]) -> String {
        values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n")
    }
    public var ageResults: [AgeResult] {
        defendants.map { ResidentNumber.age($0.residentNumber, on: indictmentDate) }
    }
    public var marksJuvenile: Bool { ageResults.contains { if case .valid(let age) = $0 { return age < 19 }; return false } }
    public var marksMandatoryCounsel: Bool { ageResults.contains { if case .valid(let age) = $0 { return age > 70 }; return false } }
}

public struct CivilDate: Equatable, Comparable, Codable, Sendable {
    public let year: Int
    public let month: Int
    public let day: Int
    public init?(_ year: Int, _ month: Int, _ day: Int) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard (1...9999).contains(year), let date = calendar.date(from: DateComponents(year: year, month: month, day: day)) else { return nil }
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        guard parts.year == year, parts.month == month, parts.day == day else { return nil }
        self.year = year; self.month = month; self.day = day
    }
    public static func < (lhs: Self, rhs: Self) -> Bool {
        if lhs.year != rhs.year { return lhs.year < rhs.year }
        if lhs.month != rhs.month { return lhs.month < rhs.month }
        return lhs.day < rhs.day
    }
    public var text: String { String(format: "%04d.%02d.%02d", year, month, day) }
    public static func parse(_ text: String) -> CivilDate? {
        guard let parts = Regex.captures(#"^\s*(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})(?:[.일])?\s*$"#, in: text),
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        return CivilDate(y, m, d)
    }
}

public enum AgeResult: Equatable, Sendable {
    case valid(Int), invalid(String)
    public var message: String {
        switch self { case .valid(let age): return "기소일 기준 만 \(age)세"
        case .invalid(let reason): return reason }
    }
}

public enum ResidentNumber {
    // Conservative policy: only complete domestic legacy checksum-compatible numbers.
    // Masked numbers, foreign identifiers, and newer non-checksummed identifiers need manual review.
    public static func age(_ input: String, on date: CivilDate?) -> AgeResult {
        let raw = input.replacingOccurrences(of: "-", with: "").trimmingCharacters(in: .whitespaces)
        guard raw.count == 13, raw.allSatisfy({ $0.isASCII && $0.isNumber }) else { return .invalid("주민등록번호 13자리 확인 필요") }
        let digits = raw.map { Int(String($0))! }
        guard (1...12).contains(digits[2] * 10 + digits[3]), (1...31).contains(digits[4] * 10 + digits[5]) else {
            return .invalid("주민등록번호의 생년월일이 유효하지 않음")
        }
        guard (1...4).contains(digits[6]) else { return .invalid("지원하지 않는 주민번호 구분값: 수동 확인 필요") }
        let year = (digits[6] <= 2 ? 1900 : 2000) + digits[0] * 10 + digits[1]
        guard let birth = CivilDate(year, digits[2] * 10 + digits[3], digits[4] * 10 + digits[5]) else {
            return .invalid("주민등록번호의 생년월일이 유효하지 않음")
        }
        let weights = [2,3,4,5,6,7,8,9,2,3,4,5]
        let sum = zip(digits.prefix(12), weights).reduce(0) { $0 + $1.0 * $1.1 }
        guard (11 - sum % 11) % 10 == digits[12] else { return .invalid("주민등록번호 검증값 불일치: 수동 확인 필요") }
        guard let date else { return .invalid("유효한 기소일 확인 필요") }
        guard birth <= date else { return .invalid("생년월일이 기소일보다 늦음") }
        let age = date.year - birth.year - ((date.month, date.day) < (birth.month, birth.day) ? 1 : 0)
        return .valid(age)
    }
}

public enum Regex {
    public static func captures(_ pattern: String, in text: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let match = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (1..<match.numberOfRanges).map { i in
            guard let range = Range(match.range(at: i), in: text) else { return "" }; return String(text[range])
        }
    }
    public static func replacing(_ pattern: String, in text: String, with replacement: String) -> String {
        guard let re = try? NSRegularExpression(pattern: pattern) else { return text }
        return re.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: replacement)
    }
}
