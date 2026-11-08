import Foundation

public struct ExtractionInput: Sendable {
    public let text: String
    public let lines: [String]
    public init(text: String) {
        self.text = text.precomposedStringWithCanonicalMapping
        self.lines = self.text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
    }
    public func values(_ label: String) -> [String] {
        let spaced = label.map { NSRegularExpression.escapedPattern(for: String($0)) }.joined(separator: #"\s*"#)
        var results: [String] = []
        var inNumberedBlock = false
        for line in lines {
            if let value = Regex.captures("^\\s*(?:[0-9]+[.)]\\s*)?" + spaced + #"\s*[:：]?\s+(.+?)\s*$"#, in: line)?.first {
                results.append(value); inNumberedBlock = true
            } else if Regex.captures("^\\s*(" + spaced + #")\s*[:：]?\s*$"#, in: line) != nil {
                inNumberedBlock = true
            } else if inNumberedBlock, let numbered = Regex.captures(#"^\s*([0-9]+[.)]\s*.+)$"#, in: line)?.first {
                results.append(numbered)
            } else if !line.isEmpty { inNumberedBlock = false }
        }
        return results
    }
}

public protocol CaseExtractionModule: Sendable {
    func extract(_ input: ExtractionInput, into draft: inout CaseDraft)
}

public struct IdentityExtractor: CaseExtractionModule {
    public init() {}
    public func extract(_ input: ExtractionInput, into draft: inout CaseDraft) {
        for value in input.values("피고인") {
            if value.contains("관련사항") { continue }
            let rrn = Regex.captures(#"(\d{6}\s*-\s*[\d*●Xx]{7})"#, in: value)?.first ?? ""
            var name = value.components(separatedBy: CharacterSet(charactersIn: "(（")).first ?? value
            name = Regex.replacing(#"\d{6}\s*-.*$"#, in: name, with: "")
            name = Regex.replacing(#"^\s*\d+[.)]\s*"#, in: name, with: "").trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { continue }
            draft.defendants.append(Defendant(name: name, residentNumber: rrn.replacingOccurrences(of: " ", with: "")))
        }
        if draft.defendants.isEmpty { draft.warnings.append("피고인을 찾지 못했습니다. 직접 입력하세요.") }
    }
}

public struct ChargeExtractor: CaseExtractionModule {
    public init() {}
    public func extract(_ input: ExtractionInput, into draft: inout CaseDraft) {
        draft.charges = input.values("죄명").flatMap { value in
            value.components(separatedBy: CharacterSet(charactersIn: ",，、;"))
                .map { Regex.replacing(#"^\s*\d+[.)]\s*"#, in: $0, with: "").trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
        }
        if draft.charges.isEmpty { draft.warnings.append("죄명을 찾지 못했습니다. 직접 입력하세요.") }
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
        let detention = input.values("구속여부").map { $0.replacingOccurrences(of: " ", with: "") }
        let statuses = Set(detention.compactMap { value -> Detention? in
            if ["불구속", "불구속기소"].contains(value) { return .released }
            if ["구속", "구속기소"].contains(value) { return .detained }
            return nil
        })
        if statuses.count == 1, let value = statuses.first { draft.detention = value }
        else { draft.warnings.append("구속 여부가 불명확하거나 피고인별로 다릅니다. 직접 확인하세요.") }
    }
}

public struct CounselExtractor: CaseExtractionModule {
    public init() {}
    public func extract(_ input: ExtractionInput, into draft: inout CaseDraft) {
        let values = input.values("변호인")
        let none = ["없음", "해당없음", "선임없음", "미선임"]
        let absent = values.filter { none.contains($0.replacingOccurrences(of: " ", with: "")) }
        if !values.isEmpty && absent.count == values.count { draft.noCounsel = true }
        else if !absent.isEmpty { draft.warnings.append("변호인 없음과 선임 정보가 함께 있어 확인이 필요합니다.") }
        else { draft.counsel = values.joined(separator: "\n") }
        if values.isEmpty { draft.warnings.append("변호인 정보가 없습니다. 없음으로 추정하지 않았습니다.") }
    }
}

public struct ExtractionPipeline: Sendable {
    private let modules: [any CaseExtractionModule]
    public init(modules: [any CaseExtractionModule] = [IdentityExtractor(), ChargeExtractor(), ProsecutionExtractor(), CounselExtractor()]) { self.modules = modules }
    public func extract(text: String) -> CaseDraft {
        var result = CaseDraft()
        let input = ExtractionInput(text: text)
        for module in modules { module.extract(input, into: &result) }
        if result.prosecutor.isEmpty { result.warnings.append("검사 이름을 확인하세요.") }
        result.warnings.append("자동 추출 결과는 확정 정보가 아닙니다. 원문과 대조한 후 PDF를 생성하세요.")
        return result
    }
}
