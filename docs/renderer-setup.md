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
| `layers=inline` / `layers=iframe` | How graphics are hosted (see below). Default: `iframe`, but `inline` in OBS. |
| `keepalive=0` | Turns off the frame pump (see OBS below). On by default; only for troubleshooting. |

**Keep the renderer visible.** Browsers pause animations in background tabs and invisible sources. Our example
graphics cope with that (they finish instantly), but third-party graphics may then time out
(`playAction() timed out after 5000 ms`). For testing in a browser, give the renderer its own window instead of a background tab.

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
   so the graphics stay alive across scene changes (a hidden source also pauses its animations).
5. Optionally turn on "Control audio via OBS".
6. Leave "Use custom frame rate" off (the source then runs at the OBS frame rate).

**Layer hosting and OBS.** Normally every graphic runs in its own iframe, so a faulty graphic cannot disturb the
others or the renderer. OBS renders the browser source off-screen and repaints iframe content only every few seconds,
which makes animations and clocks look choppy (while the same URL is smooth in a normal browser). The renderer detects
OBS and then runs the graphics **inline** in the page instead, each in its own shadow root. Isolation is a bit weaker
(graphics share one JavaScript window), so errors are logged and shown in the debug overlay instead of per layer.
If another host (CasparCG, vMix) ever looks choppy, add `?layers=inline` to the URL.

The renderer also runs a tiny invisible *frame pump* that touches the page every animation frame, so off-screen hosts
always produce fresh frames (`?keepalive=0` turns it off). With `?debug=1` the overlay shows the frame rate, the mode
and visibility, e.g. `30 fps · keep-alive on · inline layers · visible`. `hidden` or a very low fps means the host is
throttling the source: check the settings above and that the source is in the active scene.

## Several machines

Server and renderers can run on different machines on the LAN. Renderers synchronise their clock with the
server (offset shown in the debug overlay), so match clocks agree between outputs.
Make sure port 8080 (HTTP + WebSocket) is reachable from the renderer machines.
