import Foundation

public enum Detention: String, CaseIterable, Codable, Sendable {
    case unknown, detained, released
    public var label: String {
        switch self { case .unknown: return "확인 필요"; case .detained: return "구속"; case .released: return "불구속" }
    }
    public var mark: String { self == .detained ? "O" : self == .released ? "X" : "" }
}

public enum CounselStatus: String, CaseIterable, Codable, Sendable {
    case named, absentExplicit, absentMissing, needsReview
    public var label: String {
        switch self {
        case .named: return "변호인 기재"
        case .absentExplicit: return "없음 명시 (X)"
        case .absentMissing: return "항목 미기재 (X)"
        case .needsReview: return "판독 불확실 · 확인 필요"
        }
    }
}

public struct CounselInfo: Equatable, Codable, Sendable {
    public var status: CounselStatus
    public var name: String
    public var reason: String
    public init(status: CounselStatus = .needsReview, name: String = "", reason: String = "직접 확인하세요.") {
        self.status = status; self.name = name; self.reason = reason
    }
    public var needsConfirmation: Bool { status == .needsReview || (status == .named && name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
    public var text: String {
        switch status {
        case .named: return name
        case .absentExplicit, .absentMissing: return "X"
        case .needsReview: return ""
        }
    }
}

public struct Defendant: Identifiable, Equatable, Codable, Sendable {
    public var id = UUID()
    public var name: String
    /// Only YYMMDD is retained. The trailing identifier is never stored or interpreted.
    public var birthDigits: String
    public var statedAge: Int?
    /// Empty means no user override. Invalid nonempty edits must not silently fall back.
    public var confirmedBirthYear: String
    public var birthRequiresReview: Bool
    public var counsel: CounselInfo
    public var charges: [String]
    public var detention: Detention
    public init(name: String = "", birthDigits: String = "", statedAge: Int? = nil,
                confirmedBirthYear: String = "", birthRequiresReview: Bool = false, counsel: CounselInfo = CounselInfo(),
                charges: [String] = [], detention: Detention = .unknown) {
        self.name = name; self.birthDigits = birthDigits; self.statedAge = statedAge
        self.confirmedBirthYear = confirmedBirthYear; self.birthRequiresReview = birthRequiresReview; self.counsel = counsel
        self.charges = charges; self.detention = detention
    }
    public func birthAssessment(on date: CivilDate?) -> BirthAssessment {
        let result = BirthDateResolver.assess(birthDigits, statedAge: statedAge, on: date, confirmedBirthYear: confirmedBirthYear)
        if birthRequiresReview && confirmedBirthYear.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && result.status != .invalid {
            return BirthAssessment(status: .needsConfirmation, birthDate: result.birthDate, age: result.age,
                                   warnings: result.warnings + ["OCR 생년월일·기재 나이를 원문과 대조하고 출생 연도를 확인하세요."])
        }
        return result
    }
}

public struct CaseDraft: Equatable, Codable, Sendable {
    public var defendants: [Defendant] = []
    public var charges: [String] { defendants.flatMap(\.charges) }
    public var prosecutor = ""
    public var indictmentDate: CivilDate?
    public var detention: Detention {
        let statuses = Set(defendants.map(\.detention))
        return statuses.count == 1 ? statuses.first! : .unknown
    }
    public var warnings: [String] = []
    public init() {}
    public var numberedDefendants: String { Self.numbered(defendants.map(\.name)) }
    public var numberedCharges: String {
        if defendants.count > 1 {
            return Self.numbered(defendants.flatMap { person in person.charges.map { "\($0) (\(person.name))" } })
        }
        return Self.numbered(defendants.first?.charges ?? charges)
    }
    public var counselText: String {
        if defendants.count == 1 { return defendants[0].counsel.text }
        return Self.numbered(defendants.map { $0.counsel.text })
    }
    public static func numbered(_ values: [String]) -> String {
        values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n")
    }
    public var birthAssessments: [BirthAssessment] { defendants.map { $0.birthAssessment(on: indictmentDate) } }
    public var marksJuvenile: Bool { birthAssessments.contains { $0.canApplyAgeMarks && ($0.age ?? 19) < 19 } }
    public var marksMandatoryCounsel: Bool { birthAssessments.contains { $0.canApplyAgeMarks && ($0.age ?? 70) > 70 } }
    public var validationWarnings: [String] {
        defendants.flatMap { person in
            var values = person.birthAssessment(on: indictmentDate).warnings.map { "\(person.name): \($0)" }
            if person.counsel.needsConfirmation { values.append("\(person.name): 변호인 판독 결과를 확인하세요. \(person.counsel.reason)") }
            return values
        }
    }
    public var hasUnconfirmedCounsel: Bool { defendants.contains { $0.counsel.needsConfirmation } }
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
    public func age(on date: CivilDate) -> Int {
        date.year - year - ((date.month, date.day) < (month, day) ? 1 : 0)
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
