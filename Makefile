REGISTRY := forgejo.r4ven.lan/korstrike
DOCKERHUB_USER := lans
GITHUB_USER := lans
TAG ?= latest

DOCKERHUB_IMAGE := $(DOCKERHUB_USER)/korstrike
GHCR_IMAGE := ghcr.io/$(GITHUB_USER)/korstrike

.PHONY: docker-build test docker-release release

docker-build:
	docker build -f Dockerfile \
		-t $(REGISTRY)/korstrike:$(TAG) \
		-t $(DOCKERHUB_IMAGE):$(TAG) \
		-t $(GHCR_IMAGE):$(TAG) \
		.

test: docker-build
	./smoke-test.sh $(REGISTRY)/korstrike:$(TAG)

docker-release: docker-build
	docker push $(REGISTRY)/korstrike:$(TAG)
	docker push $(DOCKERHUB_IMAGE):$(TAG)
	docker push $(GHCR_IMAGE):$(TAG)

release: test
	git add -A
	git diff --cached --quiet || git commit -m "Release $(TAG)"
	git push
	$(MAKE) docker-release
