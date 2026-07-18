# File Upload Component

> 2주차 미니세션 — 프론트엔드 시스템 디자인
>
> 여러 개의 대용량 파일을 업로드할 수 있는 컴포넌트를 설계한다. drag & drop, 파일 검증,
> 진행률 표시, 취소/재시도, chunk 업로드 전략, 에러 처리를 포함한다.

## 실행 방법

```bash
pnpm --filter file-upload-component dev
```

`http://localhost:5173` 접속. 실제 백엔드가 없으므로 [MSW](https://mswjs.io)가 `/api/uploads*`
요청을 가로채 응답한다. 화면 상단의 "청크 실패율 시뮬레이션" 슬라이더로 실패율을 즉석에서
조절할 수 있어, 자동 재시도 → 에러 → 수동 재시도로 이어지는 흐름을 라이브로 볼 수 있다.

## 요구사항

- 여러 개의 대용량 파일을 동시에 업로드할 수 있어야 한다.
- 업로드 전 파일을 검증한다: 빈 파일 거부, 최대 크기(기본 2GB), 허용 확장자(설정 가능),
  중복 파일명 거부, 한 번에 올릴 수 있는 최대 개수(기본 10개) 제한.
- 파일별 업로드 진행률을 실시간으로 보여준다.
- 업로드 중인 파일은 취소할 수 있고, 실패한 파일은 재시도할 수 있어야 한다.
- 대용량 파일은 청크 단위로 나눠 업로드하고, 청크 전송 실패는 자동으로 재시도한다.
- 네트워크 실패/서버 에러 등 실패 상황을 사용자에게 원인과 함께 보여준다.
- (가정) 서버는 `(uploadId, chunkIndex)` 기준으로 청크를 upsert한다 — 즉 같은 청크를 다시
  보내도 안전하다. 재시도/재개 전략 전체가 이 가정 위에 서 있다.

## 아키텍처

```
src/
  engine/        React에 의존하지 않는 순수 TS 업로드 엔진
  hooks/         엔진을 구독하는 얇은 React 어댑터
  components/    프레젠테이션 컴포넌트
  mocks/         MSW 목 업로드 API (개발 전용)
```

업로드 로직(청크 분할, 동시성 제어, 재시도, 취소, 진행률 계산)을 `engine/`에 프레임워크
독립적으로 두고, React는 `useFileUpload` 훅 하나로 구독만 한다. 그 덕에 엔진은 jsdom과
`fetch` mock만으로 React 없이 테스트할 수 있고(`UploadManager.test.ts` 등 28개 테스트),
나중에 다른 UI 프레임워크나 Web Worker로 옮기는 것도 훅 하나만 새로 짜면 된다.

- `engine/types.ts` — `UploadFileState`, `ValidationConfig`, `ChunkUploadConfig`
- `engine/validateFile.ts` — 크기/확장자/중복/개수 검증
- `engine/chunkFile.ts` — `File`을 고정 크기 `Blob`으로 분할 (`Blob.slice`는 데이터를
  복사하지 않고 참조 범위만 기록하므로 파일이 커도 이 시점엔 메모리 부담이 없다)
- `engine/ConcurrencyPool.ts` — 세마포어. 파일 단위가 아니라 **전체 청크가 공유**한다
- `engine/withRetry.ts` — 지수 백오프 재시도
- `engine/uploadApi.ts` — `initUpload` / `uploadChunk` / `completeUpload` 3단계 REST 계약
- `engine/UploadManager.ts` — 상태 저장소 + 오케스트레이터. `subscribe`/`getSnapshot`으로만
  외부에 상태를 노출하는 pub/sub 구조
- `hooks/useFileUpload.ts` — `UploadManager`를 `useSyncExternalStore`로 구독. 로직 없음
- `components/` — `Dropzone`, `ProgressBar`, `FileItem`, `FileList`,
  `NetworkSimulationPanel`(데모용 실패율 컨트롤)

## 데이터 흐름

한 줄 요약: **순수 TS 엔진(`UploadManager`)이 상태와 네트워크를 소유하고 React는 구독만
한다. 실패는 "자동 3회 재시도 → 영구 실패(`error`) → 이어올리기 수동 재시도"의 2단 구조,
취소는 파일당 `AbortController` 하나로 전파한다.**

파일 하나의 상태는 5개다:

```
queued → uploading → success
              ├────→ error ──(수동 retry)──→ queued로 복귀
              └────→ canceled
```

1. 사용자가 `Dropzone`에 파일을 드래그하거나 선택 → `App`이 `addFiles(files)` 호출
2. `UploadManager.addFiles`가 `validateFiles`로 검증한다. 통과한 파일만 `queued`로 등록하고
   (이때 `totalChunks`를 계산해 진행률 분모로 쓴다) 업로드를 시작하며, 거부된 파일은
   `{file, error}` 목록으로 즉시 반환되어 화면에 표시된다
3. 파일별 업로드(`startUpload`):
   1. 세션 준비 — `chunkFile`로 파일을 5MB `Blob`으로 분할하고, 성공한 청크 인덱스를 담을
      `Set`(`doneIndexes`)과 이 파일의 모든 요청이 공유할 `AbortController`를 만든다
   2. `initUpload`로 서버에서 `uploadId` 발급 (재시도 시에는 세션에 남은 기존 id를 재사용)
   3. 아직 끝나지 않은 청크만 `ConcurrencyPool`(기본 동시 4개)에 태워 업로드. 청크 하나가
      끝날 때마다 `doneIndexes`에 기록하고 진행률을 갱신한다
   4. 각 청크는 실패 시 `withRetry`로 최대 3회 지수 백오프 재시도. 그래도 실패하면 해당
      파일의 `AbortController`를 중단시켜 남은 청크 요청까지 함께 정리하고 `error`로 전환
   5. 모든 청크가 끝나면 `completeUpload` 호출 후 `success`로 전환
4. 상태가 바뀔 때마다 `UploadManager`가 `emit()` → `useFileUpload`가 `useSyncExternalStore`로
   리렌더를 트리거 → `FileList`/`FileItem`이 진행률과 상태를 반영
5. **취소** — `cancel(id)`는 해당 파일의 `AbortController.abort()`를 호출해 in-flight 요청을
   즉시 끊고 상태를 `canceled`로 고정한다. 아직 시작 전인 `queued` 파일도 취소할 수 있다
   (`startUpload`가 시작 시점에 상태를 확인하고 `queued`가 아니면 시작하지 않는다).
   단, `completeUpload`가 이미 성공한 뒤에 취소가 겹치면 서버에는 파일이 완성돼 있으므로
   `success`로 확정한다 — 서버와 클라이언트 상태가 어긋나는 것을 막기 위한 선택이다
6. **재시도** — `retry(id)`는 처음부터 다시 올리지 않는다. 세션에 남아 있는 `uploadId`와
   `doneIndexes`를 재사용해 남은 청크부터 이어간다. 동시 업로드라 완료 순서가 섞여도
   Set 기반이라 정확히 재개된다
7. **삭제** — `remove(id)`는 종결 상태(success/error/canceled)에서만 동작한다. 업로드 중인
   파일은 먼저 취소해야 하며, 삭제 시 세션(청크 `Blob` 목록, `doneIndexes`)도 함께 해제되어
   메모리에 쌓이지 않는다

## 성능/에러 처리

- **메모리** — `File.slice()`는 복사 없이 범위만 참조하므로, GB 단위 파일도 청크 목록을
  미리 만들어 둬도 메모리 부담이 없다
- **동시성 제한** — 청크 단위로 공유되는 concurrency pool로 브라우저 커넥션 수와 서버
  부하를 예측 가능한 범위로 통제한다 (기본 4)
- **자동 재시도** — 청크 단위 지수 백오프(최대 3회)로, 일시적 네트워크 오류는 사용자 개입
  없이 복구된다
- **재개 가능한 수동 재시도** — 영구 실패 후에도 이미 성공한 청크는 다시 올리지 않는다
- **취소 전파** — 파일 하나의 `AbortController`를 그 파일의 모든 청크 요청이 공유해서,
  취소·영구 실패 시 나머지 요청을 한 번에 정리한다
- **사전 검증** — 빈 파일/용량 초과/중복/개수 제한을 네트워크 요청 이전에 걸러 불필요한
  트래픽을 막는다
- **진행률 granularity** — 청크 완료 시점마다 `uploadedBytes`를 갱신한다. 청크 내부의
  바이트 단위 진행률까지는 주지 않지만, 청크 크기를 5MB로 잡아 progress bar가 충분히
  매끄럽게 움직인다 (아래 트레이드오프 참고)
- **에러 메시지 구분** — 검증 실패/초기화 실패/청크 실패/완료 실패를 단계별로 다른 문구
  (status 코드 포함)로 노출해 사용자가 어느 단계에서 왜 실패했는지 구분할 수 있게 했다

## 트레이드오프

- **엔진/UI 분리 vs 컴포넌트 하나에 다 넣기** — 초기 코드량은 늘지만, 업로드 로직을 React
  렌더링과 무관하게 단위 테스트할 수 있다(엔진 테스트는 React 없이 jsdom + fetch mock만으로
  통과). 스터디 발표용 코드라 "설명하기 좋은 구조"를 확장성보다 우선한 선택이기도 하다.
- **fetch vs XHR** — `fetch`는 업로드 진행 이벤트(byte-level progress)를 지원하지 않아
  청크 단위로만 진행률을 갱신한다. XHR을 쓰면 청크 내부까지 매끄러운 progress bar를 만들 수
  있지만 API가 더 장황하고 `AbortController`와의 통합도 번거로워서, 청크를 충분히 잘게
  쪼개는 쪽으로 절충했다.
- **공유 concurrency pool vs 파일별 concurrency** — 파일별로 동시성을 두면 구현은 단순하지만,
  대용량 파일 여러 개를 한꺼번에 올릴 때 파일 수만큼 동시 연결이 배로 늘어나 네트워크를
  독점할 수 있다. 전체 청크가 풀 하나를 공유하도록 해서 전체 처리량을 예측 가능하게 했다.
- **재개 가능한 재시도 vs 처음부터 재업로드** — 완료된 청크 인덱스를 추적하는 코드가 조금
  더 필요하지만, 대용량 파일이 마지막 청크에서 실패했을 때 전체를 다시 올리지 않아도 되는
  이득이 훨씬 크다고 판단했다. 전제는 서버가 청크를 upsert한다는 것.
- **MSW 목 서버 vs 실제 백엔드** — 스터디 목적상 실제 서버 대신 브라우저에서 fetch를
  가로채는 MSW를 선택했다. 실제 네트워크 계층을 타지는 않지만, 지연·실패율을 자유롭게
  조절할 수 있어 재시도·에러 UI를 그 자리에서 시연하기엔 오히려 더 적합했다.
