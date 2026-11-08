# 개발 · 빌드 · 설치 · 검증

## 설계

- `ExtractionPipeline`: `IdentityExtractor`, `ChargeExtractor`, `ProsecutionExtractor`, `CounselExtractor`를 독립 실행합니다. 향후 전과 등은 `CaseExtractionModule` 구현으로 추가합니다.
- `MemoCore`: Apple 프레임워크와 무관한 Swift 패키지. 추출은 라벨/번호 목록 규칙 기반이며 학습 모델이나 서버를 사용하지 않습니다. 근거가 없거나 상충하는 값은 공란과 경고로 남깁니다.
- `PDFTextReader`: PDFKit 페이지 텍스트를 우선 사용합니다. 유효 문자 20개 미만 페이지 또는 사용자가 강제 OCR을 선택하면 Vision의 한국어/영어 인식을 수행합니다. OCR로 읽은 문서는 변호인 기재 상태와 출생 연도를 직접 확인하도록 합니다. OCR 조각을 행별로 묶으며 낮은 신뢰도 페이지는 경고합니다. OCR이 빈 페이지를 포함해 텍스트를 전혀 읽지 못한 경우 부분 성공으로 숨기지 않고 오류로 보고합니다.
- `MemoViewModel`: 보안 범위 URL 접근, 백그라운드 분석/렌더링, 오류 상태를 관리합니다.
- `ContentView`: 원문과 추출문 확인, 모든 대상 필드 수정, 검토 확인 후 생성. 내용을 수정하면 기존 생성물과 검토 확인을 무효화합니다.
- `MemoPDFRenderer`: 번들 템플릿 해시 검증 → 모든 원본 페이지 그리기 → 첫 페이지 좌표 기입. 글자는 11~8pt 범위에서 조정하며 칸을 넘으면 오류를 냅니다. 원본 PDF는 쓰지 않습니다.
- `PDFPreview` / `PDFExport` / `ShareSheet`: PDFKit 미리보기, 파일 앱 내보내기, 표준 iPad 공유 시트.

## Mac에서 빌드

필요: Xcode 16 이상 권장, iPadOS 17 이상 SDK/기기, XcodeGen. 앱 실행 중에는 인터넷이 필요 없지만 최초 Xcode·도구·서명 설정에는 연결이 필요할 수 있습니다.

```sh
git clone https://github.com/jhlee8403/criminal-memo.git
cd criminal-memo
git switch feature/ipad-memo-v1
brew install xcodegen
xcodegen generate
open CriminalMemo.xcodeproj
```

이미 체크아웃한 경우 clone 대신 해당 폴더를 사용합니다. Xcode에서:

1. `CriminalMemo` 스킴과 사용 가능한 iPad 시뮬레이터를 선택합니다.
2. Product → Run (`⌘R`)으로 빌드·실행합니다.
3. 두 공소장 원본을 시뮬레이터의 파일 앱에 추가하고 앱에서 가져옵니다. 실기기는 로컬 “나의 iPad”에 파일을 먼저 저장하면 오프라인 검증이 가능합니다.
4. 피고인·죄명·검사·날짜·구속 여부와 경고를 대조합니다. 검토 토글을 켜고 메모를 생성합니다.

`.xcodeproj`는 `project.yml`로 생성하는 산출물이므로 Git에 넣지 않습니다. 화면에 앱 아이콘은 기본 아이콘으로 표시되며 별도 아이콘 디자인은 포함하지 않았습니다.

### iPad 설치

1. iPad를 Mac에 연결하고 기기 신뢰와 개발자 모드를 켭니다.
2. Xcode Settings → Accounts에서 Apple 계정을 등록합니다.
3. 앱 타깃 Signing & Capabilities에서 본인 Team을 선택하고 `com.example.CriminalMemo`를 본인 고유 Bundle Identifier로 바꿉니다. 다음 재생성에도 유지하려면 `project.yml`에서 수정합니다. 자동 서명을 사용합니다.
4. 실행 대상에서 연결된 iPad를 선택하고 `⌘R`을 누릅니다. 필요하면 기기에서 개발자 앱 신뢰 절차를 수행합니다.
5. 로컬 PDF를 사용하여 비행기 모드에서 분석·생성·파일 저장을 확인합니다. Goodnotes가 설치되어 있으면 공유 시트에서 Goodnotes를 선택해 가져오기 결과를 확인합니다. 앱에서 제공되는 Goodnotes의 별도 연동 API는 없습니다.

개인 무료 개발자 계정의 설치 유효기간과 기기 수 제한은 Apple 정책을 따릅니다.

## 테스트

### 핵심 Swift 테스트 (실행 완료)

```sh
swift test --jobs 2
```

Linux Swift 6.0.3의 Swift 5 모드로 **44개 XCTest, 실패 0개**. 최신 공소장 2개, 복수 피고인 구간 및 2페이지 연결, 변호인 없음/미기재/OCR 구별, 앞 6자리·세기 해석·기재 나이 불일치, 뒷자리 무시, 수동 연도 확인, 윤년, 만 19세·70세 경계, 확장 모듈, 좌표 로딩을 확인했습니다. 마지막 Swift Testing의 “0 tests”는 별도 러너이며 XCTest와 구별합니다.

