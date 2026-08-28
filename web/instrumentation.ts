export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { announceStartupToken } = await import("./lib/local-auth");
  announceStartupToken();
}
