# file:// 우선 실험과 검증 한계

## 실제로 관측한 결과

실험 순서: 최소 HTML → 로컬 PDF File API/ArrayBuffer → PDF.js 텍스트·canvas → Tesseract 한글 OCR → pdf-lib 한글 임베딩/오버레이/다운로드 → 업무 UI 연결.

Linux 관리 Chromium 156.0.8078.79에서 아래 탐색을 먼저 실행했습니다.

```text
file:///workspace/criminal-memo/windows/distribution/CriminalMemo/CriminalMemo.html
net::ERR_BLOCKED_BY_ADMINISTRATOR
```

`/etc/chromium/policies/managed/urls.json`에는 `URLBlocklist: ["*"]`가 있고, 허용 목록에 HTTP/HTTPS 등만 있으며 file URL은 없습니다. 앱이 로드되기 전에 관리자 탐색 정책에서 차단되었습니다. Worker·WASM·PDF.js의 file 제약까지 도달하지 못했으므로 각각이 이 환경의 file 모드에서 실패/성공했다고 판단하지 않습니다. 정책 변경, 다른 브라우저로 정책 회피, `--disable-web-security`, `--allow-file-access-from-files` 등은 수행하지 않았습니다.

Windows 머신이나 Microsoft Edge 실행 파일은 이 환경에 없습니다. 실제 Windows 10/11 Edge 더블클릭, 관리자 권한 없는 회사 PC, USB 전달 후 실행은 미검증입니다.

## 독립 메모리 진단

같은 최종 HTML 파일 바이트를 Playwright `page.setContent`로 브라우저 메모리에 적재했습니다. **file 모드도 웹 서버 모드도 아닙니다.** 테스트가 사용하는 진단 방법이며 사용자 배포 실행 방법을 바꾼 것이 아닙니다.

- Chromium context `offline: true`, HTTP/HTTPS 요청은 별도로 차단·기록.
- 파일 선택창으로 주어진 실제 PDF를 File API ArrayBuffer로 읽음.
- PDF.js는 classic IIFE 번들 및 미리 로드한 `pdfjsWorker.WorkerMessageHandler`를 사용하는 main-thread fallback. 텍스트 추출과 canvas 렌더링 실행.
- Tesseract.js는 HTML 안의 문자열로 Blob Worker를 만들고 공식 `tesseract-core-lstm.wasm.js`의 embedded WASM을 초기화. kor/eng gzip 학습 데이터는 Worker의 로컬 바이트 응답으로 제공. 캐시를 끄며 HTTP fetch는 거부.
- PDF.js CMap·기본 폰트도 메모리 factory로 제공. 입력 PDF·템플릿·한글 폰트는 로컬 바이트.
- PDF 생성 후 Blob URL과 download anchor로 파일 다운로드. 다운로드한 PDF를 Python/PyMuPDF로 별도 재검증.
- 대표 전체 경로에서 외부 HTTP 요청 0건, JavaScript pageerror 0건.

근거: `browser-report.json`, `pdf-report.json`. 이 진단은 엔진의 표준 브라우저 API 사용과 오프라인 바이트 공급을 확인하지만, file 문서에서 Blob Worker 생성·WASM·다운로드가 Edge/회사 정책으로 허용되는지는 증명하지 않습니다.

## 검토한 구조와 해결 방법

1. **직접 로컬 fetch와 module import**: file origin/CORS 제약이 예상되어 최종 구조에 사용하지 않습니다. CORS를 껐다고 주장하지 않습니다.
2. **PDF.js 전용 Worker**: 별도 file Worker URL이 필요 없도록 WorkerMessageHandler를 동일 HTML에 번들링하여 fallback을 사용합니다. 메모리 진단에서는 실제 동작했습니다. 큰 문서는 메인 스레드 처리로 느릴 수 있습니다.
3. **OCR Worker·WASM·학습 데이터**: file 경로로 import/fetch하지 않고 Blob Worker와 embedded WASM, 학습 데이터 바이트를 사용합니다. 표준 Blob/WebAssembly API이며 브라우저 보안 플래그를 해제하지 않습니다. 메모리 진단에서 한글 스캔 PDF와 혼합 PDF를 처리했습니다.
4. **한글 글꼴**: NanumGothic 부분 포함 시 일부 글자가 빠지는 현상을 실제 출력에서 발견했습니다. 전체 글꼴 임베딩으로 수정하고 생성 PDF의 글자·embedded font와 원본 밖 픽셀을 확인했습니다. 출력 파일 크기가 증가합니다.
5. **로컬 템플릿**: 빌드 때 HTML에 바이트를 내장합니다. 사용자가 매번 선택하거나 네트워크로 불러올 필요가 없습니다.

CSP는 HTTP 연결을 허용하지 않습니다 (`connect-src data: blob:`). 신뢰한 번들 스크립트 실행을 위한 inline script, OCR용 Blob Worker 및 WebAssembly를 허용합니다. upstream 라이브러리에는 CDN fallback 문자열이 포함될 수 있지만 실행 경로를 로컬 자산으로 지정하고 외부 요청을 차단했습니다. 실제 공소장을 API에 전송하는 코드나 인증은 없습니다.

## 회사 PC에서 확인할 사항과 승인 후 대안

- IT 정책이 로컬 HTML(file URL) 탐색을 허용하는지.
- HTML 내 JavaScript, Blob Worker, WebAssembly 실행이 허용되는지.
- 파일 선택·Blob 다운로드·PDF 열기 및 인쇄가 허용되는지.
- 배포 ZIP/HTML이 보안 소프트웨어에서 격리되는지, 파일 전달·버전 해시 확인 절차.

HTML이 허용되고 OCR만 막히면 오류를 표시하고 원문 대조 수동 입력으로 계속할 수 있습니다. 텍스트 PDF 경로도 별도 확인이 필요합니다.

file 탐색 자체가 금지된 환경에서는 현재 구조로 실행할 수 없습니다. 설치·관리자 권한 없는 가능 대안은 회사가 허용한 정적 로컬 HTML 정책, 또는 승인된 서명 포터블 실행 파일/사용자 권한 로컬 서비스 등입니다. 후자의 두 방식은 회사 정책과 사용자 승인이 선행되어야 하며 **이번에 구현하거나 실행 구조로 채택하지 않았습니다.** 서버 성공 결과로 file 성공을 대신하지 않습니다.
