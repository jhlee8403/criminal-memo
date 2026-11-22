# Criminal Memo — 회사 폴더 대체 저장·고정사건 변호인 시험판

최신 추가: [반의사불벌·친고죄 표시 검증](docs/COMPLAINT_MARKS_VALIDATION.md). `5e341b7` 기준 `experiment/v1-complaint-marks`에서 개발했습니다.

사용자가 이전 `44a0d39`의 공소장 분석·2페이지 생성·표시를 회사 Edge 104에서 확인했다고 보고했습니다.
이번 변경의 회사 Windows 실행과 폴더 쓰기 정책은 직접 검증하지 못했습니다.
Edge 104 legacy 빌드·오프라인 단일 HTML을 유지하며 구형 Chromium 103의 file 실행으로 검사합니다.

이전 변경: [새 원본·전체 저장·기소일 검증](docs/BATCH_SAVE_FILING_DATE_VALIDATION.md).
`44a0d39`에서 새 브랜치 `experiment/v1-batch-save-filing-date`로 분기했습니다.

최신 수정은 `c5c40a0` 기준 새 브랜치 `experiment/v1-edge-save-fixed-counsel`입니다.
폴더 제한 시 명시적인 PDF 일괄 다운로드 요청/한 건씩 재시도를 제공하고, 의견·가납명령청구를 변호인 필드 경계로 추가했습니다.
[원인과 검증 범위](docs/EDGE_SAVE_FIXED_COUNSEL_VALIDATION.md).

기존 자동 전용 실험판 v1.3의 파서 변경 및 검증 범위: [실제 확인 구조 재현 검증](docs/PARSER_V13_VALIDATION.md).

변호인 표시 후속 변경: [법무법인 출력 검증](docs/COUNSEL_OUTPUT_VALIDATION.md).

국선·일반 변호인 후속 변경: [직함 및 국선 표시 검증](docs/COUNSEL_APPOINTED_VALIDATION.md).

법무법인 명단의 이름 내부 줄바꿈 후속 수정: [원인 및 전후 검증](docs/FIRM_ROSTER_WRAP_VALIDATION.md).

Edge 104 호환 빌드 변경 및 실제 검증 범위: [호환성 보고서](docs/EDGE104_COMPATIBILITY.md).

소년·국참 출력 크기/중앙 정렬 후속 수정: [레이아웃 전후 검증](docs/MARK_LAYOUT_VALIDATION.md). 판정·다운로드 로직은 유지합니다.

## 다운로드·소년·국참 브랜치

`b53ac20`에서 분기한 `experiment/v1-download-juvenile-jury`입니다.
기존 `experiment/v1-two-page-memo`는 변경하지 않습니다.
다운로드는 사용자 클릭마다 한 건씩 요청하며, 권한을 허용한 폴더의 전체 순차 저장도 유지합니다.
주민번호 앞 6자리와 뒤 첫 숫자 1~4로 만 나이를 계산하고 피고인별 소년 OX를 출력합니다.
국참은 지정된 네 죄명의 정확한 일치와 죄명 정보 완전성에 따라 O/X/보류합니다.
2페이지 원본 양식·부분 추출 생성·기타 파서와 OCR 엔진은 유지합니다.
[원인·구현·검증 범위](docs/DOWNLOAD_JUVENILE_JURY_VALIDATION.md).

## 배포 후보

[distribution/CriminalMemo](distribution/CriminalMemo/) 폴더를 복사하고 `CriminalMemo.html`을 Edge에서 엽니다. ZIP은 먼저 압축을 풉니다. Node.js·npm·Python·설치·서버는 최종 사용자에게 요구하지 않습니다. 사용법은 [USER_GUIDE.txt](USER_GUIDE.txt)를 참고하세요.

