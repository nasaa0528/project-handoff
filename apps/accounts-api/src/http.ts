/**
 * The socket. Everything above it is a pure function of a request.
 *
 * Same shape as `apps/mcp/src/http.ts`, deliberately: two HTTP surfaces in one
 * repo that read bytes differently is two places to fix the same bug.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handle, type HttpRequest, type RouteDeps } from "./routes.js";

/**
 * Registration bodies are a handful of short strings.
 *
 * 64 KiB is far more than any route here needs, and the cap is the point: without
 * one, a single request can hold the process's memory. `apps/mcp` allows 8 MiB
 * because an order carries a base64 artifact; nothing here does.
 */
export const MAX_BODY_BYTES = 64 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super(`request body over ${MAX_BODY_BYTES} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Who to charge a request to, for rate limiting.
 *
 * `X-Forwarded-For` is only consulted when `trustProxy` is on, because the header
 * is client-supplied: trusting it with nothing in front of this process lets one
 * caller invent a new address per request and walk through every limit. When it
 * is trusted, the **first** entry is the client — the rest are the proxies it
 * passed through, and reading the last one would rate-limit the proxy.
 */
export function clientAddressOf(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = header?.split(",")[0]?.trim();
    if (first !== undefined && first !== "") return first;
  }

  return request.socket.remoteAddress ?? "unknown";
}

export interface HttpServerOptions {
  readonly trustProxy?: boolean;
  /** One line per request. Keep it short; the demo reads it off the screen. */
  readonly log?: (line: string) => void;
}

export function createAccountsHttpServer(deps: RouteDeps, options: HttpServerOptions = {}): Server {
  const log = options.log ?? (() => {});
  const trustProxy = options.trustProxy ?? false;

  return createServer((incoming, response) => {
    void (async () => {
      try {
        const request: HttpRequest = {
          method: incoming.method ?? "GET",
          path: new URL(incoming.url ?? "/", "http://localhost").pathname,
          headers: incoming.headers as Readonly<Record<string, string | undefined>>,
          body: await readBody(incoming),
          clientAddress: clientAddressOf(incoming, trustProxy),
        };

        const result = await handle(request, deps);
        log(`${request.method} ${request.path} -> ${String(result.status)}`);
        send(response, result.status, result.headers, result.body);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          send(response, 413, { "Content-Type": "application/json" }, { error: { code: "body_too_large", message: error.message } });
          return;
        }

        // `handle` answers every client mistake itself, so reaching here is a bug
        // in this process. The message is logged rather than returned: an
        // internal error's text can name a collection, a connection string or a
        // stack frame, and none of that belongs in a response.
        log(`unhandled: ${(error as Error).message}`);
        send(
          response,
          500,
          { "Content-Type": "application/json" },
          { error: { code: "internal", message: "something went wrong on our side" } },
        );
      }
    })();
  });
}

function send(
  response: ServerResponse,
  status: number,
  headers: Readonly<Record<string, string>>,
  body: unknown,
): void {
  // 204 must carry no body at all, and writing one makes some clients hang
  // waiting for content the status promised was absent.
  if (status === 204 || body === null) {
    response.writeHead(status, headers);
    response.end();
    return;
  }

  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}
