# 작업 관리 백엔드

NestJS로 구현한 JSON 파일 기반 작업 관리 API입니다. HTTP API로 작업을 생성·조회·검색·수정하고, 백그라운드 스케줄러가 대기 중인 작업을 주기적으로 선점해 처리합니다.

과제에서 실제 작업의 도메인 동작은 정해져 있지 않으므로 기본 `JobProcessor`는 짧은 비동기 처리를 모사합니다. 처리 경계를 인터페이스로 분리해 실제 메일 발송, 통계 생성 또는 메시지 큐 발행 로직으로 교체할 수 있습니다.

## 실행 환경

- Node.js 20 이상
- npm 10 이상 권장

```bash
npm install
npm run start:dev
```

기본 서버 주소는 `http://localhost:3000`입니다. 저장소에 포함된 `jobs.json`에는 조회 확인용 샘플 데이터가 있습니다. 서버 실행 후 기본 10초가 지나면 `pending` 샘플 작업은 스케줄러에 의해 처리됩니다.

프로덕션 빌드는 다음과 같이 실행합니다.

```bash
npm run build
npm run start:prod
```

### 환경 변수

| 변수 | 기본값 | 설명 |
|---|---:|---|
| `PORT` | `3000` | HTTP 서버 포트 |
| `JOBS_DB_PATH` | `./jobs.json` | JSON 데이터 파일 경로 |
| `LOG_FILE_PATH` | `./logs.txt` | 요청 및 처리 로그 파일 경로 |
| `JOBS_SCHEDULER_ENABLED` | `true` | `false`이면 주기 실행 중지 |
| `JOBS_INTERVAL_MS` | `10000` | 스케줄러 실행 간격(ms) |
| `JOBS_BATCH_SIZE` | `5` | 한 번에 선점할 최대 작업 수 |
| `JOBS_LEASE_MS` | `60000` | 처리 선점 유효 시간(ms) |
| `JOBS_PROCESSING_DELAY_MS` | `100` | 기본 처리기의 모사 지연 시간(ms) |

`.env.example`은 설정 목록을 보여주기 위한 파일입니다. 별도의 환경 변수 로더를 두지 않았으므로 값을 바꿀 때는 실행 환경에서 주입합니다.

```bash
JOBS_INTERVAL_MS=60000 JOBS_BATCH_SIZE=10 npm run start:dev
```

## 데이터 모델

```json
{
  "id": "f3f1bb8d-145b-4ee4-8cf2-0f6f56941779",
  "title": "신규 회원 안내 메일 발송",
  "description": "신규 가입 회원에게 서비스 안내 메일을 발송합니다.",
  "status": "pending",
  "attempts": 0,
  "createdAt": "2026-08-05T00:00:00.000Z",
  "updatedAt": "2026-08-05T00:00:00.000Z",
  "startedAt": null,
  "completedAt": null,
  "failureReason": null,
  "claimToken": null,
  "leaseUntil": null
}
```

`claimToken`과 `leaseUntil`은 API 소비자를 위한 값이 아니라 스케줄러가 작업 소유권을 확인하기 위한 메타데이터입니다. 과제에서는 응답 모델을 단순하게 유지하기 위해 함께 반환하지만, 운영 API라면 별도 내부 모델로 숨길 수 있습니다.

## API

성공 응답은 단일 작업의 경우 `{ "data": ... }`, 목록의 경우 `{ "data": [...], "meta": ... }` 형식입니다.

### 작업 생성

```http
POST /jobs
Content-Type: application/json

{
  "title": "가입 메일 발송",
  "description": "신규 회원에게 안내 메일을 보낸다."
}
```

```json
HTTP/1.1 201 Created

{
  "data": {
    "id": "73a73fa7-3377-43d8-8db5-20e5eb77968f",
    "title": "가입 메일 발송",
    "description": "신규 회원에게 안내 메일을 보낸다.",
    "status": "pending",
    "attempts": 0,
    "createdAt": "2026-08-05T01:00:00.000Z",
    "updatedAt": "2026-08-05T01:00:00.000Z",
    "startedAt": null,
    "completedAt": null,
    "failureReason": null,
    "claimToken": null,
    "leaseUntil": null
  }
}
```

