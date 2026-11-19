# 회사 폴더 저장 대체 동작·고정사건 변호인 경계 검증

기준 `c5c40a0`, 작업 브랜치 `experiment/v1-edge-save-fixed-counsel`. 기존 브랜치는 보존합니다.

## 1. 고정사건 변호인: 재현된 원인과 최소 수정

개인정보 없는 가상 텍스트로 실제 항목 순서를 재현했습니다.

```text
변 호 인 변호사 김가상
의 견 벌금 500만 원
가납명령청구
Ⅱ. 공소사실
```

이전 `values("변호인", lines)`는 `변호사 김가상\n의 견 벌금 500만 원\n가납명령청구`를 반환했고, CounselParser는 이름 외 문장이 섞여 `needsReview`를 반환했습니다. 이름 정규식 문제가 아니라 필드 종료 항목이 빠진 문제입니다.

`core.js`의 `fieldLabels`에 `의견`, `가납명령청구` 두 항목만 추가했습니다. 기존 공백 허용 패턴이 `의 견`, `가 납 명 령 청 구`도 인식합니다. 수정 후 반환값은 `변호사 김가상`, 최종 이름은 `김가상`입니다. 의견이 없고 가납명령청구부터 시작해도 종료합니다. 기존 국선 접미사와 법무법인·이름 내부 줄바꿈 복원 코드는 변경하지 않았습니다. 구속 항목 없는 고정사건의 X 규칙도 그대로입니다.

직접 fields()/values() 검증은 6종 변호인 × 4종 뒤 항목 = 24조합입니다. 고단 순서와 OCR 검토 상태의 기존 결과도 전후 비교했습니다.

## 2. 폴더 오류: 확인된 브라우저 경로와 확인하지 못한 부분

앱은 `storage.chooseFolder()` → `showDirectoryPicker({mode:'readwrite'})`를 호출합니다. 브라우저가 선택을 허용해야 파일 생성 및 쓰기에 진입합니다. 네이티브 선택창 내부의 경고는 앱이 직접 읽을 수 없고, 닫기/취소 후 Promise가 거절되었을 때 대응합니다. AbortError만으로 사용자 취소와 보호 경로 경고 후 취소를 구별하지 않습니다.

