import SwiftUI
import MemoCore
import UniformTypeIdentifiers

struct ContentView: View {
    @StateObject private var model = MemoViewModel()
    @State private var importing = false
    @State private var exporting = false
    @State private var sharing = false
    @State private var shareURL: URL?
    @State private var dateText = ""
    @State private var forceOCR = false
    @State private var selectedPreview = 0

    var body: some View {
        NavigationSplitView {
            Form {
                Section("공소장 가져오기") {
                    Toggle("모든 페이지를 OCR로 다시 읽기", isOn: $forceOCR)
                    Button("공소장 PDF 선택") { importing = true }.disabled(model.busy)
                    Text("문서는 기기 안에서만 처리됩니다. 가져오면 현재 검토 내용이 교체됩니다.")
                        .font(.caption).foregroundStyle(.secondary)
                    if !model.extractionNote.isEmpty { Text(model.extractionNote).font(.caption) }
                    if model.busy { ProgressView("문서 처리 중…") }
                }
                if model.sourceData != nil {
                    Section("피고인 · 주민등록번호") {
                        ForEach($model.draft.defendants) { $person in
                            VStack(alignment: .leading) {
                                TextField("피고인 이름", text: $person.name)
                                SecureField("주민등록번호 (나이 계산용)", text: $person.residentNumber)
                                    .textContentType(.none).autocorrectionDisabled()
                                Text(ResidentNumber.age(person.residentNumber, on: model.draft.indictmentDate).message)
                                    .font(.caption).foregroundStyle(.secondary)
                                Button("이 피고인 삭제", role: .destructive) {
                                    model.draft.defendants.removeAll { $0.id == person.id }
                                }
                            }
                        }
                        Button("피고인 추가") { model.draft.defendants.append(Defendant()) }
                        Text("유효한 주민번호와 기소일이 있는 경우만 소년·필요적국선에 원을 표시합니다. 여러 피고인 중 한 명이라도 해당하면 표시됩니다.")
                            .font(.caption)
                    }
                    Section("죄명 (한 줄에 하나)") {
                        TextEditor(text: Binding(get: { model.draft.charges.joined(separator: "\n") }, set: { model.draft.charges = $0.components(separatedBy: .newlines) }))
                            .frame(minHeight: 80)
                        Text("피고인과 죄명은 PDF에서 항상 1.부터 번호가 붙습니다.").font(.caption)
                    }
                    Section("기소 정보") {
                        TextField("검사 이름", text: $model.draft.prosecutor)
                        Toggle("변호인 없음 (X)", isOn: $model.draft.noCounsel)
                        if !model.draft.noCounsel { TextField("변호인", text: $model.draft.counsel, axis: .vertical) }
                        TextField("기소일 YYYY.MM.DD", text: $dateText)
                            .autocorrectionDisabled()
                            .onChange(of: dateText) { _, value in
                                model.draft.indictmentDate = CivilDate.parse(value)
                                model.reviewed = false; model.outputData = nil
                            }
                        Picker("구속 여부", selection: $model.draft.detention) {
                            ForEach(Detention.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        Text("주민번호는 출력 PDF에 기재하지 않습니다. 유효성 확인 실패 시 원문에 적힌 나이로 대체하지 않습니다.").font(.caption)
                    }
                    Section("검토 후 생성") {
                        ForEach(Array(model.draft.warnings.enumerated()), id: \.offset) { _, warning in Text(warning).font(.caption).foregroundStyle(.orange) }
                        if !dateText.isEmpty && CivilDate.parse(dateText) == nil { Text("기소일 형식을 확인하세요.").foregroundStyle(.red) }
                        Toggle("원문과 대조하여 결과를 확인했습니다", isOn: $model.reviewed)
                        Button("메모 PDF 생성") { model.generate(dateText: dateText); selectedPreview = 1 }
                            .disabled(!model.reviewed || model.busy)
                    }
                }
                if let message = model.errorMessage { Section("확인 필요") { Text(message).foregroundStyle(.red) } }
            }
            .disabled(model.busy)
            .navigationTitle("Criminal Memo")
            .navigationSplitViewColumnWidth(min: 330, ideal: 410, max: 520)
        } detail: {
            VStack {
                Picker("미리보기", selection: $selectedPreview) {
                    Text("공소장 원문").tag(0); Text("생성 메모").tag(1); Text("추출 텍스트").tag(2)
                }.pickerStyle(.segmented).padding()
                if selectedPreview == 2 {
                    ScrollView { Text(model.sourceText).frame(maxWidth: .infinity, alignment: .leading).padding().textSelection(.enabled) }
                } else if let data = selectedPreview == 0 ? model.sourceData : model.outputData {
                    PDFPreview(data: data)
                } else { ContentUnavailableView("PDF 미리보기", systemImage: "doc.richtext", description: Text("공소장을 가져와 검토한 뒤 메모 PDF를 생성하세요.")) }
            }
            .toolbar {
                if model.outputData != nil {
                    Button("파일에 저장", systemImage: "square.and.arrow.down") { exporting = true }
                    Button("공유", systemImage: "square.and.arrow.up") { prepareShare() }
                }
            }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            switch result {
            case .success(let url): clearShare(); selectedPreview = 0; model.load(url, forceOCR: forceOCR)
            case .failure(let error): model.errorMessage = error.localizedDescription
            }
        }
        .fileExporter(isPresented: $exporting, document: PDFExport(data: model.outputData ?? Data()), contentType: .pdf, defaultFilename: "형사신건메모") { result in
            if case .failure(let error) = result { model.errorMessage = error.localizedDescription }
        }
        .sheet(isPresented: $sharing, onDismiss: clearShare) { if let shareURL { ShareSheet(url: shareURL) } }
        .onChange(of: model.sourceText) { _, _ in dateText = model.draft.indictmentDate?.text ?? "" }
        .onChange(of: model.draft) { _, _ in model.reviewed = false; model.outputData = nil }
    }

    private func prepareShare() {
        guard let data = model.outputData else { return }
        clearShare()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("형사신건메모-\(UUID().uuidString).pdf")
        do { try data.write(to: url, options: [.atomic, .completeFileProtection]); shareURL = url; sharing = true }
        catch { model.errorMessage = error.localizedDescription }
    }
    private func clearShare() {
        if let shareURL { try? FileManager.default.removeItem(at: shareURL) }
        shareURL = nil
    }
}
