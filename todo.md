# 📋 Ez-HealthCare API — TODO & Codex Task Plan

> Kế hoạch triển khai nâng cấp hệ thống API theo 3 đợt (Wave) với 8 task độc lập, self-contained, sẵn sàng copy prompt để giao cho Codex hoặc AI agent thực hiện.

---

## 📌 Master Checklist

### Đợt 1 — Bug Fix Cốt lõi (Critical Fixes)

- [x] **Task 1: Visit State Machine Guard** (Ngăn chặn nhảy trạng thái bất hợp lệ)
- [x] **Task 2: Database Transactions cho Critical Operations** (Xử lý race condition, atomic writes)
- [x] **Task 3: Sửa Allergy Check Logic & Digital Signature** (Cross-check nhóm thuốc & HMAC-SHA256)

### Đợt 2 — Feature Y khoa Thực tế (Clinical Features)

- [x] **Task 4: Bổ sung Weight/Height & Tự động tính NEWS2 Score** (National Early Warning Score)
- [x] **Task 5: Xây dựng Module Audit Trail** (Ghi log toàn bộ thao tác lâm sàng)
- [x] **Task 6: Timezone Fix UTC+7** (Chuẩn hóa tính ngày làm việc theo giờ Việt Nam)

### Đợt 3 — Migration & Kiểm thử (Database & Testing)

- [x] **Task 7: TypeORM Migration** (Migration cho `VisitVital` columns & bảng `audit_logs`)
- [x] **Task 8: Unit Tests** (Kiểm thử State Machine & NEWS2 Calculator)

---

## 🚀 Lộ trình thực thi tối ưu (Parallelization Plan)

```
Lượt 1: Task 1 + Task 3 (chạy song song)
Lượt 2: Task 2 (sau khi Task 1 hoàn thành)
Lượt 3: Task 4 + Task 5 + Task 6 (chạy song song sau Đợt 1)
Lượt 4: Task 7 (sau khi Task 4, 5 hoàn thành entity)
Lượt 5: Task 8 (sau khi code & migration sẵn sàng)
```

> **Quy tắc bắt buộc**: Sau mỗi task, luôn chạy `npx tsc --noEmit` để đảm bảo compile sạch 100% trước khi chuyển sang task kế tiếp.

---

## CHI TIẾT TỪNG TASK CHO CODEX

---

### [x] Task 1: Visit State Machine Guard

- **Mục tiêu**: Đảm bảo quy trình khám bệnh tuân thủ đúng thứ tự, không cho phép nhảy cóc trạng thái.
- **Dependency**: Không (Chạy đầu tiên hoặc song song với Task 3).
- **Files sửa/tạo**:
  - `[NEW]` `src/visit/visit-state-machine.ts`
  - `[MODIFY]` `src/visit/visit.service.ts`
  - `[MODIFY]` `src/triage/triage-dag.service.ts`
- **Lệnh verify**: `npx tsc --noEmit`

#### Acceptance Criteria

- [x] Tạo `src/visit/visit-state-machine.ts` chứa bảng ma trận `VALID_TRANSITIONS` và hàm `assertTransition()`.
- [x] Ném `ConflictException` với thông báo chi tiết khi chuyển trạng thái sai.
- [x] Thêm guard call vào các method trong `visit.service.ts`: `verifyVisit`, `rejectVerification`, `assignClinic`, `recordVitalSigns`, `callPatient`, `transferClinic`, `concludeVisit`, `emergencyDispatch`.
- [x] Thêm guard call vào `processClinicalOrders` trong `triage-dag.service.ts`.
- [x] `npx tsc --noEmit` không có lỗi.

<details>
<summary><b>📄 Prompt copy cho Codex (Click để mở)</b></summary>

````markdown
You are working on a NestJS 12 + TypeScript healthcare API project.

## Context

The Visit entity has a `status` field using the `VisitStatus` enum defined in `src/visit/enums/visit-status.enum.ts`:

