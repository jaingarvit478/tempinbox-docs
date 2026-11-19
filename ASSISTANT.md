# Temp Email Documentation

Temp Email (tempinbox.dev) is a free temporary email service providing up to 3 persistent browser-based inboxes with no signup required.
# Sanity article ownership and synchronization

Sanity is the editorial source for the article mirrors listed in `content/sanity-map.json`.
Do not edit these generated MDX files manually. Edit the published Sanity article;
the daily sync will reflect it here. Specialist implementation guides, policies,
comparisons and other unmapped pages remain manually maintained.

The exporter reads published English articles only, using a read-only
`SANITY_READ_TOKEN` environment variable. It never mutates Sanity. In GitHub Actions,
store only this scoped token as the secret of the same name.

Scheduled sync: every 24 hours at 04:17 UTC (09:47 IST). GitHub may delay scheduled
runs or disable inactive public-repository schedules. Check workflow history.
Immediate CLI override:

```sh
gh workflow run sync-sanity.yml --repo jaingarvit478/tempinbox-docs --ref main
gh run list --repo jaingarvit478/tempinbox-docs --workflow sync-sanity.yml --limit 5
```

Local preview: `npm ci --ignore-scripts && npm run sync:preview`.
The preview path is printed and the checkout is left untouched.
`npm run sync` installs validated output locally. `--migration` is for the reviewed
first replacement of existing authored mirrors only, never scheduled runs.

Before publishing, run `npm run sync:check` with the scoped read token. This
read-only network check fails when any mapped page or its source revision differs
from the published Sanity output, including metadata-only revisions, or when a
source is missing or ineligible. It never creates a preview or writes files.
Review changes with `npm run sync:preview`, then use the normal validated sync.
The existing sync workflow checks freshness again before its commit; trusted
main-branch validation also reports drift. The external Mintlify app deploys
independently, so a push check alone does not block its deployment. Confirm the
normal public URLs after publishing. No additional schedule is created.

Validation: `npm test && npm run validate`. Generated pages use the original blog
canonical. The marker records source identity, revision and content hash; unchanged
inputs produce no commit. Both manual edits and withdrawn/missing sources stop the
sync for review. Authentication, conversion and validation failures preserve the
previous docs. Automated commits touch only mapped files and their navigation.
External Mintlify app deployment is checked after every changed automation run.
`npm test` stays offline and needs no token; the separate `sync:check` command is
the live-source publish check. Pull-request validation never receives the token.
