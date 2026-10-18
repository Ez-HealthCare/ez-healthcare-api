# 🧪 EZ-HEALTHCARE SYSTEM — HAPPY & UNHAPPY SCENARIOS SPECIFICATION

> **Document Purpose:** Comprehensive test scenario specification covering both standard workflows (Happy Path) and all boundary, validation, failure, and edge cases (Unhappy Path).
> **Target Branch:** `repair`
> **Reference Documents:** [IMPLEMENTATION_PLAN.md](file:///c:/TLCN/codebase/api/IMPLEMENTATION_PLAN.md) | [USE_CASE_SPECIFICATION](file:///c:/TLCN/codebase/api/%C4%90%E1%BA%B6C%20T%E1%BA%A2%20USE%20CASE.md)
> **Language Standard:** **Strictly English** for all test names, assertions, error codes, and validation messages.

---

## 📑 TABLE OF CONTENTS

1. [Module 1: Patient Authentication & Staff RBAC](#1-module-1-patient-authentication--staff-rbac)
2. [Module 2: Pre-Triage, Check-in & Reception](#2-module-2-pre-triage-check-in--reception)
3. [Module 3: Nurse Screening, Vital Signs & Emergency STAT](#3-module-3-nurse-screening-vital-signs--emergency-stat)
4. [Module 4: Doctor Clinical Consultation & Kahn DAG Orders](#4-module-4-doctor-clinical-consultation--kahn-dag-orders)
5. [Module 5: Paraclinical Stations (Lab/PACS) & Priority Recall](#5-module-5-paraclinical-stations-labpacs--priority-recall)
6. [Module 6: Final Diagnosis, Prescription & Discharge](#6-module-6-final-diagnosis-prescription--discharge)
7. [Module 7: Dynamic Route Optimization & WebSocket Events](#7-module-7-dynamic-route-optimization--websocket-events)
8. [Module 8: System Governance, Catalogs & Schedules](#8-module-8-system-governance-catalogs--schedules)

---

## 1. MODULE 1: PATIENT AUTHENTICATION & STAFF RBAC

_(Covers UC-PAT-01, UC-ADM-03)_

### 1.1. Happy Path Scenarios

#### `TC-AUTH-01`: Patient Email OTP Registration & Login

- **Description:** Patient inputs a valid email address, receives a 6-digit OTP, enters it successfully, and receives an authentication session.
- **Pre-conditions:** Patient device connected to the internet.
- **Steps:**
  1. `POST /auth/patient/request-otp` with body `{ "email": "patient.john@example.com" }`.
  2. System delivers a random OTP through the configured mail send API, stores only its hash, and sets expiration to +5 minutes. Docker tests read the email from Mailpit; the API never returns or logs the code.
  3. Patient submits `POST /auth/patient/verify-otp` with body `{ "email": "patient.john@example.com", "otpCode": "123456" }`.
- **Expected Result:**
  - Status code: `200 OK`.
  - API response contains `{ "accessToken": string, "expiresIn": 900 }` plus HttpOnly access/refresh cookies. The dashboard proxy removes the token from its JSON response.
  - `GET /auth/me` with the session cookie returns the patient's identity and `role: "PATIENT"`, without a password.
  - Database: User record created if non-existent; OTP marked `isUsed = true`.

#### `TC-AUTH-02`: Healthcare Staff Login and Role Identification

- **Description:** Staff member (Doctor, Nurse, Receptionist, Lab Tech, Admin) logs in with valid email and password.
- **Steps:**
  1. `POST /auth/staff/login` with credentials `{ "email": "dr.smith@ezhealthcare.com", "password": "Doctor@123456" }`.
- **Expected Result:**
  - Status code: `200 OK`.
  - API response contains a JWT access token and expiry; the refresh token is only sent in an HttpOnly cookie.
  - `GET /auth/me` returns the actual staff role. Test ADMIN, DOCTOR, NURSE, RECEPTIONIST, LAB_TECHNICIAN, and EMERGENCY_STAFF.
  - The dashboard currently accepts every authenticated role and shows the real identity. Feature-level permissions and separate role workspaces are deferred.

#### `TC-AUTH-03`: Session Restoration, Rotation and Logout

- `POST /auth/refresh` uses the HttpOnly refresh cookie, rotates it, and renews the 15-minute access token. Reusing the previous refresh token returns `401`.
- `rememberMe: false` creates a browser-session refresh cookie with an 8-hour server limit; `true` persists the cookie for up to 30 days.
- Cookies use HttpOnly and SameSite=Lax, plus Secure in production. No tokens are stored in localStorage.
- `POST /auth/logout` revokes the session and clears cookies. Both access and refresh tokens for that session must then be rejected.
- Expired access tokens return `401`; a valid refresh cookie restores the dashboard session.
- CORS credentials are limited to configured origins; auth mutations from foreign origins return `403`.
- Runnable checks: real `AuthService` unit tests in this repo; `npm run test:auth` and the Chromium Docker test profile in `../dashboard`.

---

### 1.2. Unhappy & Edge Scenarios

#### `TC-AUTH-ERR-01`: Invalid Email Format

- **Trigger:** Patient inputs invalid email (e.g., `invalid-email-format`).
- **Expected Result:**
  - Status code: `400 Bad Request`.
  - Response body: `{ "statusCode": 400, "message": ["email must be an email"], "error": "Bad Request" }`.

#### `TC-AUTH-ERR-02`: Incorrect OTP Submission (< 3 attempts)

- **Trigger:** Patient enters wrong OTP code (e.g., `999999` instead of `123456`).
- **Expected Result:**
  - Status code: `400 Bad Request`.
  - Response message: `Invalid OTP code.`
  - Database: `failedAttempts` incremented to `1`.

#### `TC-AUTH-ERR-03`: Exceeded Failed Attempts — 15-Minute Account Lockout

- **Trigger:** Patient enters wrong OTP code 3 consecutive times.
- **Expected Result:**
  - Status code: `429 Too Many Requests`.
  - Response message indicates too many failed attempts and a 15-minute wait.
  - Database: `lockedUntil` set to `NOW() + 15 minutes`. Any subsequent OTP request within this window returns `429`.

#### `TC-AUTH-ERR-04`: Expired OTP Code Submission

- **Trigger:** Patient submits correct OTP after expiration time (> 5 minutes).
- **Expected Result:**
  - Status code: `400 Bad Request`.
  - Response message: `OTP has expired.`

#### `TC-AUTH-ERR-05`: Unauthorized Route Access (Missing Token)

- **Trigger:** Unauthenticated request to protected endpoint (e.g., `GET /visits/today`).
- **Expected Result:**
  - Status code: `401 Unauthorized`.
  - Response body: `{ "statusCode": 401, "message": "Unauthorized" }`.

#### `TC-AUTH-ERR-06`: Forbidden Resource (Role Mismatch)

- **Trigger:** A user with role `NURSE` attempts to conclude a consultation via `POST /visits/:id/conclusion`.
- **Expected Result:**
  - Status code: `403 Forbidden`.
  - Response body: `{ "statusCode": 403, "message": "Forbidden resource: Requires DOCTOR role", "error": "Forbidden" }`.

---

## 2. MODULE 2: PRE-TRIAGE, CHECK-IN & RECEPTION

_(Covers UC-PAT-02, UC-PAT-07, UC-REC-01, UC-REC-02, UC-REC-03)_

### 2.1. Happy Path Scenarios

#### `TC-REC-01`: Standard Patient Check-in & Hall Ticket Issuance

- **Description:** Patient self-reports symptoms on the Web Portal and takes Hall Ticket `A-xxx`.
- **Steps:**
  1. `POST /visits/hall-ticket` with demographic payload `{ "name": "Alice Brown", "nationalId": "079123456789", "dateOfBirth": "1990-05-15", "gender": "FEMALE", "chiefComplaint": "Headache and mild fever", "symptomSeverity": "MILD" }`.
- **Expected Result:**
  - Status code: `201 Created`.
  - Returns `{ "visitId": UUID, "hallTicketNumber": "A-001", "status": "HALL_WAITING" }`.

#### `TC-REC-02`: Reception Identity Verification & Clinic Ticket Dispatch

- **Description:** Receptionist calls `A-001`, audits physical ID & insurance card, and assigns specialty clinic ticket.
- **Steps:**
  1. Receptionist calls `PUT /visits/:id/verify` with `{ "nationalIdVerified": true, "insuranceCardNumber": "DN4791234567890" }`.
  2. Receptionist selects specialty clinic based on rule recommendation: `POST /visits/:id/assign-clinic` with `{ "departmentCode": "P.102" }`.
- **Expected Result:**
  - Status code: `200 OK`.
  - Visit status updated from `HALL_WAITING` $\to$ `RECEPTION_VERIFIED` $\to$ `TRIAGE_PENDING`.
  - Clinic ticket issued: `{ "clinicTicketNumber": "IM-001", "departmentCode": "P.102", "status": "TRIAGE_PENDING" }`.

#### `TC-REC-03`: Priority Patient Queue Dispatch

- **Description:** Patient is 82 years old or pregnant; Receptionist sets the priority flag.
- **Steps:**
  1. `POST /visits/:id/assign-clinic` with `{ "departmentCode": "P.102", "isPriority": true, "priorityReason": "Elderly patient over 80 years old" }`.
- **Expected Result:**
  - Status code: `200 OK`.
  - Visit record contains `isPriority: true`.
  - When fetching queue lists, this visit is sorted before non-priority tickets.

---

### 2.2. Unhappy & Edge Scenarios

#### `TC-REC-ERR-01`: Duplicate Hall Ticket in the Same Calendar Day

- **Trigger:** Patient already has an active ticket `A-001` for today and requests another one.
- **Expected Result:**
  - Status code: `409 Conflict`.
  - Response body: `{ "statusCode": 409, "message": "Patient already has an active visit ticket for today.", "error": "Conflict" }`.

#### `TC-REC-ERR-02`: Missing Required Identity Fields

- **Trigger:** Self check-in without mandatory `name` or `dateOfBirth`.
- **Expected Result:**
  - Status code: `400 Bad Request`.
  - Response body includes validation error details for missing fields.

#### `TC-REC-ERR-03`: Clinic Shift Quota Exceeded

- **Trigger:** Receptionist attempts to dispatch patient to Clinic `P.102`, but the clinic has reached its limit (e.g., 40/40 patients).
- **Expected Result:**
  - Status code: `409 Conflict`.
  - Response body: `{ "statusCode": 409, "message": "Clinic P.102 has reached its maximum quota for the current shift. Please select an alternate clinic.", "error": "Conflict" }`.

#### `TC-REC-ERR-04`: Identity Document Audit Mismatch

- **Trigger:** Receptionist finds fraudulent or conflicting National ID during physical audit and rejects verification.
- **Steps:**
  1. `PUT /visits/:id/reject-verification` with reason `{ "reason": "National ID photo does not match bearer." }`.
- **Expected Result:**
  - Status code: `200 OK`.
  - Visit status transitions to `CANCELLED`.
  - Ticket removed from active queues.

---

## 3. MODULE 3: NURSE SCREENING, VITAL SIGNS & EMERGENCY STAT

_(Covers UC-NUR-01, UC-EMR-01)_

### 3.1. Happy Path Scenarios

#### `TC-NUR-01`: Complete Vital Signs Measurement (Normal Bounds)

- **Description:** Nurse records all 5 mandatory vital signs within normal medical parameters.
- **Steps:**
  1. `POST /visits/:id/vitals` with `{ "bloodPressureSystolic": 120, "bloodPressureDiastolic": 80, "heartRate": 74, "temperature": 37.0, "spo2": 98.5, "respiratoryRate": 16, "notes": "Patient calm, stable condition." }`.
- **Expected Result:**
  - Status code: `201 Created`.
  - Database: `visit_vitals` record saved; `isRedFlag = false`.
  - Visit status transitions from `TRIAGE_PENDING` $\to$ `CLINIC_WAITING`.

---

### 3.2. Unhappy & Emergency Scenarios

#### `TC-NUR-ERR-01`: Missing Mandatory Vital Sign

- **Trigger:** Nurse submits vital signs with missing `spo2` or `bloodPressureSystolic`.
- **Expected Result:**
  - Status code: `400 Bad Request`.
  - Response body: `{ "statusCode": 400, "message": ["spo2 should not be empty", "bloodPressureSystolic must be an integer number"], "error": "Bad Request" }`.

#### `TC-NUR-ERR-02`: Physiological Impossibility (Out-of-range Values)

- **Trigger:** Inputting negative or physiologically impossible values (e.g., `heartRate: 400`, `temperature: 55.0`).
- **Expected Result:**
  - Status code: `400 Bad Request`.
  - Validation message indicating acceptable physiological range.

#### `TC-EMR-01`: Clinical Red Flag Detected at Nurse Station (STAT Emergency)

- **Trigger:** Nurse measures critical vital signs: `spo2: 86` (< 90%) and patient exhibits severe crushing chest pain.
- **Steps:**
  1. `POST /visits/:id/vitals` with `{ "bloodPressureSystolic": 80, "bloodPressureDiastolic": 50, "heartRate": 135, "temperature": 38.2, "spo2": 86.0, "respiratoryRate": 32, "isRedFlag": true, "redFlagReason": "Severe hypoxia and cardiogenic shock signs" }`.
- **Expected Result:**
  - Status code: `201 Created`.
  - Routine outpatient workflow **immediately aborted**.
  - Visit status updated to `EMERGENCY_DISPATCHED`.
  - Target department updated to `P.001` (Emergency Resuscitation Unit).
  - WebSocket event `EMERGENCY_ALERT` broadcasted to Emergency Console with audio-visual alarm data.

#### `TC-EMR-02`: Emergency Dispatch Triggered at Any Other Checkpoint

- **Trigger:** Bệnh nhân collapses in the hallway or Doctor detects cardiac arrest in consultation room.
- **Steps:**
  1. Staff clicks Emergency trigger: `POST /visits/:id/emergency-dispatch` with `{ "reason": "Sudden loss of consciousness" }`.
- **Expected Result:**
  - Status code: `200 OK`.
  - Visit status immediately overridden to `EMERGENCY_DISPATCHED`.

---

## 4. MODULE 4: DOCTOR CLINICAL CONSULTATION & KAHN DAG ORDERS

_(Covers UC-DOC-01, UC-DOC-02, UC-DOC-03)_

### 4.1. Happy Path Scenarios

#### `TC-DOC-01`: Doctor Calls Patient & Begins Consultation

- **Description:** Doctor calls the next patient in the clinic queue.
- **Steps:**
  1. `PUT /visits/:id/call`.
- **Expected Result:**
  - Status code: `200 OK`.
  - Visit status transitions from `CLINIC_WAITING` $\to$ `IN_EXAMINATION`.
  - Doctor workstation displays patient vitals, demographics, and history.

#### `TC-DOC-02`: Consultation Clinic Transfer (Misrouted Patient)

- **Description:** Patient presented to General Medicine `P.102` but has an acute surgical abdomen; transferred to General Surgery `P.108`.
- **Steps:**
  1. `POST /visits/:id/transfer` with `{ "targetDepartmentCode": "P.108", "transferReason": "Suspected acute appendicitis requiring surgical evaluation", "clinicalSummary": "Right lower quadrant abdominal rebound tenderness." }`.
- **Expected Result:**
  - Status code: `200 OK`.
  - Clinical examination notes preserved.
  - Target department updated to `P.108`.
  - New priority ticket issued at target clinic `P.108`.
  - Visit status set back to `CLINIC_WAITING`.

#### `TC-DOC-03`: Paraclinical Order Formulation with Kahn DAG Validation

- **Description:** Doctor orders Blood Test (`P.201`), Abdominal Ultrasound (`P.104`), and Urinalysis (`P.203`).
- **Steps:**
  1. `POST /visits/:id/orders` with body:
     ```json
     {
       "orders": ["P.201", "P.104", "P.203"],
       "workingDiagnosis": "Acute abdominal pain under investigation",
       "pregnancySuspected": false
     }
     ```
- **Expected Result:**
  - Status code: `201 Created`.
  - Kahn DAG validates:
    - Directed edge `P.104` $\to$ `P.203` (Ultrasound must precede Urinalysis).
    - Directed edges `P.201` $\to$ `P.102`, `P.104` $\to$ `P.102`, `P.203` $\to$ `P.102` (All tests must conclude back at primary clinic).
    - Graph is acyclic (`isAcyclic = true`).
  - Topological sort returns valid sequence: `P.104` $\to$ `P.203` $\to$ `P.201` $\to$ `P.102`.
  - 3 `visit_steps` generated with `prerequisite_step_id` linked properly.
  - Visit status transitions to `PARACLINICAL_PENDING`.

---

### 4.2. Unhappy & Medical Safety Scenarios

#### `TC-DOC-ERR-01`: Save Order/Diagnosis Blocked when Vitals Missing

- **Trigger:** Doctor attempts to formulate orders or conclude visit without nurse-recorded vital signs.
- **Expected Result:**
  - Status code: `400 Bad Request`.
  - Response body: `{ "statusCode": 400, "message": "Mandatory vital signs must be recorded before clinical orders can be submitted.", "error": "Bad Request" }`.

#### `TC-DOC-ERR-02`: Cyclic Dependency Rejection (Kahn DAG)

- **Trigger:** Order payload containing cyclic prerequisite constraints.
- **Expected Result:**
  - Status code: `400 Bad Request`.
  - Response body: `{ "statusCode": 400, "message": "Cyclic dependency detected in clinical orders. Order graph must be directed and acyclic.", "error": "Bad Request" }`.

#### `TC-DOC-ERR-03`: Radiation Safety Intercept (Suspected Pregnancy)

- **Trigger:** Doctor attempts to order Chest X-Ray `P.302` while `pregnancySuspected = true`.
- **Expected Result:**
  - Status code: `422 Unprocessable Entity`.
  - Response body: `{ "statusCode": 422, "message": "RADIATION HAZARD: Chest X-Ray P.302 is contraindicated for pregnant patients. Please substitute with Ultrasound or MRI.", "error": "Unprocessable Entity" }`.

#### `TC-DOC-ERR-04`: Duplicate Diagnostic Order in 24 Hours

- **Trigger:** Doctor orders the exact same laboratory test that was completed within the past 24 hours.
- **Expected Result:**
  - Status code: `409 Conflict`.
  - Response body: `{ "statusCode": 409, "message": "Duplicate order alert: Service P.201 was already ordered within the past 24 hours.", "error": "Conflict" }`.

---

## 5. MODULE 5: PARACLINICAL STATIONS (LAB/PACS) & PRIORITY RECALL

_(Covers UC-DOC-04, UC-PAT-04)_

### 5.1. Happy Path Scenarios

#### `TC-LAB-01`: Technicians Input & Sign Diagnostic Results

- **Description:** Lab and Imaging technicians complete each step and enter findings.
- **Steps:**
  1. Lab Tech opens worklist: `GET /paraclinical/worklist?departmentCode=P.201`.
  2. Submits results for step: `POST /paraclinical/:stepId/result` with `{ "quantitativeValues": { "WBC": "8.5", "RBC": "4.8", "Platelets": "250" }, "findings": "All hematological indices within normal range.", "isPanicValue": false }`.
- **Expected Result:**
  - Status code: `201 Created`.
  - `visit_steps` record status updated to `COMPLETED`.

#### `TC-LAB-02`: Automatic Priority Recall Loop Trigger

- **Description:** Once **100% of all ordered paraclinical steps** are signed, the system automatically recalls the patient to the primary clinic.
- **Trigger:** The last remaining step (e.g., Urinalysis `P.203`) is signed.
- **Expected Result:**
  - Visit status automatically updates to `RE_EXAM_CALLING`.
  - Primary doctor's clinic queue displays a glowing badge: `"Priority Recall"`.
  - System emits WebSocket event `PARACLINICAL_READY` to Patient Web Portal.
  - Patient receives Web Push notification: _"All diagnostic results are complete. Please return to Consultation Room P.102."_

---

### 5.2. Unhappy & Panic Value Scenarios

#### `TC-LAB-ERR-01`: Unauthorized Result Approval

- **Trigger:** Receptionist or Patient attempts to call `POST /paraclinical/:stepId/result`.
- **Expected Result:**
  - Status code: `403 Forbidden`.
  - Response body: `{ "statusCode": 403, "message": "Forbidden resource: Requires LAB_TECHNICIAN role", "error": "Forbidden" }`.

#### `TC-LAB-ERR-02`: Non-existent Step ID

- **Trigger:** Result submitted for invalid or non-existent `stepId`.
- **Expected Result:**
  - Status code: `404 Not Found`.
  - Response body: `{ "statusCode": 404, "message": "Paraclinical order step not found", "error": "Not Found" }`.

#### `TC-LAB-PANIC-01`: Critical Panic Value Alert

- **Trigger:** Lab technician enters a lethal panic value: Serum Potassium $K^+ = 7.1$ mmol/L (Normal 3.5 - 5.0) or severe hypoglycemia Glucose = 1.8 mmol/L.
- **Steps:**
  1. `POST /paraclinical/:stepId/result` with `{ "quantitativeValues": { "Potassium": "7.1" }, "isPanicValue": true, "panicAlertDetails": "CRITICAL PANIC VALUE: Severe hyperkalemia (7.1 mmol/L) with imminent cardiac arrest risk!" }`.
- **Expected Result:**
  - Status code: `201 Created`.
  - System immediately fires high-priority alert event `PANIC_VALUE_ALERT`.
  - Doctor Cockpit renders a persistent red modal alert banner detailing the panic value.
  - Emergency protocol option made available immediately.

---

## 6. MODULE 6: FINAL DIAGNOSIS, PRESCRIPTION & DISCHARGE

_(Covers UC-DOC-05, UC-PAT-05)_

### 6.1. Happy Path Scenarios

#### `TC-CONCL-01`: Diagnostic Conclusion & ICD-10 Electronic Prescription

- **Description:** Doctor reviews all test results, inputs ICD-10 code, prescribes medications, and concludes visit.
- **Steps:**
  1. `POST /visits/:id/conclusion` with body:
     ```json
     {
       "icd10Code": "K29.7",
       "icd10Name": "Gastritis, unspecified",
       "doctorNotes": "Avoid spicy foods and NSAIDs. Take medication before meals.",
       "revisitDate": "2026-10-22",
       "items": [
         {
           "medicationName": "Esomeprazole 40mg",
           "dosage": "40mg",
           "route": "ORAL",
           "frequency": "1 tablet once daily before breakfast",
           "durationDays": 14,
           "quantity": 14,
           "instructions": "Take 30 minutes before meal"
         }
       ]
     }
     ```
- **Expected Result:**
  - Status code: `200 OK`.
  - Database: `prescriptions` and `prescription_items` persisted with digital signature timestamp.
  - Visit status updated to `COMPLETED`.
  - Patient Web Portal updates to display medical summary, prescription, and follow-up date.

#### `TC-CONCL-02`: Routine Visit Without Paraclinical Tests

- **Description:** Patient with simple common cold is diagnosed immediately after physical examination.
- **Steps:**
  1. Direct call to `POST /visits/:id/conclusion` with ICD-10 `J00` (Acute nasopharyngitis).
- **Expected Result:**
  - Status code: `200 OK`.
  - Visit transitions directly from `IN_EXAMINATION` $\to$ `COMPLETED`.

---

### 6.2. Unhappy & Safety Scenarios

#### `TC-CONCL-ERR-01`: Missing ICD-10 Diagnosis Code

- **Trigger:** Doctor attempts to conclude consultation with empty or invalid `icd10Code`.
- **Expected Result:**
  - Status code: `400 Bad Request`.
  - Response body: `{ "statusCode": 400, "message": ["icd10Code must be a valid ICD-10 code format"], "error": "Bad Request" }`.

#### `TC-CONCL-ERR-02`: Known Drug Allergy Contraindication

- **Trigger:** Patient has documented allergy `Aspirin`, and doctor includes `Acetylsalicylic acid (Aspirin)` in the prescription items.
- **Expected Result:**
  - Status code: `422 Unprocessable Entity`.
  - Response body: `{ "statusCode": 422, "message": "ALLERGY SAFETY WARNING: Patient has documented allergy to Aspirin. Prescription cannot be signed without override authorization.", "error": "Unprocessable Entity" }`.

#### `TC-CONCL-ERR-03`: Attempting to Conclude an Already Completed Visit

- **Trigger:** Request to conclude a visit whose status is already `COMPLETED`.
- **Expected Result:**
  - Status code: `409 Conflict`.
  - Response body: `{ "statusCode": 409, "message": "Visit has already been concluded.", "error": "Conflict" }`.

---

## 7. MODULE 7: DYNAMIC ROUTE OPTIMIZATION & WEBSOCKET EVENTS

_(Covers UC-ROUTE-01, UC-ROUTE-02, UC-PAT-03, UC-PAT-08)_

### 7.1. Happy Path Scenarios

#### `TC-ROUTE-01`: Multi-Floor Distance & Queue Heuristic Calculation

- **Description:** Patient has 3 independent diagnostic tests on Floor 1, Floor 2, and Floor 3.
- **Cost Formula Verified:**
  $$\text{Cost} = 0.7 \times (\text{QueueLength} \times \text{AvgTime}) + 0.3 \times |\text{Floor}_{target} - \text{Floor}_{current}|$$
- **Expected Result:**
  - Stations ordered to minimize vertical climbing and wait time.
  - Route response returns ordered stations, floor numbers, room names, and estimated wait durations.

#### `TC-ROUTE-02`: Real-time Dynamic Re-optimization on Clinic Congestion

- **Description:** An emergency arrives at Ultrasound Room `P.104`, causing queue spike.
- **Trigger:** Room queue length increases by $> 5$ patients.
- **Expected Result:**
  - Route Engine re-evaluates remaining `PENDING` steps.
  - Step order updated.
  - WebSocket event `ROUTE_UPDATED` sent to patient device.
  - Patient Portal smoothly transitions to highlight the new recommended station.

---

### 7.2. Unhappy Scenarios

#### `TC-ROUTE-ERR-01`: All Stations Temporarily Unavailable

- **Trigger:** System detects all rooms for a required service are marked inactive or closed.
- **Expected Result:**
  - Status code: `200 OK` (Graceful degradation).
  - Route marks step as `PENDING_ASSIGNMENT` with informational alert: `"Service station temporarily unavailable. Our staff will direct you shortly."`.

#### `TC-ROUTE-ERR-02`: WebSocket Connection Disconnect & Recovery

- **Trigger:** Patient device enters elevator, loses network connection, then reconnects.
- **Expected Result:**
  - Client automatically falls back to HTTP Polling (`GET /visits/:id/route`) every 10 seconds.
  - Upon reconnection, Socket.IO resumes room subscription `visit:{id}` without data loss.

---

## 8. MODULE 8: SYSTEM GOVERNANCE, CATALOGS & SCHEDULES

_(Covers UC-ADM-01, UC-ADM-02, UC-ADM-04, UC-ADM-05)_

### 8.1. Happy Path Scenarios

#### `TC-ADM-01`: Create New Department / Room Catalog

- **Description:** Administrator adds a new consultation room `P.109`.
- **Steps:**
  1. `POST /admin/departments` with `{ "code": "P.109", "name": "Dermatology Consultation Clinic", "roomType": "CONSULTATION", "floor": 1, "avgServiceTimeMin": 15, "maxQuotaPerSlot": 35 }`.
- **Expected Result:**
  - Status code: `201 Created`.
  - Department added and immediately visible in reception routing selectors.

#### `TC-ADM-02`: Configure Doctor Work Shift & Quota

- **Description:** Administrator assigns Doctor to Morning shift at `P.102` with 40 patient quota.
- **Steps:**
  1. `POST /admin/schedules` with `{ "doctorId": UUID, "departmentCode": "P.102", "shiftDate": "2026-10-15", "shiftType": "MORNING", "maxQuota": 40 }`.
- **Expected Result:**
  - Status code: `201 Created`.
  - Quota rules active for that calendar date.

---

### 8.2. Unhappy Scenarios

#### `TC-ADM-ERR-01`: Duplicate Department Code

- **Trigger:** Administrator attempts to create department with existing code `P.102`.
- **Expected Result:**
  - Status code: `409 Conflict`.
  - Response body: `{ "statusCode": 409, "message": "Department with code P.102 already exists.", "error": "Conflict" }`.

#### `TC-ADM-ERR-02`: Doctor Shift Overlap Collision

- **Trigger:** Assigning the same Doctor to two different clinic rooms during the same morning shift.
- **Expected Result:**
  - Status code: `409 Conflict`.
  - Response body: `{ "statusCode": 409, "message": "Schedule collision: Doctor already assigned to clinic P.102 during the MORNING shift on this date.", "error": "Conflict" }`.

#### `TC-ADM-ERR-03`: Deactivating the Last Administrator

- **Trigger:** Superadmin attempts to deactivate their own account while no other active Admin exists.
- **Expected Result:**
  - Status code: `403 Forbidden`.
  - Response body: `{ "statusCode": 403, "message": "Cannot deactivate the sole active System Administrator.", "error": "Forbidden" }`.
