# system_design

프론트엔드 시스템 디자인 스터디 결과물을 쌓아가는 모노레포입니다.
매주 4개 문제 중 1개를 골라 직접 요구사항을 가정하고 설계 → 코드로 구현 → 문서화합니다.

## 구조

```
problems/
  <problem-name>/
    README.md      # 요구사항 / 아키텍처 / 데이터 흐름 / 성능·에러 처리 / 트레이드오프
    src/
    src/__tests__/
    package.json
    tsconfig.json
    vitest.config.ts
```

각 문제 폴더는 독립적인 pnpm workspace 패키지입니다. 공통 설정(tsconfig, eslint, 테스트 러너)은 루트에서 공유합니다.

## 사용법

```bash
pnpm install

# 전체 테스트 / 특정 문제만 테스트
pnpm test
pnpm --filter file-upload-component test

# 타입체크 / 린트
pnpm typecheck
pnpm lint
```

## 새 문제 추가하기

1. `problems/<problem-name>/` 폴더 생성
2. 기존 문제(`file-upload-component`)의 `package.json`, `tsconfig.json`, `vitest.config.ts` 구조를 복사해 이름만 변경
3. `README.md`에 요구사항/아키텍처/데이터 흐름/성능·에러 처리/트레이드오프 작성
