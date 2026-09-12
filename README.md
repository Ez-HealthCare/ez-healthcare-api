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

### Prerequisites

Ensure you have the following installed on your machine:

- **Node.js**: `v18.x` or `v20.x` or later
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
