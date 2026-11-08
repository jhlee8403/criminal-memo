import SwiftUI
import MemoCore

struct DefendantEditor: View {
    @Binding var person: Defendant
    let indictmentDate: CivilDate?
    let remove: () -> Void
    private var assessment: BirthAssessment { person.birthAssessment(on: indictmentDate) }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("피고인 이름", text: $person.name)
            TextField("생년월일 앞 6자리 YYMMDD", text: $person.birthDigits)
                .keyboardType(.numberPad).autocorrectionDisabled()
            TextField("공소장 기재 나이", text: Binding(
                get: { person.statedAge.map(String.init) ?? "" },
                set: { person.statedAge = Int($0) }
            )).keyboardType(.numberPad)
            TextField("직접 확인한 출생 연도 YYYY (선택)", text: $person.confirmedBirthYear)
                .keyboardType(.numberPad).autocorrectionDisabled()
            Text(assessment.message).font(.caption)
                .foregroundStyle(assessment.canApplyAgeMarks ? Color.secondary : Color.orange)
            if assessment.status == .needsConfirmation, let candidate = assessment.birthDate, assessment.age != nil {
                Button("원문 대조 후 \(candidate.year)년생으로 확인") { person.confirmedBirthYear = String(candidate.year) }
            }
            Picker("변호인 기재 상태", selection: $person.counsel.status) {
                ForEach(CounselStatus.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            if person.counsel.status == .named || person.counsel.status == .needsReview {
                TextField("변호인 이름 (원문 확인)", text: $person.counsel.name, axis: .vertical)
            }
            Text(person.counsel.status == .needsReview ? person.counsel.reason : "메모 표시: \(person.counsel.text.isEmpty ? "빈칸" : person.counsel.text)").font(.caption)
            Text("죄명 (한 줄에 하나)").font(.caption)
            TextEditor(text: Binding(get: { person.charges.joined(separator: "\n") }, set: { person.charges = $0.components(separatedBy: .newlines).filter { !$0.isEmpty } }))
                .frame(minHeight: 60)
            Picker("구속 여부", selection: $person.detention) {
                ForEach(Detention.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            Button("이 피고인 삭제", role: .destructive, action: remove)
        }
    }
}