라이브러리, OCR Worker와 embedded WASM, kor/eng 학습 데이터, CMap/기본 글꼴, 한글 글꼴, 템플릿을 HTML에 내장했습니다. 선택 PDF는 File API ArrayBuffer로 읽습니다. `fetch(file://...)`·ES module 로딩·CDN·온라인 인증·클라우드 API에 의존하지 않습니다. PDF.js는 번들 안의 WorkerMessageHandler를 이용하는 메인 스레드 fallback을 사용하고, OCR은 HTML 바이트에서 만든 Blob Worker에서 실행합니다. 원본 템플릿은 pdf-lib로 열어 첫 페이지만 오버레이하며 나머지 페이지를 다시 그리지 않습니다.

첨부된 새 원본은 자체 2페이지 PDF이며 `templates/형사메모(1).pdf` 하나를 통째로 HTML에 내장합니다. 첫 페이지만 덧입히고 두 번째 페이지에는 아무 내용도 추가하지 않습니다. 별도 1쪽/2쪽 병합 경로는 제거했습니다.

## 개발 구조

- `src/first-hearing.js`: ISO/숫자/점 날짜와 콜론/숫자 시간의 검증·정규화.
- `src/batch.js`: 파일명 사건번호와 메모 저장 이름.
- `src/storage.js`: 선택 폴더 권한 확인, 기존 파일 충돌 검사와 개별 PDF 쓰기.
- `src/core.js`: 독립 피고인·죄명·검사·변호인·기소일·구속 파서, 생년월일 해석, AgeRuleEngine 함수와 독립 표시 설정.
- `src/services.js`: PDFInputService, PDFTextExtractor, OCRService, MemoPDFRenderer, PDFExportService.
- `src/app.js`: 파일별 날짜·시간·상태, 순차 처리와 오류 격리, 결과 미리보기 및 개별 저장. DOM에 문서 내용을 넣을 때 textContent/value만 사용합니다.
- `src/CriminalMemo.html`, `styles.css`: UI 원본.
- `scripts/build.mjs`: npm 잠금 버전으로 단일 HTML과 템플릿·라이선스·SHA-256 목록 생성.
- `tests/`: Swift 사례를 계승한 Node 테스트, 브라우저 진단.
- `scripts/verify_outputs.py`: 브라우저가 다운로드한 실제 PDF를 독립 엔진으로 검사.
- `distribution/`: 사용자가 실행할 빌드 산출물. `node_modules`와 테스트 문서는 포함하지 않습니다.

초기 Windows 구현 이력과 이전 실험 브랜치는 보존합니다. 이번 작업의 기준은 `44a0d39`입니다.

## 빌드와 테스트 (개발자용)

```sh
cd windows
npm ci --cache /tmp/criminal-memo-npm
npm run build
npm test
npm run test:built-compatibility
# Python/Chromium은 개발 검증용이며 최종 사용자에게 필요하지 않습니다.
python -m pip install -r scripts/requirements-test.txt
python scripts/prepare_fixtures.py
npm run test:browser
npm run test:new-template
python scripts/verify_batch_save_form.py
```

브라우저 실행 파일은 기본 `/usr/bin/chromium`, 필요하면 `CM_CHROMIUM` 환경 변수로 지정합니다. 일반 Chromium의 기본 보안 설정을 사용하며 `--disable-web-security`, `--allow-file-access-from-files` 등을 사용하지 않습니다. 컨테이너에서는 Playwright의 기본 프로세스 샌드박스 옵션을 사용하지만 관리 URL 정책을 수정하지 않습니다.

브라우저 테스트는 **먼저 실제 file URL로 탐색**합니다. 관리자 차단(`ERR_BLOCKED_BY_ADMINISTRATOR`)일 때만 명확히 표시한 메모리 진단을 추가 수행합니다. 일반적인 file 실행 오류를 임의로 숨기지 않습니다. 대상 PC의 Edge 직접 테스트는 별도입니다.

결과: [검증 보고서](docs/VALIDATION.md), [file:// 기술 검토](docs/FILE_MODE.md), [라이브러리·라이선스](docs/DEPENDENCIES.md).
