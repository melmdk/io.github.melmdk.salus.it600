# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
