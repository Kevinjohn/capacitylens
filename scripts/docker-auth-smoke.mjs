// Exercise the same public-origin headers a TLS edge supplies to the loopback Compose port.
// The disposable CI project uses a separate named volume and fictional fixture data.
const base = process.env.DOCKER_SMOKE_URL;
const publicOrigin = "https://capacity.example.test";
const email = "bruce.wayne@example.test";
const password = process.env.DOCKER_SMOKE_PASSWORD;
const setupToken = process.env.CAPACITYLENS_SETUP_TOKEN;
const accountName = "Wayne Enterprises";
const accountIdFile = process.env.DOCKER_SMOKE_ACCOUNT_ID_FILE;
const phase = process.argv[2];

if (
  !base ||
  !password ||
  !accountIdFile ||
  (phase === "setup" && !setupToken) ||
  !["setup", "verify"].includes(phase)
) {
  throw new Error(
    "Usage: DOCKER_SMOKE_URL, DOCKER_SMOKE_PASSWORD, DOCKER_SMOKE_ACCOUNT_ID_FILE and setup token for setup are required.",
  );
}

const { readFileSync, writeFileSync } = await import("node:fs");
const { request: httpRequest } = await import("node:http");

async function request(path, { method = "GET", cookie, token, data } = {}) {
  const body = data ? JSON.stringify(data) : undefined;
  // Node fetch replaces an explicit Host with the URL's host. Use the HTTP client directly so
  // this loopback request presents the same Host that the public TLS edge forwards to nginx.
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      new URL(path, base),
      {
        method,
        headers: {
          host: "capacity.example.test",
          "x-forwarded-proto": "https",
          origin: publicOrigin,
          ...(cookie ? { cookie } : {}),
          ...(token ? { "x-capacitylens-setup-token": token } : {}),
          ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
        },
      },
      (incoming) => {
        const chunks = [];
        incoming.on("data", (chunk) => chunks.push(chunk));
        incoming.on("error", reject);
        incoming.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: incoming.statusCode,
            headers: { getSetCookie: () => incoming.headersDistinct["set-cookie"] ?? [] },
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

async function expectStatus(response, status, label) {
  if (response.status !== status) {
    throw new Error(`${label}: expected ${status}, got ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response;
}

function sessionCookie(response) {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.includes("session_token="))
    ?.split(";")[0];
  if (!cookie) throw new Error("Sign-in returned no session cookie.");
  return cookie;
}

async function signIn() {
  const response = await expectStatus(
    await request("/api/auth/sign-in/email", { method: "POST", data: { email, password } }),
    200,
    "owner sign-in",
  );
  return sessionCookie(response);
}

if (phase === "setup") {
  await expectStatus(await request("/api/state"), 401, "unauthenticated state");
  await expectStatus(
    await request("/api/auth/sign-up/email", {
      method: "POST",
      data: { email, password, name: "Bruce Wayne" },
    }),
    400,
    "signup without setup token",
  );
  const signUp = await expectStatus(
    await request("/api/auth/sign-up/email", {
      method: "POST",
      token: setupToken,
      data: { email, password, name: "Bruce Wayne" },
    }),
    200,
    "first-owner signup",
  );
  const cookie = sessionCookie(signUp);
  const org = await expectStatus(
    await request("/api/orgs", { method: "POST", cookie, data: { name: accountName } }),
    201,
    "company creation",
  );
  const { id: accountId } = await org.json();
  if (typeof accountId !== "string" || !accountId) throw new Error("Company creation returned no id.");
  const timestamp = new Date().toISOString();
  const scope = { accountId, createdAt: timestamp, updatedAt: timestamp };
  const entities = [
    [
      "resources",
      "docker-person",
      {
        ...scope,
        kind: "person",
        name: "Clark Kent",
        role: "Designer",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#76a5e7",
      },
    ],
    ["activities", "docker-activity", { ...scope, name: "Project work", kind: "internal" }],
    [
      "allocations",
      "docker-allocation",
      {
        ...scope,
        resourceId: "docker-person",
        activityId: "docker-activity",
        startDate: "2026-10-05",
        endDate: "2026-10-09",
        hoursPerDay: 6,
        status: "confirmed",
      },
    ],
  ];
  for (const [entity, id, data] of entities) {
    await expectStatus(
      await request(`/api/${entity}/${id}`, { method: "PUT", cookie, data: { id, ...data } }),
      200,
      `create ${entity}`,
    );
  }
  writeFileSync(accountIdFile, accountId);
  console.log("Authenticated owner, company and allocation created through nginx.");
} else {
  const accountId = readFileSync(accountIdFile, "utf8");
  const cookie = await signIn();
  const response = await expectStatus(
    await request(`/api/state?accountId=${encodeURIComponent(accountId)}`, { cookie }),
    200,
    "authenticated state after recreation",
  );
  const state = await response.json();
  if (!state.accounts?.some((account) => account.id === accountId && account.name === accountName)) {
    throw new Error("Company did not survive recreation.");
  }
  if (!state.allocations?.some((allocation) => allocation.id === "docker-allocation" && allocation.hoursPerDay === 6)) {
    throw new Error("Allocation did not survive recreation.");
  }
  await expectStatus(
    await request(`/api/state?accountId=${encodeURIComponent(accountId)}`),
    401,
    "unauthenticated state after recreation",
  );
  console.log("Authenticated scheduling data survived API recreation; unauthenticated reads remain closed.");
}
