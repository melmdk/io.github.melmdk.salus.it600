# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.1] - 2026-10-28

### Changed
- The wiring-centre image has a transparent background like the thermostat image
- Temperature sensors, binary sensors, plugs and blinds tell Homey they are available only when that changes, as thermostats and wiring centres already do
- Housekeeping: lint runs clean on tests and dev scripts, the dev scripts moved to `scripts/`, and the user-facing changelog in Homey lists every release

### Fixed
- If the combined device requests are rejected again after you switched them back on, the app log says so again (it was silent the second time)

## [0.10.0] - 2026-10-26

### Added
- Protocol auto-detection: AES-256-CBC, then AES-128-CBC, then AES-256-CCM (newer UG800 firmware). The detected protocol is stored and used on restart
- SQ610 "Away" preset (the FC600 refuses it with "Away is not supported on this thermostat")
- Wiring-centre (it600WC) device with a "Connected" indicator (`salus_connected`, also reflected in availability), problem alarm and signal (RSSI/LQI)
- Thermostat problem alarm (`alarm_generic` and `salus_problems`) and a `problem_started` flow trigger
- Signal capabilities `salus_rssi` and `salus_lqi`
- Repair for every driver
- Combined device-detail requests, on by default (verified on a real gateway). They fall back to per-type requests automatically and can be switched off with "Use combined device requests" in the app settings
- Test suite (`node:test`) with sanitised gateway fixtures

### Changed
- Pairing reuses the app's existing gateway connection: the credentials screen is skipped when the app is already connected (see Known limitations)
- One shared gateway-credentials flow for all drivers; its IP field says that leaving it empty uses the saved gateway
- The settings page saves IP and EUID in one step and shows the connection status
- Device details are fetched in one combined request by default instead of one request per device type (the 0.9.6 behaviour). If the gateway rejects it, leaves devices out or keeps failing, the app switches back to per-type requests for the session
- Clear error messages: "No gateway answering at <ip>", "Wrong EUID: check the 16 characters on the gateway label" and "Gateway firmware uses an encryption this app doesn't support"
- One shared request lock across all gateway instances
- EUID input is normalised
- The settings page refuses an EUID that isn't 12 or 16 hex characters ("Wrong EUID: check the 16 characters on the gateway label") without saving
- The wiring centre has its own icon

### Fixed
- Misleading "bad decrypt" error
- EUID placeholder that looked like a real EUID
- Pairing list missing devices that dropped out of a single poll
- A transient network error or an empty answer reported as a wrong EUID
- Every protocol probed again on each reconnect attempt when the gateway drops a request under the known protocol
- Slow failure when the gateway is unreachable
- A stored protocol that keeps failing with a network error or an empty answer while the gateway answers was retried forever; after 3 such connects in a row the next one detects the protocol again (once) and stores the result
- The "Use combined device requests" choice was lost when the connect after saving the settings failed
- The settings page stopped waiting on any status, including a background reconnect's; it now waits for the outcome of its own save
- Thermostats and wiring centres set their availability on every poll; they now do so only when it changes

### Known limitations
- On SQ610 thermostats "Temporary Hold" still reads and writes as Follow Schedule (unchanged)
- Skipping the credentials screen during pairing is covered by tests but not yet verified on a real Homey

## [0.9.6] - 2026-02-08

### Fixed
- Reverted single-batch `deviceid` polling to per-device-type requests (gateway requires separate requests per type)
- Error isolation per device type in polling (one type failing doesn't block others)

### Changed
- Reduced app archive from 32.8 MB (230 files) to ~900 KB (47 files) via `.homeyignore`
- Excluded debug/test scripts from TypeScript compilation via `tsconfig.json` exclude

## [0.9.4] - 2026-02-08

### Fixed
- Reuse initial `readall` response from connect, eliminating redundant request on startup
- Parallel capability updates using `Promise.all` across all device drivers
- Skip `setCapabilityValue` when value unchanged, preventing unnecessary UI re-renders
- Include `setAvailable` in parallel batch instead of awaiting separately

## [0.9.3] - 2026-01-18

### Fixed
- Thermostat icon.svg now uses SQ610RF design with currentColor for theme support
- Driver image sizes corrected per Homey guidelines (75x75, 500x500, 1000x1000)

## [0.9.2] - 2026-01-18

### Changed
- Updated app icon with Salus Controls branding

## [0.9.1] - 2026-01-18

### Changed
- Updated thermostat device images with SQ610RF graphic
- Improved documentation with setup instructions, supported devices, and troubleshooting

### Fixed
- ESLint configuration for TypeScript compatibility
- Corrected AES-256-CBC encryption documentation (was incorrectly noted as AES-128)

### Added
- CHANGELOG.md for tracking releases
- GPL-3.0 LICENSE file
- App settings sync for gateway configuration UI

## [0.9.0] - 2026-01-14

### Added
- Initial release of Salus IT600 for Homey
- **Thermostat support**: Temperature control, HVAC modes (Off, Heat, Cool, Auto), preset modes (Follow Schedule, Permanent Hold, Temporary Hold, Eco, Off)
- **Battery monitoring**: Battery level and low battery alarm for battery-powered thermostats
- **Temperature sensors**: PS600 temperature monitoring
- **Binary sensors**: Door/window (SW600), water leak (WLS600), occupancy (OS600), smoke (SD600) detection
- **Smart plugs/switches**: SPE600, RS600, SR600 on/off control
- **Roller shutters**: RS600 cover control with position (0-100%)
- **Local communication**: Direct gateway connection via UG600/UGE600, no cloud required
- **App settings**: Configure gateway IP and EUID from Homey app settings
- **Settings persistence**: Gateway connection restored automatically on app restart
- **Homey Flows**: Full support for triggers, conditions, and actions

### Technical
- AES-256-CBC encrypted communication with gateway
- 30-second polling interval for device status updates
- Automatic device discovery during pairing

## Credits

Based on [pyit600](https://github.com/epoplavskis/pyit600) and [homeassistant_salus](https://github.com/epoplavskis/homeassistant_salus) by Edgars Poplavskis.
