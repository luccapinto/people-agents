COMPOSE = docker compose -p atrium -f deploy/docker-compose.yml
BACKEND = cd backend &&
FRONTEND = cd frontend &&
export ATRIUM_TODAY ?= 2026-10-01
EMBEDDINGS ?= fastembed

.PHONY: help install db-up db-down generate goldens seed api web dev test test-backend test-frontend \
        lint build build-demo preview-demo e2e e2e-demo smoke-live up down

help:
	@echo "make dev          Postgres + seed + API (8765) + web (5175), deterministic model"
	@echo "make test         back-end (pytest) and front-end (vitest) suites"
	@echo "make up / down    full stack with Docker Compose (db + api + web on 127.0.0.1:5175)"
	@echo "make build-demo   static demo in frontend/dist-demo (VITE_BASE=/sub-path/ to change the base)"
	@echo "make e2e-demo     Playwright against the static demo served under a sub-path"
	@echo "make smoke-live   a few real conversations with the configured LLM (costs money; opt-in)"

install:
	$(BACKEND) uv sync --all-extras
	$(FRONTEND) npm ci

db-up:
	$(COMPOSE) up -d --wait db

db-down:
	$(COMPOSE) down

generate:
	$(BACKEND) uv run atrium generate

goldens: db-up
	$(BACKEND) uv run atrium goldens

seed: db-up
	$(BACKEND) ATRIUM_EMBEDDINGS=$(EMBEDDINGS) uv run atrium seed --reset

api:
	$(BACKEND) ATRIUM_EMBEDDINGS=$(EMBEDDINGS) uv run atrium serve --host 127.0.0.1 --port 8765

web:
	$(FRONTEND) npm run dev

dev: seed
	@trap 'kill 0' INT TERM; \
	(cd backend && ATRIUM_EMBEDDINGS=$(EMBEDDINGS) uv run atrium serve --host 127.0.0.1 --port 8765) & \
	(cd frontend && npm run dev) & wait

test: test-backend test-frontend

test-backend: db-up
	$(BACKEND) uv run pytest -p no:warnings

test-frontend:
	$(FRONTEND) npm test

lint:
	$(BACKEND) uv run ruff check atrium tests
	$(FRONTEND) npm run typecheck

build:
	$(FRONTEND) npm run build

build-demo:
	$(FRONTEND) npm run build:demo

preview-demo:
	$(FRONTEND) npm run preview:demo

# The real-app specs mutate data (vacation requests, Studio agents): start from a fresh seed.
# Needs the API on 8765 and the web dev server on 5175 (make dev).
e2e: seed
	$(FRONTEND) npm run e2e

e2e-demo:
	$(FRONTEND) npm run e2e:demo

smoke-live: db-up
	$(BACKEND) uv run pytest -m live -p no:warnings -o addopts="" -s tests/live

up:
	$(COMPOSE) up -d --build --wait

down:
	$(COMPOSE) down
