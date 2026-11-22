# Art directions (proposal, 2026-11-22)

The owner found the shading variations of `public/artlook.js` too alike ("just more or less outlined") and asked for
truly different character and game designs. Four directions were shown; none is chosen yet.

| | Models | Animations | Work | Phone cost |
|---|---|---|---|---|
| A. Anime Heroes | made in VRoid Studio (free desktop app; the owner's step) | retargeted to the VRoid skeleton | largest | heaviest: samples are 25-28k triangles, 14-19 materials (KayKit: ~6.2k, 1) |
| B. Faceted Heroes | built in code, rigid parts on the existing KayKit skeleton | all kept | medium | lightest |
| C. Voxel Toybox | built in code, cube parts on the existing skeleton | all kept | medium, world larger | light if the world is chunked |
| D. Grim Knights | downloaded packs | from the packs | large | medium to heavy |

First-pass mockups (standalone three.js pages, not part of the game): `docs/briefs/art-directions/faceted.html`,
`voxel.html`, `anime-standins.html`. Each expects `./three` to point at `node_modules/three`; the anime page also
expects VRoid sample avatars as `a.glb`, `b.glb`, `c.glb` and `public/models/rogue.glb` as `k.glb` (not committed:
the samples have their own conditions of use and are stand-ins only).

Work sizes are estimates. The asset sites (Quaternius, Kenney, itch.io, Mixamo) are not reachable from the cloud
workspace, so packs have to be downloaded by the owner.