- `title`: 필수 문자열, 공백 제거 후 1~100자
- `description`: 필수 문자열, 공백 제거 후 1~2,000자
- 정의하지 않은 필드가 있으면 `400 Bad Request`

```bash
curl -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"title":"가입 메일 발송","description":"신규 회원에게 안내 메일을 보낸다."}'
```

### 작업 목록

```http
GET /jobs?page=1&limit=20
```

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 0
  }
}
```

- 기본값: `page=1`, `limit=20`
- `limit` 최댓값: 100
- 최신 생성 순으로 정렬

### 작업 검색

```http
GET /jobs/search?title=메일&status=pending&page=1&limit=20
```

- `title`: 공백 제거 후 대소문자를 구분하지 않는 부분 일치
- `status`: 정확히 일치
- 두 조건을 함께 주면 AND 검색
- `title` 또는 `status` 중 하나는 반드시 필요
- 사용할 수 있는 상태: `pending`, `processing`, `completed`, `failed`, `cancelled`

명세가 `/jobs/search`를 별도 엔드포인트로 요구해 이를 따랐습니다. 일반적인 REST API에서는 `GET /jobs?title=...&status=...`로 목록 필터와 합치는 방법도 가능합니다.

### 단일 작업 조회

```http
GET /jobs/:id
```

작업이 없으면 `404 Not Found`와 `JOB_NOT_FOUND` 코드를 반환합니다.

### 작업 수정

```http
PATCH /jobs/:id
Content-Type: application/json

{
  "title": "수정된 제목",
  "description": "수정된 설명"
}
```

수정 가능한 필드는 `title`, `description`, `status`입니다. 한 필드 이상 전달해야 합니다.

| 현재 상태 | 변경할 상태 | 허용 여부 | 의도 |
|---|---|---:|---|
| `pending` | `cancelled` | 허용 | 사용자가 처리 전 작업 취소 |
| `failed` | `pending` | 허용 | 실패 작업 수동 재시도 |
| 그 외 상태 전이 |  | 거절 | 처리 상태를 API가 임의 조작하지 못하게 함 |

제목과 설명은 아직 실행되지 않은 `pending` 작업에서만 수정할 수 있습니다. 스케줄러가 작업을 `processing`으로 선점한 뒤 들어온 수정 요청은 `409 Conflict`로 거절합니다. 상태 확인과 수정·저장을 같은 Repository 잠금 안에서 수행하므로 확인과 저장 사이의 경쟁 상태가 없습니다.

## 오류 응답

모든 오류는 동일한 형태로 반환합니다.

```json
{
  "statusCode": 409,
  "code": "INVALID_STATUS_TRANSITION",
  "message": "pending에서 completed(으)로 상태를 변경할 수 없습니다.",
  "path": "/jobs/73a73fa7-3377-43d8-8db5-20e5eb77968f",
  "timestamp": "2026-08-05T01:00:00.000Z"
}
```

DTO 검증 오류에는 개별 원인을 `errors` 배열로 추가합니다.

| HTTP 상태 | 대표 코드 | 상황 |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | DTO 또는 쿼리 형식 오류 |
| 400 | `EMPTY_UPDATE` | 수정 필드 없음 |
| 400 | `SEARCH_CONDITION_REQUIRED` | 검색 조건 없음 |
| 404 | `JOB_NOT_FOUND` | 작업 없음 |
| 409 | `JOB_NOT_EDITABLE` | 현재 상태에서 내용 수정 불가 |
| 409 | `INVALID_STATUS_TRANSITION` | 허용하지 않은 상태 전이 |
| 500 | `INTERNAL_SERVER_ERROR` | 예상하지 못한 서버 오류 |

## 스케줄러

기본적으로 10초마다 생성 시간이 오래된 `pending` 작업을 최대 5개 처리합니다.

```text
pending ──선점──> processing ──성공──> completed
                              └─실패──> failed

