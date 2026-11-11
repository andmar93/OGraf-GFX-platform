# Renderer setup – CasparCG, vMix, OBS

The renderer URL for a channel is:

```
http://<server-ip>:8080/render/<channelId>
```

The default channel is `main`. The page is 1920×1080 with a fully transparent background.

| Query parameter | |
|---|---|
| `debug=1` | Status overlay (connection, time offset, layers, errors) and mouse cursor. **Not for air.** |
| `bg=checker` | Checkerboard background, to check transparency in a normal browser |
| `preview=1` | Preview renderer: renders everything, but does not count as output (used by the player preview) |

Every renderer page recovers by itself: after a reload, a network drop or a server restart it fetches
the channel state and restores what is on air (without in-animations).

## CasparCG (2.4 / 2.5)

Play the page with the HTML producer on its own layer, above video:

```
PLAY 1-100 [HTML] "http://192.168.1.10:8080/render/main"
```

- The channel's video format should be 1080p/1080i (the page renders at 1920×1080).
- GPU rendering in `casparcg.config` helps with heavy graphics: `<html><enable-gpu>true</enable-gpu></html>`.
- To reload after a renderer freeze: `STOP 1-100`, then the same `PLAY` again.

## vMix

1. **Add Input → Web Browser**.
2. URL: `http://192.168.1.10:8080/render/main`, size **1920 × 1080**, frame rate to match your production.
3. vMix keys the transparent background automatically. Put the input on an overlay channel (or use it as a layer).
4. Use the input's **Refresh** if it ever needs a reload.

## OBS Studio

1. **Sources → + → Browser**.
2. URL: `http://192.168.1.10:8080/render/main`, Width **1920**, Height **1080**.
3. Leave *Custom CSS* at the default (it keeps the background transparent).
4. Turn **off** "Shutdown source when not visible" and "Refresh browser when scene becomes active",
   so the graphics stay alive across scene changes.
5. Optionally turn on "Control audio via OBS".

## Several machines

Server and renderers can run on different machines on the LAN. Renderers synchronise their clock with the
server (offset shown in the debug overlay), so match clocks agree between outputs.
Make sure port 8080 (HTTP + WebSocket) is reachable from the renderer machines.
