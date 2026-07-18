# 대용량 파일 업로드 컴포넌트 설계

## 질문

여러 개의 대용량 파일을 업로드하는 UI는 어떻게 설계하며, 실무에서는 어떤 점을 고려해야 하나요?

## 답변 초안

대용량 파일 업로드의 핵심은 크게 두 가지입니다.

1. **파일을 청크로 나눠 실패의 단위를 "파일 전체"에서 "조각 하나"로 줄이는 것**
2. **업로드 로직(상태·네트워크)을 React 밖의 엔진으로 분리하고, React는 구독만 하는 것**

여기에 검증, 진행률, 취소/재시도, 동시성 제어가 따라붙습니다. 간단해 보이지만 "업로드 중
취소", "실패 후 이어서 재시도" 같은 동시성 엣지 케이스가 많아서, 로직을 컴포넌트 밖으로
빼두지 않으면 테스트도 설명도 어려워집니다.

> **실행 방법**: `pnpm --filter file-upload-component dev` → `http://localhost:5173`.
> 백엔드 대신 MSW가 `/api/uploads*`를 가로채며, 화면의 "청크 실패율" 슬라이더로
> 자동 재시도 → 에러 → 수동 재시도 흐름을 라이브로 볼 수 있습니다.

---

## 왜 청크로 나누는가

2GB 파일을 요청 하나로 올리면 99%에서 끊겨도 전부 다시 올려야 하고, 진행률을 보여줄
방법도 마땅치 않습니다. 그래서 파일을 5MB 조각으로 나눠 보냅니다.

```ts
// File.slice()는 데이터를 복사하지 않고 참조 범위만 기록한다.
// GB 파일도 청크 목록을 미리 만들어 두는 데 메모리 부담이 없다.
for (let offset = 0; offset < file.size; offset += chunkSize) {
  chunks.push(file.slice(offset, offset + chunkSize));
}
```

서버와는 3단계 계약을 맺습니다.

```text
initUpload            → uploadId 발급
PUT /chunks/:index    → 청크 업로드 (인덱스가 있어 도착 순서가 섞여도 조립 가능)
completeUpload        → 서버가 파일 조립
```

**핵심 가정**: 서버는 `(uploadId, chunkIndex)` 기준으로 청크를 **upsert**합니다.
같은 청크를 두 번 보내도 안전(멱등)하다는 뜻이고, 뒤에 나오는 재시도·이어올리기 전략
전체가 이 가정 위에 서 있습니다. S3 multipart, tus 프로토콜도 같은 원리입니다.

---

## 전체 구조: 엔진과 UI의 분리

```text
components/  Dropzone, FileList, ProgressBar …     ← 프레젠테이션만
     ↑ props
hooks/       useUploadFiles, useDragDropFiles       ← 이벤트 어댑팅 + 구독만
     ↑ subscribe / getSnapshot
utils/       uploadManager, uploadApi, validateFile, chunkFile, withRetry, concurrencyPool …
             ← 상태 + 청크 + 재시도 + 취소 (React 무관 순수 TS)
```

업로드 로직 전체를 React 밖(`utils/`)에 둔 이유는 세 가지입니다.

- **테스트** — "동시 업로드 중 취소" 같은 까다로운 로직을 네트워크 계층(`uploadApi`)
  mock만으로 검증할 수 있습니다 (React 없이 도는 테스트 28개).
- **설명 가능성** — 상태 전이가 `createUploadManager` 함수 하나에 모여 있어 위에서
  아래로 읽힙니다.
- **이식성** — 다른 프레임워크나 Web Worker로 옮겨도 훅만 새로 짜면 됩니다.

훅은 `useSyncExternalStore`로 엔진을 구독하고, input 이벤트 처리·파일 정렬·거부 콜백
전달 같은 어댑팅만 합니다.

```tsx
const { uploadFiles, isLoading, handleFilesAdd, handleFileCancel, handleFileRetry } =
  useUploadFiles({ onFilesRejected: setRejections });
```

---

## 상태 설계와 데이터 흐름

파일 하나의 상태는 5개뿐입니다.

```text
queued → uploading → success
              ├────→ error ──(수동 retry)──→ queued로 복귀
              └────→ canceled
```

흐름은: 파일 선택/드롭 → 검증(빈 파일·2GB 초과·확장자·중복 이름·개수 제한) →
통과한 파일만 `queued` 등록 → 청크 업로드 → 완료 시 `success`.

검증에서 거부된 파일은 상태로 만들지 않고 `{file, error}` 목록으로 콜백에 넘겨,
토스트든 인라인 목록이든 호출부가 노출 방식을 정하게 했습니다.

진행률은 기본적으로 청크가 완료될 때마다 갱신합니다. 네트워크 계층은 axios라서
`uploadApi.uploadChunk`에 전달한 `onUploadProgress` 콜백으로 바이트 단위 진행률도
받을 수 있습니다. 다만 현재 UI는 5MB 청크 단위 갱신만으로도 progress bar가 충분히
매끄럽게 움직여서 상태 모델을 단순하게 유지했습니다.

```ts
doneIndexes.add(index); // 성공한 청크 인덱스 Set
progress = Math.round((doneIndexes.size / chunks.length) * 100);
```

---

## 동시성 제어: 풀은 파일별이 아니라 전역

파일마다 동시성을 주면 파일 10개를 올릴 때 동시 연결이 10배로 늘어나 네트워크를
독점합니다. 그래서 **모든 파일의 청크가 세마포어 하나(동시 4개)를 공유**합니다.

