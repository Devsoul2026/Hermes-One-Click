/**
 * Cloudflare Worker: Hermes One-Click update proxy
 *
 * Deploy steps:
 *  1. Log into https://dash.cloudflare.com -> Workers & Pages -> Create
 *  2. Paste this entire file as the worker script
 *  3. Save & Deploy. Copy the Worker URL (e.g. https://hermes-update.xxx.workers.dev)
 *  4. In the installed app, set env var:
 *       HERMES_OC_UPDATE_API_URL=https://hermes-update.xxx.workers.dev
 *     Or set it in hermes-agent/config.yaml under [env]:
 *       HERMES_OC_UPDATE_API_URL: "https://hermes-update.xxx.workers.dev"
 *
 * Free tier: 100,000 requests/day — more than enough for an update checker.
 */

const UPSTREAM =
  "https://api.github.com/repos/Devsoul2026/Hermes-One-Click/releases/latest";

export default {
  async fetch(request) {
    try {
      const resp = await fetch(UPSTREAM, {
        headers: {
          "User-Agent": "HermesOneClick/cf-worker",
          Accept: "application/vnd.github+json",
        },
        cf: { cacheTtl: 300 }, // cache at Cloudflare edge for 5 minutes
      });

      const body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