pending ──API──> cancelled
failed  ──API──> pending
```

한 작업의 실패가 나머지 배치를 중단하지 않도록 작업별로 오류를 격리합니다. 실제 처리는 Repository 잠금 밖에서 순차적으로 진행되므로 느린 작업이 API의 파일 접근을 계속 막지 않습니다.

스케줄러 실행, 선점, 완료, 실패와 배치 집계 결과는 `logs.txt`에 JSON Lines 형식으로 기록됩니다.

```json
{"timestamp":"2026-08-05T01:00:00.000Z","event":"job.completed","jobId":"...","attempt":1}
```

## 동시성과 데이터 무결성

### API와 스케줄러의 동시 접근

Node.js가 단일 스레드여도 비동기 파일 I/O의 `await` 사이에 다른 요청이 실행될 수 있습니다. 두 요청이 같은 이전 배열을 읽은 뒤 각각 저장하면 마지막 저장이 앞선 변경을 덮어쓸 수 있습니다.

이를 막기 위해 singleton `JobsRepository`가 하나의 `async-mutex`를 소유하고, 모든 파일 연산을 이 Repository로 제한했습니다.

```text
POST/PATCH 요청 ─┐
GET 요청 ────────┼─ 같은 mutex ─ 읽기 → 조건 확인 → 변경 → 저장
Scheduler ───────┘
```

잠금은 저장 시점에만 잡는 것이 아니라 **읽기 → 조건 확인 → 변경 → 저장 전체**를 감쌉니다. 조회도 일관된 스냅샷을 반환하도록 같은 잠금을 통과하고 반환값은 복제해 외부 변경이 내부 데이터에 영향을 주지 않게 했습니다.

### 작업 선점

스케줄러는 작업을 조회한 뒤 바로 실행하지 않습니다. mutex 안에서 대상 작업을 선택하고 `processing` 상태, 고유 `claimToken`, `leaseUntil`을 함께 저장한 뒤 잠금을 해제합니다. 겹쳐 실행된 다음 스케줄러는 이미 `processing`인 작업을 선택하지 않습니다.

완료·실패 저장 시에도 현재 `claimToken`이 처음 선점한 토큰과 같은지 확인합니다. lease가 만료되어 다른 실행자가 재선점했다면 이전 실행자의 늦은 완료 결과는 거절됩니다. 같은 프로세스에서 이전 cron이 아직 실행 중인 경우에는 scheduler-level guard로 새 tick도 건너뜁니다.

### 보장 범위와 다중 Pod

현재 구현이 보장하는 범위는 **하나의 NestJS 프로세스 내부**입니다. `node-json-db`라는 과제 조건과 파일 저장소 특성상 다음 환경은 지원하지 않습니다.

- 여러 Pod가 각자의 로컬 `jobs.json`을 가지는 구성: 데이터 자체가 분리됨
- 여러 Pod가 공유 볼륨의 `jobs.json`을 수정하는 구성: mutex가 프로세스별로 달라 lost update 및 파일 손상 가능
- 저장 도중 프로세스가 강제 종료되는 상황: `node-json-db`는 임시 파일 교체 방식의 원자적 저장을 보장하지 않음

다중 Pod로 확장할 때는 Repository 구현을 PostgreSQL로 교체하고 다음 트랜잭션 패턴을 사용합니다.

```sql
BEGIN;

WITH picked AS (
  SELECT id
  FROM jobs
  WHERE status = 'pending'
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 10
)
UPDATE jobs
SET status = 'processing',
    worker_id = $1,
    claim_token = $2,
    lease_until = NOW() + INTERVAL '5 minutes'
WHERE id IN (SELECT id FROM picked)
RETURNING *;

