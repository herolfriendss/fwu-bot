import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GenericModuleForm } from "@/components/GenericModuleForm";
import type { ModuleCatalogEntry } from "@/lib/module-catalog";

// A module the bot team could add to /setup tomorrow: the site must render it without new code.
const futureModule: ModuleCatalogEntry = {
  key: "giveaways",
  label: "Concours",
  description: "Organise des concours avec tirage au sort.",
  owner: "suckme",
  toggle: true,
  fields: [
    { key: "enabled", label: "Module activé (oui/non)", kind: "boolean" },
    { key: "channelId", label: "Salon des concours (ID)", kind: "textChannel", required: false },
    { key: "maxWinners", label: "Gagnants maximum", kind: "integer", min: 1, max: 20 },
    { key: "mode", label: "Mode", kind: "enum", values: ["auto", "manual"], choices: { auto: "Automatique", manual: "Manuel" } },
  ],
};

describe("generated module screen", () => {
  it("renders every field kind from the /setup definition and reports changes", () => {
    const onChange = vi.fn();
    render(<GenericModuleForm module={futureModule} value={{ enabled: false, channelId: null, maxWinners: 1, mode: "auto" }} onChange={onChange}
      channels={[{ id: "111111", name: "concours", type: 0 }, { id: "222222", name: "Vocal", type: 2 }]} roles={[]} />);
    expect(screen.getByText("Concours")).toBeTruthy();
    expect(screen.getByText(/Géré par SUCK ME/)).toBeTruthy();
    expect(screen.getByRole("option", { name: "#concours" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "#Vocal" })).toBeNull();
    expect(screen.getByRole("option", { name: "Automatique" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Gagnants maximum"), { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith({ enabled: false, channelId: null, maxWinners: 5, mode: "auto" });
  });
});
