# Mutual Dependencies - Interactive Graph

This is a lightweight React (UMD) canvas graph that loads `graph.json` and renders a draggable force layout.
The page uses CDN-hosted React and fonts, so an internet connection is required unless you swap in local copies.

## Run locally
Because the data is loaded via `fetch`, you need to serve this folder.

```bash
cd /Users/peter/mutual-dependencies-react-graph-20260118
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Files
- `index.html` - entry point
- `styles.css` - styling and layout
- `app.js` - React + canvas renderer
- `graph.json` - data
