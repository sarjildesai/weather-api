# Weather Log API

A Flask REST API that fetches **live** weather data from the free [Open-Meteo](https://open-meteo.com) API
(no API key required) and logs each lookup. Built as the app underneath a multi-environment CI/CD pipeline project.

## Endpoints
- `GET /health` — health check (used by CI/CD and monitoring)
- `GET /weather/current?city=Ahmedabad` — fetches live weather for a city, logs it, returns it
- `GET /logs` — list all logged weather lookups
- `GET /logs/<id>` — get one logged entry
- `DELETE /logs/<id>` — delete a logged entry

## Run locally
```bash
pip install -r requirements.txt
python app.py
# app runs on http://localhost:5000
curl "http://localhost:5000/weather/current?city=Ahmedabad"
```

## Run tests
```bash
python -m pytest test_app.py -v
```
External API calls are mocked in tests, so the test suite runs fast and doesn't depend on network access.

## Run with Docker
```bash
docker build -t weather-api .
docker run -p 5000:5000 weather-api
```

## How it works
1. You call `/weather/current?city=X`
2. The app geocodes the city name to lat/lon using Open-Meteo's free geocoding API
3. It fetches current weather for those coordinates
4. It stores the result in memory and returns it

## Pipeline (Week 1)
On every push, GitHub Actions:
1. Installs dependencies
2. Runs the test suite
3. Builds the Docker image

Next up: deploying this to Dev / Staging / Prod environments.
