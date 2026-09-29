Chrome scroll fix v3

This version fixes the layout first, rather than only changing the scroll formula.

Important changes:
1. The browser page itself is fixed to the viewport (h-screen / overflow hidden).
2. #screen-editor and #view-dialogue are constrained flex containers.
3. #reader-pane is the only right-side vertical scroll container.
4. The old calc(100vh - 120px) + h-full nesting was removed.
5. The split JavaScript files are actually loaded by index.html in this order:
   core.js, characters.js, dialogue.js, app.js
6. Dialogue scrolling uses the target/pane center delta and corrects once after Chrome paints.

Replace the corresponding files in the GitHub Pages repository.
Then hard refresh Chrome (Cmd+Shift+R on macOS / Ctrl+Shift+R on Windows).

Character Gender page scroll fix
--------------------------------
The app shell remains viewport-locked to preserve the working Chrome Dialogue
Attribution behavior. The Character Gender view now has its own vertical
scroll container, so ordinary mouse-wheel/trackpad scrolling works again.
