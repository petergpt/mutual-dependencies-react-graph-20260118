# AI Relationships - Interactive Graph

Interactive canvas graph of AI company relationships (customers, suppliers, both), with brand-colored nodes sized by valuation.
Uses React UMD + HTML canvas and loads `graph.json` at runtime.

Live site: https://petergpt.github.io/ai-relationships/

## Run locally
Because the data is loaded via `fetch`, you need to serve this folder.

```bash
cd /Users/peter/ai-relationships
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Data
- `graph.json` - nodes, edges, valuations, and brand colors.
  - `edges`: directed provider -> customer relationships.
  - `nodes[].valuation_b`: market cap or estimate in billions (used for node radius).
  - `nodes[].color`: brand color for node fill/stroke.

## Files
- `index.html` - entry point
- `styles.css` - layout and styling
- `app.js` - React + canvas renderer
