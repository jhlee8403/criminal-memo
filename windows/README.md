# Criminal Memo — Windows/Edge 오프라인 전환

**대상 Windows Edge의 `file://` 검증은 미완료입니다.** 실행 구조는 서버·EXE 없이 HTML 더블클릭을 목표로 유지했습니다. 현재 환경의 관리자 정책이 `file://` 탐색을 차단하여, 동일한 배포 HTML을 메모리에 올린 진단으로만 엔진·업무 흐름을 실행 검증했습니다. 이 결과를 HTML 더블클릭 성공으로 해석하지 않습니다.

## 배포 후보

[distribution/CriminalMemo](distribution/CriminalMemo/) 폴더를 복사하고 `CriminalMemo.html`을 Edge에서 엽니다. ZIP은 먼저 압축을 풉니다. Node.js·npm·Python·설치·서버는 최종 사용자에게 요구하지 않습니다. 사용법은 [USER_GUIDE.txt](USER_GUIDE.txt)를 참고하세요.

라이브러리, OCR Worker와 embedded WASM, kor/eng 학습 데이터, CMap/기본 글꼴, 한글 글꼴, 템플릿을 HTML에 내장했습니다. 선택 PDF는 File API ArrayBuffer로 읽습니다. `fetch(file://...)`·ES module 로딩·CDN·온라인 인증·클라우드 API에 의존하지 않습니다. PDF.js는 번들 안의 WorkerMessageHandler를 이용하는 메인 스레드 fallback을 사용하고, OCR은 HTML 바이트에서 만든 Blob Worker에서 실행합니다. 원본 템플릿은 pdf-lib로 열어 첫 페이지만 오버레이하며 나머지 페이지를 다시 그리지 않습니다.

현재 저장소 원본 형사메모는 **1페이지**입니다. 지시서의 실제 2페이지 양식은 확인되지 않았습니다. 모든 페이지 보존 알고리즘은 합성 2페이지 템플릿으로 검사했지만, 이것이 실제 2페이지 원본 검증을 대신하지 않습니다.

## 개발 구조

- `src/core.js`: 독립 피고인·죄명·검사·변호인·기소일·구속 파서, 생년월일 해석, AgeRuleEngine 함수와 독립 표시 설정.
- `src/services.js`: PDFInputService, PDFTextExtractor, OCRService, MemoPDFRenderer, PDFExportService.
- `src/app.js`: 검토·수정, 원문/결과 미리보기, 다운로드. DOM에 문서 내용을 넣을 때 textContent/value만 사용합니다.
- `src/CriminalMemo.html`, `styles.css`: UI 원본.
- `scripts/build.mjs`: npm 잠금 버전으로 단일 HTML과 템플릿·라이선스·SHA-256 목록 생성.
- `tests/`: Swift 사례를 계승한 Node 테스트, 브라우저 진단.
- `scripts/verify_outputs.py`: 브라우저가 다운로드한 실제 PDF를 독립 엔진으로 검사.
- `distribution/`: 사용자가 실행할 빌드 산출물. `node_modules`와 테스트 문서는 포함하지 않습니다.

기존 Swift 브랜치 `feature/ipad-memo-v1`의 `f808f29`는 그대로 유지했습니다. 새 브랜치는 main `69ca759`에서 시작하며 기존 저장소 파일을 수정하지 않고 `windows/`만 추가합니다.

## 빌드와 테스트 (개발자용)

```sh
cd windows
npm ci --cache /tmp/criminal-memo-npm
npm run build
npm test
# Python/Chromium은 개발 검증용이며 최종 사용자에게 필요하지 않습니다.
python -m pip install -r scripts/requirements-test.txt
python scripts/prepare_fixtures.py
npm run test:browser
python scripts/verify_outputs.py
```

브라우저 실행 파일은 기본 `/usr/bin/chromium`, 필요하면 `CM_CHROMIUM` 환경 변수로 지정합니다. 일반 Chromium의 기본 보안 설정을 사용하며 `--disable-web-security`, `--allow-file-access-from-files` 등을 사용하지 않습니다. 컨테이너에서는 Playwright의 기본 프로세스 샌드박스 옵션을 사용하지만 관리 URL 정책을 수정하지 않습니다.

브라우저 테스트는 **먼저 실제 file URL로 탐색**합니다. 관리자 차단(`ERR_BLOCKED_BY_ADMINISTRATOR`)일 때만 명확히 표시한 메모리 진단을 추가 수행합니다. 일반적인 file 실행 오류를 임의로 숨기지 않습니다. 대상 PC의 Edge 직접 테스트는 별도입니다.

결과: [검증 보고서](docs/VALIDATION.md), [file:// 기술 검토](docs/FILE_MODE.md), [라이브러리·라이선스](docs/DEPENDENCIES.md).
