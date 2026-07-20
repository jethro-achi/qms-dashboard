import { describe, it, expect } from "vitest";
import { isValidEmail, normalizeEmails } from "../lib/reports/mailer";
import { composeReportEmail, firstName, greetingFromEmail } from "../lib/reports/email-report";

describe("email address validation", () => {
  it("accepts normal addresses", () => {
    expect(isValidEmail("jachelam@octech.digital")).toBe(true);
    expect(isValidEmail("a.b-c@sub.example.co.ug")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["", "no-at", "a@b", "a@@b.com", "a b@c.com", "a@b.com ", "@b.com"]) {
      // trailing space is trimmed by isValidEmail, so "a@b.com " is actually valid;
      // exclude that from the "bad" expectation.
      if (bad.trim() === "a@b.com") continue;
      expect(isValidEmail(bad)).toBe(false);
    }
  });

  it("rejects CR/LF (header-injection defence)", () => {
    expect(isValidEmail("a@b.com\r\nBcc: evil@x.com")).toBe(false);
    expect(isValidEmail("a@b.com\nSubject: x")).toBe(false);
  });
});

describe("normalizeEmails", () => {
  it("lower-cases, de-dupes, drops invalid", () => {
    expect(
      normalizeEmails(["A@B.Com", "a@b.com", "junk", "  c@d.io  ", ""]),
    ).toEqual(["a@b.com", "c@d.io"]);
  });
});

describe("composeReportEmail", () => {
  const base = {
    reportTitle: "Monthly Queue Management Report",
    periodLabel: "June 2026",
    scopeLabel: "Nakawa",
    senderName: "Jethro Achelam",
    senderRole: "Nakawa Branch Operations",
    format: "pdf" as const,
  };

  it("builds a subject from title + period", () => {
    expect(composeReportEmail(base).subject).toBe(
      "Monthly Queue Management Report: June 2026",
    );
  });

  it("signs off with the sender name and app role label", () => {
    const { text } = composeReportEmail(base);
    expect(text).toContain("Yours sincerely,");
    expect(text).toContain("Jethro Achelam");
    expect(text).toContain("Nakawa Branch Operations");
  });

  it("includes an optional note when provided", () => {
    const { text, html } = composeReportEmail({ ...base, note: "Please review before Friday." });
    expect(text).toContain("Please review before Friday.");
    expect(html).toContain("Please review before Friday.");
  });

  it("escapes HTML in user-supplied fields", () => {
    const { html } = composeReportEmail({ ...base, note: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("greets by recipient name when given, else 'colleague'", () => {
    expect(composeReportEmail({ ...base, recipientName: "Grace" }).text).toContain("Dear Grace,");
    expect(composeReportEmail(base).text).toContain("Dear colleague,");
  });
});

describe("greeting name derivation", () => {
  it("firstName takes the first token", () => {
    expect(firstName("Jethro Achelam")).toBe("Jethro");
    expect(firstName("  Grace   Achola ")).toBe("Grace");
    expect(firstName("")).toBe("");
  });

  it("greetingFromEmail derives a capitalised name from the local-part", () => {
    expect(greetingFromEmail("jachelam@octech.digital")).toBe("Jachelam");
    expect(greetingFromEmail("grace.achola@bank.com")).toBe("Grace");
    expect(greetingFromEmail("reports.octech.qms@gmail.com")).toBe("Reports");
    expect(greetingFromEmail("123@x.com")).toBe("");
  });
});
