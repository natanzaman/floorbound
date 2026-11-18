# Filming an episode

How to shoot an episode (e.g. Episode 1, `ep1-first-line.yaml`) with the scene director. The director runs the bot actors inside the server; you record the film view.

## 1. Run a local server without a database
A server without `DATABASE_URL` has no accounts, so the Hall of Clearers starts blank (how Episode 1 opens) and nobody's characters are touched.

```sh
PORT=3000 node server/index.js
```

With no database there are no admins either: the Director answers **only from the same machine** (localhost). Don't film on the live server: every actor fight is real (loot, the Hall, the first-clear bell).

## 2. Open the film view and the Director
- **Film view:** `http://localhost:3000/?spectate=1&film=1` in its own browser window, sized to your recording (16:9; the letterbox makes it 2.39:1). It follows the director's camera, titles, fades, letterbox, light and clean feed.
- **POV views (optional, for a multi-camera take):** `http://localhost:3000/?spectate=1&pov=<name>` rides one actor's own camera; add `&eyes=1` for first person. The Director lists a link per cast member under "POV views". Open them before Run and record each window alongside the film view.
- **Director:** `http://localhost:3000/admin.html#director` in another window (or another screen). On a local server without a database it shows just the Director tab.

## 3. Load the sheet
Pick `ep1-first-line.yaml` from the list (or paste a sheet) and **Validate**. Errors list their scene and cue; fix them in the YAML file. Purple lines are cues whose game module isn't on this server: tick "skip missing modules" to run without them (for rehearsals only).

## 4. Record, then Run
For a full take, restart the server first: once the Warden has fallen on a server, the Hall shows the engraved names, but Episode 1 opens on a blank Hall.

1. Start your screen recorder on the film-view window (OBS: Window Capture, 60 fps).
2. Press **Run** (or pick a scene under "From scene" to retake just that one).
3. Watch the status: current scene, running cues, the log. Lines starting with `!` are problems (an actor stuck, an unscripted death).
4. When the log says "The end", stop recording, then press **Stop**: the actors leave and the picture, the twists and the bell go back to normal. Stop also works mid-take.

## Notes
- Episode 1 runs about 4–6 minutes: the Warden fight is live, so its length varies (the director waits for each `until`). Trim in editing.
- The actors are protected (never below 10% health) unless a cue kills them, and the automatic first-clear bell is held: the sheet rings it.
- A retake from scene 3 or 4 starts from the sheet's marks; a dead actor from an earlier take is gone after Stop, so the cast is fresh each Run.
- Running from a scene other than the first doesn't replay what came before (e.g. scene 4 alone has no fresh Hall engraving unless the Warden was killed in this server's life).
