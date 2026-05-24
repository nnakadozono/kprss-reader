# kprss integration

The planned direction is to move this project into the `kprss` repository,
probably as `reader/`.

Suggested target layout:

```text
kprss/
  reader/
    public/
    scripts/
      generate_site.py
      deploy_site.sh
    docs/
    dist/        # ignored
```

Before moving files, inspect and settle any uncommitted changes in the `kprss`
repository. Do not start the integration while unrelated changes are mixed into
the same working tree.

Integration checklist:

1. Move this repo's `public/`, `scripts/`, `docs/`, `README.md`, `.env.sample`,
   `.gitignore`, and `AGENT.md` content into `kprss/reader/` as appropriate.
2. Update paths in commands from `scripts/...` to `reader/scripts/...` if the
   scripts are run from the `kprss` repository root.
3. Keep `reader/dist/` ignored.
4. Add hosting infrastructure to the existing `kprss` Terraform, not to this
   reader project.
5. Deploy reader app files to `s3://$KPRSS_READER_SITE_BUCKET/$KPRSS_READER_SITE_PREFIX/`.
6. Generate reader JSON from the existing `kprss` fetch/write Lambda after the
   SQLite database update succeeds.

Manual deploy modes after integration:

```sh
reader/scripts/deploy_site.sh --app-only
reader/scripts/deploy_site.sh --data-only
reader/scripts/deploy_site.sh --full
```

Use `--app-only` for UI-only changes when the local database may be stale.