[Chromium 104 권한 구현](https://github.com/chromium/chromium/blob/104.0.5112.79/chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc)의 `kBlockedPaths`, `ShouldBlockAccessToPath`, `ConfirmSensitiveDirectoryAccess`를 확인했습니다. 시스템·앱 데이터 경로와 일부 상위 폴더는 알려진 경로 기준으로 제한하며, 이 검사는 폴더 내부의 실제 시스템 파일을 조사하는 방식이 아닙니다. 일반 하위 폴더 선택은 허용될 수 있습니다.

[Chromium 104 제한 폴더 대화상자](https://github.com/chromium/chromium/blob/104.0.5112.79/chrome/browser/ui/views/file_system_access/file_system_access_restricted_directory_dialog_view.cc)는 메시지에 요청 출처(origin)를 넣습니다. 따라서 오류의 `file://` 표시만으로 모든 로컬 HTML의 폴더 저장이 금지되었다고 단정할 수 없습니다. 출처 권한과 회사 정책도 영향을 줄 수 있습니다. 실제 회사 PC의 선택 경로·관리 정책에는 접근하지 못했으므로 정확한 회사 차단 원인은 미확정입니다.

### 변경한 사용자 동작

- 폴더 선택/권한 실패 시 이유와 대체 패널을 표시합니다. 네이티브 경고창이 남아 있다면 먼저 닫아야 합니다.
- 실패 직후 자동 다운로드하지 않습니다. 새 클릭의 사용자 동작으로 `전체 메모 저장 (다운로드 요청)` 또는 패널 버튼을 눌러 모든 미저장 PDF를 요청합니다.
- 다운로드 요청은 저장 완료가 아닙니다. 다운로드 완료/차단 결과를 페이지가 확실하게 알 수 없으므로 저장 성공 수에 포함하지 않습니다.
- 다중 요청이 차단되면 사건별 버튼 또는 `한 건씩 다시 받기`와 `다음 메모 다운로드`로 진행합니다. 재시작 클릭에서는 한 건만 요청합니다.
- 허용되는 폴더를 다시 선택하면 기존 순차 쓰기와 close 완료 확인 방식으로 복귀합니다. 일부 실패는 다른 사건을 중단하지 않습니다. 기존 파일 충돌 방지와 사건별 재시도도 유지합니다.
- ZIP, 보안 설정 변경, 정책 우회, 자동 반복 요청은 추가하지 않았습니다.

## 3. 검증 결과

| 검증 | 결과 |
|---|---|
| 기존+신규 단위 테스트 | 226개 통과 |
| 빌드된 HTML 호환성 검사 | 3개 통과 |
| Chromium 103 실제 file:// 대상 시험 | 2건·10건 생성/다운로드 요청, 개별 재시도, 고정/고단 변호인 16조합 통과 |
| 허용된 자동화 브라우저의 다운로드 이벤트 | 2/2건 및 10/10건 관찰, 저장 성공 표시는 0 유지 |
| 폴더 실패·다운로드 차단 모의 시험 | 요청 전환·한 건씩 재시작·거짓 완료 방지 통과 |
| 현대 Chromium + 미지원 API 제거 모의 시험 | 동일 대상 시험 통과; file 접근 제한으로 메모리 로드 진단 사용 |
| 독립 PDF 검사 | 각 대상 환경 29 PDF / 275개 검사 통과 |
| 기존 전체 브라우저 회귀 | Chromium 103 file:// 54 PDF 생성·다운로드 통과 |
| 기존 PDF/레이아웃 회귀 | 54개+24개 PDF, 독립 검사 768개 통과 |

폴더 핸들·권한은 모의 객체로 재현했습니다. 10건 순차 쓰기, 바이트 일치, close 완료 대기, 일부 실패 후 계속 저장, 충돌 방지, 개별 재시도를 검사했습니다. 실제 네이티브 폴더 선택·회사 정책 검증으로 해석하면 안 됩니다. 다중 다운로드 이벤트는 다운로드를 허용한 자동화 컨텍스트에서 관찰한 결과이며 회사 정책에서 동일하게 허용된다는 보장이 아닙니다.

모든 PDF가 2페이지이고, 두 번째 페이지는 원본의 내용 스트림·문자/폰트/좌표·렌더링 픽셀이 같습니다. 수정 전후 첫 페이지는 변호인 칸 외 픽셀이 동일합니다. 검사·본문 기소일·죄명·구속과 소년/국참/필요적국선 표시도 검사했습니다. services.js, mark-layout.js, batch-save.js, batch.js, first-hearing.js는 기준 커밋과 바이트가 같습니다. OCR·템플릿·라이브러리·빌드 타깃을 변경하지 않았습니다.

검증한 HTML SHA-256: `eac5337d9deaaaa731cb75869deeb59474d99ada5cb5d5f96b56dfedd63c03c2`.

## 4. 렌더링 및 재현 자료

- [수정 전 변호인 빈칸](edge-fixed-counsel-before.png) / [수정 후 이름](edge-fixed-counsel-after.png)
- [12명 법무법인 명단](edge-fixed-firm-long.png) / [첫 페이지 전체](edge-fixed-counsel-first-page.png)
- [Chromium 103 대상 브라우저 보고서](edge-fixed-chromium103-browser-report.json), [PDF 검사](edge-fixed-chromium103-pdf-report.json)
- [API 제거 대상 보고서](edge-fixed-missing-api-browser-report.json), [PDF 검사](edge-fixed-missing-api-pdf-report.json)
- [기존 전체 회귀 보고서](edge-fixed-regression-browser-report.json), [PDF 검사](edge-fixed-regression-pdf-report.json)

실제 실패 고정사건 원문은 제공되지 않았습니다. 가상 자료에서 경계 오염의 원인과 수정은 재현했지만 실제 문제 문서 성공을 확인한 것은 아닙니다. 이번 변경을 실제 회사 Windows Edge 104에서 실행하거나 폴더 쓰기 정책을 직접 확인하지 못했습니다.
