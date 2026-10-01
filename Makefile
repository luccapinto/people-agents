COMPOSE = docker compose -p atrium -f deploy/docker-compose.yml
BACKEND = cd backend &&

.PHONY: db-up db-down generate seed test test-backend

db-up:
	$(COMPOSE) up -d --wait db

db-down:
	$(COMPOSE) down

generate:
	$(BACKEND) uv run atrium generate

seed: db-up
	$(BACKEND) uv run atrium seed --reset

test-backend: db-up
	$(BACKEND) uv run pytest

test: test-backend
