# v2.2 실제 실행한 검증

기존 v2.1 배포물은 그대로 보존했습니다. 아래는 별도 실험 후보에 대한 Linux Chromium 검증이며 **Windows Edge/file:// 검증 완료가 아닙니다**.

- `npm test`: **84개 통과**. 기존 73개 테스트를 기재 나이 제거·전체 DOB 확인 규칙에 맞게 갱신하고, CTC·DB 전처리·위치/행 복원·모델 해시·엔진 충돌/피고인 연결·Worker 시간 제한·점수 판정 테스트 11개를 추가했습니다. 기존 최초 37개 업무 규칙 테스트를 삭제하지 않았습니다.
- `npm run test:browser`: 원본 공소장1·2, 스캔, 두 페이지 혼합 PDF, 후보/직접 수정, DOB 확인/수정/무효화, 다운로드 회귀 통과. 기재 나이 입력란 없음 확인.
- `node tests/paddle-integration.mjs`: **3개 통합 시나리오 통과**. Paddle 스캔 분석→실제 후보 버튼 선택→전체 DOB/변호인 확인→PDF 다운로드, 두 페이지 복수 피고인→OX PDF 다운로드, 명시적 두 엔진 비교→충돌 보류.
- `python scripts/verify_outputs.py`: 브라우저에서 실제 다운로드한 두 엔진의 공소장1·2 출력 PDF 4개를 PyMuPDF로 독립 검사, **55개 통과**. 한글/번호, 변호인 빈칸·윤상일(국선), O 빨강/X 검정/OX 한 줄·칸 내부, 입력칸 밖 픽셀 변화 없음(2pt 여유), 폰트 포함, 원형 표시, 1페이지 출력 확인. 합성 2페이지 양식도 원본 사본은 그대로 두고 첫 페이지만 출력함을 확인.
- `npm run test:ocr-ui`, `CM_REGION_ENGINE=paddle npm run test:ocr-ui`: **8개씩 통과**. 불량 선택 텍스트의 OCR 추가, 후보 충돌 보류, 후보 선택/수동 수정, 단계별 원문, 실제 마우스 드래그→각 엔진의 선택 영역 재인식→이승엽 인식, 합성 기울기 보정, 재시도 예산0 제한. 전체 문서 분석 엔진은 이 두 UI 시험 모두 기존 Tesseract이며, 선택 영역만 각각 Tesseract/Paddle로 실행했습니다. Paddle 전체 분석은 별도 통합 시나리오로 검증했습니다.
- `npm run test:paddle`: 실제 PP-OCRv5 검출·한국어 인식 ONNX를 오프라인 Blob Worker에서 실행. 공소장1의 검사·죄명·기소일·피고인·앞6자리·구속·변호인 텍스트와 단어 좌표를 assertion으로 확인.
- 단일 전체 OCR **20건**(10자료×2엔진), 실제 앱 혼합 경로 **20건**, 주석 영역 전처리 **40회**를 실행하고 비교 JSON과 보고서를 저장했습니다. 낮은 품질의 합성 자료는 미인식·충돌·불완전한 후보가 남았습니다. [정확도/성능/실패 보고서](OCR_V22.md).
- 모델 두 개는 `onnx==1.19.1`의 `onnx.checker.check_model` 통과. 사전은 공식 고정 커밋과 미러의 사전이 바이트 단위로 일치. ONNX 변환 자체나 공식 Paddle Python 추론/출력 동등성 검사는 수행하지 않았습니다.
- 모든 브라우저 시험은 인터넷 차단 컨텍스트와 HTTP(S) 요청 감시로 실행했으며 외부 요청은0건입니다.

관리 Chromium 정책의 `URLBlocklist:["*"]`가 file://를 허용하지 않아 `ERR_BLOCKED_BY_ADMINISTRATOR`를 실제 확인했습니다. 보안 정책이나 브라우저 보안 옵션을 바꾸지 않고 동일 HTML을 메모리에서 실행했습니다. 실제 Windows의 Edge, 회사 정책 아래 더블클릭 실행, 물리적 네트워크 단절, 저사양 PC 메모리, 인쇄는 미검증입니다.

최종 후보 HTML SHA-256: `bedbbde89af028ddc86a48f91081c4b77cacb99a495414954829d3b909bfce3b`. 앱 경로 비교/Paddle 브라우저/기본 브라우저/통합 다운로드 검증 모두 이 HTML을 사용했습니다. ZIP의 manifest 전 항목도 검증했습니다. 단일 전체 OCR 비교에는 그보다 앞선 후보 HTML 해시가 별도로 기록되어 있으며 모델·인식 계산은 동일합니다.

v2.1 HTML SHA-256(변경 없음): `25092868017180e38177f0b4d0fb8ac7a242640655fea55966454a874bfb75ad`. 원본 PDF 3개를 718bdda의 Git 객체 바이트와 대조해 모두 동일함을 확인했습니다. [배포/원본 해시 증거](v22-artifact-report.json).

실험 ZIP은 **28,357,296바이트(약27.04MiB)**이며, HTML은58,868,550바이트(약56.14MiB)입니다. 기존 v2.1 ZIP과 배포 폴더를 덮어쓰지 않았습니다.

주요 변경 파일:

- `src/ocr/paddle-core.js`, `paddle-worker.js`, `paddle.js`, `comparison.js`: 독립 ONNX 엔진, 전처리/검출/CTC, 기한/종료, 순차 비교와 미확정 후보.
- `src/services.js`, `hybrid.js`, `diagnostics.js`: 기존 Tesseract 보존, 엔진 선택, 출처 기록, 주민번호 앞6자리의 독립 후보, 1페이지 출력.
- `src/core.js`, `app.js`, `CriminalMemo.html`: 기재 나이 제거, 확인한 전체 DOB 수정, 엔진/수동 영역 선택·충돌 진단.
- `scripts/build.mjs`, `build-paddle.mjs`, `fetch-paddle-models.mjs`: v2.1과 분리된 완전 로컬 실험 배포물, 고정 해시 자원과 라이선스 포함.
- `experimental/paddle/`: 모델, 공식 사전, 출처·라이선스·무결성 검사 기록. 인식 모델 upstream 동등성/변환 출처 라이선스는 독립 검증 미완료.
- `tests/paddle*.mjs`, `ocr-scoring.mjs`, 기존 업무/브라우저/UI 테스트와 PDF 검사: 측정·회귀·통합 검증.
- `docs/OCR_V22.md`, 측정/검증 JSON, 사용 안내/README, `distribution-candidates/CriminalMemo-v2.2/`: 리뷰 가능한 보고서와 실험 배포 후보.