COMMIT;
```

여러 scheduler Pod가 동시에 실행돼도 다른 트랜잭션이 선점한 행은 건너뜁니다. 완료 UPDATE에는 `id`, `processing` 상태, `claim_token` 조건을 함께 넣어 오래된 worker가 새 선점을 덮어쓰지 못하게 합니다.

처리량이 더 커지면 API가 DB에 작업을 저장하고, outbox/dispatcher가 BullMQ·Kafka 같은 큐에 발행하며, 여러 worker Pod가 소비하도록 분리할 수 있습니다. 이 경우에도 적어도 한 번 전달될 수 있다고 보고 작업별 idempotency key를 사용해야 합니다.

## 로깅

모든 HTTP 응답 완료 시 다음 항목을 `logs.txt`에 남깁니다.

```json
{"timestamp":"2026-08-05T01:00:00.000Z","event":"http.request","method":"POST","path":"/jobs","statusCode":201,"durationMs":4.12}
```

로그 파일 쓰기는 하나의 Promise queue로 순서를 보존합니다. 로깅 I/O 때문에 요청을 불필요하게 직렬화하지 않도록 응답 완료 후 비동기로 기록하며, 애플리케이션 정상 종료 시 남은 쓰기를 기다립니다. 요청 본문은 개인정보나 민감 정보 유출 가능성이 있어 기록하지 않습니다.

운영 환경에서는 파일 로깅 대신 stdout에 구조화 로그를 출력하고 수집기에서 중앙화·rotation하는 구성이 적합합니다.

## 테스트

```bash
# 전체 단위 테스트와 API e2e 테스트를 한 번 실행
npm test

# 파일 변경을 감지해 관련 테스트 반복 실행
npm run test:watch

# API e2e 테스트만 실행
npm run test:e2e

