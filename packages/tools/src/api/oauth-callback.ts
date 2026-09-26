import type { AuthorizationCallback } from "../calendar/google/oauth.ts";

/** Bridge Google's browser redirect to the existing state/PKCE OAuth flow.
 * The redirect URI is fixed by server configuration, never supplied by a client.
 * Pending state is one-use and expires. No tokens are returned to the browser.
 */
export class OAuthCallback implements AuthorizationCallback {
  readonly redirectUri: string;
  #pending = new Map<string, { resolve(code: string): void; reject(error: Error): void }>();
  constructor(redirectUri: string) {
    const url = new URL(redirectUri);
    if (url.pathname !== "/oauth/google/callback" || url.search || url.hash || url.username || url.password) throw new Error("Google redirect URI must end in /oauth/google/callback, without query or credentials");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Remote OAuth redirect URI requires HTTPS");
    this.redirectUri = url.href;
  }
  async waitForCode(opts: { state: string; timeoutMs: number; open: () => void | Promise<void> }): Promise<string> {
    if (this.#pending.size >= 32) throw new Error("Too many pending sign-ins");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<string>((resolve, reject) => {
        this.#pending.set(opts.state, { resolve, reject });
        timer = setTimeout(() => reject(new Error("Google sign-in timed out")), opts.timeoutMs);
        Promise.resolve().then(opts.open).catch(reject);
      });
    } finally { clearTimeout(timer); this.#pending.delete(opts.state); }
  }
  receive(url: URL): { ok: boolean; message: string } {
    if (url.searchParams.getAll("state").length !== 1) return { ok: false, message: "Invalid sign-in state" };
    const state = url.searchParams.get("state")!;
    const pending = this.#pending.get(state);
    if (!pending) return { ok: false, message: "Unknown or expired sign-in state" };
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if ((!error && (!code || url.searchParams.getAll("code").length !== 1)) || (error && code)) return { ok: false, message: "Invalid sign-in response" };
    this.#pending.delete(state);
    if (error) { pending.reject(new Error("Google sign-in was declined")); return { ok: false, message: "Sign-in declined. Return to Life-OS." }; }
    pending.resolve(code!);
    return { ok: true, message: "Sign-in received. You can return to Life-OS." };
  }
  close() { for (const pending of this.#pending.values()) pending.reject(new Error("API server stopped during sign-in")); this.#pending.clear(); }
}
