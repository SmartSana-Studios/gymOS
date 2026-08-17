import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// No `test.globals: true` in vitest.config.mts (every other test file imports
// describe/it/expect explicitly) -- @testing-library/react's own auto-cleanup
// only self-registers when it detects a global test framework, so without
// this every component test file would leak its rendered DOM into the next
// test in the same file.
afterEach(cleanup);

// Story 4.12: jsdom implements the `<dialog>` element itself but not its
// `showModal()`/`close()` methods (confirmed: `showModal is not a function`) --
// this app's every modal (RecordPaymentModal/RecordRefundModal/
// FlagPaymentDialog/RenewalModal, converted to native `<dialog>` per Story
// 4.7's own decisions.md entry) calls `dialogRef.current?.showModal()` in a
// mount effect, so any test that renders one of them (rather than mocking it
// out entirely, as every prior modal-adjacent test has done) hits this gap.
// A minimal polyfill, not a full modal implementation -- toggles the `open`
// attribute and fires the same `close` event React's `onClose` handler
// listens for, which is all this app's components actually depend on.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
