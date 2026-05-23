# kprss-reader plan

## Goal

Build a lightweight static news reader for articles collected by the sibling
`kprss` project. The reader is hosted as static files, reads generated JSON data,
and keeps per-browser reading state only on the client.

## Architecture

Use a single static web app plus generated daily JSON files.

```text
kprss-reader/
  public/
    index.html
    assets/
      app.css
      app.js
  scripts/
    generate_site.py
  dist/
    index.html
    assets/
    data/
      manifest.json
      latest.json
      YYYY-MM-DD.json
```

The app loads `data/manifest.json` first. If the URL has `?date=YYYY-MM-DD`, it
loads that date directly. Otherwise, it loads the latest date from the manifest.
The visible date control, URLs, and generated data files use `YYYY-MM-DD`.

## Data generation

The generator reads the SQLite database produced by `kprss`.

The source DB path comes from `--db`, `.env`, or `KPDB`. The article table comes
from `--article-table`, `KPRSS_READER_ARTICLE_TABLE`, `KPSHORT`, or schema
inference. The image/asset table comes from `--asset-table`,
`KPRSS_READER_ASSET_TABLE`, or schema inference.

For each day, it writes one JSON file:

```json
{
  "date": "2025-12-12",
  "articles": [
    {
      "id": "...",
      "url": "...",
      "title": "...",
      "article": "...",
      "category": "...",
      "images": [
        {
          "url": "https://www.dropbox.com/...?raw=1",
          "caption": "..."
        }
      ]
    }
  ]
}
```

Dropbox image URLs are kept in the data and rendered with lazy loading because
they can be slow.

Article titles are normalized during generation by trimming source line breaks
and joining title parts with ` | `.

The default generated data window is the latest 10 article dates. This keeps the
static payload small while still allowing recent previous/next navigation.

## Client state

No backend state is required. The browser stores user choices in `localStorage`
by date:

```text
kprss-reader:v4:YYYY-MM-DD
```

Stored state includes:

- selected-for-reading
- expanded/collapsed
- reading mode

This preserves the user's state during back/forward navigation, date changes,
and reloads on the same browser.

## User experience

The initial view is a headline list for the selected day. Articles are selected
by default. The user unchecks headlines they do not want to read. Pressing the
main read button hides unchecked articles and expands checked articles. Pressing
it again returns to the full collapsed headline list.

Controls:

- Previous day
- Next day
- Date picker
- Today/latest date
- Toggle expand/collapse all visible articles
- Read selected articles
- Copy all visible articles as Markdown

Each article has:

- Markdown copy button
- selected-for-reading checkbox
- bottom actions to copy, collapse, or unselect the article
- images from Dropbox URLs, rendered lazily

Markdown copy uses the Clipboard API when available and falls back to temporary
text selection for local HTTP testing, especially on iPhone/Safari.
Article URLs in copied Markdown are emitted as links whose label is the trailing
URL ID.

## Hosting plan

Recommended AWS shape:

```text
kprss Lambda
  -> S3 database zip
  -> S3 ObjectCreated event
  -> kprss-reader generator Lambda
  -> static site S3 bucket
  -> CloudFront + Basic Auth
```

Keep the site bucket private and expose it through CloudFront with Origin Access
Control. Basic Auth can be implemented with a CloudFront Function on
viewer-request.

Cache policy:

- `/index.html`: short TTL or no-cache
- `/data/manifest.json`: short TTL or no-cache
- `/data/latest.json`: short TTL or no-cache
- `/data/YYYY-MM-DD.json`: long TTL
- `/assets/*`: long TTL with content/version management later

## Implementation phases

1. Build the local static app and generator.
2. Generate `dist` from the local sibling DB.
3. Verify the UX locally.
4. Add AWS upload/generator Lambda packaging.
5. Add Terraform or deployment scripts for S3, CloudFront, and Basic Auth.
