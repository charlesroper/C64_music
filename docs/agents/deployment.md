# GitHub Pages deployment

Read this file when the user says "ship it", "deploy" or asks to publish.

## Remotes and target

- `origin` points to upstream `MartinGalway/C64_music`.
- `fork` points to `charlesroper/C64_music`.
- Pass `-R charlesroper/C64_music` to every `gh` command.
- Push releases only to `fork main`.
- Live URL: `https://charlesroper.github.io/C64_music/`.
- GitHub Pages serves the root `/` of `main` on `fork`.

## Release sequence

1. Run `npm run bump`. Completion: all seven version locations show the new CalVer.
2. Commit the release. The `pre-commit` hook runs lint and tests, leaving the working tree clean.
3. Confirm the latest `NARRATIVE.md` Section 8 entry already links its commit SHA(s) (write Section 8 entries after committing the code they describe).
4. Run `npm run deploy`. It verifies a clean tree, the `fork` remote and the latest Section 8 commit link, runs `npm run check:lint`, `npm test`, `npm run check:help-popovers` and `npm run check:layout`, then pushes `HEAD` to `fork/main`.
5. Verify the live build from the Pages workflow run and push the `deploy-v<CalVer>` tag by running `npm run deploy:verify`, or manually:
   - Run `gh run list -R charlesroper/C64_music --limit 5` and find the `pages build and deployment` run for the release commit.
   - Run `gh run view <run-id> -R charlesroper/C64_music --json headSha,status,conclusion,jobs`. Confirm the SHA matches the release commit, the run is completed and successful, and the `deploy` job succeeded.
   - Confirm the live version with `curl -s https://charlesroper.github.io/C64_music/src/version.js`.
   - Do not rely on `gh api repos/charlesroper/C64_music/pages/builds/latest` alone. It can lag behind, or attribute a build to the previous commit even when the workflow run is for the new one.

   Completion: report the live URL, CalVer version, commit hash and workflow run ID.

## Release tags

- After a successful deploy, tag the commit `deploy-v<CalVer>` and push it to `fork`.
- Create `known-good-v<CalVer>` only after the user confirms the live build is good. Never create it automatically.
