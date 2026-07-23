# Third-Party Notices

Redstone Cowork is licensed under the **GNU General Public License v3.0** (see
[`LICENSE`](LICENSE)). It incorporates the following third-party material, retained
here to satisfy that license's attribution requirements.

## eDEX-UI

- **Project:** eDEX-UI — https://github.com/GitSquared/edex-ui
- **Copyright:** © Gabriel "GitSquared" Saillard and eDEX-UI contributors
- **License:** GNU General Public License v3.0

Used from eDEX-UI:

- **UI sound effects** (e.g. the keystroke sound, `apps/desktop/src/renderer/src/assets/sfx/keystroke.wav`),
  composed by **IceWolf** (https://soundcloud.com/iamicewolf) for eDEX-UI and
  distributed under the GPL-3.0 as part of that project.

These assets remain under the GPL-3.0; our use and redistribution of them is under
the same license, which is why this project as a whole is GPL-3.0.

## GeoIP data — DB-IP City Lite (Network Map widget)

- **Data:** IP-to-City Lite database — https://db-ip.com/db/download/ip-to-city-lite
- **Copyright:** © db-ip.com
- **License:** Creative Commons Attribution 4.0 International (CC BY 4.0)

The Network Map widget geolocates a host's network peers **offline** using this
database (bundled into the packaged app; fetched by `apps/desktop/scripts/fetch-geoip.mjs`).
Attribution as required by CC BY 4.0: **"IP Geolocation by DB-IP" (https://db-ip.com)**.

## World map coastlines — Natural Earth

- **Data:** Natural Earth 110m land vector (`ne_110m_land`) — https://www.naturalearthdata.com
- **License:** Public domain.

Used to draw the Network Map widget's world map outline
(`apps/desktop/src/renderer/src/assets/geo/land.json`).
