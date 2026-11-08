# 오프라인 자산·버전·라이선스

개발 시 npm의 package-lock.json 무결성 정보로 설치하고 최종 HTML에 번들링합니다. 최종 사용자의 실행에는 다운로드가 없습니다. 배포 `manifest.json`에 산출물 SHA-256이 있습니다. 단순 SHA는 서명을 대신하지 않으므로 회사 배포 승인·파일 전달 절차에 맞게 사용하세요.

| 구성요소 | 버전 | 라이선스/비고 |
|---|---|---|
| pdfjs-dist | 4.8.69 | Apache-2.0, classic IIFE로 빌드, PDF eval 비활성화 |
| pdf-lib | 1.17.1 | MIT |
| @pdf-lib/fontkit | 1.1.1 | MIT |
| tesseract.js | 5.1.1 | Apache-2.0 |
| tesseract.js-core | 5.1.1 | Apache-2.0, LSTM wasm.js에 WASM 내장 |
| @tesseract.js-data/kor | 1.0.0 | npm 포장 메타데이터 MIT, 원 학습 데이터 Apache-2.0 별도 포함 |
| @tesseract.js-data/eng | 1.0.0 | 동일, 4.0.0_best_int gzip 사용 |
| NanumGothic-Regular.ttf | 저장소에 고정한 바이트 | SIL OFL 1.1, 네이버/Google Fonts 배포 |
| PDF.js CMap / Foxit / Liberation 기본 폰트 | pdfjs-dist 동봉본 | 각 LICENSE 별도 포함 |
| esbuild (개발 전용) | 0.25.12 | MIT |
| prettier (소스 정리 전용) | 3.6.2 | MIT |
| playwright-core (검증 전용) | 1.56.1 | Apache-2.0 |

NanumGothic 출처: https://github.com/google/fonts/tree/main/ofl/nanumgothic

글꼴 SHA-256: `76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31`.

학습 데이터 Apache 라이선스 출처: https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE . 실행 데이터는 npm 잠금 버전의 @tesseract.js-data 패키지에서 공급합니다. 원본 파일은 프로그램 폴더 내부 HTML의 base64 바이트로 포함됩니다.

배포물 `assets/THIRD_PARTY_LICENSES.txt`, `NanumGothic-OFL.txt`, `tessdata-Apache-2.0.txt`에 고지·본문을 포함합니다. 라이브러리의 라이선스 주석은 번들에도 남깁니다.

source/vendor는 글꼴·라이선스의 빌드 입력이고, source/node_modules는 개발 캐시입니다. 최종 사용자에게 node_modules나 온라인 레지스트리가 필요하지 않습니다. 의존성 업데이트 시 오프라인·file 모드·CMap·OCR·PDF 글꼴 검증을 다시 수행해야 합니다.
