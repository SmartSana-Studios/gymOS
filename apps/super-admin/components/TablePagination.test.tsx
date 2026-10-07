import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { createInstance } from "i18next";

import enTranslations from "../locales/en.json";
import { TablePagination } from "./TablePagination";

function renderPagination(props: Partial<React.ComponentProps<typeof TablePagination>> = {}) {
  const i18n = createInstance();
  i18n.use(initReactI18next).init({
    lng: "en",
    resources: { en: { translation: enTranslations } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <TablePagination
        page={1}
        pageSize={10}
        total={42}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        {...props}
      />
    </I18nextProvider>,
  );
  return { onPageChange, onPageSizeChange };
}

describe("TablePagination", () => {
  it("offers 5/10/25/50 and reports the chosen size", async () => {
    const { onPageSizeChange } = renderPagination();
    const select = screen.getByRole("combobox");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      "5",
      "10",
      "25",
      "50",
    ]);
    await userEvent.selectOptions(select, "25");
    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });

  it("compact mode keeps the size selector and count but hides the page buttons", () => {
    renderPagination({ compact: true });
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "2" })).toBeNull();
  });

  it("keeps a legacy default size (20) selectable", () => {
    renderPagination({ pageSize: 20 });
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("20");
  });

  it("navigates pages", async () => {
    const { onPageChange } = renderPagination({ page: 2 });
    await userEvent.click(screen.getByRole("button", { name: "4" }));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("renders nothing when there are no rows", () => {
    renderPagination({ total: 0 });
    expect(screen.queryByTestId("table-pagination")).toBeNull();
  });
});
