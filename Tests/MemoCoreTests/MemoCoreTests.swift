import XCTest
@testable import MemoCore

final class MemoCoreTests: XCTestCase {
    func sample(_ number: Int) throws -> String {
        let url = Bundle.module.url(forResource: "sample\(number)", withExtension: "txt", subdirectory: "Fixtures")!
        return try String(contentsOf: url, encoding: .utf8)
    }
    func testActualSampleOne() throws { try assertSample(1) }
    func testActualSampleTwo() throws { try assertSample(2) }
    private func assertSample(_ number: Int) throws {
        let draft = ExtractionPipeline().extract(text: try sample(number))
        XCTAssertEqual(draft.defendants.map(\.name), ["이민주"])
        XCTAssertEqual(draft.numberedDefendants, "1. 이민주")
        XCTAssertEqual(draft.numberedCharges, "1. 상해\n2. 폭행치상")
        XCTAssertEqual(draft.prosecutor, "이승엽")
        XCTAssertEqual(draft.indictmentDate, CivilDate(2025, 8, 22))
        XCTAssertEqual(draft.detention, .detained)
        XCTAssertTrue(draft.noCounsel)
        XCTAssertEqual(draft.counselText, "X")
        XCTAssertEqual(draft.ageResults, [.invalid("주민등록번호의 생년월일이 유효하지 않음")])
        XCTAssertFalse(draft.marksJuvenile)
        XCTAssertFalse(draft.marksMandatoryCounsel)
    }
    func testSingleNumbering() {
        XCTAssertEqual(CaseDraft.numbered(["절도"]), "1. 절도")
        XCTAssertEqual(CaseDraft.numbered(["", "甲", "乙"]), "1. 甲\n2. 乙")
    }
    func testMultipleDefendantsAndCharges() {
        let draft = ExtractionPipeline().extract(text: "피 고 인 1. 김가상\n2. 이가상\n죄 명 1. 절도\n2. 사기\n구속여부 불구속")
        XCTAssertEqual(draft.numberedDefendants, "1. 김가상\n2. 이가상")
        XCTAssertEqual(draft.numberedCharges, "1. 절도\n2. 사기")
        XCTAssertEqual(draft.detention, .released)
        XCTAssertEqual(draft.detention.mark, "X")
    }
    func testLabelOnlyThenNumberedLines() {
        let draft = ExtractionPipeline().extract(text: "피고인\n1. 김가상\n2. 이가상\n죄명\n1. 절도\n2. 사기")
        XCTAssertEqual(draft.defendants.count, 2)
        XCTAssertEqual(draft.charges, ["절도", "사기"])
    }
    func testNoCounselMustBeExplicit() {
        XCTAssertFalse(ExtractionPipeline().extract(text: "피고인 김가상").noCounsel)
        XCTAssertFalse(ExtractionPipeline().extract(text: "변호인 홍가상").noCounsel)
        XCTAssertTrue(ExtractionPipeline().extract(text: "변호인 없음").noCounsel)
    }
    func testMixedCounselNotMarkedAbsent() {
        let d = ExtractionPipeline().extract(text: "변호인 없음\n변호인 김가상")
        XCTAssertFalse(d.noCounsel); XCTAssertFalse(d.warnings.isEmpty)
    }
    func testMixedDetentionRequiresReview() {
        let d = ExtractionPipeline().extract(text: "구속여부 구속\n구속여부 불구속")
        XCTAssertEqual(d.detention, .unknown)
    }
    func testUnknownDetentionNotGuessed() {
        XCTAssertEqual(ExtractionPipeline().extract(text: "구속여부 미확인").detention, .unknown)
    }
    func testAmbiguousDateNotGuessed() {
        XCTAssertNil(ExtractionPipeline().extract(text: "2025. 8. 22.\n2024. 1. 1.").indictmentDate)
    }
    func testExplicitDatePreferred() {
        XCTAssertEqual(ExtractionPipeline().extract(text: "2020. 1. 1.\n기소일 2025. 8. 22.").indictmentDate, CivilDate(2025,8,22))
    }
    func testConflictingProsecutorsNotGuessed() {
        XCTAssertEqual(ExtractionPipeline().extract(text: "검사 김가상\n검사 이가상").prosecutor, "")
    }
    func testCalendarValidation() {
        XCTAssertNil(CivilDate(2025,2,29)); XCTAssertNotNil(CivilDate(2024,2,29))
        XCTAssertNil(CivilDate.parse("2025.13.01"))
        XCTAssertEqual(CivilDate.parse("2025년 8월 22일"), CivilDate(2025,8,22))
    }
    // Synthetic checksum-valid test identifiers, not real persons.
    private func rrn(_ birth: String, code: String) -> String {
        let base = birth + code + "00000"
        let weights = [2,3,4,5,6,7,8,9,2,3,4,5]
        let digits = base.map { Int(String($0))! }
        let sum = zip(digits, weights).reduce(0) { $0 + $1.0 * $1.1 }
        return String(base.prefix(6)) + "-" + String(base.dropFirst(6)) + String((11 - sum % 11) % 10)
    }
    func testUnder19Boundary() {
        let id = rrn("060823", code: "3")
        XCTAssertEqual(ResidentNumber.age(id, on: CivilDate(2025,8,22)), .valid(18))
        XCTAssertEqual(ResidentNumber.age(id, on: CivilDate(2025,8,23)), .valid(19))
    }
    func testOver70Boundary() {
        let id = rrn("540823", code: "1")
        XCTAssertEqual(ResidentNumber.age(id, on: CivilDate(2025,8,22)), .valid(70))
        XCTAssertEqual(ResidentNumber.age(id, on: CivilDate(2025,8,23)), .valid(71))
    }
    func testAgeMarks() {
        var d = CaseDraft(); d.indictmentDate = CivilDate(2025,8,22)
        d.defendants = [Defendant(name: "甲", residentNumber: rrn("100101", code: "3")), Defendant(name: "乙", residentNumber: rrn("500101", code: "1"))]
        XCTAssertTrue(d.marksJuvenile); XCTAssertTrue(d.marksMandatoryCounsel)
    }
    func testLeapDayAge() {
        let id = rrn("040229", code: "3")
        XCTAssertEqual(ResidentNumber.age(id, on: CivilDate(2025,2,28)), .valid(20))
        XCTAssertEqual(ResidentNumber.age(id, on: CivilDate(2025,3,1)), .valid(21))
    }
    func testInvalidDateInResidentNumber() {
        XCTAssertEqual(ResidentNumber.age("841284-7293746", on: CivilDate(2025,8,22)), .invalid("주민등록번호의 생년월일이 유효하지 않음"))
    }
    func testInvalidChecksum() {
        let valid = rrn("000101", code: "3")
        let bad = String(valid.dropLast()) + (valid.last == "0" ? "1" : "0")
        guard case .invalid = ResidentNumber.age(bad, on: CivilDate(2025,8,22)) else { return XCTFail("must reject checksum") }
    }
    func testMaskedNumberRejected() {
        guard case .invalid = ResidentNumber.age("000101-3******", on: CivilDate(2025,8,22)) else { return XCTFail("must reject mask") }
    }
    func testFutureBirthRejected() {
        guard case .invalid = ResidentNumber.age(rrn("250101", code: "3"), on: CivilDate(2024,1,1)) else { return XCTFail("must reject future") }
    }
    func testMissingDateRejected() {
        guard case .invalid = ResidentNumber.age(rrn("000101", code: "3"), on: nil) else { return XCTFail("must require date") }
    }
    func testExtensionsRunIndependently() {
        struct Stub: CaseExtractionModule { func extract(_ input: ExtractionInput, into draft: inout CaseDraft) { draft.warnings.append("extension") } }
        let d = ExtractionPipeline(modules: [Stub()]).extract(text: "")
        XCTAssertTrue(d.warnings.contains("extension")); XCTAssertTrue(d.defendants.isEmpty)
    }
    func testLayoutLoadsAndConvertsCoordinates() throws {
        let layout = try TemplateLayout.bundled()
        XCTAssertEqual(layout.fields.count, 8)
        XCTAssertEqual(layout.box("defendants").x, 33)
        XCTAssertEqual(layout.box("defendants").bottomLeftY(pageHeight: layout.height), 602.0001220703125, accuracy: 0.001)
        for values in layout.fields.values {
            let b = FieldBox(values)
            XCTAssertGreaterThan(b.width,0); XCTAssertGreaterThan(b.height,0)
            XCTAssertGreaterThanOrEqual(b.x,0); XCTAssertGreaterThanOrEqual(b.y,0)
            XCTAssertLessThanOrEqual(b.x+b.width,layout.width); XCTAssertLessThanOrEqual(b.y+b.height,layout.height)
        }
    }
}
