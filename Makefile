.PHONY: build deploy-guided deploy logs-api logs-notifier destroy validate

build:
	pnpm build && cd infra && sam build

deploy-guided:
	cd infra && sam deploy --guided

deploy:
	cd infra && sam deploy

logs-api:
	cd infra && sam logs --name api --tail

logs-notifier:
	cd infra && sam logs --name notifier --tail

destroy:
	cd infra && sam delete

validate:
	cd infra && sam validate --lint
