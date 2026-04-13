# Midnight Falls Helper

Midnight Falls Helper is a transparent desktop overlay for the Death's Dirge memory mechanic. One leader enters the five-rune order, and every joined client sees the same sequence around the clockwise laser path.

## Fight Model

- Five runes are supported: `T`, `X`, `V`, `O`, and `Baklava`.
- The tank marker sits at the top of the arena.
- Runes fill the circle clockwise from the tank marker, matching the rotating laser path.
- The leader can enter up to five runes, undo the last rune, or reset for the next pull.

## Run Locally

Install Node.js 20 or newer, then run:

```bash
npm install
npm run start
```

## Build Installers

Windows one-click installer:

```bash
npm run build:win
```

macOS DMG and ZIP:

```bash
npm run build:mac
```

Build output is written to `dist/`.

## Using The Overlay

1. Run World of Warcraft in Windowed or Borderless Windowed mode. Exclusive fullscreen usually prevents desktop overlays from appearing on top.
2. Open Midnight Falls Helper.
3. Start the relay with `npm run relay`, or deploy the `server/` folder to Render.
4. The raid leader enters the relay URL, then clicks `Create Room`.
5. Other players enter the same relay URL and the room code, then click `Join Room`.
6. The leader presses rune buttons or global hotkeys as the runes appear.
7. Use `Reset` for the next Death's Dirge set or next pull.

For local testing, the default relay URL is `ws://127.0.0.1:10000`. For Render, use the service URL with `wss://`, for example `wss://midnight-falls-relay.onrender.com`.

## Hotkeys

- `Ctrl/Cmd + Shift + 1`: T Rune
- `Ctrl/Cmd + Shift + 2`: X Rune
- `Ctrl/Cmd + Shift + 3`: V Rune
- `Ctrl/Cmd + Shift + 4`: O Rune
- `Ctrl/Cmd + Shift + 5`: Baklava Rune
- `Ctrl/Cmd + Shift + Backspace`: Undo
- `Ctrl/Cmd + Shift + R`: Reset
- `Ctrl/Cmd + Shift + Space`: Toggle click-through

Click-through lets mouse input pass through the overlay to WoW. Use the click-through hotkey again to make the overlay clickable.

## Architecture

- Electron renders the transparent always-on-top overlay.
- Electron global shortcuts keep leader input available while WoW is focused.
- A separate WebSocket relay in `server/` manages room codes.
- Everyone connects to the same relay URL and joins the same room.
- Clients are read-only; only the leader or solo mode can change the order.
- The app does not read WoW memory, combat logs, or UI state.

## Relay Server

Run locally:

```bash
npm run relay
```

Deploy to Render:

1. Push this repo to GitHub.
2. In Render, create a new Web Service from the repo.
3. Set Root Directory to `server`.
4. Set Build Command to `npm install`.
5. Set Start Command to `npm start`.
6. Add `NODE_VERSION=20` in the Environment tab.
7. Deploy the service.

Render provides a public HTTPS URL. Use that as a WebSocket URL by replacing `https://` with `wss://`.

## Notes

- Overlays are platform/window-manager dependent. For reliable visibility, use WoW Borderless Windowed mode.
- On macOS, grant Accessibility or Input Monitoring permission if global hotkeys do not fire while another app is focused.
- For remote raiders outside the same LAN, deploy the relay to Render or another public WebSocket host.

## References

- [Midnight Falls Assist](https://www.curseforge.com/wow/addons/midnight-falls-assist)
- [Death's Dirge spell](https://www.wowhead.com/spell=1244412/deaths-dirge?dd=15&ddsize=30)
