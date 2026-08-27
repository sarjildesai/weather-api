import pytest
from unittest.mock import patch
from app import app, logs


@pytest.fixture
def client():
    app.config["TESTING"] = True
    logs.clear()
    with app.test_client() as client:
        yield client


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


def test_current_weather_missing_city(client):
    resp = client.get("/weather/current")
    assert resp.status_code == 400


@patch("app.geocode_city")
@patch("app.requests.get")
def test_current_weather_success(mock_get, mock_geocode, client):
    mock_geocode.return_value = {
        "latitude": 23.03,
        "longitude": 72.58,
        "resolved_name": "Ahmedabad",
        "country": "India",
    }
    mock_response = mock_get.return_value
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "current": {
            "temperature_2m": 34.5,
            "relative_humidity_2m": 55,
            "wind_speed_10m": 12.3,
            "weather_code": 1,
        }
    }

    resp = client.get("/weather/current?city=Ahmedabad")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["city"] == "Ahmedabad"
    assert data["temperature_c"] == 34.5
    assert "id" in data


@patch("app.geocode_city")
def test_current_weather_city_not_found(mock_geocode, client):
    mock_geocode.return_value = None
    resp = client.get("/weather/current?city=Nowhereville")
    assert resp.status_code == 404


@patch("app.geocode_city")
@patch("app.requests.get")
def test_get_logs_after_fetch(mock_get, mock_geocode, client):
    mock_geocode.return_value = {
        "latitude": 23.03,
        "longitude": 72.58,
        "resolved_name": "Ahmedabad",
        "country": "India",
    }
    mock_response = mock_get.return_value
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "current": {
            "temperature_2m": 30,
            "relative_humidity_2m": 50,
            "wind_speed_10m": 10,
            "weather_code": 0,
        }
    }

    client.get("/weather/current?city=Ahmedabad")
    resp = client.get("/logs")
    assert resp.status_code == 200
    assert len(resp.get_json()) == 1


def test_get_log_not_found(client):
    resp = client.get("/logs/999")
    assert resp.status_code == 404


def test_delete_log_not_found(client):
    resp = client.delete("/logs/999")
    assert resp.status_code == 404
