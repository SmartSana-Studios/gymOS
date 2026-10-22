import { render, screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import { RESOURCES } from "@/lib/i18n/get-server-translation";

export function renderWithI18n(ui: React.ReactElement, lng: "en" | "fr" = "en") {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({ lng, resources: RESOURCES, interpolation: { escapeValue: false }, react: { useSuspense: false } });
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

/** Opens the row's Actions menu (named "Actions for <name>") and picks the item. */
export async function pickRowAction(user: ReturnType<typeof userEvent.setup>, name: string, item: string) {
  await user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  await user.click(await screen.findByRole("menuitem", { name: item }));
}

export async function menuItems(user: ReturnType<typeof userEvent.setup>, name: string): Promise<string[]> {
  await user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  const menu = await screen.findByRole("menu");
  const labels = within(menu).getAllByRole("menuitem").map((i) => i.textContent ?? "");
  await user.keyboard("{Escape}");
  return labels;
}

export async function modal() {
  return within(await screen.findByRole("dialog"));
}
