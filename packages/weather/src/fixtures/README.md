# Weather test fixtures

Tests never reach a provider (19.4). Open-Meteo and MET Norway files are **real answers recorded on
2026-10-08** for Triora (Liguria, 43.99 N 7.77 E). OpenWeather and Meteomatics files are **constructed
from the providers' documented response formats** (One Call 3.0; Meteomatics JSON `data[].coordinates[].dates[]`)
because the project has no account with either — they show the documented shape, not live values.

## The Daily Planet (43.7), recorded 2026-11-15

Real answers recorded on **2026-11-15** from this project's cloud test environment:

- `gazette-open-meteo-triora.json` — Open-Meteo, models ICON-2I, ECMWF IFS, ICON-EU for Triora (43.99 N 7.76 E, 780 m).
- `gazette-open-meteo-goggenhofen.json` — Open-Meteo, models ICON-D2, ICON-EU, ECMWF IFS for Göggenhofen (48.22 N 11.04 E).
- `gazette-met-goggenhofen.json` — MET Norway Locationforecast compact for Göggenhofen.
- `gazette-brightsky-mosmix.json` — Bright Sky `/weather` 2026-11-15…22 (DWD MOSMIX station Mering, plus current observations).
- `gazette-brightsky-observations.json` — Bright Sky `/weather` 2026-11-13…14 (DWD historical station observations).
- `gazette-brightsky-alerts.json` — Bright Sky `/alerts` (official DWD warnings: frost, fog, icy surfaces).
- `gazette-meteoalarm-italy.json` — Meteoalarm Italy feed, **trimmed** to the 14 newest Liguria/Piemonte warnings.
- `gazette-allerta-liguria.html` — AllertaLiguria home page, **trimmed** to the message bar and the zone map.
