from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import os
import requests
from datetime import datetime, timezone

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)
# In-memory storage (simple on purpose - the pipeline is the point, not this app)
logs = {}
next_id = 1

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"


@app.route("/health", methods=["GET"])
def health():
    """Used by CI/CD pipeline + load balancer to check if the app is alive."""
    return jsonify({"status": "ok", "environment": os.environ.get("APP_ENV", "unknown")}), 200


def geocode_city(city):
    """Turn a city name into lat/lon using Open-Meteo's free geocoding API."""
    resp = requests.get(GEOCODE_URL, params={"name": city, "count": 1}, timeout=5)
    resp.raise_for_status()
    data = resp.json()
    results = data.get("results")
    if not results:
        return None
    top = results[0]
    return {
        "latitude": top["latitude"],
        "longitude": top["longitude"],
        "resolved_name": top.get("name"),
        "state": top.get("admin1"),
        "country": top.get("country"),
    }


@app.route("/geocode/suggestions", methods=["GET"])
def geocode_suggestions():
    """Autocomplete: returns up to 5 candidate cities matching a partial name."""
    query = request.args.get("q", "").strip()
    if len(query) < 3:
        return jsonify({"suggestions": []}), 200

    try:
        resp = requests.get(GEOCODE_URL, params={"name": query, "count": 5}, timeout=5)
        resp.raise_for_status()
        results = resp.json().get("results") or []
    except requests.RequestException as e:
        return jsonify({"error": f"geocoding service unavailable: {e}"}), 502

    suggestions = [
        {
            "name": r.get("name"),
            "state": r.get("admin1"),
            "country": r.get("country"),
            "latitude": r.get("latitude"),
            "longitude": r.get("longitude"),
        }
        for r in results
    ]
    return jsonify({"suggestions": suggestions}), 200


@app.route("/weather/current", methods=["GET"])
def current_weather():
    city = request.args.get("city")
    if not city:
        return jsonify({"error": "city query param is required, e.g. ?city=Ahmedabad"}), 400

    try:
        location = geocode_city(city)
    except requests.RequestException as e:
        return jsonify({"error": f"geocoding service unavailable: {e}"}), 502

    if not location:
        return jsonify({"error": f"could not find city '{city}'"}), 404

    try:
        resp = requests.get(
            WEATHER_URL,
            params={
                "latitude": location["latitude"],
                "longitude": location["longitude"],
                "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
            },
            timeout=5,
        )
        resp.raise_for_status()
        weather = resp.json().get("current", {})
    except requests.RequestException as e:
        return jsonify({"error": f"weather service unavailable: {e}"}), 502

    global next_id
    entry = {
        "id": next_id,
        "city": location["resolved_name"],
        "state": location.get("state"),
        "country": location.get("country"),
        "logged_at": datetime.now(timezone.utc).isoformat(),
        "temperature_c": weather.get("temperature_2m"),
        "humidity_pct": weather.get("relative_humidity_2m"),
        "wind_speed_kmh": weather.get("wind_speed_10m"),
        "weather_code": weather.get("weather_code"),
    }
    logs[next_id] = entry
    next_id += 1

    return jsonify(entry), 200


@app.route("/logs", methods=["GET"])
def get_logs():
    return jsonify(list(logs.values())), 200


@app.route("/logs/<int:log_id>", methods=["GET"])
def get_log(log_id):
    entry = logs.get(log_id)
    if not entry:
        return jsonify({"error": "log not found"}), 404
    return jsonify(entry), 200


@app.route("/logs/<int:log_id>", methods=["DELETE"])
def delete_log(log_id):
    if log_id not in logs:
        return jsonify({"error": "log not found"}), 404
    del logs[log_id]
    return "", 204


@app.route("/", methods=["GET"])
def index():
    """Serves the weather interface (static/index.html)."""
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api", methods=["GET"])
def api_index():
    """JSON index of available API endpoints (moved from '/', which now serves the UI)."""
    return jsonify({
        "service": "weather-log-api",
        "endpoints": ["/health", "/weather/current?city=<name>", "/logs", "/logs/<id>"]
    }), 200


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)