```typescript
export enum VisitStatus {
  HALL_WAITING = 'HALL_WAITING',
  RECEPTION_VERIFIED = 'RECEPTION_VERIFIED',
  TRIAGE_PENDING = 'TRIAGE_PENDING',
  CLINIC_WAITING = 'CLINIC_WAITING',
  IN_EXAMINATION = 'IN_EXAMINATION',
  PARACLINICAL_PENDING = 'PARACLINICAL_PENDING',
  RE_EXAM_CALLING = 'RE_EXAM_CALLING',
  COMPLETED = 'COMPLETED',
  EMERGENCY_DISPATCHED = 'EMERGENCY_DISPATCHED',
  CANCELLED = 'CANCELLED',
}
```
````

Currently, `src/visit/visit.service.ts` does NOT validate that a visit is in the correct status before transitioning. For example, `callPatient()` can be called when the visit is still HALL_WAITING, and `concludeVisit()` can be called when the visit is TRIAGE_PENDING.

## Task

1. Create a new file `src/visit/visit-state-machine.ts` containing:
   - A `VALID_TRANSITIONS` constant: a `Record<VisitStatus, VisitStatus[]>` mapping each status to its allowed target statuses:
     - HALL_WAITING → [RECEPTION_VERIFIED, CANCELLED]
     - RECEPTION_VERIFIED → [TRIAGE_PENDING, CANCELLED]
     - TRIAGE_PENDING → [CLINIC_WAITING, EMERGENCY_DISPATCHED]
     - CLINIC_WAITING → [IN_EXAMINATION, EMERGENCY_DISPATCHED]
     - IN_EXAMINATION → [PARACLINICAL_PENDING, CLINIC_WAITING, COMPLETED, EMERGENCY_DISPATCHED]
     - PARACLINICAL_PENDING → [RE_EXAM_CALLING, EMERGENCY_DISPATCHED]
     - RE_EXAM_CALLING → [IN_EXAMINATION]
     - COMPLETED → [] (terminal)
     - EMERGENCY_DISPATCHED → [] (terminal)
     - CANCELLED → [] (terminal)
   - An exported function `assertTransition(currentStatus: VisitStatus, targetStatus: VisitStatus): void` that throws a NestJS `ConflictException` with a descriptive message if the transition is not in `VALID_TRANSITIONS`. The error message must include both current and target statuses, and list allowed targets.

2. Modify `src/visit/visit.service.ts`:
   - Import `assertTransition` from `./visit-state-machine`
   - Add `assertTransition(visit.status, VisitStatus.XXX)` call at the beginning of each method, AFTER fetching the visit but BEFORE any mutation. Apply to:
     - `verifyVisit()`: assert transition to RECEPTION_VERIFIED (if nationalIdVerified is false, assert CANCELLED)
     - `rejectVerification()`: assert transition to CANCELLED
     - `assignClinic()`: assert transition to TRIAGE_PENDING
     - `recordVitalSigns()`: assert transition to CLINIC_WAITING (or EMERGENCY_DISPATCHED if red flag)
     - `callPatient()`: assert transition to IN_EXAMINATION
     - `transferClinic()`: assert transition to CLINIC_WAITING
     - `concludeVisit()`: assert transition to COMPLETED
     - `emergencyDispatch()`: assert transition to EMERGENCY_DISPATCHED

3. Modify `src/triage/triage-dag.service.ts`:
   - Import `assertTransition` from `../visit/visit-state-machine`
   - In `processClinicalOrders()`, after fetching the visit, assert transition to PARACLINICAL_PENDING (non-STAT) or EMERGENCY_DISPATCHED (STAT).

Do NOT modify any entity files, enums, DTOs, controllers, or module files.
Preserve all existing comments, formatting, and business logic.

## Verification

Run: `npx tsc --noEmit` — must compile with zero errors.

````
</details>

---

### [x] Task 2: Database Transactions cho Critical Operations

