# Edge 104 호환성 수정 및 검증

대상: Microsoft Edge **104.0.1293.47**, 기준 브랜치
`experiment/v1-auto-latest-pdf`, 기준 커밋 `0648eea`. 2026-11-17.

**회사 Windows PC와 실제 Edge 104에서는 실행하지 못했다.** 아래 결과는 Node 검사,
Linux Chromium 103.0.5058.0의 실제 엔진 실행, 최신 Chromium에서 API를 제거한 시험이다.
이 결과를 실제 회사 PC/Edge 104 인증으로 해석하지 않는다.

## 원인과 변경

기존 빌드는 `pdfjs-dist/build/pdf.mjs`와 `build/pdf.worker.mjs`를 사용했다.
이 일반 빌드는 `Promise.withResolvers()`를 직접 사용한다. Edge 104에는 이 함수가
없으므로 PDF 문서 로딩 객체 생성에서 예외가 발생하고, 미리보기와 분석 버튼까지
진행하지 못한다. `es2022` 문법 타깃은 이런 런타임 API를 추가하지 않는다.

동일한 **PDF.js 4.8.69**의 `legacy/build/pdf.mjs`, `legacy/build/pdf.worker.mjs`로
본체와 worker를 함께 전환했다. 라이브러리 버전 변경이나 전면 교체는 하지 않았다.
배포 패키지 README도 최신 JS 기능이 없는 브라우저에 legacy 폴더를 안내한다.
다만 이 안내 자체를 Edge 104의 모든 기능에 대한 지원 보장으로 보지는 않는다.

legacy에 내장된 **core-js 3.38.1**이 필요한 폴리필을 기능 감지 후 설치한다.
직접 작성한 Promise 대체 함수로 라이브러리의 세부 동작을 바꾸지 않았다.
지원 브라우저의 기존 native `Promise.withResolvers`는 그대로 유지한다.

실제 단일 HTML의 실행 순서는 기존대로 다음과 같다.

1. PDF/글꼴/CMap 및 OCR 데이터 설정
2. **legacy PDF worker**: 해당 번들 내부의 호환 모듈이 API 사용 전에 초기화
3. **legacy PDF 본체**: API 사용 전에 호환 모듈 초기화, worker가 설치한 기능도 재사용
4. 앱 초기화 및 PDF 열기

본체만이 아니라 worker의 독립 realm에서도 API 부재 초기화 검사를 수행했다.
완성된 HTML에서 worker → 본체 → 앱 순서를 직접 읽어 실행하는 검사도 추가했다.

`build.mjs`의 PDF 본체·worker·앱 esbuild 타깃은 **`edge104`**로 설정했다.
OCR은 원래 배포된 worker/WASM/학습 데이터를 유지하며, 이 번들은 구형 엔진에서 실제
OCR 실행으로 확인했다. manifest에는 `browserTarget`, `pdfjsBuild`, `pdfjsVersion`을 기록한다.
core-js MIT 라이선스를 vendor 및 배포 고지에 포함했다.

## 다른 API·문법 검토

| 항목 | Edge 104 대응 |
|---|---|
| Promise.withResolvers | legacy 내장 폴리필, resolve/reject·Promise 하위 클래스·native 유지 검사 |
| TypedArray.toSorted/toReversed/with | legacy 내장 폴리필, 구형 엔진 및 API 제거 시험 |
| ArrayBuffer.transfer/transferToFixedLength | legacy 내장 폴리필, 구형 엔진에서 로딩/렌더링 실행 |
| Set 집합 연산 | legacy 내장 폴리필, 동작 및 전체 흐름 검사 |
| URLSearchParams의 확장 동작 | legacy 내장 호환 모듈 사용 |
| structuredClone, Array.at, replaceAll, Object.hasOwn | 대상 이전 Chromium에 존재, 실제 Chromium 103에서도 사용 확인 |
| optional chaining, nullish coalescing, private fields 등 | esbuild `edge104` 타깃으로 문법 검토·변환, 구형 엔진에서 전체 번들 파싱 |
| ImageDecoder | PDF.js의 기존 기능 감지 및 대체 경로 유지 |
| AbortSignal.any | Edge 104에 없는 API. PDF.js 편집기 관련 경로에 존재하나 이 앱은 해당 편집기를 사용하지 않음. API를 제거한 상태에서 지원 작업 흐름을 검증 |

폴리필은 브라우저 전체의 새 기능을 모두 제공하는 것이 아니다. 이 앱의 지원 흐름을
검증한 범위이며, PDF.js의 주석 편집기 등 사용하지 않는 기능까지 지원한다고 주장하지 않는다.

## 변경하지 않은 것

