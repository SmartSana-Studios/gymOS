import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Story 16.1: jsdom has no ResizeObserver -- cmdk (the Command primitive
// backing PhoneInput's country picker, first user of these shadcn
// primitives in this app) observes its list for scroll/height changes on
// mount and throws `ResizeObserver is not defined` without this. A minimal
// no-op stub is sufficient; no test here asserts on resize-driven behavior.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom implements Element but not layout -- cmdk calls scrollIntoView to
// keep the highlighted option in view as the user types/navigates.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

// No `test.globals: true` in vitest.config.mts (every other test file imports
// describe/it/expect explicitly) -- @testing-library/react's own auto-cleanup
// only self-registers when it detects a global test framework, so without
// this every component test file would leak its rendered DOM into the next
// test in the same file.
afterEach(cleanup);

// This app's modals (CreateGymModal, AddAdminModal, GymLifecycleDialog, etc.)
// call native `<dialog>` `showModal()`, which jsdom implements the element
// for but not the method -- mirrors apps/dashboard's vitest.setup.ts polyfill.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
