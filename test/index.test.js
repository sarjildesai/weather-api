import test from "node:test";
import assert from "node:assert";
import worker from "../src/index.js";

// --- Fake KV namespace (in-memory) ---
function makeFakeKV() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix }) {
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    },
  };
}

function makeEnv() {
  return {
    LOGS_KV: makeFakeKV(),
    APP_ENV: "test",
    ASSETS: { fetch: async () => new Response("static-fallback", { status: 200 }) },
  };
}

// --- Mock global fetch for geocoding + weather APIs ---
const originalFetch = global.fetch;

function mockFetchFor(city) {
  global.fetch = async (url) => {
    if (url.includes("geocoding-api")) {
      if (city === "Nowhereville") {
        return { ok: true, json: async () => ({ results: [] }) };
      }
      return {
        ok: true,
        json: async () => ({
          results: [
            {
              name: city,
              latitude: 23.03,
              longitude: 72.58,
              admin1: "Gujarat",
              country: "India",
            },
          ],
        }),
      };
    }
    if (url.includes("api.open-meteo.com")) {
      return {
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: 30,
            relative_humidity_2m: 55,
            weather_code: 1,
            wind_speed_10m: 12,
          },
        }),
      };
    }
    throw new Error("unexpected fetch url: " + url);
  };
}

test.afterEach(() => {
  global.fetch = originalFetch;
});

// --- /health ---
test("GET /health returns ok status", async () => {
  const env = makeEnv();
  const req = new Request("https://worker.test/health");
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.status, "ok");
  assert.strictEqual(body.environment, "test");
});

// --- /weather/current ---
test("GET /weather/current without city returns 400", async () => {
  const env = makeEnv();
  const req = new Request("https://worker.test/weather/current");
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 400);
});

test("GET /weather/current with valid city logs and returns weather", async () => {
  mockFetchFor("Ahmedabad");
  const env = makeEnv();
  const req = new Request("https://worker.test/weather/current?city=Ahmedabad");
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.city, "Ahmedabad");
  assert.strictEqual(body.temperature_c, 30);
  assert.ok(body.id);
});

test("GET /weather/current with unknown city returns 404", async () => {
  mockFetchFor("Nowhereville");
  const env = makeEnv();
  const req = new Request("https://worker.test/weather/current?city=Nowhereville");
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 404);
});

// --- /geocode/suggestions ---
test("GET /geocode/suggestions with short query returns empty list", async () => {
  const env = makeEnv();
  const req = new Request("https://worker.test/geocode/suggestions?q=ab");
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.deepStrictEqual(body.suggestions, []);
});

test("GET /geocode/suggestions with valid query returns suggestions", async () => {
  mockFetchFor("Ahm");
  const env = makeEnv();
  const req = new Request("https://worker.test/geocode/suggestions?q=Ahm");
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.suggestions.length, 1);
  assert.strictEqual(body.suggestions[0].name, "Ahm");
});

// --- /logs CRUD ---
test("logs CRUD: create via weather lookup, list, get, delete", async () => {
  mockFetchFor("Ahmedabad");
  const env = makeEnv();

  // Create a log by hitting /weather/current
  const createReq = new Request("https://worker.test/weather/current?city=Ahmedabad");
  const createRes = await worker.fetch(createReq, env);
  const created = await createRes.json();

  // List logs
  const listReq = new Request("https://worker.test/logs");
  const listRes = await worker.fetch(listReq, env);
  assert.strictEqual(listRes.status, 200);
  const list = await listRes.json();
  assert.strictEqual(list.length, 1);

  // Get single log
  const getReq = new Request(`https://worker.test/logs/${created.id}`);
  const getRes = await worker.fetch(getReq, env);
  assert.strictEqual(getRes.status, 200);
  const single = await getRes.json();
  assert.strictEqual(single.id, created.id);

  // Delete log
  const delReq = new Request(`https://worker.test/logs/${created.id}`, { method: "DELETE" });
  const delRes = await worker.fetch(delReq, env);
  assert.strictEqual(delRes.status, 204);

  // Confirm gone
  const getAfterDeleteReq = new Request(`https://worker.test/logs/${created.id}`);
  const getAfterDeleteRes = await worker.fetch(getAfterDeleteReq, env);
  assert.strictEqual(getAfterDeleteRes.status, 404);
});

test("GET /logs/:id for missing id returns 404", async () => {
  const env = makeEnv();
  const req = new Request("https://worker.test/logs/9999");
  const res = await worker.fetch(req, env);
  assert.strictEqual(res.status, 404);
});