# 전체 테스트와 커버리지 검증
npm run test:cov
```

테스트는 운영 `jobs.json`을 건드리지 않고 OS 임시 디렉터리에 독립된 JSON 및 로그 파일을 생성합니다.

현재 검증 결과는 다음과 같습니다.

| 항목 | 결과 |
|---|---:|
| 테스트 스위트 | 9개 통과 |
| 테스트 케이스 | 46개 통과 |
| Statements | 100% |
| Branches | 100% |
| Functions | 100% |
| Lines | 100% |

`jest.config.json`의 global coverage threshold를 네 지표 모두 100%로 설정했습니다. 이후 미검증 코드가 추가되어 한 지표라도 100% 아래로 내려가면 `npm run test:cov`가 실패합니다.

커버리지는 실행 로직이 있는 Controller, Service, Repository, Scheduler, Processor, 전역 오류 처리 및 로깅 계층을 대상으로 합니다. 애플리케이션 bootstrap인 `main.ts`, 선언적 Nest module wiring, 검증 decorator만 선언하는 DTO와 TypeScript 모델 선언은 집계에서 제외했습니다. DTO 검증과 module wiring 자체는 실제 `AppModule`을 기동하는 e2e 테스트에서 검증합니다.

검증하는 주요 시나리오는 다음과 같습니다.

- 생성, 목록, 검색, 단일 조회, 수정 API
- DTO whitelist와 일관된 400/404/409 오류 응답
- 허용·거절 상태 전이
- 모든 HTTP 요청 로그 생성
- 50개 동시 생성 시 데이터 유실 없음
- 겹친 선점 요청 사이의 작업 ID 중복 없음
- lease 만료 후 재선점 및 오래된 claim token 거절
- 작업별 성공·실패 격리
- 이전 스케줄 실행과 겹친 tick 건너뛰기
- 스케줄러 비활성 설정과 저장소 장애 전파
- stale claim의 성공·실패 결과 덮어쓰기 방지
- 로그 파일 쓰기 실패 격리와 다음 로그 복구
- 손상된 JSON 루트 감지
- 실패 작업 재시도 시 처리 메타데이터 초기화

## 프로젝트 구조

```text
src/
├── common/
│   ├── errors/                 # 전역 HTTP 오류 응답
│   └── logging/                # 파일 로그와 요청 interceptor
├── jobs/
│   ├── dto/                    # 요청 검증
│   ├── job-processor.ts        # 교체 가능한 실제 처리 경계
│   ├── jobs.controller.ts      # HTTP 계층
│   ├── jobs.service.ts         # 상태 전이 및 비즈니스 규칙
│   ├── jobs.repository.ts      # JSON 접근과 원자적 임계 구역
│   └── jobs.scheduler.ts       # 배치 선점과 처리 조율
└── main.ts
```

Controller는 HTTP 변환, Service는 상태 규칙, Repository는 영속화와 동시성, Scheduler는 실행 조율만 담당하게 분리했습니다. 따라서 HTTP 규칙을 변경하지 않고 저장소나 처리 방식을 교체할 수 있습니다.

## 설계하면서 고민한 지점

### 파일 잠금을 실제 처리 전체에 유지하지 않음

처음 검토한 가장 단순한 방식은 작업 조회부터 완료까지 mutex 하나로 감싸는 것이었습니다. 구현은 쉽지만 외부 API나 긴 작업을 수행하는 동안 모든 HTTP 조회·수정이 멈춥니다. 그래서 잠금 안에서는 선점 상태 저장만 끝내고, 실제 처리는 잠금 밖에서 수행하는 2단계 방식으로 결정했습니다.

### 상태를 자유롭게 PATCH하지 않음

CRUD만 생각하면 모든 상태를 클라이언트가 변경하게 만들 수 있습니다. 그러나 클라이언트가 `completed`를 직접 기록하면 실제 처리 결과와 데이터가 달라집니다. 외부 변경은 취소와 실패 재시도로 제한하고 `processing`, `completed`, `failed`는 scheduler가 관리하게 했습니다.

### 목록 필터와 검색 엔드포인트를 합치지 않음

REST 관점에서는 `/jobs?title=...&status=...` 하나로 합치는 것이 자연스럽지만, 요구된 `/jobs/search` 동작을 명확히 제공하기 위해 목록과 검색을 구분했습니다. 두 API의 페이지 응답 구조는 동일하게 유지했습니다.

### 낙관적 락보다 단일 mutex 선택

`version` 필드와 재시도 기반 낙관적 락도 고려할 수 있지만, 단일 프로세스·단일 파일이라는 현재 제약에서는 모든 파일 접근을 Repository로 모으는 mutex가 더 단순하고 검증 가능합니다. DB로 전환할 때는 row lock이나 조건부 UPDATE가 적합합니다.

## 성능과 남은 한계

`node-json-db`는 변경 시 전체 JSON 문서를 직렬화하여 저장합니다. 현재 검색과 페이지네이션도 전체 작업을 메모리에 읽은 뒤 수행하므로 읽기·쓰기 비용은 작업 수에 비례하며, 대용량 데이터나 높은 요청량에는 적합하지 않습니다. batch size는 한 번의 처리량과 API 응답 지연 사이의 균형을 위해 보수적으로 5개로 두었고 환경 변수로 조정할 수 있게 했습니다.

시간이 더 있다면 다음 순서로 개선하겠습니다.

1. PostgreSQL Repository와 `FOR UPDATE SKIP LOCKED` 기반 분산 선점
2. outbox와 작업 큐를 이용한 API·worker 분리
3. 재시도 횟수·지수 백오프·dead-letter 상태 추가
4. 종료 신호 수신 시 진행 중 작업을 기다리는 graceful shutdown 강화
5. OpenAPI 문서와 컨테이너·CI 파이프라인 추가
6. 구조화 로그의 중앙 수집과 보존 주기 설정

현재 범위에서는 필수 저장 기술을 지키면서 단일 프로세스 안의 동시 요청 및 스케줄 실행에 의한 데이터 유실을 방지하는 데 우선순위를 두었습니다.
