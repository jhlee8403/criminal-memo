import XCTest
@testable import MemoCore

final class MemoCoreTests: XCTestCase {
    func sample(_ number: Int) throws -> String {
        try String(contentsOf: Bundle.module.url(forResource: "sample\(number)", withExtension: "txt", subdirectory: "Fixtures")!, encoding: .utf8)
    }
    func testActualSampleOne() throws {
        let d = ExtractionPipeline().extract(text: try sample(1))
        XCTAssertEqual(d.defendants.map(\.name), ["이민주"])
        XCTAssertEqual(d.defendants[0].birthDigits, "841204")
        XCTAssertEqual(d.defendants[0].statedAge, 41)
        XCTAssertEqual(d.numberedDefendants, "1. 이민주")
        XCTAssertEqual(d.numberedCharges, "1. 상해\n2. 폭행치상")
        XCTAssertEqual(d.prosecutor, "이승엽")
        XCTAssertEqual(d.indictmentDate, CivilDate(2025,8,22))
        XCTAssertEqual(d.detention, .detained)
        XCTAssertEqual(d.defendants[0].counsel.status, .absentExplicit)
        XCTAssertEqual(d.counselText, "X")
        let birth = d.birthAssessments[0]
        XCTAssertEqual(birth.birthDate, CivilDate(1984,12,4))
        XCTAssertEqual(birth.age, 40)
        XCTAssertEqual(birth.status, .needsConfirmation)
        XCTAssertTrue(birth.warnings.contains { $0.contains("41세") && $0.contains("40세") })
        XCTAssertFalse(d.marksJuvenile); XCTAssertFalse(d.marksMandatoryCounsel)
    }
    func testActualSampleTwo() throws {
        let d = ExtractionPipeline().extract(text: try sample(2))
        XCTAssertEqual(d.defendants.map(\.name), ["김유나", "이영수"])
        XCTAssertEqual(d.defendants.map(\.birthDigits), ["720324", "710305"])
        XCTAssertEqual(d.defendants.map(\.statedAge), [54,55])
        XCTAssertEqual(d.prosecutor, "이정현")
        XCTAssertEqual(d.indictmentDate, CivilDate(2026,10,27))
        XCTAssertEqual(d.defendants[0].charges, ["공무집행방해"])
        XCTAssertEqual(d.defendants[1].charges, ["상해", "절도"])
        XCTAssertEqual(d.numberedCharges, "1. 공무집행방해 (김유나)\n2. 상해 (이영수)\n3. 절도 (이영수)")
        XCTAssertEqual(d.defendants.map(\.detention), [.detained, .released])
        XCTAssertEqual(d.detention, .unknown)
        XCTAssertEqual(d.defendants[0].counsel.text, "윤상일(국선)")
        XCTAssertEqual(d.defendants[1].counsel.status, .absentMissing)
        XCTAssertEqual(d.defendants[1].counsel.text, "X")
        XCTAssertEqual(d.counselText, "1. 윤상일(국선)\n2. X")
        XCTAssertFalse(d.hasUnconfirmedCounsel)
        XCTAssertEqual(d.birthAssessments.map(\.birthDate), [CivilDate(1972,3,24), CivilDate(1971,3,5)])
        XCTAssertEqual(d.birthAssessments.map(\.age), [54,55])
        XCTAssertTrue(d.birthAssessments.allSatisfy(\.canApplyAgeMarks))
    }
    func testResidentSuffixDoesNotAffectAgeOrCentury() {
        let expected = BirthDateResolver.assess("720324", statedAge: 54, on: CivilDate(2026,10,27))
        for tail in ["-5982346", "-1000000", "-9999999", "-*******", "-garbage", ""] {
            XCTAssertEqual(BirthDateResolver.assessIdentifier("720324" + tail, statedAge: 54, on: CivilDate(2026,10,27)), expected)
        }
    }
    func testTrailingDataIsNotStored() throws {
        let d = ExtractionPipeline().extract(text: try sample(2))
        let json = String(decoding: try JSONEncoder().encode(d), as: UTF8.self)
        XCTAssertFalse(json.contains("5982346")); XCTAssertFalse(json.contains("1978346"))
        XCTAssertFalse(json.contains("residentNumber"))
    }
    func testStatedAgeResolves1900Century() {
        let a = BirthDateResolver.assess("710305", statedAge: 55, on: CivilDate(2026,10,27))
        XCTAssertEqual(a.birthDate, CivilDate(1971,3,5)); XCTAssertEqual(a.status, .resolved)
    }
    func testStatedAgeResolves2000Century() {
        let a = BirthDateResolver.assess("100101", statedAge: 16, on: CivilDate(2026,10,27))
        XCTAssertEqual(a.birthDate, CivilDate(2010,1,1)); XCTAssertTrue(a.canApplyAgeMarks)
    }
    func testCenturyBoundaryYear2000() {
        let a = BirthDateResolver.assess("000101", statedAge: 26, on: CivilDate(2026,10,27))
        XCTAssertEqual(a.birthDate, CivilDate(2000,1,1))
    }
    func testMissingAgeRequiresConfirmation() {
        let a = BirthDateResolver.assess("100101", statedAge: nil, on: CivilDate(2026,10,27))
        XCTAssertEqual(a.status, .needsConfirmation); XCTAssertNil(a.age)
        XCTAssertFalse(a.canApplyAgeMarks)
    }
    func testUnrelatedStatedAgeDoesNotGuessCentury() {
        let a = BirthDateResolver.assess("841204", statedAge: 12, on: CivilDate(2025,8,22))
        XCTAssertEqual(a.status, .needsConfirmation); XCTAssertNil(a.birthDate)
    }
    func testMismatchRequiresExplicitYearBeforeMarks() {
        let uncertain = BirthDateResolver.assess("101204", statedAge: 15, on: CivilDate(2025,8,22))
        XCTAssertEqual(uncertain.age, 14); XCTAssertFalse(uncertain.canApplyAgeMarks)
        let confirmed = BirthDateResolver.assess("101204", statedAge: 15, on: CivilDate(2025,8,22), confirmedBirthYear: "2010")
        XCTAssertEqual(confirmed.age,14); XCTAssertTrue(confirmed.canApplyAgeMarks)
        XCTAssertFalse(confirmed.warnings.isEmpty)
    }
    func testManualYearResolvesWithoutStatedAge() {
        let a = BirthDateResolver.assess("841204", statedAge: nil, on: CivilDate(2025,8,22), confirmedBirthYear: "1984")
        XCTAssertEqual(a.status, .resolved); XCTAssertEqual(a.age,40)
    }
    func testManualYearMustMatchYY() {
        let a = BirthDateResolver.assess("841204", statedAge: 41, on: CivilDate(2025,8,22), confirmedBirthYear: "1983")
        XCTAssertEqual(a.status, .invalid)
    }
    func testInvalidManualEditDoesNotFallBack() {
        for year in ["abc", "198", "1900x"] {
            XCTAssertEqual(BirthDateResolver.assess("720324", statedAge: 54, on: CivilDate(2026,10,27), confirmedBirthYear: year).status, .invalid)
        }
    }
    func testInvalidMonthAndDayRejected() {
        for value in ["841284", "841304", "840431", "840000", "abc123", "84120", "8412040"] {
            XCTAssertEqual(BirthDateResolver.assess(value, statedAge: 41, on: CivilDate(2025,8,22)).status,.invalid)
        }
    }
    func testLeapYearValidatedForActualCentury() {
        XCTAssertEqual(BirthDateResolver.assess("000229", statedAge: nil, on: CivilDate(2025,8,22), confirmedBirthYear: "1900").status, .invalid)
        XCTAssertEqual(BirthDateResolver.assess("000229", statedAge: nil, on: CivilDate(2025,8,22), confirmedBirthYear: "2000").age,25)
        XCTAssertEqual(BirthDateResolver.assess("010229", statedAge: 24, on: CivilDate(2025,8,22)).status, .invalid)
    }
    func testFutureBirthRejected() {
        XCTAssertEqual(BirthDateResolver.assess("250101", statedAge: nil, on: CivilDate(2024,1,1), confirmedBirthYear: "2025").status,.invalid)
    }
    func testMissingFilingDateSuppressesMarks() {
        let a = BirthDateResolver.assess("100101", statedAge: 15, on: nil, confirmedBirthYear: "2010")
        XCTAssertFalse(a.canApplyAgeMarks); XCTAssertNil(a.age)
    }
    func testUnder19Boundary() {
        XCTAssertEqual(BirthDateResolver.assess("060823", statedAge: nil, on: CivilDate(2025,8,22), confirmedBirthYear: "2006").age,18)
        XCTAssertEqual(BirthDateResolver.assess("060823", statedAge: nil, on: CivilDate(2025,8,23), confirmedBirthYear: "2006").age,19)
    }
    func testOver70Boundary() {
        XCTAssertEqual(BirthDateResolver.assess("540823", statedAge: nil, on: CivilDate(2025,8,22), confirmedBirthYear: "1954").age,70)
        XCTAssertEqual(BirthDateResolver.assess("540823", statedAge: nil, on: CivilDate(2025,8,23), confirmedBirthYear: "1954").age,71)
    }
    func testAgeMarksRequireResolvedBirth() {
        var d = CaseDraft(); d.indictmentDate = CivilDate(2025,8,22)
        d.defendants = [Defendant(name: "甲", birthDigits: "101204", statedAge: 15)]
        XCTAssertFalse(d.marksJuvenile)
        d.defendants[0].confirmedBirthYear = "2010"
        XCTAssertTrue(d.marksJuvenile)
        d.defendants.append(Defendant(name: "乙", birthDigits: "500101", confirmedBirthYear: "1950"))
        XCTAssertTrue(d.marksMandatoryCounsel)
    }
    func testMarksExcludeExactly19And70() {
        var d = CaseDraft(); d.indictmentDate = CivilDate(2025,8,22)
        d.defendants = [Defendant(birthDigits: "060822", confirmedBirthYear: "2006"), Defendant(birthDigits: "550822", confirmedBirthYear: "1955")]
        XCTAssertFalse(d.marksJuvenile); XCTAssertFalse(d.marksMandatoryCounsel)
    }
    func testLeapDayAge() {
        XCTAssertEqual(CivilDate(2004,2,29)!.age(on: CivilDate(2025,2,28)!),20)
        XCTAssertEqual(CivilDate(2004,2,29)!.age(on: CivilDate(2025,3,1)!),21)
    }
    func testMissingAndExplicitAbsentCounselBothProduceX() {
        for text in ["피고인 김가상\n변호인 없음", "피고인 김가상\n죄명 절도"] {
            let d = ExtractionPipeline().extract(text: text)
            XCTAssertEqual(d.counselText, "X"); XCTAssertFalse(d.hasUnconfirmedCounsel)
        }
    }
    func testNamedCounselPreserved() {
        let d = ExtractionPipeline().extract(text: "피고인 김가상\n변호인 윤상일(국선)")
        XCTAssertEqual(d.counselText,"윤상일(국선)")
    }
    func testCounselIsNotCarriedIntoNextDefendant() {
        let d = ExtractionPipeline().extract(text: "피고인 김가상\n변호인 윤상일\n피고인 이가상\n죄명 절도")
        XCTAssertEqual(d.defendants.map { $0.counsel.text }, ["윤상일","X"])
    }
    func testExplicitAbsenceDistinguishedFromMissing() {
        let d = ExtractionPipeline().extract(text: "피고인 김가상\n변호인 없음\n피고인 이가상\n죄명 절도")
        XCTAssertEqual(d.defendants.map { $0.counsel.status }, [.absentExplicit,.absentMissing])
    }
    func testOCRMissingDoesNotAutomaticallyBecomeX() {
        let d = ExtractionPipeline().extract(text: "피고인 김가상\n죄명 절도", readability: .needsReview)
        XCTAssertEqual(d.defendants[0].counsel.status,.needsReview)
        XCTAssertEqual(d.counselText,""); XCTAssertTrue(d.hasUnconfirmedCounsel)
    }
    func testOCRNamedAndExplicitAbsentAlsoNeedReview() {
        for value in ["없음", "윤상일"] {
            let d = ExtractionPipeline().extract(text: "피고인 김가상\n변호인 \(value)", readability: .needsReview)
            XCTAssertTrue(d.hasUnconfirmedCounsel)
        }
    }
    func testEmptyOrUnreadableCounselNeedsReview() {
        for value in ["변호인", "변호인 :", "변호인 판독불가", "변호인 ?"] {
            XCTAssertTrue(ExtractionPipeline().extract(text: "피고인 김가상\n" + value).hasUnconfirmedCounsel)
        }
    }
    func testUserCanConfirmOCRAbsence() {
        var d = ExtractionPipeline().extract(text: "피고인 김가상", readability: .needsReview)
        d.defendants[0].counsel.status = .absentMissing
        XCTAssertEqual(d.counselText,"X"); XCTAssertFalse(d.hasUnconfirmedCounsel)
    }
    func testBlankNamedCounselRemainsUnconfirmed() {
        XCTAssertTrue(CounselInfo(status: .named, name: "  ").needsConfirmation)
    }
    func testOCRBirthNeedsConfirmationEvenWhenAgeMatches() {
        var d = ExtractionPipeline().extract(text: "피고인 김가상 (100101-9999999), 15세\n기소일 2025.08.22", readability: .needsReview)
        XCTAssertEqual(d.birthAssessments[0].age, 15)
        XCTAssertFalse(d.marksJuvenile)
        d.defendants[0].confirmedBirthYear = "2010"
        XCTAssertTrue(d.marksJuvenile)
    }
    func testSuffixChangesInActualExtractionDoNotAffectBirth() throws {
        let text = try sample(2)
        let original = ExtractionPipeline().extract(text: text)
        let changed = ExtractionPipeline().extract(text: text.replacingOccurrences(of: "5982346", with: "1111111").replacingOccurrences(of: "1978346", with: "9999999"))
        XCTAssertEqual(original.birthAssessments, changed.birthAssessments)
        XCTAssertEqual(original.defendants.map(\.birthDigits), changed.defendants.map(\.birthDigits))
    }
    func testEditingOneCounselDoesNotChangeOtherPerson() throws {
        var d = ExtractionPipeline().extract(text: try sample(2))
        d.defendants[1].counsel = CounselInfo(status: .named, name: "새변호인")
        XCTAssertEqual(d.defendants[0].counsel.text, "윤상일(국선)")
        XCTAssertEqual(d.defendants[1].counsel.text, "새변호인")
        d.defendants[1].charges = ["변경죄명"]
        XCTAssertEqual(d.charges, ["공무집행방해", "변경죄명"])
        XCTAssertEqual(d.numberedCharges, "1. 공무집행방해 (김유나)\n2. 변경죄명 (이영수)")
    }
    func testSingleNumbering() {
        XCTAssertEqual(CaseDraft.numbered(["절도"]),"1. 절도")
        XCTAssertEqual(CaseDraft.numbered(["", "甲", "乙"]),"1. 甲\n2. 乙")
    }
    func testNumberedNamesAndZeroWidthCharacters() {
        let d = ExtractionPipeline().extract(text: "1.\u{200B} 피 고 인 김가상 (720324-0000000), 54세\n변호인 없음\n2.\u{200B} 피 고 인 이가상 (710305-9999999), 55세\n죄명 절도")
        XCTAssertEqual(d.defendants.map(\.name),["김가상","이가상"])
        XCTAssertEqual(d.defendants[0].counsel.text,"X")
        XCTAssertFalse(d.counselText.contains("피 고 인"))
    }
    func testLabelOnlyNumberedNames() {
        let d = ExtractionPipeline().extract(text: "피고인\n1. 김가상\n2. 이가상\n죄명\n1. 절도\n2. 사기")
        XCTAssertEqual(d.defendants.count,2); XCTAssertEqual(d.charges,["절도","사기"])
    }
    func testMixedDetentionNeverBecomesReleasedForAll() throws {
        let d = ExtractionPipeline().extract(text: try sample(2))
        XCTAssertEqual(d.detention,.unknown)
        XCTAssertEqual(d.defendants.map(\.detention),[.detained,.released])
    }
    func testAmbiguousDateNotGuessed() {
        XCTAssertNil(ExtractionPipeline().extract(text:"2025. 8. 22.\n2024. 1. 1.").indictmentDate)
    }
    func testExplicitDatePreferred() {
        XCTAssertEqual(ExtractionPipeline().extract(text:"2020. 1. 1.\n기소일 2025. 8. 22.").indictmentDate,CivilDate(2025,8,22))
    }
    func testConflictingProsecutorsNotGuessed() {
        XCTAssertEqual(ExtractionPipeline().extract(text:"검사 김가상\n검사 이가상").prosecutor,"")
    }
    func testCalendarValidation() {
        XCTAssertNil(CivilDate(2025,2,29)); XCTAssertNotNil(CivilDate(2024,2,29))
        XCTAssertNil(CivilDate.parse("2025.13.01"))
        XCTAssertEqual(CivilDate.parse("2025년 8월 22일"),CivilDate(2025,8,22))
    }
    func testIndependentExtensionModule() {
        struct Stub: CaseExtractionModule { func extract(_ input: ExtractionInput, into draft: inout CaseDraft) { draft.warnings.append("extension") } }
        XCTAssertTrue(ExtractionPipeline(modules:[Stub()]).extract(text:"").warnings.contains("extension"))
    }
    func testLayoutUnchanged() throws {
        let layout = try TemplateLayout.bundled()
        XCTAssertEqual(layout.fields.count,8)
        XCTAssertEqual(layout.box("defendants").bottomLeftY(pageHeight:layout.height),602.0001220703125,accuracy:0.001)
        for values in layout.fields.values {
            let b = FieldBox(values)
            XCTAssertGreaterThan(b.width,0); XCTAssertGreaterThan(b.height,0)
            XCTAssertGreaterThanOrEqual(b.x,0); XCTAssertGreaterThanOrEqual(b.y,0)
            XCTAssertLessThanOrEqual(b.x+b.width,layout.width); XCTAssertLessThanOrEqual(b.y+b.height,layout.height)
        }
    }
}