- **Mục tiêu**: Xử lý triệt để race conditions khi tạo ticket, cấp quota phòng khám và xuất viện / kê đơn.
- **Dependency**: Task 1.
- **Files sửa/tạo**:
  - `[MODIFY]` `src/visit/visit.service.ts`
- **Lệnh verify**: `npx tsc --noEmit`

#### Acceptance Criteria
- [x] Inject TypeORM `DataSource` vào constructor của `VisitService`.
- [x] Bọc `createHallTicket()` trong transaction (`dataSource.transaction`).
- [x] Bọc `assignClinic()` trong transaction (kiểm tra quota và tăng count atomic).
- [x] Bọc `concludeVisit()` trong transaction (lưu prescription + items + đổi status atomic).
- [x] `npx tsc --noEmit` không có lỗi.

<details>
<summary><b>📄 Prompt copy cho Codex (Click để mở)</b></summary>

```markdown
You are working on a NestJS 12 + TypeScript + TypeORM healthcare API.

## Context
`src/visit/visit.service.ts` has multiple methods that perform read-check-write sequences without database transactions, causing race conditions:
- `createHallTicket()`: counts today's visits then generates sequential number — concurrent calls produce duplicate tickets.
- `assignClinic()`: checks quota then assigns — concurrent calls exceed room capacity.
- `concludeVisit()`: writes prescription + items + status updates — partial failures lead to corrupt clinical dossiers.

## Task

1. Inject TypeORM `DataSource` into `VisitService` constructor:
   ```typescript
   import { DataSource } from 'typeorm';
   constructor(
     // ... existing repos ...
     private readonly dataSource: DataSource,
   ) {}
````

2. Wrap these three methods in explicit transactions using `this.dataSource.transaction(async (manager) => { ... })`:
   - `createHallTicket()`: Replace repo calls inside with `manager.getRepository(Entity)`. Ensure count + ticket generation is atomic.
   - `assignClinic()`: Replace repo calls inside with `manager.getRepository(Entity)`. Ensure quota count + visit update is atomic.
   - `concludeVisit()`: Replace repo calls inside with `manager.getRepository(Entity)`. Ensure prescription create + items delete/create + visit status update is atomic.

3. Keep non-compound methods (`verifyVisit`, `callPatient`, etc.) unchanged.
4. Preserve all existing business logic, comments, and state machine guards.

## Verification

Run: `npx tsc --noEmit` — must compile with zero errors.

````
</details>

---

### [x] Task 3: Fix Allergy Check Logic & Digital Signature

- **Mục tiêu**: Chặn sai/sót dị ứng thuốc (cross-class allergy) và tạo chữ ký số HMAC-SHA256 chuẩn hóa cho đơn thuốc điện tử.
- **Dependency**: Không (Chạy độc lập hoặc song song Task 1).
- **Files sửa/tạo**:
  - `[MODIFY]` `src/visit/visit.service.ts`
- **Lệnh verify**: `npx tsc --noEmit`

#### Acceptance Criteria
- [x] Thêm hằng số `DRUG_CLASS_MAP` định nghĩa nhóm thuốc (Penicillin, Sulfa, NSAID, Cephalosporin, Fluoroquinolone).
- [x] Viết hàm `checkAllergyConflict()` hỗ trợ exact match và drug class mapping 2 chiều.
- [x] Thay thế vòng lặp `.includes()` cũ trong `concludeVisit()` bằng `checkAllergyConflict()`.
- [x] Thay thế signature giả `SIG_...` bằng HMAC-SHA256 dùng `crypto.createHmac`.
- [x] `npx tsc --noEmit` không có lỗi.

<details>
<summary><b>📄 Prompt copy cho Codex (Click để mở)</b></summary>

