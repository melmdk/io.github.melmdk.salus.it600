# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-14

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
