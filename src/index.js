import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from './resvg.wasm';

import { scaleBand, scaleLinear } from 'd3-scale';
import { line, curveCatmullRom } from 'd3-shape';
import { extent, range } from 'd3-array';

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 1 day, matches daily market data
const UPSTREAM_TIMEOUT_MS = 10000;
const PNG_HEADERS = {
  'content-type': 'image/png',
  'cache-control': 'public, max-age=86400',
};

// Initialize WASM once per isolate. Storing the promise (not a flag) keeps
// concurrent requests from calling initWasm() twice, which throws.
let wasmReady;
const ensureWasm = () => {
  if (!wasmReady) {
    wasmReady = initWasm(wasm).catch((err) => {
      wasmReady = undefined;
      throw err;
    });
  }

  return wasmReady;
};

const textResponse = (body, status, headers = {}) => new Response(body, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
});

const renderChart = async (data, isSmall) => {
  // Dimensions
  const padding = isSmall ? 5 : 10;
  const width = (isSmall ? 250 : 500) - padding * 2;
  const height = (isSmall ? 100 : 200) - padding * 2;

  // Scales
  const mapX = scaleBand()
    .domain(range(data.length))
    .range([padding, width - padding])
    .paddingInner(0.05)
    .align(0.5);

  const mapY = scaleLinear()
    .domain(extent(data))
    .nice()
    .range([height - padding, padding]);

  const bandwidth = mapX.bandwidth();
  const zeroY = mapY(0);

  // Line generator
  const linePath = line()
    .x((_, i) => mapX(i) + bandwidth / 2)
    .y(d => mapY(d))
    .curve(curveCatmullRom.alpha(0.5))(data);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" viewBox="0 0 ${width} ${height}">
      <line style="vector-effect:non-scaling-stroke;" stroke="#ccc" x1="0" x2="${width}" y1="${zeroY}" y2="${zeroY}"/>
      <path fill="none" style="vector-effect:non-scaling-stroke;" stroke="#5f99d2" stroke-width="1" d="${linePath}"/>
    </svg>`;

  await ensureWasm();

  // resvg objects live in WASM memory and must be freed explicitly.
  const resvg = new Resvg(svg);
  try {
    const image = resvg.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
};

const handleRequest = async (request, env, ctx) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textResponse('Method not allowed', 405, { allow: 'GET, HEAD' });
  }

  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  // Parse ID and size from pathname: /<id>[-small][.png|.svg]
  const match = pathname.match(/^\/(\d{1,10})(-small)?(?:\.(?:svg|png))?$/);
  if (!match) {
    return textResponse('Item not found', 404);
  }

  const id = match[1];
  const isSmall = Boolean(match[2]) || searchParams.has('small');

  // Edge cache first (free, per data center), then KV (global).
  const edgeCache = caches.default;
  const edgeKey = new Request(`${url.origin}/${id}${isSmall ? '-small' : ''}.png`);
  const edgeHit = await edgeCache.match(edgeKey);
  if (edgeHit) {
    return request.method === 'HEAD' ? new Response(null, edgeHit) : edgeHit;
  }

  const respond = (png) => {
    const response = new Response(png, { headers: PNG_HEADERS });
    ctx.waitUntil(edgeCache.put(edgeKey, response.clone()));
    return request.method === 'HEAD' ? new Response(null, response) : response;
  };

  const cacheKey = `markethunt-chart-${id}-${isSmall ? 'small' : 'large'}`;
  const cachedData = await env.markethuntChartCache.get(cacheKey, 'arrayBuffer');

  if (cachedData) {
    return respond(cachedData);
  }

  // Fetch market data
  let apiRes;
  try {
    apiRes = await fetch(`https://api.markethunt.win/items/${id}`, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`Upstream fetch failed for item ${id}:`, err);
    return textResponse('Upstream unavailable', 502);
  }

  if (apiRes.status === 404) {
    return textResponse('Item not found', 404);
  }

  if (!apiRes.ok) {
    console.error(`Upstream returned ${apiRes.status} for item ${id}`);
    return textResponse('Upstream unavailable', 502);
  }

  let data;
  try {
    const apiData = await apiRes.json();
    data = (apiData?.market_data ?? [])
      .map(d => Number(d?.price))
      .filter(Number.isFinite);
  } catch (err) {
    console.error(`Bad upstream response for item ${id}:`, err);
    return textResponse('Upstream unavailable', 502);
  }

  if (data.length === 0) {
    return textResponse('Item not found', 404);
  }

  let png;
  try {
    png = await renderChart(data, isSmall);
  } catch (err) {
    console.error(`Render failed for item ${id}:`, err);
    return textResponse('Failed to render chart', 500);
  }

  ctx.waitUntil(
    env.markethuntChartCache.put(cacheKey, png, { expirationTtl: CACHE_TTL_SECONDS })
  );

  return respond(png);
};

export default { fetch: handleRequest };
