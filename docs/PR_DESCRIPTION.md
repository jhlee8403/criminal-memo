공소장 PDF를 기기 안에서 분석하고 원본 형사메모 양식에 기입하는 iPadOS 17+ 앱의 1차 구현입니다. 두 샘플에서 피고인·죄명·검사·변호인·기소일·구속 여부를 추출하고, 사용자가 원문과 대조해 수정한 뒤 PDF를 생성하도록 구성했습니다.

- SwiftUI 검토 화면, PDFKit 텍스트/미리보기, Vision 페이지 OCR, Files 내보내기·표준 공유 시트
- 피고인·죄명 번호 목록, 변호인 없음 X, 구속 빨간 O / 불구속 X
- 주민번호 날짜·구분값·검증값을 보수적으로 확인하고 기소일 기준 나이 판정. 실제 샘플의 잘못된 주민번호는 나이 판정 보류
- 실제 형사메모 PDF의 모든 페이지를 그린 뒤 좌표 기입. 원본 파일은 보존하며 번들 사본의 해시와 좌표를 결합
- 전과·누범·집행유예 등은 독립 추출 모듈로 확장 가능하며 아직 구현하지 않음

검증: Linux Swift 6.0.3에서 XCTest 24개 통과. 실제 PDF 기반 좌표·원본 보존 검사 38개 통과. Python 좌표 시뮬레이션에서 입력 영역 밖 변경 픽셀 0개. Apple 소스 구문 파싱 통과.

미검증: 이 환경에 Xcode/Apple SDK/iPad가 없어 앱 빌드, XcodeGen 생성, Apple 통합 테스트 5개, 실제 Vision OCR, iOS PDF 렌더링, 설치 및 Goodnotes 공유는 실행하지 못했습니다. 좌표 시뮬레이션은 iOS 앱 출력물이 아닙니다. Mac CI와 후속 실기기 검증이 필요합니다.

설치: Mac에서 `brew install xcodegen && xcodegen generate` 후 프로젝트를 열어 CriminalMemo 스킴을 선택합니다. 실기기는 Team과 고유 Bundle Identifier를 설정합니다. 상세 절차·범위는 `docs/DEVELOPMENT.md`, 실제 분석/좌표·검증 이미지는 `docs/PDF_ANALYSIS.md`를 참조하세요.
