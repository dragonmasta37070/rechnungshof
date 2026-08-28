.PHONY: test
test:
	uv run pytest tests --doctest-modules --cov=abrechnung

.PHONY: dev-web
dev-web:
	pnpm --filter web run dev

.PHONY: format
format:
	uv run ruff format
	npx oxfmt

.PHONY: check-format
check-format:
	uv run ruff format --check

.PHONY: check-format-frontend
check-format-frontend:
	npx oxfmt --check

.PHONY: lint
lint: pylint typecheck ruff

.PHONY: pylint
pylint:
	uv run pylint ./**/*.py

.PHONY: ruff
ruff:
	uv run ruff check

.PHONY: ruff-fix
ruff-fix:
	uv run ruff check --fix

.PHONY: typecheck
typecheck:
	uv run ty check

.PHONY: docs
docs:
	uv run sphinx-build docs docs/_build

.PHONY: serve-docs
serve-docs:
	uv run sphinx-autobuild docs docs/_build

.PHONY: generate-openapi
generate-openapi:
	mkdir -p api
	uv run abrechnung -c config.yaml show-openapi > api/openapi.json
	pnpm -w -r run generate-openapi

.PHONY: generate-openapi-angular
generate-openapi-angular:
	mkdir -p api
	curl -sf http://localhost:9980/openapi.json | python3 -m json.tool > api/openapi.json
	pnpm exec typed-openapi api/openapi.json \
		-o apps/frontend/src/app/api/schema.ts --schemas-only