```ts
// 개념만 남긴 코드 — 실제로는 pool.run 안에서 재시도와 진행률 갱신까지 처리한다
await Promise.all(
  remaining.map((index) =>
    pool.run(() => uploadChunk(uploadId, index, chunks[index], signal)),
  ),
);
```

파일을 아무리 많이 추가해도 동시 요청은 4개로 고정되고, 나머지는 풀 대기열에서
기다립니다. 최대 개수 제한(기본 10개)은 기술적 한계가 아니라 UX 가드레일입니다.

---

## 실패 처리: 2단 재시도

**1층 — 자동 재시도.** 청크 하나가 실패하면 지수 백오프(0.5s → 1s → 2s)로 최대 3회
조용히 다시 보냅니다. 일시적인 네트워크 흔들림은 사용자가 모르게 지나갑니다.

**2층 — 영구 실패 후 이어올리기.** 3회를 다 써도 실패하면 그 파일의 나머지 요청을
전부 중단하고 `error`로 전환합니다. 사용자가 재시도를 누르면 **처음부터 올리지 않고**,
세션에 남은 `uploadId`와 성공한 청크 인덱스(`doneIndexes`)를 재사용해 남은 청크만
이어서 올립니다.

```ts
const remaining = chunks
  .map((_, index) => index)
  .filter((index) => !doneIndexes.has(index)); // 성공한 청크는 건너뛴다
```

2GB 파일이 마지막 청크에서 죽어도 다시 올리는 건 5MB뿐입니다. 이게 가능한 근거가
서두의 upsert 가정입니다.

---

## 취소: AbortSignal 하나로 전파

파일 하나의 모든 요청(init, 청크들, complete)이 `AbortController` 하나를 공유합니다.
`cancel()`이 `abort()`를 호출하면 in-flight 요청이 한 번에 끊깁니다.

"사용자가 취소했는가"의 판별은 별도 boolean 플래그가 아니라 **abort reason**으로 합니다.

```ts
controller.abort("user-cancel");        // 사용자 취소
controller.abort();                     // 청크 영구 실패로 인한 내부 정리
// → signal.reason === "user-cancel" 인지로 두 경로를 구분
```

플래그를 따로 두면 abort 경로가 추가될 때마다 동기화를 깜빡할 수 있어서, signal을
단일 진실 공급원으로 삼았습니다.

엣지 케이스 둘:

- **시작 전 취소** — `queued` 상태에선 아직 요청이 없지만, 상태를 `canceled`로 바꿔 두면
  시작 시점에 확인하고 포기합니다.
- **완료와 취소가 겹치면** — `completeUpload`가 이미 성공했다면 서버엔 파일이 완성돼
  있으므로 `success`로 확정합니다. 서버와 클라이언트 상태가 어긋나는 것을 막기 위한
  선택입니다.

---

## 실무 주의점

- 청크 재시도·재개 전략은 서버의 멱등성(upsert) 보장이 전제입니다. 계약을 먼저
  확인해야 합니다.
- `fetch`는 업로드 방향의 바이트 단위 진행 이벤트가 없습니다. 이 프로젝트는 axios를
  씁니다. axios의 `onUploadProgress`는 내부적으로 XHR의 progress 이벤트를 감싼 것이라
  바이트 단위 진행률이 가능하고, `signal` 옵션으로 `AbortController` 연동도 됩니다.
  fetch로 가려면 청크를 잘게 쪼개 청크 단위 진행률로 절충해야 합니다.
- 동시성 풀은 파일별이 아니라 전역으로 두어야 파일 수와 무관하게 네트워크 사용량이
  예측 가능합니다.
- 취소·실패 시 남은 in-flight 요청을 정리하지 않으면 대역폭이 새고 상태가 꼬입니다.
  `AbortController` 공유로 한 번에 정리하는 것이 안전합니다.
- `useSyncExternalStore`의 `getSnapshot`은 상태가 안 바뀌면 같은 참조를 반환해야
  합니다(무한 리렌더 방지). 스냅샷 캐시가 필요합니다.
- 같은 파일을 연속 선택하면 change 이벤트가 안 뜹니다. 처리 후 `input.value = ""`
  리셋이 필요합니다.
- 파일 개수를 크게 늘리면 병목은 엔진이 아니라 UI입니다. 수백 개 규모면 리스트
  가상화와 진행률 emit 스로틀링을 고려해야 합니다.

---

## 면접 답변

> "대용량 파일 업로드는 파일을 5MB 청크로 나눠 실패의 단위를 줄이는 것에서
> 시작했습니다. 서버와 init → 청크 업로드 → complete의 3단계 계약을 맺고, 서버가
> 청크를 upsert한다는 멱등성 가정 위에서 재시도 전략을 세웠습니다. 청크 실패는 지수
> 백오프로 3회 자동 재시도하고, 영구 실패 시에는 성공한 청크 인덱스를 Set으로 추적해
> 재시도 때 남은 청크만 이어서 올립니다. 모든 파일의 청크가 전역 세마포어(동시 4개)를
> 공유해 파일 수와 무관하게 네트워크 사용량을 통제했고, 취소는 파일당 AbortController
> 하나를 모든 요청이 공유해 한 번에 전파했습니다. 사용자 취소와 실패로 인한 내부
> 중단은 abort reason으로 구분해 플래그 동기화 문제를 없앴습니다. 이 로직 전체를
> React 밖의 순수 TS 엔진에 두고 훅은 useSyncExternalStore로 구독만 하게 해서, 까다로운
> 동시성 시나리오를 React 없이 단위 테스트할 수 있었습니다."
