# Weather test fixtures

Tests never reach a provider (19.4). Open-Meteo and MET Norway files are **real answers recorded on
2026-10-08** for Triora (Liguria, 43.99 N 7.77 E). OpenWeather and Meteomatics files are **constructed
from the providers' documented response formats** (One Call 3.0; Meteomatics JSON `data[].coordinates[].dates[]`)
because the project has no account with either — they show the documented shape, not live values.