`windows/src/` 전체가 기준 커밋과 동일하다. 검사·기소일·피고인·생년월일·죄명·구속,
국선/법무법인 변호인, OCR, PDF 렌더러와 1페이지 출력 방식, UI 흐름을 수정하지 않았다.
완성 HTML의 PDF/글꼴/CMap 데이터 스크립트와 OCR worker/WASM/학습 데이터 스크립트도
기준 커밋과 바이트 동일함을 검사했다. 원본 PDF와 양식은 보존했다. 수동 입력은 추가하지 않았다.

## 수행 결과

- `npm test`: 기존 파서 회귀 **89개 + 호환성 4개 = 93개 통과**.
  일반 PDF.js는 함수가 없는 realm에서 원래 오류를 재현한다. legacy 본체와 worker는
  같은 조건에서 각각 초기화되며 폴리필의 resolve/reject·하위 클래스·native 유지가 통과한다.
- `npm run test:built-compatibility`: **2개 통과**. 실제 배포 HTML의 순서·외부 script 불필요,
  main 실행 전 폴리필 설치, 라이브러리 버전과 manifest 타깃을 확인한다.
- Linux **Chromium 103.0.5058.0**: native Promise.withResolvers/TypedArray.toSorted/
  ArrayBuffer.transfer/Set.union이 처음부터 없는 엔진이다. 별도 API 제거 없이
  **실제 `file://`** → PDF 선택 → 미리보기의 비어 있지 않은 픽셀 → 분석 버튼 활성화
  → 자동 추출 → 기존 1페이지 PDF 생성 → Blob 다운로드까지 통과했다.
- Linux **Chromium 156**: 문서 스크립트 실행 전 Promise.withResolvers, TypedArray 확장,
  ArrayBuffer 전송, Set 확장, AbortSignal.any를 명시적으로 제거하고 같은 흐름 통과.
  관리 정책으로 file 탐색이 차단되어 동일 HTML의 메모리 진단으로 수행했다.
  이것은 구형 엔진 자체를 에뮬레이션하거나 Edge 104를 실행한 결과는 아니다.
- 두 환경 모두 기존 샘플 PDF 2개, 스캔 한글 OCR·혼합 PDF, 국선/일반/법무법인
  **26개 가상 사례**를 포함한 기존 브라우저 회귀를 통과했다. HTTP 외부 요청 0, 실행 오류 0.
- 각 환경의 다운로드 PDF를 `python scripts/verify_outputs.py`로 검사해 **150개씩 통과**.
  전체 이름·순서·칸 내부 좌표, 구속 색상, 입력칸 밖 픽셀 및 양식 보존을 확인했다.

보고서:
- `edge104-chromium103-browser-report.json`, `edge104-chromium103-pdf-report.json`
- `edge104-missing-api-browser-report.json`, `edge104-missing-api-pdf-report.json`

## 개발 시험 환경과 한계

Chromium 103 실행 파일은 개발용으로 `/tmp`에만 준비한
`@sparticuz/chromium@103.0.0`의 headless binary이다. 프로젝트/배포 의존성이 아니다.
실제 버전 문자열은 `103.0.5058.0`이다. Windows용 Edge나 Chromium 104라는 이름으로
바꾸어 보고하지 않았다. 구형 공식 browser 아카이브 접근은 개발 환경의 네트워크 제한으로
실패했고, Microsoft의 해당 Linux Edge 104 패키지 경로도 제공되지 않아 확보하지 못했다.

구형 Linux headless 실행 파일에는 동봉된 SwiftShader 라이브러리와
`--use-gl=angle --use-angle=swiftshader`가 필요했다. 이를 준비하기 전에는 전체 시험의
미리보기 단계가 대기/시간 초과됐다. 준비 후 전체 시험이 통과했다. 이는 개발 컴퓨터의
그래픽 실행 구성으로, 배포 HTML이나 회사 PC에 설치·설정·서버 실행을 요구하지 않는다.

시험용 HTTP 가로채기는 사용하지 않고 브라우저의 native offline 모드로 인터넷을 차단하며,
요청 이벤트를 기록한다. `--disable-web-security`, `--allow-file-access-from-files`,
보안 정책 수정, origin 격리 해제는 사용하지 않았다. 컨테이너의 프로세스 샌드박스 실행은
기존 Playwright 기본값을 사용한다. 회사 PC의 보안 설정을 변경하라고 안내하지 않는다.

개발자 재실행 예:

```sh
npm ci
npm test
npm run build
npm run test:built-compatibility
CM_CHROMIUM=/path/to/chromium CM_SOFTWARE_GL=1 npm run test:browser
python scripts/verify_outputs.py
CM_NO_MODERN_APIS=1 npm run test:browser
python scripts/verify_outputs.py
```

현재 실행 결과는 핵심 PDF/OCR 흐름의 호환성을 뒷받침하지만, 회사 PC의 정확한 Edge
104.0.1293.47, Windows 렌더링/다운로드 정책, 실제 문제 공소장 PDF를 검증한 결과는 아니다.
그 최종 확인은 회사 PC에서 새 ZIP의 HTML로 다시 수행해야 한다.
