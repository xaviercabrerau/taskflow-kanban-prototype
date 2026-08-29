import { buildOAuthState, verifyOAuthState, buildGoogleAuthUrl } from "../oauth";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, JWT_SECRET: "test-secret" };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("buildOAuthState / verifyOAuthState", () => {
  it("round-trips tenantId and userId through a signed state param", () => {
    const state = buildOAuthState("org-1", "user-1");
    const decoded = verifyOAuthState(state);
    expect(decoded).toEqual(expect.objectContaining({ tenantId: "org-1", userId: "user-1" }));
  });

  it("rejects a tampered state param", () => {
    const state = buildOAuthState("org-1", "user-1");
    const tampered = state.slice(0, -1) + (state.endsWith("a") ? "b" : "a");
    expect(() => verifyOAuthState(tampered)).toThrow();
  });

  it("rejects a state signed with a different secret", () => {
    const state = buildOAuthState("org-1", "user-1");
    process.env.JWT_SECRET = "a-different-secret";
    expect(() => verifyOAuthState(state)).toThrow();
  });
});

describe("buildGoogleAuthUrl", () => {
  it("throws a clear error when Google credentials aren't configured", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    expect(() => buildGoogleAuthUrl("some-state")).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("builds a well-formed consent URL once configured", () => {
    process.env.GOOGLE_CLIENT_ID = "client-123";
    process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://task.conto.ec/api/integrations/google/callback";

    const url = new URL(buildGoogleAuthUrl("signed-state"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("state")).toBe("signed-state");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("scope")).toContain("drive.readonly");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
  });
});
