import { initialize, svg2png } from 'svg2png-wasm';
import wasm from './svg2png_wasm_bg.wasm';

import { scaleBand, scaleLinear } from 'd3-scale';
import { line, curveCatmullRom } from 'd3-shape';
import { extent, range } from 'd3-array';

// Initialize WASM once at module level
let wasmInitialized = false;

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days
const PNG_HEADERS = {
  'content-type': 'image/png',
  'cache-control': 'public, max-age=86400',
};

const handleRequest = async (request, env, ctx) => {
  const { pathname, searchParams } = new URL(request.url);

  // Parse ID and size from pathname
  let id = pathname.replace('/', '').replace(/\.(svg|png)$/, '');
  let isSmall = searchParams.has('small');

  // Check if the ID contains "-small" suffix
  if (id.endsWith('-small')) {
    id = id.replace('-small', '');
    isSmall = true;
  }

  const cacheKey = `markethunt-chart-${id}-${isSmall ? 'small' : 'large'}`;
  const cachedData = await env.markethuntChartCache.get(cacheKey, 'arrayBuffer');

  if (cachedData) {
    return new Response(cachedData, { headers: PNG_HEADERS });
  }

  // Fetch market data
  const apiRes = await fetch(`https://api.markethunt.win/items/${id}`);
  if (!apiRes.ok) {
    return new Response('Item not found', { status: 404 });
  }

  const apiData = await apiRes.json();
  let data = apiData.market_data.map(d => d.price);

  if (isSmall && data.length > 365) {
    // data = data.slice(-365);
  }

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

  // Initialize wasm if needed
  if (!wasmInitialized) {
    await initialize(wasm);
    wasmInitialized = true;
  }

  const png = await svg2png(svg, {});

  // Cache and respond
  ctx.waitUntil(
    env.markethuntChartCache.put(cacheKey, png, { expirationTtl: CACHE_TTL_SECONDS })
  );

  return new Response(png, { headers: PNG_HEADERS });
};

export default { fetch: handleRequest };
