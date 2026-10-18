<p align="center">
  <h1 align="center">🏥 Ez-HealthCare API</h1>
  <p align="center">
    <strong>Scalable, enterprise-grade backend RESTful API service for the Ez-HealthCare platform.</strong>
  </p>
  <p align="center">
    <a href="https://nestjs.com/" target="_blank"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS" /></a>
    <a href="https://www.typescriptlang.org/" target="_blank"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://www.postgresql.org/" target="_blank"><img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" /></a>
    <a href="https://typeorm.io/" target="_blank"><img src="https://img.shields.io/badge/TypeORM-FE0803?style=for-the-badge&logo=typeorm&logoColor=white" alt="TypeORM" /></a>
    <a href="https://swagger.io/" target="_blank"><img src="https://img.shields.io/badge/Swagger-85EA2D?style=for-the-badge&logo=swagger&logoColor=black" alt="Swagger" /></a>
  </p>
</p>

---

## 📖 Overview

**Ez-HealthCare API** is the core backend service powering the Ez-HealthCare ecosystem. Engineered with **NestJS 12**, **TypeScript**, and **PostgreSQL**, this repository provides a high-performance, modular, and maintainable foundation for healthcare management, consultations, and medical service workflows.

### Key Highlights

- **Modern Architecture**: Clean modular structure following official NestJS enterprise patterns.
- **Relational Persistence**: PostgreSQL with TypeORM for robust data mapping and seamless schema migrations.
- **Interactive Documentation**: Auto-generated Swagger/OpenAPI documentation available out-of-the-box.
- **Request Validation & Security**: Strict global validation pipes with DTO whitelist and payload sanitization via `class-validator` & `class-transformer`.
- **Developer Experience**: Automated linting, formatting, and conventional commit enforcement powered by Husky, Commitlint, ESLint, Oxlint, and Prettier.

---

## 🛠 Tech Stack

