# Rich-text SDK 1.1.2

Patch release using the same public API and portable document schema as 1.1.1.

- Advanced editing shows one full ribbon and a return button. Inline editing retains the basic toolbar.
- Chinese bold and italic can synthesize missing font faces even when the host disables font synthesis.
- Menus, color pickers, dialogs and asynchronous image uploads preserve their original selection.
- Click an image to show four resize handles. Mouse and touch drags resize proportionally; width is saved in the existing `image.attrs.width` field. Each drag is one undo step. Escape or pointer cancellation discards its preview.
- Image assets continue to store only content hashes; runtime URLs never enter saved documents.

Build with `node scripts/build-richtext-advanced.mjs` from `core/`. Previously published SDK directories are immutable.