```markdown
You are working on a NestJS 12 + TypeScript healthcare API.

## Context
In `src/visit/visit.service.ts`, `concludeVisit()` has two critical clinical safety flaws:
1. Allergy check uses dangerous substring matching (`.includes()`), blocking safe drugs or missing class-wide allergies (e.g. Penicillin vs Amoxicillin).
2. Digital signature is merely string concatenation (`SIG_${doctorId}_${Date.now()}`).

## Task

1. Add `DRUG_CLASS_MAP` constant before `VisitService` class:
   ```typescript
   const DRUG_CLASS_MAP: Record<string, string[]> = {
     'penicillin': ['amoxicillin', 'ampicillin', 'oxacillin', 'piperacillin', 'nafcillin', 'dicloxacillin'],
     'sulfa': ['sulfamethoxazole', 'sulfasalazine', 'sulfadiazine', 'sulfacetamide'],
     'nsaid': ['aspirin', 'ibuprofen', 'naproxen', 'diclofenac', 'ketorolac', 'piroxicam', 'meloxicam'],
     'cephalosporin': ['cefazolin', 'cephalexin', 'ceftriaxone', 'cefepime', 'cefuroxime'],
     'fluoroquinolone': ['ciprofloxacin', 'levofloxacin', 'moxifloxacin', 'ofloxacin'],
   };
````

2. Add helper function `checkAllergyConflict(medicationName: string, patientAllergies: string[]): string | null`:
   - Exact match check (case-insensitive).
   - Drug class match check: if allergy matches class key and medication is in the list, or vice versa.
   - Return conflicting allergy string or null.

3. Replace substring allergy check in `concludeVisit()` with:

   ```typescript
   if (dto.items && dto.items.length > 0) {
     for (const item of dto.items) {
       const conflict = checkAllergyConflict(item.medicationName, patientAllergies);
       if (conflict) {
         throw new UnprocessableEntityException(
           `ALLERGY SAFETY WARNING: Patient has documented allergy to ${conflict}. ` +
             `Medication "${item.medicationName}" is contraindicated. ` +
             `Prescription cannot be signed without override authorization.`,
         );
       }
     }
   }
   ```

4. Replace digital signature assignment with HMAC-SHA256:
   ```typescript
   import { createHmac } from 'crypto';

   const signaturePayload = JSON.stringify({
     doctorId,
     visitId: id,
     icd10Code: dto.icd10Code,
     timestamp: new Date().toISOString(),
   });
   prescription.digitalSignature = createHmac(
     'sha256',
     process.env.SIGNATURE_SECRET || 'ez-healthcare-dev-key',
   )
     .update(signaturePayload)
     .digest('hex');
   ```
   Apply to both create and update branches.

## Verification

Run: `npx tsc --noEmit` — must compile with zero errors.

````
</details>

---

### [x] Task 4: Bổ sung Weight/Height & Tự động tính NEWS2 Score

- **Mục tiêu**: Bổ sung chiều cao, cân nặng vào sinh hiệu và tự động chấm điểm cảnh báo sớm quốc tế NEWS2 (National Early Warning Score).
- **Dependency**: Task 1.
- **Files sửa/tạo**:
  - `[NEW]` `src/visit/news2-calculator.ts`
  - `[MODIFY]` `src/visit/entities/visit-vital.entity.ts`
  - `[MODIFY]` `src/visit/dto/record-vitals.dto.ts`
  - `[MODIFY]` `src/visit/visit.service.ts`
- **Lệnh verify**: `npx tsc --noEmit`

#### Acceptance Criteria
- [x] Thêm `weightKg`, `heightCm`, `news2Score`, `news2Risk` vào entity `VisitVital`.
- [x] Thêm `weightKg`, `heightCm` vào `RecordVitalsDto`.
- [x] Tạo module tính toán thuần `calculateNews2()` trong `src/visit/news2-calculator.ts`.
- [x] Tích hợp tính điểm trong `recordVitalSigns()`, trigger cấp cứu khi `news2.score >= 7`.
- [x] `npx tsc --noEmit` không có lỗi.

