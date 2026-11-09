# noVNC 1.7.0

Source: https://github.com/novnc/noVNC/tree/v1.7.0
Package: @novnc/novnc 1.7.0, frontend only.

Upstream core/vendor sources, authors and license texts are provided here for the bundled browser client. `core/util/browser.js` is modified to disable the optional blocking H.264 hardware probe for embedded WebViews; standard VNC encodings remain enabled. The same deterministic patch is applied during Vite builds by `scripts/novnc-compat.js`. The integration code lives in web/remote-desktop.tsx. noVNC uses MPL-2.0 with separately licensed vendor files; see docs/LICENSE* and source headers. No Docker, guacd or RDP dependency is included.
