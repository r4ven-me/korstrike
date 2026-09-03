DOCKERHUB_USER := r4venme
GITHUB_USER := r4ven-me
TAG ?= latest

DOCKERHUB_IMAGE := $(DOCKERHUB_USER)/korstrike
GHCR_IMAGE := ghcr.io/$(GITHUB_USER)/korstrike

.PHONY: docker-build test docker-release release

docker-build:
	docker build -f Dockerfile \
		-t $(DOCKERHUB_IMAGE):$(TAG) \
		-t $(GHCR_IMAGE):$(TAG) \
		.

test: docker-build
	./smoke-test.sh $(DOCKERHUB_IMAGE):$(TAG)

docker-release: docker-build
	docker push $(DOCKERHUB_IMAGE):$(TAG)
	docker push $(GHCR_IMAGE):$(TAG)

release: test
	git add -A
	git diff --cached --quiet || git commit -m "Release $(TAG)"
	git push
	$(MAKE) docker-release