> Review 2026-10-11: Task 4 pass; compile và smoke calculator 4/4. Phạm vi năm chỉ số theo TODO, chưa bao gồm oxy bổ sung/ACVPU/SpO2 Scale 2. Task 5 tiếp theo.

<details>
<summary><b>📄 Prompt copy cho Codex (Click để mở)</b></summary>

```markdown
You are working on a NestJS 12 + TypeScript + TypeORM healthcare API.

## Task

### 1. Update `src/visit/entities/visit-vital.entity.ts`:
Add columns:
```typescript
@Column({ type: 'decimal', precision: 5, scale: 1, nullable: true })
weightKg?: number;

@Column({ type: 'decimal', precision: 5, scale: 1, nullable: true })
heightCm?: number;

@Column({ type: 'int', default: 0 })
news2Score: number;

@Column({ type: 'varchar', length: 20, default: 'LOW' })
news2Risk: string; // 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH'
````

### 2. Update `src/visit/dto/record-vitals.dto.ts`:

Add optional Swagger/validation properties:

```typescript
@ApiPropertyOptional({ description: 'Patient weight in kilograms', example: 65.5 })
@IsOptional()
@IsNumber()
@Min(0.5)
@Max(500)
weightKg?: number;

@ApiPropertyOptional({ description: 'Patient height in centimeters', example: 170 })
@IsOptional()
@IsNumber()
@Min(20)
@Max(280)
heightCm?: number;
```

### 3. Create `src/visit/news2-calculator.ts`:

Implement standard NEWS2 scoring algorithm (respiratoryRate, spo2, bloodPressureSystolic, heartRate, temperature) returning `{ score, risk, components }`.

- Score >= 7: 'HIGH' risk.
- Score >= 5 or any single score of 3: 'MEDIUM' risk.
- Score 1-4: 'LOW_MEDIUM' risk.
- Score 0: 'LOW' risk.

### 4. Update `src/visit/visit.service.ts`:

In `recordVitalSigns()`:

- Save `weightKg`, `heightCm`.
- Calculate `calculateNews2(...)` and assign `news2Score`, `news2Risk`.
- Include `news2.score >= 7` in `isRedFlag` emergency trigger.
- Return `news2Score`, `news2Risk`, `news2Components` in response.

## Verification

Run: `npx tsc --noEmit` — must compile with zero errors.

````
</details>

---

### [x] Task 5: Xây dựng Module Audit Trail

- **Mục tiêu**: Lưu vết audit log cho các hành động y tế quan trọng phục vụ pháp lý và truy vết trách nhiệm.
- **Dependency**: Không (Chạy song song Task 4, 6).
- **Files sửa/tạo**:
  - `[NEW]` `src/common/entities/audit-log.entity.ts`
  - `[NEW]` `src/common/audit.service.ts`
  - `[NEW]` `src/common/audit.module.ts`
  - `[MODIFY]` `src/app.module.ts`
  - `[MODIFY]` `src/visit/visit.service.ts`
- **Lệnh verify**: `npx tsc --noEmit`

#### Acceptance Criteria
- [x] Entity `AuditLog` với `action`, `actorId`, `targetEntityType`, `targetEntityId`, `metadata`, `createdAt`.
- [x] `AuditService` có method `log()`, `getByTarget()`, `getByActor()`.
- [x] `AuditModule` đánh dấu `@Global()` và import vào `AppModule`.
- [x] Gọi `auditService.log()` trong 8 method chính của `VisitService`.
- [x] `npx tsc --noEmit` không có lỗi.

> Review 2026-10-12: Task 5 pass; `npx tsc --noEmit` và 34/34 test pass. Đủ 8 hành động audit, không có nhánh ghi log trùng; migration bảng `audit_logs` thuộc Task 7.

<details>
<summary><b>📄 Prompt copy cho Codex (Click để mở)</b></summary>

