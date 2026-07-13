/**
 * Outbound fetch that transparently honors HTTP(S)_PROXY when present
 * (needed in proxied CI/dev containers; a no-op passthrough in normal prod).
 */
import { fetch as undiciFetch, EnvHttpProxyAgent } from "undici";

const proxied = !!(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY);
const dispatcher = proxied ? new EnvHttpProxyAgent() : undefined;

export const outboundFetch: typeof fetch = (dispatcher
  ? ((input: any, init?: any) => undiciFetch(input, { ...init, dispatcher }))
  : fetch) as typeof fetch;