이 클라우드에서는 기본 캐시 경로가 읽기 전용이라 다음 방식으로 실행했습니다. 도구체인은 공식 Swift 6.0.3 Ubuntu 24.04 배포 파일과 detached signature를 다운로드하고, 공식 swift-org-website의 공개키로 GPG 서명을 확인한 뒤 `/tmp/criminal-memo-swift`에 풀었습니다. 해당 도구체인은 저장소나 앱에 포함하지 않습니다.

```sh
CLANG_MODULE_CACHE_PATH=/tmp/criminal-memo-clang-cache \
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/criminal-memo-module-cache \
/tmp/criminal-memo-swift/swift-6.0.3-RELEASE-ubuntu24.04/usr/bin/swift test \
  --scratch-path /tmp/criminal-memo-build \
  --cache-path /tmp/criminal-memo-spm-cache \
  --config-path /tmp/criminal-memo-spm-config \
  --security-path /tmp/criminal-memo-spm-security --jobs 2
```

### 원본 PDF 및 좌표 검사 (실행 완료)

```sh
python3 -m venv /tmp/criminal-memo-pdf-venv
/tmp/criminal-memo-pdf-venv/bin/pip install -r scripts/requirements-pdf.txt
/tmp/criminal-memo-pdf-venv/bin/python scripts/verify_pdfs.py
```

38개 검사 통과. 산출물은 `artifacts/pdf-validation/`에 생성됩니다. 리뷰용 이미지와 JSON 사본은 `docs/`에 있습니다. 자세한 범위는 [PDF 분석](PDF_ANALYSIS.md)을 확인하세요.

### Apple 통합 테스트 (작성했지만 미실행)

Xcode에서 Product → Test (`⌘U`). 또는:

```sh
xcodegen generate
xcodebuild -showdestinations -project CriminalMemo.xcodeproj -scheme CriminalMemo
# 위에서 확인한 iPad 시뮬레이터 ID로 치환
xcodebuild test -project CriminalMemo.xcodeproj -scheme CriminalMemo \
  -destination 'platform=iOS Simulator,id=<SIMULATOR_ID>' \
  -resultBundlePath artifacts/AppleTests.xcresult CODE_SIGNING_ALLOWED=NO
```

`ApplePDFTests`의 7개 테스트:

- PDFKit으로 실제 샘플 두 개를 읽고 대상 항목 추출
- 실제 샘플을 이미지로만 된 PDF로 만들어 Vision OCR 후 이름·검사·죄명 확인
- 실제 iOS 렌더러의 페이지 수/크기·원본 텍스트 보존 및 입력 내용 확인, 결과 PDF를 XCTest 첨부파일로 보존
- 지나치게 긴 텍스트를 잘라내지 않고 거부
- 다른 템플릿 해시 거부
- 미확인 변호인 상태의 PDF 생성 차단
- 실제 공소장2의 피고인별 변호인·구속 표시가 칸 안에 들어가는지 검증

**이 Linux 환경에는 Xcode·Apple SDK·iPad가 없습니다.** 앱 전체의 타입 검사·빌드, XcodeGen 생성, 위 7개 Apple 테스트, OCR 품질, UI 동작, 저장·공유, iPad 설치는 아직 확인되지 않았습니다. Swift 구문 파싱만 통과했으며 이는 SDK 타입 검사나 앱 빌드 성공을 의미하지 않습니다. CI 설정은 추가했지만 원격 실행 결과는 별도로 확인해야 합니다.

### 실기기 인수 확인 목록

- 원본 공소장 2개: `1. 이민주`, 죄명 두 줄, 검사, X, 날짜, 구속 빨간 O. 기재 나이 41세와 계산 40세 불일치 경고 및 출생 연도 확인 전 나이 원 미표시. 공소장2는 김유나·이영수의 죄명·구속·변호인이 구분되어야 함.
- 스캔 공소장과 텍스트/이미지 혼합 문서에서 필요시 강제 OCR을 사용하고 원문과 대조.
- 단일/복수 피고인·죄명이 1.부터 표시되는지, 수정 후 기존 출력이 무효화되는지.
- 유효한 합성 테스트 번호에서 18/19세·70/71세 및 기소일 변경 판정.
- 세로/가로 및 분할 화면, 긴 입력 오류, 취소·암호화·손상 PDF 오류.
- PDF 전체 표/페이지 방향 보존, 표시가 지정 칸 안에 있는지, 인쇄 크기·한글·줄바꿈.
- 파일 앱 저장·재열기, 설치된 Goodnotes 공유, 비행기 모드에서 전체 흐름.

## 아직 구현하지 않은 범위

전과·누범·집행유예·반의사불벌 등의 추가 추출 모듈, 사건 자동 저장/목록, OCR 필드별 근거 하이라이트, 다른 양식 좌표 자동 인식. 주민번호 뒷자리 해석과 체크섬 검증은 새 요구사항에 따라 제거했습니다. 현재 양식 공간을 넘는 내용의 추가 페이지 생성은 하지 않습니다.

변경된 세부 처리 규칙은 [EXTRACTION_RULES.md](EXTRACTION_RULES.md)를 참고하세요.
