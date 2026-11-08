import Foundation

public enum DocumentReadability: Sendable { case reliableText, needsReview }

public struct DefendantSection: Sendable {
    public let identity: String
    public var lines: [String]
}

public struct ExtractionInput: Sendable {
    public let text: String
    public let lines: [String]
    public let readability: DocumentReadability
    public let sections: [DefendantSection]
    public init(text: String, readability: DocumentReadability = .reliableText) {
        var normalized = text.precomposedStringWithCanonicalMapping
        for invisible in ["\u{200B}", "\u{FEFF}", "\u{2060}", "\u{200C}", "\u{200D}"] { normalized = normalized.replacingOccurrences(of: invisible, with: "") }
        self.text = normalized; self.readability = readability
        self.lines = normalized.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
        self.sections = Self.splitDefendants(self.lines)
    }
    public static func labelPattern(_ label: String) -> String {
        label.map { NSRegularExpression.escapedPattern(for: String($0)) }.joined(separator: #"\s*"#)
    }
    public static func value(_ label: String, in line: String) -> String? {
        Regex.captures(#"^\s*(?:[0-9]+[.)]\s*)?"# + labelPattern(label) + #"\s*[:：]?\s+(.+?)\s*$"#, in: line)?.first
    }
    public static func hasLabel(_ label: String, in line: String) -> Bool {
        Regex.captures(#"^\s*(?:[0-9]+[.)]\s*)?("# + labelPattern(label) + #")\s*(?:[:：]|$|\s)"#, in: line) != nil
    }
    public func values(_ label: String) -> [String] { Self.values(label, lines: lines) }
    public static func values(_ label: String, lines: [String]) -> [String] {
        var results: [String] = [], inNumberedBlock = false
        let labels = ["피고인", "죄명", "검사", "변호인", "구속여부", "적용법조", "직업", "주거", "등록기준지"]
        for line in lines {
            if let value = value(label, in: line) { results.append(value); inNumberedBlock = true }
            else if hasLabel(label, in: line) { inNumberedBlock = true }
            else if inNumberedBlock, !labels.contains(where: { hasLabel($0, in: line) }),
                    let numbered = Regex.captures(#"^\s*([0-9]+[.)]\s*.+)$"#, in: line)?.first { results.append(numbered) }
            else if !line.isEmpty { inNumberedBlock = false }
        }
        return results
    }
    private static func splitDefendants(_ lines: [String]) -> [DefendantSection] {
        var sections: [DefendantSection] = []
        var inNameList = false
        for line in lines {
            if Regex.captures(#"^(?:[IVX]+[.)]\s*)?(공\s*소\s*사\s*실)"#, in: line) != nil { break }
            if let identity = value("피고인", in: line), !identity.contains("관련사항") {
                sections.append(DefendantSection(identity: identity, lines: [])); inNameList = true
            } else if hasLabel("피고인", in: line), !line.contains("관련사항") {
                inNameList = true
            } else if inNameList, let identity = Regex.captures(#"^\d+[.)]\s*(.+)$"#, in: line)?.first {
                sections.append(DefendantSection(identity: identity, lines: []))
            } else {
                if !line.isEmpty { inNameList = false }
                if !sections.isEmpty { sections[sections.count - 1].lines.append(line) }
            }
        }
        return sections
    }
}

public protocol CaseExtractionModule: Sendable {
    func extract(_ input: ExtractionInput, into draft: inout CaseDraft)
}

public struct IdentityExtractor: CaseExtractionModule {
    public init() {}
    public func extract(_ input: ExtractionInput, into draft: inout CaseDraft) {
        for section in input.sections {
            let identity = section.identity
            let front = Regex.captures(#"(?<!\d)(\d{6})(?!\d)"#, in: identity)?.first ?? ""
            let age = Regex.captures(#"(?:만\s*)?(\d{1,3})\s*세"#, in: identity)?.first.flatMap(Int.init)
            var name = identity.components(separatedBy: CharacterSet(charactersIn: "(（")).first ?? identity
            name = Regex.replacing(#"\d{6}.*$"#, in: name, with: "")
            name = Regex.replacing(#"^\s*\d+[.)]\s*"#, in: name, with: "").trimmingCharacters(in: .whitespaces)
            draft.defendants.append(Defendant(name: name, birthDigits: front, statedAge: age, birthRequiresReview: input.readability == .needsReview))
        }
        if draft.defendants.isEmpty { draft.warnings.append("피고인을 찾지 못했습니다. 직접 입력하세요.") }
    }
}

public struct ChargeExtractor: CaseExtractionModule {
    public init() {}
    public func extract(_ input: ExtractionInput, into draft: inout CaseDraft) {
        func charges(_ values: [String]) -> [String] {
            values.flatMap { $0.components(separatedBy: CharacterSet(charactersIn: ",，、;")) }
                .map { Regex.replacing(#"^\s*\d+[.)]\s*"#, in: $0, with: "").trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
        }
        let allCharges = charges(input.values("죄명"))
        for index in draft.defendants.indices where index < input.sections.count {
            draft.defendants[index].charges = charges(ExtractionInput.values("죄명", lines: input.sections[index].lines))
        }
        if draft.defendants.count == 1 { draft.defendants[0].charges = allCharges }
        if allCharges.isEmpty { draft.warnings.append("죄명을 찾지 못했습니다. 직접 입력하세요.") }
    }
}

public struct ProsecutionExtractor: CaseExtractionModule {
    public init() {}
    public func extract(_ input: ExtractionInput, into draft: inout CaseDraft) {
        let prosecutors = input.values("검사").map { Regex.replacing(#"[_\s]+$"#, in: $0, with: "") }
        draft.prosecutor = prosecutors.first ?? ""
        if Set(prosecutors).count > 1 { draft.prosecutor = ""; draft.warnings.append("검사가 여러 명으로 추출되었습니다. 확인하세요.") }
        let explicit = input.values("기소일") + input.values("공소제기일")
        let dates = (explicit.isEmpty ? input.lines : explicit).compactMap(CivilDate.parse)
        let unique = Array(Set(dates.map(\.text))).compactMap(CivilDate.parse)
        if unique.count == 1 { draft.indictmentDate = unique[0] }
        else { draft.warnings.append("기소일을 하나로 확정할 수 없습니다. 직접 확인하세요.") }
        func parse(_ value: String) -> Detention? {
            let compact = value.replacingOccurrences(of: " ", with: "")
            if compact == "불구속" || compact == "불구속기소" { return .released }
            if compact == "구속" || compact == "구속기소" || Regex.captures(#"^(\d{4}[.년]\d{1,2}[.월]\d{1,2}[.일]?구속)$"#, in: compact) != nil { return .detained }
            return nil
        }
        for index in draft.defendants.indices where index < input.sections.count {
            let values = ExtractionInput.values("구속여부", lines: input.sections[index].lines)
            let statuses = Set(values.compactMap(parse))
            draft.defendants[index].detention = statuses.count == 1 && values.allSatisfy({ parse($0) != nil }) ? statuses.first! : .unknown
        }
        if draft.hasUnconfirmedDetention { draft.warnings.append("구속 여부를 알 수 없는 피고인이 있습니다. 피고인별 정보를 확인하세요.") }
    }
}

public struct CounselExtractor: CaseExtractionModule {
    public init() {}
    public func extract(_ input: ExtractionInput, into draft: inout CaseDraft) {
        for index in draft.defendants.indices where index < input.sections.count {
            let lines = input.sections[index].lines
            let values = ExtractionInput.values("변호인", lines: lines)
            let hasLabel = lines.contains { ExtractionInput.hasLabel("변호인", in: $0) }
            let compact = values.map { $0.replacingOccurrences(of: " ", with: "") }
            let none = ["없음", "해당없음", "선임없음", "미선임", "X", "x"]
            var info: CounselInfo
            if values.isEmpty && !hasLabel {
                info = CounselInfo(status: .absentMissing, reason: "해당 피고인 구간에 변호인 항목이 기재되지 않았습니다.")
            } else if !values.isEmpty && compact.allSatisfy({ none.contains($0) }) {
                info = CounselInfo(status: .absentExplicit, reason: "변호인 없음이 명시되어 있습니다.")
            } else if values.isEmpty || compact.contains(where: { none.contains($0) || $0.contains("판독") || $0.contains("확인불가") || $0.contains("?") || $0.contains("�") || $0.trimmingCharacters(in: .punctuationCharacters).isEmpty }) {
                info = CounselInfo(reason: "변호인 항목이 비어 있거나 판독 결과가 불명확합니다.")
            } else { info = CounselInfo(status: .named, name: values.joined(separator: "\n"), reason: "변호인 항목에서 추출했습니다.") }
            if input.readability == .needsReview {
                info.status = .needsReview
                info.reason = "OCR 또는 불완전한 판독 결과입니다. 이름 기재·없음·미기재를 원문과 대조해 선택하세요."
            }
            draft.defendants[index].counsel = info
        }
    }
}

public struct ExtractionPipeline: Sendable {
    private let modules: [any CaseExtractionModule]
    public init(modules: [any CaseExtractionModule] = [IdentityExtractor(), ChargeExtractor(), ProsecutionExtractor(), CounselExtractor()]) { self.modules = modules }
    public func extract(text: String, readability: DocumentReadability = .reliableText) -> CaseDraft {
        var result = CaseDraft()
        let input = ExtractionInput(text: text, readability: readability)
        for module in modules { module.extract(input, into: &result) }
        if result.prosecutor.isEmpty { result.warnings.append("검사 이름을 확인하세요.") }
        result.warnings.append("자동 추출 결과는 확정 정보가 아닙니다. 원문과 대조한 후 PDF를 생성하세요.")
        return result
    }
}
