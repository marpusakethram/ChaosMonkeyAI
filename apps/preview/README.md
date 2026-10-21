# Browser preview

A no-install version of ChaosMonkey AI that runs entirely in the browser. `engine.js` is a straight port of the
Python backend (gateway, the 5 problems, both test agents, the 12 checks, replay and the report), and `index.html`
is the same screens as `apps/web`, built with Preact.

Check that the browser engine still gives the same results as the Python app:

```bash
node apps/preview/engine-check.mjs apps/preview
```

It runs both test agents against every problem, compares the failing checks with the Python results, and replays
each run to make sure it matches.

To open it locally, serve this folder (`python3 -m http.server -d apps/preview 8080`) and open the page in a browser.
`index.html` is written as a page body (it gets wrapped when published), so browsers render it fine as-is.

Signatures here are computed with a different hash than the Python app, so they won't match the API's signatures.
Results (pass/fail, scores, tool calls) do.
