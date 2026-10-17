# Releasing

All public packages under `packages/` are published together, at one
version. The version comes only from the git tag. The `version` fields in
the repo stay at `0.0.0`.

## Publish a release

1. On GitHub, open **Releases → Draft a new release**.
2. Type a new tag on `main`: `v0.1.0` for a release, or `v0.1.0-rc.0` for a
   release candidate.
3. Write the release notes.
4. For a release candidate, select **Set as a pre-release**.
5. Click **Publish release**.

The [release workflow](.github/workflows/release.yml) then:

- checks that the tag is on `main`, is `v` + a semantic version, and agrees
  with the pre-release option;
- checks that the version is not already on npm;
- runs `vp check` and the tests;
- builds, packs and publishes every package. A release goes to the npm
  dist-tag `latest`. A pre-release goes to its label, for example `rc`, so
  `npm install` without a tag never installs it.

The job uses the `npm` GitHub environment. If that environment has required
reviewers, the job waits for approval before it runs.

## Authentication

The workflow uses npm trusted publishing (OIDC). Each package on npmjs.com
trusts this repository's `release.yml` workflow and the `npm` environment.
No npm token is stored in GitHub.

## First publish of a new package

npm can only add a trusted publisher to a package that already exists. Thus
the first version of a new package is published from a maintainer's
machine, with Node 24:

```sh
vp install
npm login
node scripts/release.ts v0.1.0-rc.0 --dry-run   # check the output first
node scripts/release.ts v0.1.0-rc.0
```

The script restores every `package.json` when it finishes.

Then, for each new package on npmjs.com, open **Settings**:

1. Under **Trusted Publisher**, select **GitHub Actions** and enter:
   - Organization or user: `paulsilcock`
   - Repository: `litmus`
   - Workflow filename: `release.yml`
   - Environment name: `npm`
2. Under **Publishing access**, select **Require two-factor authentication
   and disallow tokens**.

npm does not check these settings when you save them. A mistake shows only
when the workflow runs.

Create later releases with the workflow. It refuses a version that is
already on npm, so the next workflow release after a manual `v0.1.0-rc.0`
is `v0.1.0-rc.1`.
