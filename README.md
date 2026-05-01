<div align="center">

# 📦 Product Manager

**A modern, full-stack inventory management application**
built for the web and desktop — fast, real-time, and production-ready.

[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?style=flat-square&logo=vite)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com)
[![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express)](https://expressjs.com)
[![DynamoDB](https://img.shields.io/badge/AWS-DynamoDB-4053d6?style=flat-square&logo=amazondynamodb)](https://aws.amazon.com/dynamodb)
[![LocalStack](https://img.shields.io/badge/LocalStack-AWS%20Emulator-2a9d8f?style=flat-square)](https://localstack.cloud)
[![Tauri](https://img.shields.io/badge/Tauri-Desktop-ffc131?style=flat-square&logo=tauri)](https://tauri.app)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?style=flat-square&logo=docker)](https://www.docker.com)

</div>

<br/>
🌐 Live Demo → product-manager-chi-eosin.vercel.app

---

## 🐳 Docker (Local Development)

Run the entire stack locally — no Node.js installation required.

The setup uses **two Docker Compose files**:
- `docker-compose.localstack.yml` — starts LocalStack (AWS DynamoDB emulator)
- `docker-compose.yml` — starts the frontend and backend containers

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

### Quick Start

```bash
# Clone the repo
git clone https://github.com/your-username/product_manager.git
cd product_manager/server

# Copy and fill in your environment variables
cp .env.example .env

# Step 1 — Start LocalStack (DynamoDB emulator) first
cd server
docker compose -f docker-compose.localstack.yml up -d

# Step 2 — Verify LocalStack is healthy before continuing
docker ps
# You should see localstack_dynamo with status (healthy)

# Step 3 — Start the app containers
docker compose up --build

# Step 4 — Start the app containers
#you can run the backend app by 
npm run dev 
```

> ⚠️ **Important:** Always start LocalStack before the backend. The backend connects to DynamoDB on startup and will crash if LocalStack is not running.

| Service   | URL                   |
|-----------|-----------------------|
| Frontend  | http://localhost      |
| Backend   | http://localhost/api  |
| LocalStack| http://localhost:4566 |

### Container Architecture

| Container              | Image                      | Role                                  |
|------------------------|----------------------------|---------------------------------------|
| `localstack_dynamo`    | localstack/localstack:3    | AWS DynamoDB emulator on port 4566    |
| `product_manager_ui`   | nginx:alpine               | Serves the React build + proxies API  |
| `product_manager_api`  | node:20-alpine             | Express REST API on port 5001         |

### Common Commands

```bash
# ── LocalStack (DynamoDB) ──────────────────────────────────────

# Start LocalStack
docker compose -f docker-compose.localstack.yml up -d

# Stop LocalStack
docker compose -f docker-compose.localstack.yml down

# Check LocalStack health
docker ps
# localstack_dynamo should show (healthy)

# View LocalStack logs
docker logs localstack_dynamo

# ── App containers ─────────────────────────────────────────────

# Start (detached — terminal stays free)
docker compose up -d

# View logs
docker compose logs -f
docker compose logs -f backend    # backend only
docker compose logs -f frontend   # frontend only

# Check container status
docker compose ps

# Shell into backend container
docker compose exec backend sh

# Stop containers
docker compose down

# Full rebuild after code changes
docker compose down
docker compose build --no-cache
docker compose up
```

### Switching from LocalStack to Real AWS

The app is fully production-ready for real AWS DynamoDB. To switch, open `server/.env` and make one change:

```env
# Remove this line to use real AWS:
# DYNAMO_ENDPOINT=http://localhost:4566

# Replace fake credentials with your real AWS credentials:
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_real_key
AWS_SECRET_ACCESS_KEY=your_real_secret
```

No code changes required — the AWS SDK automatically points to real AWS when `DYNAMO_ENDPOINT` is absent.

---

## ✨ Overview

Product Manager is a full-featured inventory platform that combines a responsive React frontend with a Node/Express backend and AWS DynamoDB for data storage. It supports real-time product and category management, dashboard analytics, a recycle-bin recovery system, PDF export, Cloudinary image uploads, and a polished light/dark theme — all optionally packageable as a native desktop app via Tauri.

The database layer was migrated from Turso (SQLite) to **AWS DynamoDB** using a multi-table design with UUID v4 keys and the AWS SDK v3 Document Client. LocalStack is used locally to emulate AWS services with zero cost and no cloud account required.

---

## 🚀 Feature Highlights

### 🔄 Real-Time Product Management
Add, edit, duplicate, delete, and update stock — all changes are reflected instantly without a manual page refresh.

### ♻️ Recycle Bin & Recovery
- Soft-delete for both products and categories
- 30-day retention window with countdown display
- Restore a category and all of its linked products in one action
- Permanently delete when ready

### 📊 Dashboard Analytics
- Inventory snapshot: total value, average price, total units
- Stock status breakdown: in-stock / low-stock / out-of-stock
- Category breakdown filtered to active categories only
- Price range distribution chart
- 5 most recently added products
- Low-stock alert list

### 🎨 Theme Support
- Light and dark mode toggle
- Improved sidebar contrast and product-selection readability in dark mode

### 📄 Product Operations
- Edit technical details per product
- Download a formatted PDF per product
- Upload product images via Cloudinary

---

## 🛠️ Tech Stack

| Layer        | Technology                                              |
|--------------|---------------------------------------------------------|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4, Zustand   |
| **Backend**  | Node.js, Express                                        |
| **Database** | AWS DynamoDB via AWS SDK v3 Document Client             |
| **Local DB** | LocalStack (free AWS emulator running in Docker)        |
| **Media**    | Cloudinary + `multer-storage-cloudinary`                |
| **PDF**      | pdfmake                                                 |
| **Desktop**  | Tauri                                                   |
| **Local Dev**| Docker, Docker Compose, nginx                           |

---

## 📁 Project Structure

```
product_manager/
├── src/                        # React frontend
│   ├── components/             # UI components
│   ├── services/               # API service layer
│   ├── store/                  # Zustand stores
│   └── context/                # Legacy context (see Notes)
├── server/                     # Express backend
│   ├── routes/
│   │   ├── products.js         # Product CRUD routes
│   │   ├── categories.js       # Category routes
│   │   ├── dashboard.js        # Dashboard stats
│   │   └── recycleBin.js       # Recycle bin routes
│   ├── server.js               # App entry point
│   ├── db.js                   # DynamoDB client + table bootstrap
│   ├── cloudinary.js           # Cloudinary config
│   └── docker-compose.localstack.yml  # LocalStack setup
├── src-tauri/                  # Tauri desktop scaffold
├── public/
├── Dockerfile                  # Frontend Docker build
├── nginx.conf                  # nginx reverse proxy config
├── docker-compose.yml          # Multi-container orchestration
├── package.json
├── vite.config.ts
└── README.md
```

---

## ⚙️ Environment Variables

Create a `.env` file inside the `server/` directory:

```env
# ── AWS DynamoDB via LocalStack (local development) ────────────
DYNAMO_ENDPOINT=http://localhost:4566
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test

# ── AWS DynamoDB (production — remove DYNAMO_ENDPOINT above) ───
# AWS_REGION=us-east-1
# AWS_ACCESS_KEY_ID=your_real_key
# AWS_SECRET_ACCESS_KEY=your_real_secret

# ── Media — Cloudinary ─────────────────────────────────────────
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# ── Server ─────────────────────────────────────────────────────
PORT=5001
```

> **Optional** — Frontend API base URL (defaults to `http://localhost:5001/api` if omitted):
> ```env
> VITE_API_URL=http://localhost:5001/api
> ```

---

## 🗄️ DynamoDB Schema

The app uses a **multi-table design** with UUID v4 primary keys. Tables are created automatically on server startup via `db.js`.

| Table          | Primary Key  | Description                        |
|----------------|--------------|------------------------------------|
| `Products`     | `productId`  | All product data + stock status    |
| `Categories`   | `categoryId` | Category metadata + soft-delete    |
| `StockHistory` | `historyId`  | Stock change log per product       |
| `AppSettings`  | `settingKey` | App-level key/value configuration  |

### Key DynamoDB operations used

| Operation       | SDK Command       | Used for                        |
|-----------------|-------------------|---------------------------------|
| Get by ID       | `GetCommand`      | Fetch single product/category   |
| List all        | `ScanCommand`     | Fetch all products/categories   |
| Create          | `PutCommand`      | Insert new item with UUID v4    |
| Update fields   | `UpdateCommand`   | Partial update with SET/REMOVE  |
| Hard delete     | `DeleteCommand`   | Permanent deletion              |

---

## 🧑‍💻 Local Development

### Option A — Manual (recommended for development)

#### 1. Start LocalStack first

```bash
cd server
docker compose -f docker-compose.localstack.yml up -d

# Wait ~15 seconds then verify it's healthy
docker ps
# localstack_dynamo should show (healthy)
```

#### 2. Install dependencies

```bash
# Frontend
npm install

# Backend
cd server && npm install
```

#### 3. Start development servers

Open two terminals:

```bash
# Terminal 1 — Backend
cd server
npm run dev
# You should see:
# 🚀 Server running on port 5001
# ✅ Table created: Products
# ✅ Table created: Categories
# ✅ Table created: StockHistory
# ✅ Table created: AppSettings
# ✅ DynamoDB ready (LocalStack)

# Terminal 2 — Frontend
npm run dev
```

#### 4. Open in browser

| Service  | URL                    |
|----------|------------------------|
| Frontend | http://localhost:5173  |
| Backend  | http://localhost:5001  |
| DynamoDB | http://localhost:4566  |

### Option B — Docker

See the [Docker section](#-docker-local-development) above.

---

## 📜 Available Scripts

### From the project root

| Script              | Description                          |
|---------------------|--------------------------------------|
| `npm run dev`       | Start Vite frontend dev server       |
| `npm run build`     | Build frontend for production        |
| `npm run preview`   | Preview production build             |
| `npm run lint`      | Run ESLint                           |
| `npm run test`      | Run Vitest unit tests                |
| `npm run test:e2e`  | Run Playwright end-to-end tests      |
| `npm run test:api`  | Run backend API tests                |
| `npm run tauri`     | Run Tauri CLI command                |

### From `server/`

| Script          | Description                            |
|-----------------|----------------------------------------|
| `npm run dev`   | Start backend with nodemon (hot reload)|
| `npm run start` | Start backend with node                |

---

## 🌐 API Reference

### Products

| Method   | Endpoint                         | Description             |
|----------|----------------------------------|-------------------------|
| `GET`    | `/api/products`                  | List all active products|
| `GET`    | `/api/products/:id`              | Get single product      |
| `POST`   | `/api/products`                  | Create product          |
| `PUT`    | `/api/products/:id`              | Update product          |
| `DELETE` | `/api/products/:id`              | Soft-delete product     |
| `PUT`    | `/api/products/:id/stock`        | Update stock level      |
| `POST`   | `/api/products/:id/duplicate`    | Duplicate product       |
| `GET`    | `/api/products/:id/pdf`          | Download product PDF    |
| `GET`    | `/api/products/:id/stock-history`| Get stock change log    |

### Categories

| Method   | Endpoint               | Description                           |
|----------|------------------------|---------------------------------------|
| `GET`    | `/api/categories`      | List all active categories            |
| `GET`    | `/api/categories/:id`  | Get single category                   |
| `POST`   | `/api/categories`      | Create or restore category            |
| `PUT`    | `/api/categories/:id`  | Update category                       |
| `DELETE` | `/api/categories/:id`  | Soft-delete category + linked products|

### Recycle Bin

| Method   | Endpoint                                    | Description                     |
|----------|---------------------------------------------|---------------------------------|
| `GET`    | `/api/recycle-bin`                          | List deleted products/categories|
| `POST`   | `/api/recycle-bin/products/:id/restore`     | Restore deleted product         |
| `DELETE` | `/api/recycle-bin/products/:id/permanent`   | Permanently delete product      |
| `POST`   | `/api/recycle-bin/categories/:id/restore`   | Restore category + products     |

### Dashboard & Uploads

| Method | Endpoint               | Description                  |
|--------|------------------------|------------------------------|
| `GET`  | `/api/dashboard/stats` | Fetch all dashboard KPIs     |
| `POST` | `/api/upload-image`    | Upload image to Cloudinary   |

---

## 📦 Build & Release

### Frontend production build

```bash
npm run build
```

### Desktop packaging (Tauri)

```bash
npm run tauri build
```

---

## 🏷️ Git Tag & Release Workflow

#### Step 1 — Ensure a clean, up-to-date branch

```bash
git status
git pull origin main
```

#### Step 2 — Run quality checks

```bash
npm run lint
npm run test
npm run build
```

#### Step 3 — Choose a semantic version

| Change type                      | Example  |
|----------------------------------|----------|
| Bug fixes only                   | `v2.2.1` |
| New backward-compatible features | `v2.3.0` |
| Breaking changes                 | `v3.0.0` |

#### Step 4 — Create an annotated tag

```bash
git tag -a v2.3.0 -m "v2.3.0: migrated database to AWS DynamoDB, LocalStack dev setup"
```

#### Step 5 — Push commits and tag

```bash
git push origin main
git push origin v2.3.0
```

#### Step 6 — Draft a GitHub release

1. Go to your repository → **Releases** → **Draft a new release**
2. Select tag: `v2.3.0`
3. Set title: `v2.3.0`
4. Add release notes

---

## 📋 Release Notes Template

```
## v2.3.0

### Summary
- Migrated database from Turso (SQLite) → AWS DynamoDB
- Multi-table DynamoDB schema with UUID v4 keys
- LocalStack integration for local development (no AWS account needed)
- AWS SDK v3 Document Client for all database operations
- Production AWS-ready — single .env change to deploy

### Backend
- db.js rewritten — DynamoDB client + auto table bootstrap on startup
- All routes migrated: products, categories, dashboard, recycleBin
- Aggregations moved from SQL to JavaScript (DynamoDB pattern)
- ScanCommand, GetCommand, PutCommand, UpdateCommand, DeleteCommand

### Infrastructure
- Added docker-compose.localstack.yml for local DynamoDB emulation
- Server port changed to 5001 (5000 reserved for other local services)

### Known Notes
- LocalStack must be running before starting the backend
- Run: docker compose -f docker-compose.localstack.yml up -d
```

---

## 🗒️ Notes

- **`DarkModeContext.tsx`** — Located at `src/context/DarkModeContext.tsx`. This is a legacy file and is **not** part of the active theme system. Theme state is managed through the Zustand theme store and the `ThemeToggle` component.
- **DynamoDB local persistence** — LocalStack data is stored in a Docker volume (`localstack_data`). Data persists between container restarts but is lost if the volume is deleted (`docker compose -f docker-compose.localstack.yml down -v`).
- **Production AWS** — Remove `DYNAMO_ENDPOINT` from `.env` and add real AWS credentials. No code changes required.