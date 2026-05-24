# kprss-reader

Lightweight static web reader for news articles collected by the sibling
`kprss` project.

The app is a single static page backed by generated daily JSON files. User state
such as selected-for-reading and expanded/collapsed is stored only in the browser
with `localStorage`.

## Quick start

Generate the site from the sibling `kprss` SQLite database:

```sh
cp .env.sample .env
# edit .env
python3 scripts/generate_site.py --out dist
```

By default this writes only the latest 10 article dates. Override it with:

```sh
python3 scripts/generate_site.py --out dist --days 20
```

Serve the generated files locally:

```sh
python3 -m http.server 8000 --directory dist
```

Open:

```text
http://localhost:8000/
```

Open a specific date directly:

```text
http://localhost:8000/?date=2025-12-12
```

The visible date control, URLs, and generated files use `YYYY-MM-DD`.

## Project layout

```text
public/
  index.html
  assets/
    app.css
    app.js
scripts/
  generate_site.py
docs/
  PLAN.md
dist/
  generated site output
```

`dist/` is generated output and is intentionally ignored by git. Regenerate it
with `scripts/generate_site.py` before local testing or deployment.

## Data source

The generator reads the source SQLite database path from `--db` or `KPDB`.
The article table can be provided with `--article-table`,
`KPRSS_READER_ARTICLE_TABLE`, or `KPSHORT`; otherwise the generator tries to
infer it from the expected article columns. The image/asset table can be
provided with `--asset-table` or `KPRSS_READER_ASSET_TABLE`; otherwise the
generator tries to infer it from the expected asset columns.

Local configuration can live in `.env`, which is ignored by git. Commit
`.env.sample`, not `.env`.

Images are read from the configured or inferred asset table and embedded in each
article's JSON as Dropbox URLs.

Generated article titles collapse source line breaks into ` | ` so headlines
stay compact in the reader. Article body text is trimmed at the start to avoid
extra leading whitespace.

## Client state

State is saved per date in `localStorage`:

```text
kprss-reader:v4:YYYY-MM-DD
```

This app intentionally has no backend state. State persists across reloads and
normal date navigation on the same browser, but it is not a cross-device source
of truth.

The main reading flow uses selected articles. Articles are selected by default.
Uncheck articles you do not want to read, press `読む`, and only selected
articles stay visible and expand. Press it again to return to the full collapsed
headline list.

The copy buttons copy Markdown for either the current article or all currently
visible articles. The app uses the Clipboard API when available and falls back
to a temporary text selection copy method for local iPhone/Safari testing over
plain HTTP.

Copied Markdown renders article URLs as links using the article ID as the label,
for example `- URL: [197930](https://...)`.

## iPhone local testing

Start the local server on the Mac, then open the Mac's LAN IP from iPhone Safari:

```sh
python3 -m http.server 8000 --directory dist
ipconfig getifaddr en0
```

Example:

```text
http://192.168.1.23:8000/?date=2025-12-12
```

The iPhone and Mac must be on the same Wi-Fi. Production HTTPS hosting through
CloudFront should make clipboard behavior more reliable.

## Deployment direction

The first production hosting step is intended to use the existing `kprss` S3
bucket under a reader site prefix, behind CloudFront with Basic Auth. Manual app
deploys are supported by `scripts/deploy_site.sh`. See
[docs/HOSTING.md](docs/HOSTING.md).

The later direction is a generator Lambda that runs when the uploaded database
zip changes. See [docs/PLAN.md](docs/PLAN.md) for the broader plan.

This repository is also ready to be merged into the sibling `kprss` repository
as `reader/`. See [docs/INTEGRATION.md](docs/INTEGRATION.md).
