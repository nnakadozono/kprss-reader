# Hosting

The reader should be hosted from the existing `kprss` AWS environment rather
than a separate stack. Keep the generated site under a prefix in the existing
S3 bucket and expose that prefix through CloudFront.

Recommended object layout:

```text
s3://YOUR_KPRSS_BUCKET/
  reader/
    site/
      index.html
      assets/
      data/
        manifest.json
        latest.json
        YYYY-MM-DD.json
```

Set CloudFront's S3 origin path to `/reader/site` so the public URLs stay clean:

```text
https://DISTRIBUTION.cloudfront.net/
https://DISTRIBUTION.cloudfront.net/data/latest.json
```

## Terraform ownership

The hosting infrastructure should live in the `kprss` repository Terraform,
because that repository already owns the bucket, Lambda, IAM, and Terraform
state.

Add these resources there:

- CloudFront distribution with the existing S3 bucket as origin
- Origin Access Control for private S3 reads
- bucket policy that allows CloudFront to read only `reader/site/*`
- CloudFront Function for Basic Auth on viewer requests
- cache policies:
  - short TTL for `/`, `/index.html`, `/data/manifest.json`, `/data/latest.json`
  - long TTL for `/assets/*` and `/data/YYYY-MM-DD.json`

## Manual deploy

Configure `.env`:

```sh
KPRSS_READER_SITE_BUCKET=YOUR_KPRSS_BUCKET
KPRSS_READER_SITE_PREFIX=reader/site
KPRSS_READER_CLOUDFRONT_DISTRIBUTION_ID=YOUR_DISTRIBUTION_ID
```

Deploy everything from the local database:

```sh
scripts/deploy_site.sh
```

Deploy only app files without touching `data/`:

```sh
scripts/deploy_site.sh --app-only
```

Generate and deploy only `data/`:

```sh
scripts/deploy_site.sh --data-only
```

Use `--app-only` when the local database may be stale and you only want to
publish HTML/CSS/JS changes.

## JSON generation direction

Prefer generating reader JSON in the existing `kprss` fetch/write Lambda after
the SQLite database has been updated. That avoids downloading the SQLite file
again in a second Lambda and keeps the DB update and reader JSON update in one
workflow.

A separate generator Lambda remains possible later if the reader generation
needs independent retries, deployment, or ownership.
