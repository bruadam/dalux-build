import { NextResponse } from "next/server";
import { createClient } from "dalux-build-api";
import { catalog } from "../../../lib/catalog";

// Coerce a raw form value into the argument the client method expects,
// based on the param spec `type`. Returns { arg, provided }.
function coerceValue(spec, raw) {
  const isBlank =
    raw === undefined || raw === null || String(raw).trim() === "";

  if (spec.type === "json") {
    if (isBlank) return { provided: false };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new HttpError(400, `Invalid JSON for "${spec.name}": ${e.message}`);
    }
    return { arg: parsed, provided: true };
  }

  // string (default)
  if (isBlank) {
    if (spec.required)
      throw new HttpError(400, `Missing required field "${spec.name}"`);
    return { provided: false };
  }
  return { arg: String(raw), provided: true };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { message: "Request body must be JSON" } },
      { status: 400 },
    );
  }

  const { resource, method, params = {}, credentials = {} } = payload || {};

  // Validate against the catalog (this is the allow-list).
  const resourceSpec = catalog[resource];
  if (!resourceSpec) {
    return NextResponse.json(
      { ok: false, error: { message: `Unknown resource "${resource}"` } },
      { status: 400 },
    );
  }
  const methodSpec = resourceSpec.methods[method];
  if (!methodSpec) {
    return NextResponse.json(
      {
        ok: false,
        error: { message: `Unknown method "${resource}.${method}"` },
      },
      { status: 400 },
    );
  }

  // Resolve credentials: request overrides, else server env.
  const baseUrl =
    (credentials.baseUrl || "").trim() || process.env.DALUX_BASE_URL;
  const apiKey = (credentials.apiKey || "").trim() || process.env.DALUX_API_KEY;
  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          message:
            "Base URL and API key are required (set them in the console or in .env.local).",
        },
      },
      { status: 400 },
    );
  }

  // Build the positional argument list from the param specs.
  let args;
  try {
    args = [];
    for (const spec of methodSpec.params) {
      const { arg, provided } = coerceValue(spec, params[spec.name]);
      // Push undefined for un-provided optional params so the client's own
      // defaults take effect; trailing undefineds are harmless.
      args.push(provided ? arg : undefined);
    }
    // Trim trailing undefineds so default parameters kick in cleanly.
    while (args.length && args[args.length - 1] === undefined) args.pop();
  } catch (e) {
    if (e instanceof HttpError) {
      return NextResponse.json(
        { ok: false, error: { message: e.message } },
        { status: e.status },
      );
    }
    throw e;
  }

  const started = Date.now();
  try {
    const client = createClient({ baseUrl, apiKey });
    // getFileAreaTree composes folders + files (fetches both concurrently),
    // but its FilesApi argument can't come from the browser — inject it here.
    if (resource === 'folders' && method === 'getFileAreaTree') {
      args = [args[0], args[1], client.files];
    }
    const data = await client[resource][method](...args);
    return NextResponse.json({
      ok: true,
      data,
      meta: { durationMs: Date.now() - started, http: methodSpec.http },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          name: err.name || "Error",
          message: err.message || String(err),
        },
        meta: { durationMs: Date.now() - started, http: methodSpec.http },
      },
      // The client maps HTTP failures to typed errors; surface as 200-with-ok:false
      // so the UI renders them uniformly rather than throwing on fetch.
      { status: 200 },
    );
  }
}
