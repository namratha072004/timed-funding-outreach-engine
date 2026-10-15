import { describe, expect, it } from "vitest";
import { fixGreeting } from "./draft";

describe("fixGreeting", () => {
  const c = (email: string, name: string | null) => ({ email, name, role: null, verified: true }) as any;
  it("uses the contact's own first name", () => {
    expect(fixGreeting("Hi Vibhanshu,\n\nCongrats.", c("chennai@banaraswala.com", "Chennai Chetty"))).toBe("Hi Chennai,\n\nCongrats.");
  });
  it("greets an unnamed address by name only when the address starts with it", () => {
    expect(fixGreeting("Hi Krish,\n\nx", c("krish@vitonnix.com", null))).toBe("Hi Krish,\n\nx");
    expect(fixGreeting("Hi Prashant,\n\nx", c("krish@vitonnix.com", null))).toBe("Hi there,\n\nx");
  });
  it("leaves the greeting alone when there is no contact", () => {
    expect(fixGreeting("Hi Prashant,\n\nx", null)).toBe("Hi Prashant,\n\nx");
  });
});

describe("fixGreeting shared mailboxes", () => {
  it("keeps the founder greeting on info@ and support@", () => {
    const c = { email: "support@sosorrysugar.com", name: null, role: null, verified: false } as any;
    expect(fixGreeting("Hi Palash,\n\nx", c)).toBe("Hi Palash,\n\nx");
  });
});