| Category                | Technology                                       |
| :---------------------- | :----------------------------------------------- |
| **Framework**           | [NestJS](https://nestjs.com/) v12                |
| **Language**            | [TypeScript](https://www.typescriptlang.org/) v6 |
| **Database**            | [PostgreSQL](https://www.postgresql.org/)        |
| **ORM**                 | [TypeORM](https://typeorm.io/)                   |
| **API Documentation**   | [Swagger / OpenAPI](https://swagger.io/)         |
| **Validation**          | `class-validator`, `class-transformer`           |
| **Testing**             | [Jest](https://jestjs.io/), Supertest            |
| **Code Quality**        | ESLint, Oxlint, Prettier                         |
| **Git Hooks & Commits** | Husky, Lint-Staged, Commitlint                   |

---

## 📂 Project Structure

```text
api/
├── .husky/                  # Git hooks (pre-commit, commit-msg)
├── src/
│   ├── database/            # Database configuration, entities & migrations
│   │   ├── entities/        # TypeORM entity definitions
│   │   │   ├── base.entity.ts
│   │   │   └── user.entity.ts
│   │   ├── migrations/      # Version-controlled migration files
│   │   ├── data-source.ts   # TypeORM CLI DataSource config
│   │   └── database.module.ts
│   ├── app.controller.ts    # Base health check & root controllers
│   ├── app.module.ts        # Root application module
│   ├── app.service.ts       # Base application service
│   └── main.ts              # Application bootstrap & configuration
├── test/                    # End-to-End (e2e) tests & Jest config
├── .env.example             # Environment variable template
├── .lintstagedrc.json       # Lint-staged configuration
├── .commitlintrc.json       # Commitlint conventional commits config
├── package.json             # Scripts & dependencies
└── tsconfig.json            # TypeScript compiler configuration
```

---

## 🚀 Getting Started

### Partner startup on branch repair

Keep sibling folders named `api` and `dashboard`, both on `repair`. Follow the
[PowerShell team quick start](https://github.com/Ez-HealthCare/ez-healthcare-dashboard/blob/repair/README.md#partner-quick-start-powershell)
for either the all-Docker demo or local FE/BE with Docker DB/Mailpit. It includes
first-time env setup, migration/seed, URLs, demo accounts and stop commands.

Daily local API command is `npm run dev` (or `npm run start:dev`), port **3000**;
dashboard `npm run dev` uses **3001**. Start the database configured in this repo's
`.env` and Mailpit first. Do not start Docker API alongside the local API.
Node.js **24** is the validated runtime. Real `.env`/secrets are not in Git:
copy `.env.example` only if `.env` does not exist, then set your own credentials.

An existing developer DB may use 5432; the isolated dashboard Compose auth-test
DB uses 5434. Preserve existing DB settings/data. On a fresh isolated test DB only:

```powershell
npm ci
npm run build
node --loader ./esm-loader.mjs dist/database/setup.js
node --loader ./esm-loader.mjs dist/database/seeds/seed.js --auth-only
npm run dev
```

`setup.js` runs all pending migrations; the seed command writes demo accounts.
For an existing DB, back up and inspect pending migrations first, then approve
the required changes instead of blindly running setup/seed. Never reset a volume
to fix an auth error. Read-only migration status after building:

```powershell
node --loader ./esm-loader.mjs node_modules/typeorm/cli.js migration:show -d dist/database/data-source.js
```

`AddAuthSessions1792050000000` is required for current auth: it creates
`auth_sessions`, widens `patient_otps.otpCode` from varchar(10) to varchar(64), and
invalidates old OTPs. Without it an email can arrive but OTP persistence returns 500. A migration executed on another machine is not applied to your DB by Git
pull. Request a fresh OTP after migration; observe the 60-second resend limit.
Do not truncate hashes or enable `DB_SYNC` as a workaround. The earlier local
auth repair applied only this migration; NEWS2/audit remains pending on that DB.

### Application configuration

Local startup: configure this repo's ignored `.env` (`PORT=3000`, database
credentials, JWT/signature keys, `CORS_ORIGINS=http://localhost:3001` and
`OTP_DELIVERY_URL=http://localhost:8025/api/v1/send`). Copy `.env.example` only
on first setup; do not overwrite existing credentials. Start that database and
Mailpit before using `npm run dev` (alias of `npm run start:dev`). Frontend runs
separately on port 3001 with `npm run dev` in `../dashboard`.

All npm start variants reuse `esm-loader.mjs` for the existing extensionless ESM
imports, matching Docker. `start`/`start:dev`/`start:debug` use the Nest CLI's shell
exec option; `start:prod` runs the compiled entry with the same loader. Port comes
from `ApiConfigService` and `.env` (default 3000); process env overrides still apply.
Do not run the Docker API and local API simultaneously on port 3000. This repo's
local database and the dashboard Compose auth-test database are distinct; preserve
the configured credentials/database and do not reseed or recreate volumes to start.

Import the global `ApiConfigModule` once in `AppModule`. Runtime consumers inject
`ApiConfigService` from `src/config/api-config.service.ts`, not `ConfigService`,
`dotenv` or `process.env`:

```ts
constructor(private readonly config: ApiConfigService) {}
// this.config.database, .port, .jwtSecret, .signatureSecret,
// .corsOrigins, .otpDelivery, .isProduction
```

The service reads `.env` through the installed Nest config module. Process env
takes precedence. It parses port numbers/boolean flags, validates HTTP(S) mail
URLs and exact CORS origins, and checks production JWT secrets before consumers
initialize. Validation errors name the setting without echoing secret values.
`DB_SYNC`/`DB_LOGGING` must be `true` or `false`; ports must be in 1–65535.
Missing OTP delivery remains an explicit unavailable service, never a fake OTP.

CLI/migration/seed code uses `ApiConfigService.fromEnvironment().database` after
loading `.env` through that factory. This shares the same database parsing without
requiring a Nest container, JWT or mail configuration. It does not open a database
connection by itself. Static business values stay in `src/common/constants/`.
ESLint prevents runtime consumers outside `src/config/` from bypassing this boundary.

Existing defaults are preserved; production still requires a JWT secret of at
least 32 characters. Set `SIGNATURE_SECRET` to a strong deployment-specific HMAC
key: the legacy fallback is retained for compatibility, not a production key.
See `.env.example`; never log or return the config object.

### Prerequisites

Ensure you have the following installed on your machine:

- **Node.js**: `v24.x` (validated local/Docker runtime)
- **npm**: `v9.x` or later
- **PostgreSQL**: `v14+` running locally or via Docker

---

### Installation

1. **Clone the repository:**

   ```bash
   git clone git@github.com:Ez-HealthCare/ez-healthcare-api.git
   cd ez-healthcare-api
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the example environment file and configure your credentials:

   ```bash
   cp .env.example .env
   ```

   Configure the `.env` file with your PostgreSQL connection parameters:

   ```env
   # Application
   PORT=3000
   NODE_ENV=development

   # PostgreSQL Database Configuration
   DB_HOST=localhost
   DB_PORT=5432
   DB_USERNAME=postgres
   DB_PASSWORD=postgres
   DB_DATABASE=tlcn_api_db
   DB_SYNC=false
   DB_LOGGING=true
   ```

---

## 🗄 Database & Migrations

We use TypeORM migrations to track and execute schema changes safely.

| Command                                                        | Description                                          |
| :------------------------------------------------------------- | :--------------------------------------------------- |
| `npm run migration:run`                                        | Executes all pending migrations                      |
| `npm run migration:revert`                                     | Reverts the last executed migration                  |
| `npm run migration:show`                                       | Displays the status of all migrations                |
| `npm run migration:generate -- src/database/migrations/<Name>` | Generates a new migration from entity schema changes |
| `npm run migration:create -- src/database/migrations/<Name>`   | Creates a blank migration file                       |

> **Note**: For production and development safety, `DB_SYNC` should be set to `false`, and schema changes should always be applied via migrations.

---

## ⚡ Running the Application

```bash
# Development mode with hot-reload
npm run start:dev

# Standard start
npm run start

# Debug mode
npm run start:debug

# Production build & run
npm run build
npm run start:prod
```

Once started:

- **REST API Base URL**: [http://localhost:3000/api](http://localhost:3000/api)
- **Swagger Documentation**: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)

---

## 🧪 Testing

```bash
# Unit tests
npm run test

# Unit tests in watch mode
npm run test:watch

# Test coverage report
npm run test:cov

# End-to-end (e2e) tests
npm run test:e2e
```

---

## 🎨 Code Quality & Conventions

### Formatting & Linting

```bash
# Run ESLint check
npm run lint

# Automatically fix ESLint errors
npm run lint:fix

# Ultra-fast linting with Oxlint
npm run oxlint

# Format code with Prettier
npm run format

# Verify formatting without writing
npm run format:check
```

### Git Commit Guidelines

This project strictly adheres to [Conventional Commits](https://www.conventionalcommits.org/) via **Commitlint** and **Husky**.

Format:

```text
<type>(<scope>): <subject>
```

Common types:

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Formatting, missing semicolons, etc. (no code changes)
- `refactor`: Refactoring production code
- `test`: Adding or refactoring tests
- `chore`: Updating build tasks, package manager configs, etc.

_Example:_ `feat(auth): implement jwt authentication strategy`

---

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feat/your-feature-name`
2. Commit your changes adhering to commitlint conventions
3. Push to your branch: `git push origin feat/your-feature-name`
4. Open a Pull Request

---

## 📄 License

This project is licensed under private proprietary terms for Ez-HealthCare.
