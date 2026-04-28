# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project aims to adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.6] - 2025-11-13

### Added

- Initial public release: raw Bitcoin transaction builder (educational).
- Frontend (Vite + React + shadcn/ui) and Python backend.
- Examples, basic tests, and docs.

## [0.2.8] - 2025-11-18

### Added

- Mobile read-only experience with device detection, zoom limits, banner actions (load lessons + theme toggle), and hidden canvas controls.
- Safer share imports: opening a shared flow now spins up a new tab when the browser already has saved work, keeping canvases isolated.
- YouTube link in the community menu plus refreshed intro copy for the README/landing text.

### Fixed

- Random 32-byte node no longer gets stuck in error when the backend hiccups (new backend tests cover regen/normal paths).

## [0.3.0] - 2026-01-22

### Added

- Taproot lessons (L11 key-path, L12 script-path/MAST) with new Taproot node templates and calc helpers (taptree, control block, preimage builders, scriptPubKeys builder).
- Taproot-aware script verification and tapscript opcode catalog updates (incl. OP_CHECKSIGADD).
- Mobile read-only banner polish with a GitHub shortcut and tighter action layout.

### Fixed

- Calculation UX improvements (removed input-completeness gating, stabilized script step UI, and connected-input display fixes).
- ResizeObserver drag warnings in the canvas/text node.

## [0.3.1] - 2026-01-24

### Fixed

- Lesson 12: fix Taproot tweak node wiring (wrong node).

## [0.3.2] - 2026-01-26

### Fixed

- Lesson 12: update Taproot flow input transactions and amounts.

## [0.3.4] - 2026-01-28

### Changed

- Search panel no longer includes “Highlight & Select”.

### Fixed

- TextInfoNode header corner bleed when zoomed out.
- Lesson flows: refreshed Lesson 12 spending logic and rewired Lesson 11 multi-input signing to use even-Y privkeys.

## [0.3.5] - 2026-02-02

### Added

- Lesson 13 Taproot Multisig flow and summary content.

### Changed

- Lesson 12 Taproot script-path flow updated with the new witness node.

### Fixed

- Script execution steps display Taproot opcode labels (including OP_CHECKSIGADD).
- Editor stability: guard against group index collisions and skip pasted edges missing endpoints.
- Markdown rendering now sanitizes link URLs to block unsafe schemes.

## [0.3.6] - 2026-03-16

### Added

- First public release of **Lesson 14: MuSig2** flow.
- MuSig2 node/backend set required by Lesson 14
- First release of **Flow Map / Protocol Diagram**.
- First release of the **skin/theme system**.

### Fixed

- Undo/redo now captures node comment blur commits and flow-map/group comment commits reliably.
- UI fixes: tab-strip scrollbar appearance, and TextInfo/group interaction stability.

## [0.3.7] - 2026-03-17

### Changed

- `LICENSE-docs` now contains the full CC BY 4.0 legal text.
- `package.json` now declares `"license": "MIT"`.
- README flow list now includes Lessons 13 and 14.

## [0.3.8] - 2026-03-20

### Added

- MuSig2 NonceGen now supports an explicit `null` message mode (`__NULL__`) for BIP327-aligned behavior.
- Added backend regression coverage for Lesson 13 (`p13_Taproot_Multisig.json`) roundtrip execution.

### Fixed

- Mobile first-run dialog is now fully responsive on small/iPhone viewports (overflow and long-label issues resolved).
- Loading example flows on mobile no longer risks a blank canvas due to mount/fit timing races.
- Lesson content polish in L1/L3, including corrected locktime/CLTV wording and removal of stale “ready to broadcast” text in flows 1-3.
- Improved Safari drag responsiveness in the paper skin by removing dashed-edge styling.

## [0.3.9] - 2026-03-20

### Added

- Exports (`full`, `simplified`, `LLM`) now include `runtimeSemantics` metadata describing sentinel precedence (`__FORCE00__`, `__EMPTY__`, `__NULL__`) and numeric type coercion rules.

### Changed

- Lesson 2 flow renamed to **Multisig: Bare P2MS and P2SH Multisig** (`p2_Bare_P2MS_and_P2SH_MultiSig.json`), with refreshed in-flow wording.

### Fixed

- Shared-flow imports now use more resilient fit-view timing to avoid occasional blank/offscreen canvas states.
- Redo no longer causes a visible canvas blink during history restore.
- Lesson 3 cleanup: removed redundant “Resulting TXID” helper comments.

## [0.4.1] - 2026-04-10

### Added

- Added a comprehensive public contribution guide for new contributors in `docu/contribute.md`, including project goals, high-value contribution areas, flow design principles, proposal expectations, and an idea bank.
- Added the Discord community invite (`https://discord.gg/5vRnYSZc`)

## [0.4.2] - 2026-04-10

### Fixed

- `npm test` on a fresh clone: the test script no longer references a file that isn't shipped with the repo. Reported by @harsh04044.

## [0.4.3] - 2026-04-23

### Added

- Paper Ledger is now the default skin for new sessions when no saved skin preference exists.

### Fixed

- Verify Script debug steps are now preserved when loading history snapshots across tab switches and when importing templates that require ID remapping on collision.
- Tab switching now persists selection-only graph updates, preventing pasted-node deselection state from being lost when moving between tabs.
- Opcode node UI surfaces now follow skin styling tokens consistently (borders/text/search/list panels), improving visual consistency across themes.

## [0.4.8] - 2026-04-26

### Fixed

- Shared links now open isolated `share_<id>` tabs and persist imported graphs immediately.
- Safari/WebKit shared-link edge rendering is hardened across repeated shared URL loads.
- Shared-link URLs are cleared after a successful import, preventing browser reload from importing the same shared flow again.
- Codebase audit fixes for tab storage, validation, calculation races, and release/test coverage.

## [0.4.9] - 2026-04-27

### Added

- Added **Trezor Signing Flow** to the lesson/sidebar flow catalog.
- Added **Summer of Bitcoin 2026 PoC** to the lesson/sidebar flow catalog.
- Added manual Trezor/BIP39/BIP32/RFC6979 signing node support used by the Trezor lesson.
- Added initial Trezor signing support for normal Bitcoin/testnet single-sig transactions. The included lesson demonstrates legacy P2PKH signing; the params builder can also prepare common BIP44/49/84/86 single-sig inputs, standard address/change outputs, and multiple inputs/outputs. Not included yet: multisig signing, coinjoin/external inputs, OP_RETURN outputs, PSBT workflows, and advanced/custom Trezor request types.
- Added advanced tab-close actions for closing all tabs, closing all except the current tab, and resetting the workspace.

### Changed

- Reorganized the sidebar taxonomy into clearer node groups and curriculum-style flow lesson sections.
- Updated the current Discord community invite in the app and contributor-facing docs.

### Fixed

- Fixed Safari/WebKit shared-link edge loss by preserving all ResizeObserver batches and remeasuring imported nodes after shared-flow load.
- Hardened shared-link tab recovery so stale closed-tab metadata cannot resurrect empty tabs.
- Restored large-flow responsiveness by keeping React Flow visible-element rendering enabled and limiting shared-link repair work to real divergence cases.
