# Doctor room model

- One doctor per room, business date and shift; one room per doctor, business date and shift.
- Database unique indexes enforce both directions, including concurrent admin requests.
- Existing duplicate schedules must be reconciled before migration 1792140000000. Migration refuses to discard existing data.
- Seed preserves existing doctor assignments and extends the latest assigned room; it does not wrap additional doctors into occupied rooms.
- New patient flow: CLINIC_WAITING -> CLINIC_CALLED -> IN_EXAMINATION.
- Calling sets the doctor; reception into examination requires that doctor and a valid room schedule.
- Re-examination requires the same examining doctor. Shift handover must not silently take ownership.
- Calling or receiving another visit is rejected while this room has an IN_EXAMINATION visit.
- Room admission locks the room in the existing serializable transaction, with retries for serialization/deadlock errors.
- Doctor room queues contain waiting tickets and that doctor's in-progress visits; another doctor's clinical work does not become editable merely by changing room filters.
- Diagnostic routing returns to the current consultation room after transfer/reassignment.

PostgreSQL integration tests cover schedule races (one 201 and one 409), a doctor assigned to two rooms, two concurrent examination starts (one 201 and one 409), repeated start, and calling while occupied.

After three unsuccessful calls, the visit is TEMPORARILY_ABSENT with a PAUSED clinic ticket. When the patient returns, the assigned room doctor, nurse or receptionist can requeue it. The original visit and clinic number remain; callAttempts resets to zero and queuedAt moves to now. Priority ordering is preserved. Doctor requeue checks the active room assignment. Concurrent restores produce one success and one conflict, with one audit/notification. Expired tickets require the existing reissue flow.

Patients can POST /visits/:id/report-return for their own valid paused clinic ticket while TEMPORARILY_ABSENT. The API stores returnReportedAt, notifies the assigned doctor, and logs one audit event per absence. Repeated or concurrent reports replay the saved time. Reporting does not requeue the visit; the doctor confirms the return. Requeue clears the flag for future absence cycles. The Doctor queue and notification bell poll every 5 seconds. Staff may still confirm an in-person return when a patient cannot use the app.
