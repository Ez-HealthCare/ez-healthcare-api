# PostgreSQL integration tests

Run from the API repository with Docker Desktop running:

```sh
npm run test:integration
```

This builds the current API source, starts an isolated PostgreSQL 17 database,
runs all migrations and seed data, then runs the Jest integration suite.
The test image retains development dependencies, including Jest and ts-jest.
No host PostgreSQL port, application database or local .env is used by the containers.
The database uses tmpfs; --force-recreate gives each run a fresh database.
The command returns the integration-tests service exit code.

Remove the stopped test containers and their network after reviewing output:

```sh
docker compose -f compose.integration.yml down
```

The suite currently checks concurrent ticket issuance, idempotency, intake rollback,
intake/examination races, expiry, quotas, counter isolation, access boundaries,
and a down/up round trip of the CALLED enum and current-ticket index migrations.
The audit rollback test deliberately causes a database error and expects HTTP 500;
that error log is expected when the test passes.

These are real API/PostgreSQL integration checks. They do not yet replace browser
UAT or cover the complete diagnostic, specialty-transfer and emergency workflows.

The aftercare checks also cover transactional conclusion/prescription/notification,
repeated conclusion, rollback after an audit failure, owner-scoped patient history
and prescription details, and diagnostic result ownership and terminal-state safety.
This remains partial diagnostic coverage; it does not certify the entire lab workflow.
