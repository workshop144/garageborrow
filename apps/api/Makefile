# SAM `BuildMethod: makefile` targets for every Lambda in infra/template.yaml.
#
# `pnpm build` (esbuild) has already bundled each handler into dist/ from the
# pnpm lockfile. These targets only copy that output into $(ARTIFACTS_DIR); they
# never run npm, so `sam build` resolves no dependencies and runs no install
# scripts (S4-3). @aws-sdk/* comes from the Lambda runtime. The bundles are ESM,
# so the artifact gets a dependency-free package.json with "type": "module".
#
# Each function gets only its own bundle and that bundle's source map (the
# template sets NODE_OPTIONS=--enable-source-maps for readable stack traces),
# not the other handlers' code. BUNDLE must match the function's Handler path.

FUNCTIONS := ApiFunction NotifierFunction ImageResizerFunction AccountCleanerFunction \
	DefineAuthChallengeFunction CreateAuthChallengeFunction VerifyAuthChallengeFunction

build-ApiFunction: BUNDLE := index.js
build-NotifierFunction: BUNDLE := notifier.js
build-ImageResizerFunction: BUNDLE := image-resizer.js
build-AccountCleanerFunction: BUNDLE := account-cleaner.js
build-DefineAuthChallengeFunction: BUNDLE := define-auth-challenge.mjs
build-CreateAuthChallengeFunction: BUNDLE := create-auth-challenge.mjs
build-VerifyAuthChallengeFunction: BUNDLE := verify-auth-challenge.mjs

.PHONY: $(addprefix build-,$(FUNCTIONS))

$(addprefix build-,$(FUNCTIONS)):
	@test -n "$(ARTIFACTS_DIR)" || { echo "ARTIFACTS_DIR is not set (run via sam build)" >&2; exit 1; }
	@test -n "$(BUNDLE)" || { echo "$@ has no BUNDLE mapping" >&2; exit 1; }
	@test -f "dist/$(BUNDLE)" || { echo "apps/api/dist/$(BUNDLE) is missing: run pnpm build before sam build" >&2; exit 1; }
	mkdir -p "$(ARTIFACTS_DIR)/dist"
	cp "dist/$(BUNDLE)" "dist/$(BUNDLE).map" "$(ARTIFACTS_DIR)/dist/"
	printf '{\n  "type": "module"\n}\n' > "$(ARTIFACTS_DIR)/package.json"
