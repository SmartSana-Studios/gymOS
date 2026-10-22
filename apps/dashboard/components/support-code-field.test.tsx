/** Story 23-6c: the code field keeps digits only (max 6), so a pasted "123 456 " is accepted whole. */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { SupportCodeField } from "./support-code-field";

function Harness({ onValue }: { onValue: (v: string) => void }) {
  const [v, setV] = useState("");
  return <SupportCodeField id="c" value={v} onChange={(x) => { setV(x); onValue(x); }} />;
}

describe("SupportCodeField", () => {
  it("normalises a pasted '123 456 ' to 123456", async () => {
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);
    await user.click(screen.getByLabelText("supportStepUp.codeLabel"));
    await user.paste("123 456 ");
    expect(screen.getByLabelText("supportStepUp.codeLabel")).toHaveValue("123456");
    expect(onValue).toHaveBeenLastCalledWith("123456");
  });

  it("drops non-digits and anything past six", async () => {
    const user = userEvent.setup();
    render(<Harness onValue={vi.fn()} />);
    await user.type(screen.getByLabelText("supportStepUp.codeLabel"), "12ab34567890");
    expect(screen.getByLabelText("supportStepUp.codeLabel")).toHaveValue("123456");
  });
});
