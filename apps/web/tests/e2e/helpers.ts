import { expect, type Page } from "@playwright/test";

const COOKIE_DOMAIN = "127.0.0.1";
const SESSION_COOKIE = "mock-session";
const SCENARIO_COOKIE = "mock-scenario";

export async function setSessionCookie(page: Page, value: string) {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value,
      domain: COOKIE_DOMAIN,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function setUnauthenticatedSessionCookie(page: Page) {
  await setSessionCookie(page, "invalid");
}

export async function setScenarioCookie(
  page: Page,
  flags: string | string[] | null,
) {
  const value = Array.isArray(flags) ? flags.join(",") : flags ?? "";
  await page.context().addCookies([
    {
      name: SCENARIO_COOKIE,
      value,
      domain: COOKIE_DOMAIN,
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}

export async function clearScenarioCookie(page: Page) {
  await setScenarioCookie(page, "");
}

export async function signInViaApi(page: Page, callbackURL = "/chat") {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: {
      email: "demo@lifeos.dev",
      password: "demo12345",
      callbackURL,
    },
  });

  expect(response.ok()).toBeTruthy();
}

export async function signOutViaApi(page: Page) {
  const response = await page.request.post("/api/auth/sign-out");
  expect(response.ok()).toBeTruthy();
}
