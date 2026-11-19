# 2페이지 원본 양식 교체 검증

기준 `783b158`, 새 브랜치 `experiment/v1-template-update`.

## 교체 범위

이번 첨부 파일은 업로드 이름 `형사메모.pdf`로 전달되었으며, 요청에서 지칭한 새 `형사메모(2).pdf`로 사용했습니다. 실제 업로드는 43,986바이트의 2페이지 PDF입니다. 새 원본 SHA-256은 `b16fcb041110090725863c5a4934a03b80ea935f6086d9bcf7111528aeb6f75c`입니다.

내부 리소스 경로 `windows/templates/형사메모(1).pdf`는 그대로 두고 파일 내용만 첨부 원본 바이트로 교체했습니다. 기존 빌드가 이 경로를 사용하므로 빌드 코드·프로그램 기능을 변경할 필요가 없습니다. 배포 폴더의 같은 경로와 단일 `CriminalMemo.html`에 정확히 같은 원본 전체가 내장됩니다. 실행 시 별도의 양식 파일은 필요하지 않습니다. 이전 원본은 기준 커밋과 이전 브랜치에 보존됩니다.

`windows/src/` 전체, 자동 기재 좌표, 화면/CSS, 파서, OCR, 판정, 저장/다운로드 로직, 라이브러리, Edge 104 빌드 스크립트는 변경하지 않았습니다. 양식 해시를 고정 검증하는 기존 두 테스트 파일의 기대값과 새 브랜치 배포 워크플로만 갱신했습니다. 추가 파일은 비교 테스트·검증 보고서·렌더링 이미지입니다.

## 첫 페이지 비교

구·신 원본 모두 595 × 841 pt이며 MediaBox, CropBox, 회전이 같습니다. 첫 페이지 텍스트/폰트/좌표, 도형/좌표, 디코딩한 내용 스트림이 동일합니다. 1배·2배·4배 해상도 렌더링에서 모두 픽셀 차이가 0입니다. 따라서 사건번호, 피고인, 죄명, 검사, 변호인, 구속, 기소일, 첫기일, 소년, 국참, 필요적국선의 모든 좌표를 유지했습니다.

같은 렌더러와 같은 입력을 구·신 원본에 각각 출력한 6가지 비교도 통과했습니다. 사건번호만 기재, 단일 피고인, 국선변호인, 긴 법무법인 명단, 복수 피고인 OX/XO/OXX를 포함합니다. 6개 쌍의 생성 첫 페이지는 크기·텍스트 좌표·도형·내용 스트림·1/2/4배 렌더링 이미지가 모두 동일합니다.

## 두 번째 페이지 비교

구·신 두 번째 페이지 크기와 텍스트 좌표는 같으나 도형과 내용 스트림이 달라졌습니다. 2배 렌더링에서 변경된 픽셀은 1,890개입니다. 새 페이지를 다시 그리지 않았습니다.

각 생성 PDF는 정확히 2페이지이며, 생성된 두 번째 페이지는 새 원본의 크기·회전·텍스트/폰트/좌표·도형·내용 스트림·렌더링 픽셀이 같습니다. 따라서 날짜, O/X, 사건번호 등 추가 기재가 없습니다. PDF 저장 과정의 객체 번호/파일 전체 바이트 차이와 페이지 내용 보존은 구분하여 검사했습니다.

## 재현 및 검증

```sh
npm test --prefix windows
npm run build --prefix windows
npm run test:built-compatibility --prefix windows
CM_CHROMIUM=/tmp/criminal-memo-chromium103/chromium CM_SOFTWARE_GL=1 node windows/tests/template-update-browser.mjs
python windows/scripts/verify_template_update.py
```

비교 검사는 Chromium 103.0.5058.0의 실제 file:// 실행, 네트워크 오프라인 상태에서 수행했습니다. 프로그램 파일의 템플릿 리소스 외 PDF.js·OCR·앱 스크립트가 기존 빌드와 같고 HTML/CSS/화면도 같음을 추가로 검사했습니다. 단위 테스트 226개, 빌드 호환성 3개, 새 양식 비교 110개 검사가 통과했습니다.

## 렌더링 자료

- 첫 페이지: [기존](template-update-old-page-1.png) / [신규](template-update-new-page-1.png)
- 두 번째 페이지: [기존](template-update-old-page-2.png) / [신규](template-update-new-page-2.png)
- 실제 출력: [첫 페이지](template-update-generated-page-1.png) / [두 번째 페이지](template-update-generated-page-2.png)
- [비교 브라우저 보고서](template-update-browser-report.json) / [독립 PDF 비교 보고서](template-update-pdf-report.json)

실제 회사 Windows Edge 104에서 이번 양식 교체를 실행하지는 못했습니다. 기존 호환 빌드와 기능을 유지하고 구형 Chromium 103에서 오프라인 회귀를 검사한 결과입니다. 폴더 쓰기 정책은 모의 핸들로 검사하며 회사 정책 확인을 의미하지 않습니다.

## 기존 회귀 결과

| 항목 | 결과 |
|---|---|
| 기존 전체 단위 테스트 | 226개 통과 |
| 빌드 호환성·내장 원본 검사 | 3개 통과 |
| 양식 전후 비교 | 6쌍 PDF, 110개 검사 통과 |
| 단건·일괄 분석/다운로드 | 54개 PDF, 브라우저 시험 통과 |
| 소년·국참 등 출력 레이아웃 | 24개 PDF, 브라우저 시험 통과 |
| 위 두 회귀의 독립 PDF 검사 | 768개 통과 |
| 고정/고단 변호인·저장 대체 회귀 | 16조합, 2건/10건 다운로드 요청 시험 통과 |
| 저장·변호인 회귀의 독립 PDF 검사 | 29개 PDF, 275개 검사 통과 |

기존 공소장 1건씩 분석·복수 파일 분석, 정보 추출 실패 시 생성, 본문 기소일 우선, OCR, 사건번호·파일명·첫기일, 피고인별 소년·구속 OX, 국참·필요적국선 표시를 포함한 기존 시험을 그대로 실행했습니다. 저장 권한·오류는 기존 모의 핸들 시험입니다. 네트워크 요청과 브라우저 실행 오류는 없었습니다.

검증한 HTML SHA-256: `25198a07be2a56b582c2021c0355cc9faca88518ee34e699452e368c093669ca`.

- [전체 브라우저 회귀](template-update-regression-browser-report.json) / [PDF 검사](template-update-regression-pdf-report.json)
- [표시 레이아웃 회귀](template-update-layout-browser-report.json)
- [저장·변호인 회귀](template-update-edge-browser-report.json) / [PDF 검사](template-update-edge-pdf-report.json)