```markdown
You are working on a NestJS 12 + TypeScript + TypeORM healthcare API.

## Task: Create Global Audit Trail

1. Create `src/common/entities/audit-log.entity.ts` mapping table `audit_logs` with fields: `id (uuid)`, `action (varchar 50)`, `actorId (uuid)`, `actorRole (varchar 50)`, `targetEntityType (varchar 50)`, `targetEntityId (uuid)`, `metadata (jsonb)`, `ipAddress (inet)`, `createdAt (timestamp)`.
2. Create `src/common/audit.service.ts` with `log(entry)`, `getByTarget()`, and `getByActor()`.
3. Create `src/common/audit.module.ts` as `@Global()` module exporting `AuditService`.
4. Register `AuditModule` in `src/app.module.ts`.
5. Inject `AuditService` into `VisitService` and record audit events after successful actions for: `createHallTicket`, `verifyVisit`, `rejectVerification`, `assignClinic`, `recordVitalSigns`, `callPatient`, `concludeVisit`, `emergencyDispatch`.

## Verification
Run: `npx tsc --noEmit` — must compile with zero errors.
````

</details>

---

### [x] Task 6: Timezone Fix (UTC+7)

- **Mục tiêu**: Xử lý tính toán đầu ngày/cuối ngày chuẩn múi giờ Việt Nam (Asia/Ho_Chi_Minh), tránh lỗi reset ca khám khi deploy lên cloud server (UTC).
- **Dependency**: Không.
- **Files sửa/tạo**:
  - `[MODIFY]` `src/visit/visit.service.ts`
- **Lệnh verify**: `npx tsc --noEmit`

#### Acceptance Criteria

- [x] `getTodayBounds()` sử dụng VN offset (+7 tiếng) tính start và end timestamp.
- [x] Không thêm thư viện phụ thuộc bên ngoài.
- [x] `npx tsc --noEmit` không có lỗi.

> Review 2026-10-12: Task 6 pass; diff chỉ thay `getTodayBounds()`, không thêm dependency; `npx tsc --noEmit` và 34/34 test pass.

<details>
<summary><b>📄 Prompt copy cho Codex (Click để mở)</b></summary>

````markdown
You are working on a NestJS 12 + TypeScript healthcare API in Vietnam (UTC+7).

## Task

In `src/visit/visit.service.ts`, replace `getTodayBounds()` with a timezone-aware version without adding external dependencies:

```typescript
private getTodayBounds(): { start: Date; end: Date } {
  const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
  const nowUtc = Date.now();
  const vnNow = new Date(nowUtc + VN_OFFSET_MS);

  const year = vnNow.getUTCFullYear();
  const month = vnNow.getUTCMonth();
  const day = vnNow.getUTCDate();

  const start = new Date(Date.UTC(year, month, day) - VN_OFFSET_MS);
  const end = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - VN_OFFSET_MS);

  return { start, end };
}
```
````

## Verification

Run: `npx tsc --noEmit` — must compile with zero errors.

````
</details>

---

### [x] Task 7: Database Migration

- **Mục tiêu**: Tạo TypeORM migration script cập nhật các cột mới của `VisitVital` và tạo bảng `audit_logs`.
- **Dependency**: Task 4, 5.
- **Files sửa/tạo**:
  - `[NEW]` `src/database/migrations/<timestamp>-AddNews2AndAuditLog.ts`
  - `[MODIFY]` `src/database/data-source.ts` (nếu cần import entity)
- **Lệnh verify**: `npx tsc --noEmit`

#### Acceptance Criteria
- [x] Entity `AuditLog` được đăng ký trong DataSource.
- [x] Migration script có đầy đủ `up()` (thêm cột `weight_kg`, `height_cm`, `news2_score`, `news2_risk`, tạo bảng `audit_logs` + index) và `down()` (rollback sạch).
- [x] `npx tsc --noEmit` không có lỗi.

> Review 2026-10-12: Task 7 pass; migration `1791440000000-AddNews2AndAuditLog.ts` có `up/down` đối xứng, `AuditLog` đã được DataSource glob đăng ký; compile và 34/34 test pass. Không chạy migration lên database.

<details>
<summary><b>📄 Prompt copy cho Codex (Click để mở)</b></summary>

```markdown
You are working on a NestJS 12 + TypeScript + TypeORM project.

