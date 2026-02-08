const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

export async function getProxyBodyAndNormalizeHeaders(
  request: Request,
  headers: Headers,
) {
  if (BODYLESS_METHODS.has(request.method)) {
    return undefined;
  }

  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    headers.delete("content-type");
    headers.delete("content-length");
    return undefined;
  }

  return body;
}
