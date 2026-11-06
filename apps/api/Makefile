# SAM `BuildMethod: makefile` targets for every Lambda in infra/template.yaml.
#
# `pnpm build` (esbuild) has already bundled each handler into dist/ from the
# pnpm lockfile. These targets only copy that output into $(ARTIFACTS_DIR); they
# never run npm, so `sam build` resolves no dependencies and runs no install
# scripts (S4-3). @aws-sdk/* comes from the Lambda runtime. The bundles are ESM,
# so the artifact gets a dependency-free package.json with "type": "module".

FUNCTIONS := ApiFunction NotifierFunction ImageResizerFunction AccountCleanerFunction \
	DefineAuthChallengeFunction CreateAuthChallengeFunction VerifyAuthChallengeFunction

.PHONY: $(addprefix build-,$(FUNCTIONS))

$(addprefix build-,$(FUNCTIONS)):
	@test -n "$(ARTIFACTS_DIR)" || { echo "ARTIFACTS_DIR is not set (run via sam build)" >&2; exit 1; }
	@test -f dist/index.js || { echo "apps/api/dist is missing: run pnpm build before sam build" >&2; exit 1; }
	mkdir -p "$(ARTIFACTS_DIR)/dist"
	cp dist/*.js dist/*.mjs dist/*.map "$(ARTIFACTS_DIR)/dist/"
	printf '{\n  "type": "module"\n}\n' > "$(ARTIFACTS_DIR)/package.json"