## Context
Entities updated:
1. `VisitVital`: added `weightKg`, `heightCm`, `news2Score`, `news2Risk`.
2. `AuditLog`: new entity created in `src/common/entities/audit-log.entity.ts`.

## Task
1. Make sure `AuditLog` entity is included in `src/database/data-source.ts`.
2. Create migration file `src/database/migrations/1728660000000-AddNews2AndAuditLog.ts`:
   - `up()`:
     - ALTER TABLE visit_vitals ADD COLUMN weight_kg DECIMAL(5,1) NULL;
     - ALTER TABLE visit_vitals ADD COLUMN height_cm DECIMAL(5,1) NULL;
     - ALTER TABLE visit_vitals ADD COLUMN news2_score INT DEFAULT 0;
     - ALTER TABLE visit_vitals ADD COLUMN news2_risk VARCHAR(20) DEFAULT 'LOW';
     - CREATE TABLE audit_logs (...);
     - CREATE INDEX idx_audit_logs_action ON audit_logs(action);
     - CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
     - CREATE INDEX idx_audit_logs_target ON audit_logs(target_entity_id);
   - `down()`:
     - DROP TABLE audit_logs;
     - ALTER TABLE visit_vitals DROP COLUMN news2_risk, DROP COLUMN news2_score, DROP COLUMN height_cm, DROP COLUMN weight_kg;

## Verification
Run: `npx tsc --noEmit` — must compile with zero errors.
````

</details>

---

### [x] Task 8: Unit Tests

- **Mục tiêu**: Viết unit test tự động kiểm tra toàn bộ nhánh của State Machine và thuật toán NEWS2 score.
- **Dependency**: Task 1, 4.
- **Files sửa/tạo**:
  - `[NEW]` `src/visit/visit-state-machine.spec.ts`
  - `[NEW]` `src/visit/news2-calculator.spec.ts`
- **Lệnh verify**: `npm test` hoặc `npx jest --testPathPattern="(state-machine|news2)"`

#### Acceptance Criteria

- [x] Test cases cho State Machine: kiểm tra tất cả transition hợp lệ và các trường hợp nhảy cóc ném ConflictException.
- [x] Test cases cho NEWS2 Calculator: Normal (0, LOW), Borderline (LOW_MEDIUM), High (>=7, HIGH), Single 3 trigger (MEDIUM).
- [x] Tất cả unit tests pass 100%.

> Review 2026-10-12: Task 8 pass; 149 test mới cho toàn bộ ma trận State Machine và các ngưỡng/risk branch NEWS2. Targeted 149/149, full suite 183/183, compile và Prettier check đều pass.

<details>
<summary><b>📄 Prompt copy cho Codex (Click để mở)</b></summary>

```markdown
You are working on a NestJS 12 + TypeScript project with Jest.

## Task

Create unit tests for the newly added pure logic modules:

1. `src/visit/visit-state-machine.spec.ts`:
   - Test `assertTransition()` for all valid state transitions.
   - Test invalid state transitions (e.g. HALL_WAITING -> IN_EXAMINATION, TRIAGE_PENDING -> COMPLETED, terminal state mutations) expecting `ConflictException`.
   - Verify exception message content.

2. `src/visit/news2-calculator.spec.ts`:
   - Normal values -> score 0, 'LOW'.
   - Mildly abnormal -> score 1-4, 'LOW_MEDIUM'.
   - Single vital with sub-score 3 -> risk 'MEDIUM'.
   - Critical vitals -> score >= 7, 'HIGH'.
   - Verify individual component scoring.

## Verification

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern="(state-machine|news2)" --no-coverage`
All tests must pass.
```

</details>
