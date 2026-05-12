HUGO ?= hugo
GO ?= go
CONTRACTS_CONFIG ?= contracts/api-contracts.yaml
ROOT_DIR ?= .

.PHONY: build-site validate-contracts

build-site:
	$(HUGO) --gc --buildFuture

validate-contracts:
ifndef SKIP_HUGO_BUILD
	$(HUGO) --gc --buildFuture
endif
	$(GO) run ./cmd/validate-contracts --root $(ROOT_DIR) --config $(CONTRACTS_CONFIG)
