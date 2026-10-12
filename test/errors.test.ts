import { describe, expect, it } from "vitest";
import { SdkHttpError, SdkErrorCode } from "@modelcontextprotocol/client";
import { classifyError, paymentMessage, redactSecrets, signInMessage } from "../src/errors.js";
import { payloadFromToolResult } from "../src/parse.js";

describe("classifyError", () => {
  it("turns an HTTP 401 into a sign-in message", () => {
    const error = classifyError(new SdkHttpError(SdkErrorCode.ClientHttpAuthentication, "nope", { status: 401 }));
    expect(error.status).toBe(401);
    expect(error.message).toBe(signInMessage());
  });

  it("explains Pro and credit failures", () => {
    expect(classifyError({ status: 402, code: "UPGRADE_REQUIRED" }).message).toBe(paymentMessage("UPGRADE_REQUIRED"));
    expect(classifyError({ status: 402, code: "OUT_OF_CREDITS" }).message).toContain("credits");
    expect(classifyError({ code: "PLAN_LIMIT", message: "folder limit" }).message).toContain("free plan");
  });

  it("reads a tool error payload", () => {
    expect(() => payloadFromToolResult({
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: "OUT_OF_CREDITS", status: 402, message: "none left" }) }],
    })).toThrow(expect.objectContaining({ status: 402, code: "OUT_OF_CREDITS" }));
  });

  it("redacts tokens", () => {
    expect(redactSecrets("Authorization: Bearer abc.def-123")).toContain("[redacted]");
    expect(redactSecrets('{"access_token":"secret-value"}')).not.toContain("secret-value");
  });
});
