import Foundation

public enum BirthStatus: String, Equatable, Sendable { case resolved, needsConfirmation, invalid }

public struct BirthAssessment: Equatable, Sendable {
    public let status: BirthStatus
    /// A tentative date when status is needsConfirmation; never used for automatic marks.
    public let birthDate: CivilDate?
    public let age: Int?
    public let warnings: [String]
    public var canApplyAgeMarks: Bool { status == .resolved && age != nil }
    public var message: String {
        guard let birthDate, let age else { return warnings.joined(separator: "\n") }
        let prefix = status == .resolved ? "" : "미확정 후보: "
        return "\(prefix)\(birthDate.text) · 기소일 기준 만 \(age)세" + (warnings.isEmpty ? "" : "\n" + warnings.joined(separator: "\n"))
    }
}

public enum BirthDateResolver {
    /// The suffix is deliberately ignored, even when malformed, masked or inconsistent.
    public static func frontSix(from input: String) -> String {
        String(input.trimmingCharacters(in: .whitespacesAndNewlines).prefix(6))
    }
    public static func assessIdentifier(_ input: String, statedAge: Int?, on date: CivilDate?, confirmedBirthYear: String = "") -> BirthAssessment {
        assess(frontSix(from: input), statedAge: statedAge, on: date, confirmedBirthYear: confirmedBirthYear)
    }
    public static func assess(_ front: String, statedAge: Int?, on date: CivilDate?, confirmedBirthYear: String = "") -> BirthAssessment {
        func fail(_ status: BirthStatus, _ reason: String) -> BirthAssessment {
            BirthAssessment(status: status, birthDate: nil, age: nil, warnings: [reason])
        }
        guard front.count == 6, front.allSatisfy({ $0.isASCII && $0.isNumber }) else {
            return fail(.invalid, "생년월일 앞 6자리 YYMMDD를 확인하세요.")
        }
        let yy = Int(front.prefix(2))!, month = Int(front.dropFirst(2).prefix(2))!, day = Int(front.suffix(2))!
        // Check all possible centuries for leap-day validity; do not use an arbitrary century.
        let calendarYears = stride(from: yy == 0 ? 100 : yy, through: 9999, by: 100)
        guard calendarYears.contains(where: { CivilDate($0, month, day) != nil }) else {
            return fail(.invalid, "앞 6자리의 월·일이 실제 달력에 존재하지 않습니다.")
        }
        let manual = confirmedBirthYear.trimmingCharacters(in: .whitespacesAndNewlines)
        var birth: CivilDate
        let isManual = !manual.isEmpty
        if isManual {
            guard manual.count == 4, manual.allSatisfy({ $0.isASCII && $0.isNumber }), let year = Int(manual), year % 100 == yy,
                  let value = CivilDate(year, month, day) else {
                return fail(.invalid, "확인한 출생 연도가 YY와 일치하지 않거나 해당 날짜가 유효하지 않습니다.")
            }
            birth = value
        } else {
            guard let date else { return fail(.needsConfirmation, "기소일과 기재 나이 또는 확인한 출생 연도가 필요합니다.") }
            guard let statedAge, statedAge >= 0 else { return fail(.needsConfirmation, "앞 6자리만으로 출생 세기를 확정할 수 없습니다. 출생 연도를 확인하세요.") }
            // A stated age provides a two-year birth-year window. Month/day then
            // computes the exact age; discrepancies remain tentative until confirmed.
            let years = [date.year - statedAge - 1, date.year - statedAge]
            let candidates = years.filter { $0 > 0 && $0 % 100 == yy }.compactMap { CivilDate($0, month, day) }.filter { $0 <= date }
            guard candidates.count == 1, let candidate = candidates.first else {
                return fail(.needsConfirmation, "기재 나이와 YYMMDD로 출생 세기를 확정할 수 없습니다. 출생 연도를 확인하세요.")
            }
            birth = candidate
        }
        guard let date else { return BirthAssessment(status: .needsConfirmation, birthDate: birth, age: nil, warnings: ["만 나이 계산을 위한 기소일을 확인하세요."]) }
        guard birth <= date else { return fail(.invalid, "확인한 생년월일이 기소일보다 늦습니다.") }
        let age = birth.age(on: date)
        let mismatch = statedAge.map { $0 != age } ?? false
        let warnings = mismatch ? ["계산한 만 나이 \(age)세와 공소장 기재 나이 \(statedAge!)세가 다릅니다." + (isManual ? "" : " 출생 연도를 직접 확인해야 나이 표시를 적용합니다.")] : []
        return BirthAssessment(status: mismatch && !isManual ? .needsConfirmation : .resolved, birthDate: birth, age: age, warnings: warnings)
    }
}
