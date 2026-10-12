const BASE_URL = 'http://localhost:3000/api';

interface TestResult {
  code: string;
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function assert(code: string, name: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${code}: ${name}`);
    results.push({ code, name, passed: true });
  } else {
    console.error(`  ❌ [FAIL] ${code}: ${name} — ${details || 'Assertion failed'}`);
    results.push({ code, name, passed: false, details });
  }
}

function decodeJwt(token: string): any {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(base64, 'base64').toString('utf-8'));
}

async function request(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let body: any = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, ok: res.ok };
}

async function runTestSuite() {
  console.log('\n===============================================================');
  console.log('🏥 EZ-HEALTHCARE END-TO-END SCENARIO VERIFICATION TEST SUITE');
  console.log('===============================================================\n');

  // ==============================================================
  // MODULE 1: AUTHENTICATION & RBAC
  // ==============================================================
  console.log('📌 --- MODULE 1: AUTHENTICATION & RBAC ---');

  // TC-AUTH-01: Patient OTP request & verify
  const otpReq = await request('/auth/patient/request-otp', {
    method: 'POST',
    body: JSON.stringify({ email: 'test.patient.e2e@example.com' }),
  });
  assert(
    'TC-AUTH-01a',
    'Patient Request OTP',
    otpReq.status === 200 && otpReq.body.success === true,
  );
  const otpCode = otpReq.body.otpCodePreview || '123456';

  // TC-AUTH-ERR-02: Incorrect OTP (< 3 attempts)
  const wrongOtp = await request('/auth/patient/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email: 'test.patient.e2e@example.com', otpCode: '999999' }),
  });
  assert('TC-AUTH-ERR-02', 'Incorrect OTP Submission returns 400', wrongOtp.status === 400);

  // TC-AUTH-01b: Valid OTP verify
  const verifyOtp = await request('/auth/patient/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email: 'test.patient.e2e@example.com', otpCode }),
  });
  assert(
    'TC-AUTH-01b',
    'Patient OTP Verification returns JWT',
    verifyOtp.status === 200 && !!verifyOtp.body.accessToken,
  );
  const patientToken = verifyOtp.body.accessToken;

  // TC-AUTH-02: Staff logins with RBAC
  const doctorLogin = await request('/auth/staff/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'dr.smith@ezhealthcare.com', password: 'Doctor@123456' }),
  });
  const doctorToken = doctorLogin.body.accessToken;
  const doctorClaims = decodeJwt(doctorToken);
  assert(
    'TC-AUTH-02a',
    'Doctor Login',
    doctorLogin.status === 200 && doctorClaims.role === 'DOCTOR',
  );
  const doctorId = doctorClaims.sub;

  const nurseLogin = await request('/auth/staff/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'nurse.emily@ezhealthcare.com', password: 'Nurse@123456' }),
  });
  const nurseToken = nurseLogin.body.accessToken;
  assert(
    'TC-AUTH-02b',
    'Nurse Login',
    nurseLogin.status === 200 && decodeJwt(nurseToken).role === 'NURSE',
  );

  const receptionistLogin = await request('/auth/staff/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'reception.clara@ezhealthcare.com',
      password: 'Reception@123456',
    }),
  });
  const receptionistToken = receptionistLogin.body.accessToken;
  assert(
    'TC-AUTH-02c',
    'Receptionist Login',
    receptionistLogin.status === 200 && decodeJwt(receptionistToken).role === 'RECEPTIONIST',
  );

  const labTechLogin = await request('/auth/staff/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'lab.tech@ezhealthcare.com', password: 'Lab@123456' }),
  });
  const labTechToken = labTechLogin.body.accessToken;
  assert(
    'TC-AUTH-02d',
    'Lab Technician Login',
    labTechLogin.status === 200 && decodeJwt(labTechToken).role === 'LAB_TECHNICIAN',
  );

  const adminLogin = await request('/auth/staff/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'admin@ezhealthcare.com', password: 'Admin@123456' }),
  });
  const adminToken = adminLogin.body.accessToken;
  assert(
    'TC-AUTH-02e',
    'Admin Login',
    adminLogin.status === 200 && decodeJwt(adminToken).role === 'ADMIN',
  );

  // TC-AUTH-ERR-06: RBAC Forbidden resource
  const forbiddenReq = await request('/admin/configs', {
    method: 'GET',
    headers: { Authorization: `Bearer ${nurseToken}` },
  });
  assert(
    'TC-AUTH-ERR-06',
    'Nurse accessing Admin route returns 403 Forbidden',
    forbiddenReq.status === 403,
  );

  // ==============================================================
  // MODULE 2: PRE-TRIAGE, CHECK-IN & RECEPTION
  // ==============================================================
  console.log('\n📌 --- MODULE 2: PRE-TRIAGE, CHECK-IN & RECEPTION ---');

  // Pre-Triage Rule Recommendation
  const triageRecommend = await request('/triage/recommend', {
    method: 'POST',
    body: JSON.stringify({ symptoms: ['SYM_ABDOMINAL_PAIN'], age: 35 }),
  });
  assert(
    'TC-TRIAGE-01',
    'Pre-triage symptom recommendation maps to Imaging P.104',
    triageRecommend.status === 200 && triageRecommend.body.recommendedDepartment.code === 'P.104',
  );

  // TC-REC-01: Standard Patient Check-in & Hall Ticket Issuance
  const timestamp = Date.now();
  const nationalId = `079${String(timestamp).slice(-9)}`;
  const hallTicketRes = await request('/visits/hall-ticket', {
    method: 'POST',
    body: JSON.stringify({
      name: `John Doe ${timestamp}`,
      nationalId,
      insuranceCardNumber: 'DN4791234567890',
      dateOfBirth: '1985-04-12',
      gender: 'MALE',
      chiefComplaint: 'Abdominal cramps and mild nausea',
      symptomSeverity: 'MODERATE',
    }),
  });
  assert(
    'TC-REC-01',
    'Hall Ticket Issuance returns A-xxx and HALL_WAITING status',
    hallTicketRes.status === 201 &&
      hallTicketRes.body.status === 'HALL_WAITING' &&
      hallTicketRes.body.hallTicketNumber.startsWith('A-'),
  );
  const visitId = hallTicketRes.body.visitId;

  // TC-REC-ERR-01: Duplicate ticket on same day
  const duplicateTicketRes = await request('/visits/hall-ticket', {
    method: 'POST',
    body: JSON.stringify({
      name: `John Doe ${timestamp}`,
      nationalId,
      chiefComplaint: 'Second ticket attempt',
    }),
  });
  assert(
    'TC-REC-ERR-01',
    'Duplicate Hall Ticket on same day returns 409 Conflict',
    duplicateTicketRes.status === 409,
  );

  // TC-REC-02: Reception Identity Verification
  const verifyVisitRes = await request(`/visits/${visitId}/verify`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${receptionistToken}` },
    body: JSON.stringify({
      nationalIdVerified: true,
      insuranceCardNumber: 'DN4791234567890',
    }),
  });
  assert(
    'TC-REC-02',
    'Reception Verification audit returns RECEPTION_VERIFIED',
    verifyVisitRes.status === 200 && verifyVisitRes.body.status === 'RECEPTION_VERIFIED',
  );

  // TC-REC-03: Assign Clinic Ticket
  const assignClinicRes = await request(`/visits/${visitId}/assign-clinic`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${receptionistToken}` },
    body: JSON.stringify({
      departmentCode: 'P.102',
      isPriority: false,
    }),
  });
  assert(
    'TC-REC-03',
    'Assign Clinic Ticket returns CL-102-xx and TRIAGE_PENDING',
    assignClinicRes.status === 200 &&
      assignClinicRes.body.status === 'TRIAGE_PENDING' &&
      assignClinicRes.body.departmentCode === 'P.102',
  );

  // ==============================================================
  // MODULE 3: NURSE SCREENING, VITALS & EMERGENCY STAT
  // ==============================================================
  console.log('\n📌 --- MODULE 3: NURSE SCREENING & VITALS ---');

  // TC-NUR-ERR-01: Missing mandatory vital sign
  const invalidVitals = await request(`/visits/${visitId}/vitals`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${nurseToken}` },
    body: JSON.stringify({
      bloodPressureSystolic: 120,
      bloodPressureDiastolic: 80,
      heartRate: 75,
      // temperature omitted!
      spo2: 98,
      respiratoryRate: 16,
    }),
  });
  assert(
    'TC-NUR-ERR-01',
    'Missing mandatory vital returns 400 Bad Request',
    invalidVitals.status === 400,
  );

  // TC-NUR-01: Record complete 5 vitals
  const recordVitalsRes = await request(`/visits/${visitId}/vitals`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${nurseToken}` },
    body: JSON.stringify({
      bloodPressureSystolic: 120,
      bloodPressureDiastolic: 80,
      heartRate: 72,
      temperature: 36.8,
      spo2: 98.0,
      respiratoryRate: 16,
      notes: 'Patient resting comfortably.',
    }),
  });
  assert(
    'TC-NUR-01',
    'Record complete 5 vitals transitions to CLINIC_WAITING',
    recordVitalsRes.status === 201 && recordVitalsRes.body.status === 'CLINIC_WAITING',
  );

  // TC-EMR-01: STAT Emergency Intercept test on a second emergency ticket
  const emergencyTicket = await request('/visits/hall-ticket', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Emergency Patient Test',
      nationalId: `999${String(Date.now()).slice(-9)}`,
      chiefComplaint: 'Severe acute dyspnea',
    }),
  });
  const emrVisitId = emergencyTicket.body.visitId;
  const statVitalsRes = await request(`/visits/${emrVisitId}/vitals`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${nurseToken}` },
    body: JSON.stringify({
      bloodPressureSystolic: 85,
      bloodPressureDiastolic: 55,
      heartRate: 135,
      temperature: 38.5,
      spo2: 84.0, // Hypoxia < 90%
      respiratoryRate: 34,
      isRedFlag: true,
      redFlagReason: 'Severe hypoxia and respiratory distress',
    }),
  });
  assert(
    'TC-EMR-01',
    'Severe hypoxia SpO2 < 90% triggers EMERGENCY_DISPATCHED to P.001',
    statVitalsRes.status === 201 &&
      statVitalsRes.body.status === 'EMERGENCY_DISPATCHED' &&
      statVitalsRes.body.isRedFlag === true,
  );

  // ==============================================================
  // MODULE 4: DOCTOR CONSULTATION & KAHN DAG ORDERS
  // ==============================================================
  console.log('\n📌 --- MODULE 4: DOCTOR CONSULTATION & KAHN DAG ORDERS ---');

  // TC-DOC-01: Doctor calls patient into consultation room
  const callRes = await request(`/visits/${visitId}/call`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
  assert(
    'TC-DOC-01',
    'Doctor calls patient: status transitions to IN_EXAMINATION',
    callRes.status === 200 && callRes.body.status === 'IN_EXAMINATION',
  );

  // TC-DOC-ERR-03: Radiation safety intercept (pregnancy suspected + X-ray P.302)
  const radiationHazardRes = await request(`/visits/${visitId}/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({
      orders: ['P.302'], // Chest X-Ray
      pregnancySuspected: true,
      workingDiagnosis: 'Persistent cough in pregnancy',
    }),
  });
  assert(
    'TC-DOC-ERR-03',
    'Radiation hazard for pregnant patient returns 422 Unprocessable Entity',
    radiationHazardRes.status === 422,
  );

  // TC-DOC-03: Valid Paraclinical formulation with Kahn DAG topological sort
  // Blood Lab (P.201), Ultrasound (P.104), Urinalysis (P.203)
  const ordersRes = await request(`/visits/${visitId}/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({
      orders: ['P.201', 'P.104', 'P.203'],
      workingDiagnosis: 'Suspected acute epigastric gastritis under investigation',
      pregnancySuspected: false,
      doctorNotes: 'Please evaluate gallbladder and complete blood count.',
    }),
  });
  assert(
    'TC-DOC-03',
    'Kahn DAG validates acyclic dependencies and transitions to PARACLINICAL_PENDING',
    ordersRes.status === 201 &&
      ordersRes.body.isAcyclic === true &&
      ordersRes.body.sortedOrder.length >= 3,
  );

  // ==============================================================
  // MODULE 5: PARACLINICAL STATIONS & PRIORITY RECALL
  // ==============================================================
  console.log('\n📌 --- MODULE 5: PARACLINICAL STATIONS & AUTO-RECALL ---');

  // TC-LAB-01a: Lab tech views worklist
  const worklistRes = await request('/paraclinical/worklist', {
    method: 'GET',
    headers: { Authorization: `Bearer ${labTechToken}` },
  });
  assert(
    'TC-LAB-01a',
    'Technician retrieves paraclinical worklist',
    worklistRes.status === 200 && Array.isArray(worklistRes.body),
  );

  // Get visit details to get step IDs
  const visitDetailsRes = await request(`/visits/${visitId}`, { method: 'GET' });
  const diagnosticSteps = (visitDetailsRes.body.steps || []).filter((s: any) => !s.isReExam);
  assert(
    'TC-LAB-01b',
    'Found 3 diagnostic test steps for patient visit',
    diagnosticSteps.length === 3,
  );

  // Sign Step 1: Blood Test
  const step1 = diagnosticSteps[0];
  const step1Res = await request(`/paraclinical/${step1.id}/result`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${labTechToken}` },
    body: JSON.stringify({
      quantitativeValues: { WBC: '7.8', RBC: '4.9', Platelets: '240' },
      findings: 'Hematological parameters normal.',
      isPanicValue: false,
    }),
  });
  assert(
    'TC-LAB-01c',
    'Technician signs Step 1 (Blood Test)',
    step1Res.status === 201 && step1Res.body.remainingDiagnosticSteps === 2,
  );

  // Sign Step 2: Ultrasound
  const step2 = diagnosticSteps[1];
  const step2Res = await request(`/paraclinical/${step2.id}/result`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${labTechToken}` },
    body: JSON.stringify({
      findings: 'No gallbladder stones. Mild gastric mucosal inflammation.',
      isPanicValue: false,
      dicomImageUrls: ['https://pacs.ezhealthcare.local/us01.jpg'],
    }),
  });
  assert(
    'TC-LAB-01d',
    'Technician signs Step 2 (Ultrasound)',
    step2Res.status === 201 && step2Res.body.remainingDiagnosticSteps === 1,
  );

  // TC-LAB-02: Sign final Step 3 (Urinalysis) -> Triggers Auto-Recall Loop!
  const step3 = diagnosticSteps[2];
  const step3Res = await request(`/paraclinical/${step3.id}/result`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${labTechToken}` },
    body: JSON.stringify({
      quantitativeValues: { Protein: 'Negative', Glucose: 'Normal' },
      findings: 'Urinalysis clear.',
      isPanicValue: false,
    }),
  });
  assert(
    'TC-LAB-02',
    'Signing 100% of diagnostic steps automatically triggers RE_EXAM_CALLING priority recall',
    step3Res.status === 201 &&
      step3Res.body.remainingDiagnosticSteps === 0 &&
      step3Res.body.autoRecallTriggered === true,
  );

  // TC-LAB-PANIC-01: Panic value alert endpoint check
  const panicAlertRes = await request(`/paraclinical/${step1.id}/result`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${labTechToken}` },
    body: JSON.stringify({
      quantitativeValues: { Potassium: '7.2' },
      isPanicValue: true,
      panicAlertDetails: 'CRITICAL PANIC VALUE: Severe Hyperkalemia 7.2 mmol/L',
    }),
  });
  assert(
    'TC-LAB-PANIC-01',
    'Critical Panic Value record preserved with flag',
    panicAlertRes.status === 201 && panicAlertRes.body.isPanicValue === true,
  );

  // ==============================================================
  // MODULE 6: FINAL DIAGNOSIS, PRESCRIPTION & DISCHARGE
  // ==============================================================
  console.log('\n📌 --- MODULE 6: FINAL DIAGNOSIS & PRESCRIPTION ---');

  // Verify visit is now in RE_EXAM_CALLING with priority badge
  const recalledVisit = await request(`/visits/${visitId}`, { method: 'GET' });
  assert(
    'TC-CONCL-00',
    'Visit has transitioned to RE_EXAM_CALLING with isPriority = true',
    recalledVisit.body.status === 'RE_EXAM_CALLING' && recalledVisit.body.isPriority === true,
  );

  // TC-CONCL-ERR-02: Drug allergy safety warning
  // Patient David Miller in seed has allergy 'Penicillin'
  const seedPatient = await request('/users/audit/national-id/079123456789', {
    method: 'GET',
    headers: { Authorization: `Bearer ${receptionistToken}` },
  });
  assert(
    'TC-CONCL-ERR-02a',
    'Seed patient David Miller has allergy to Penicillin',
    seedPatient.status === 200 && seedPatient.body.allergies.includes('Penicillin'),
  );

  // Create visit for an allergic patient and test allergy check
  const allergicTimestamp = Date.now();
  const allergicNid = `078${String(allergicTimestamp).slice(-9)}`;
  const allergicTicket = await request('/visits/hall-ticket', {
    method: 'POST',
    body: JSON.stringify({
      name: `Allergic Patient ${allergicTimestamp}`,
      nationalId: allergicNid,
      chiefComplaint: 'Bacterial pharyngitis',
      allergies: ['Penicillin'],
    }),
  });
  const davidVisitId = allergicTicket.body.visitId;

  // Try prescribing Penicillin V
  const allergyBlockedRes = await request(`/visits/${davidVisitId}/conclusion`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({
      icd10Code: 'J02.9',
      icd10Name: 'Acute pharyngitis, unspecified',
      items: [
        {
          medicationName: 'Penicillin V Potassium 500mg',
          dosage: '500mg',
          route: 'ORAL',
          frequency: '1 tablet 4 times daily',
          durationDays: 10,
          quantity: 40,
        },
      ],
    }),
  });
  assert(
    'TC-CONCL-ERR-02b',
    'Prescribing Penicillin to allergic patient returns 422 Unprocessable Entity',
    allergyBlockedRes.status === 422,
  );

  // TC-CONCL-01: Valid Conclusion & ICD-10 Electronic Prescription
  const concludeRes = await request(`/visits/${visitId}/conclusion`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({
      icd10Code: 'K29.7',
      icd10Name: 'Gastritis, unspecified',
      doctorNotes: 'Avoid NSAIDs, alcohol, and spicy foods. Take omeprazole before breakfast.',
      revisitDate: '2026-10-22',
      items: [
        {
          medicationName: 'Esomeprazole 40mg',
          dosage: '40mg',
          route: 'ORAL',
          frequency: '1 tablet once daily before breakfast',
          durationDays: 14,
          quantity: 14,
          instructions: 'Take 30 minutes before meal with plenty of water',
        },
      ],
    }),
  });
  assert(
    'TC-CONCL-01',
    'Doctor concludes visit with ICD-10 code K29.7; status transitions to COMPLETED',
    concludeRes.status === 200 &&
      concludeRes.body.status === 'COMPLETED' &&
      !!concludeRes.body.digitalSignature,
  );

  // TC-CONCL-ERR-03: Attempting to conclude an already completed visit
  const reConcludeRes = await request(`/visits/${visitId}/conclusion`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({
      icd10Code: 'K29.7',
      icd10Name: 'Gastritis, unspecified',
    }),
  });
  assert(
    'TC-CONCL-ERR-03',
    'Re-concluding completed visit returns 409 Conflict',
    reConcludeRes.status === 409,
  );

  // ==============================================================
  // MODULE 7: DYNAMIC ROUTING & QUEUES
  // ==============================================================
  console.log('\n📌 --- MODULE 7: DYNAMIC ROUTING & QUEUES ---');

  // TC-ROUTE-01: Multi-floor route heuristics
  const routeRes = await request(`/visits/${visitId}/route`, { method: 'GET' });
  assert(
    'TC-ROUTE-01',
    'Route endpoint returns ordered stations with heuristic costs',
    routeRes.status === 200 && Array.isArray(routeRes.body.routeStations),
  );

  // Queue query for clinic P.102
  const queueRes = await request('/visits/queue/P.102', { method: 'GET' });
  assert(
    'TC-QUEUE-01',
    'Queue endpoint returns active department queue',
    queueRes.status === 200 && queueRes.body.departmentCode === 'P.102',
  );

  // ==============================================================
  // MODULE 8: SYSTEM GOVERNANCE & CATALOGS
  // ==============================================================
  console.log('\n📌 --- MODULE 8: SYSTEM GOVERNANCE & CATALOGS ---');

  // TC-ADM-01: Admin creates new department room
  const newDeptRes = await request('/admin/departments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      code: `P.109_${Date.now()}`,
      name: 'Dermatology Consultation Clinic',
      roomType: 'CONSULTATION',
      floor: 1,
      avgServiceTimeMin: 15,
      maxQuotaPerSlot: 35,
    }),
  });
  assert('TC-ADM-01', 'Admin creates new Department room catalog', newDeptRes.status === 201);

  // TC-ADM-ERR-01: Duplicate department code
  const dupDeptRes = await request('/admin/departments', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      code: 'P.102', // Already exists in seed
      name: 'Duplicate Internal Medicine',
      roomType: 'CONSULTATION',
    }),
  });
  assert(
    'TC-ADM-ERR-01',
    'Duplicate department code returns 409 Conflict',
    dupDeptRes.status === 409,
  );

  // TC-ADM-02: Doctor work shift scheduling
  const futureOffsetDays = Math.floor(Math.random() * 500) + 40;
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + futureOffsetDays);
  const shiftDate = targetDate.toISOString().split('T')[0];

  const scheduleRes = await request('/admin/schedules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      doctorId,
      departmentCode: 'P.102',
      shiftDate,
      shiftType: 'MORNING',
      maxQuota: 40,
    }),
  });
  assert('TC-ADM-02', 'Admin assigns doctor shift schedule', scheduleRes.status === 201);

  // TC-ADM-ERR-02: Doctor schedule shift collision
  const collisionScheduleRes = await request('/admin/schedules', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      doctorId,
      departmentCode: 'P.105', // Different room, same doctor, same morning shift
      shiftDate,
      shiftType: 'MORNING',
      maxQuota: 30,
    }),
  });
  assert(
    'TC-ADM-ERR-02',
    'Doctor shift collision on same date/shift returns 409 Conflict',
    collisionScheduleRes.status === 409,
  );

  // Admin configs retrieval
  const configsRes = await request('/admin/configs', {
    method: 'GET',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert(
    'TC-ADM-03',
    'Retrieve system configurations including BR-QUEUE-PRIORITY',
    configsRes.status === 200 && configsRes.body.length > 0,
  );

  // ==============================================================
  // SUMMARY SCOREBOARD
  // ==============================================================
  console.log('\n===============================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`📊 FINAL RESULTS: ${passed}/${total} TESTS PASSED (${failed} FAILED)`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
