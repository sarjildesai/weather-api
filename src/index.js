const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Equivalent of flask-cors' CORS(app) — allow any origin
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function geocodeCity(city) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`geocoding service returned ${resp.status}`);
  const data = await resp.json();
  const results = data.results;
  if (!results || results.length === 0) return null;
  const top = results[0];
  return {
    latitude: top.latitude,
    longitude: top.longitude,
    resolved_name: top.name,
    state: top.admin1 || null,
    country: top.country || null,
  };
}

async function nextId(env) {
  // Simple auto-increment counter stored in KV
  const current = await env.LOGS_KV.get("meta:next_id");
  const id = current ? parseInt(current, 10) : 1;
  await env.LOGS_KV.put("meta:next_id", String(id + 1));
  return id;
}

async function handleHealth(env) {
  return json({ status: "ok", environment: env.APP_ENV || "unknown" });
}

async function handleCurrentWeather(request, env) {
  const url = new URL(request.url);
  const city = url.searchParams.get("city");
  if (!city) {
    return json({ error: "city query param is required, e.g. ?city=Ahmedabad" }, 400);
  }

  let location;
  try {
    location = await geocodeCity(city);
  } catch (e) {
    return json({ error: `geocoding service unavailable: ${e.message}` }, 502);
  }

  if (!location) {
    return json({ error: `could not find city '${city}'` }, 404);
  }

  let weather;
  try {
    const weatherUrl =
      `${WEATHER_URL}?latitude=${location.latitude}&longitude=${location.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
    const resp = await fetch(weatherUrl);
    if (!resp.ok) throw new Error(`weather service returned ${resp.status}`);
    const data = await resp.json();
    weather = data.current || {};
  } catch (e) {
    return json({ error: `weather service unavailable: ${e.message}` }, 502);
  }

  const id = await nextId(env);
  const entry = {
    id,
    city: location.resolved_name,
    state: location.state,
    country: location.country,
    logged_at: new Date().toISOString(),
    temperature_c: weather.temperature_2m ?? null,
    humidity_pct: weather.relative_humidity_2m ?? null,
    wind_speed_kmh: weather.wind_speed_10m ?? null,
    weather_code: weather.weather_code ?? null,
  };

  await env.LOGS_KV.put(`log:${id}`, JSON.stringify(entry));
  return json(entry, 200);
}

async function handleSuggestions(request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 3) {
    return json({ suggestions: [] });
  }

  try {
    const geoUrl = `${GEOCODE_URL}?name=${encodeURIComponent(q)}&count=5`;
    const resp = await fetch(geoUrl);
    if (!resp.ok) throw new Error(`geocoding service returned ${resp.status}`);
    const data = await resp.json();
    const results = data.results || [];
    const suggestions = results.map((r) => ({
      name: r.name,
      state: r.admin1 || null,
      country: r.country || null,
      latitude: r.latitude,
      longitude: r.longitude,
    }));
    return json({ suggestions });
  } catch (e) {
    return json({ error: `geocoding service unavailable: ${e.message}` }, 502);
  }
}

async function handleGetLogs(env) {
  // List all "log:*" keys, then fetch each value.
  // Fine for a demo-scale app; for heavy traffic you'd want a different data model.
  const list = await env.LOGS_KV.list({ prefix: "log:" });
  const entries = await Promise.all(
    list.keys.map(async (k) => {
      const val = await env.LOGS_KV.get(k.name);
      return val ? JSON.parse(val) : null;
    })
  );
  return json(entries.filter(Boolean));
}

async function handleGetLog(env, id) {
  const val = await env.LOGS_KV.get(`log:${id}`);
  if (!val) return json({ error: "log not found" }, 404);
  return json(JSON.parse(val));
}

async function handleDeleteLog(env, id) {
  const val = await env.LOGS_KV.get(`log:${id}`);
  if (!val) return json({ error: "log not found" }, 404);
  await env.LOGS_KV.delete(`log:${id}`);
  return new Response(null, { status: 204 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === "/health" && method === "GET") {
      return handleHealth(env);
    }

    if (path === "/weather/current" && method === "GET") {
      return handleCurrentWeather(request, env);
    }

    if (path === "/geocode/suggestions" && method === "GET") {
      return handleSuggestions(request);
    }

    if (path === "/logs" && method === "GET") {
      return handleGetLogs(env);
    }

    const logMatch = path.match(/^\/logs\/(\d+)$/);
    if (logMatch && method === "GET") {
      return handleGetLog(env, logMatch[1]);
    }
    if (logMatch && method === "DELETE") {
      return handleDeleteLog(env, logMatch[1]);
    }

    if (path === "/api" && method === "GET") {
      return json({
        service: "weather-log-api",
        endpoints: ["/health", "/weather/current?city=<name>", "/logs", "/logs/<id>"],
      });
    }

    // Anything else (/, /index.html, etc.) falls through to static assets
    return env.ASSETS.fetch(request);
  },
};