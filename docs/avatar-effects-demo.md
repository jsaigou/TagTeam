# Avatar Effects Demo — house compositing (launch candidate)

> **Status: prototype.** Two dev-only sandboxes exist to prototype avatar effects before
> they touch the real app. The `/demo2` "house" story works as a proof of concept and is
> **a candidate for a polished launch vignette**. This doc records the approach, the
> constraints it works around, and what a production polish pass would need.

## The two demos (dev-only, no login)

| Route | What it is | Files |
| --- | --- | --- |
| `/demo/` | Primitive effects: resize (container / CSS scale / camera FOV), walk (traverse / bob), front layer (solid / gradient / vignette / frosted blur) | `demo/index.html`, `src/demo/DemoApp.tsx` |
| `/demo2/` | The story: a two-story house, a cat (Luna) in the window, approach to the door, and a transition into an indoor scene | `demo2/index.html`, `src/demo/house/*` |

Run with `pnpm dev` → `http://localhost:5173/demo/` and `http://localhost:5173/demo2/`.
Both reuse the dev-gated unauthenticated `/api/demo/*` endpoints (`server/routes/catalog.mjs`,
enabled only when `NODE_ENV !== "production"` or `ENABLE_DEMO_API=1` — a warning logs at startup
if the latter is ever set under `NODE_ENV=production`) and the low-level `usePresenter` hook —
no login, no real-app changes.

## The candidate: "cat comes to the door"

A single `<sv-presenter>` (Luna / `cc051_meeks`, which has a real wave motion) is composited
inside an HTML facade. The whole "world" (backdrop + house + avatar card) is one transformable
element, so scale / traverse / bob move everything coherently.

### Layer stack (z-order, world coords 900×700)

1. **Backdrop** `z 1` — sky + ground (fades with the house for the indoor ending).
2. **Avatar card** `z 5` — the `<sv-presenter>` mount; an **opaque** canvas. Repositioned +
   resized per phase; the widget re-fits itself via its internal ResizeObserver.
3. **House** `z 10` — opaque wall strips with two real gaps (window, door), a window frame +
   glass, roof, path, hinged door, hedge. Occludes the card except through the gaps.
4. **Foreground** — hedge in front of the door path (feet occluder).

### Story beats and the constraints they encode

- **Upper body only through the window.** The avatar card is *taller* than the window hole, so
  the opaque wall crops the legs below the sill. A window never shows a full body.
- **Window transparency is static; glass is ~60%.** The window hole never changes; a fixed glass
  pane (`rgba(205,224,245,.4)` + slight frost blur) keeps it 60% see-through.
- **Doorway is 100% transparent.** No glass; when the door swings open the cat is fully visible.
- **No teleport.** After the approach the card slides *down behind the opaque wall* (window →
  doorway) while the door is still closed. Opacity never dips; the cat is merely occluded while
  it moves, so it "goes downstairs" without a cut.
- **The door opens with the cat already present.** The descent happens behind the closed door,
  so the swing reveals her standing there.
- **Wave → slide out of the way → fast zoom → indoor.** She waves in the doorway, slides
  sideways (hidden the instant she leaves the door gap), a fast FOV/scale push zooms into the
  now-empty doorway, and a crossfade expands the card to fill the frame — a full indoor scene
  with Luna, settled back to a **regular size (scale 1, not zoomed)**.

### Effects that carry the story

| Effect | Where | How |
| --- | --- | --- |
| **Scale** (world) | approach, zoom, indoor | CSS `transform: scale()` on the world, `transform-origin` anchored at the door so the house grows toward the camera and the window slides out of frame |
| **FOV zoom** (Perxona-native) | approach, zoom | `updateCameraFOV({ distance })` on the presenter element; the demo slider spans **0.1–10** (usable range is empirical — low clips into the avatar, high shrinks it) |
| **Traverse** | approach drift; slide-away | `translateX` on the world / the avatar card |
| **Bob** | approach | `translateY` sine on the world (reads as walking *only* when feet are occluded) |
| **Occlusion** | everywhere | solid/transparent HTML layering is the entire trick |

## Constraints discovered (from the spike + live work)

- The `<sv-presenter>` canvas is **opaque** — its scene travels with the avatar. You cannot see
  an HTML layer through it, so the HTML house must *mask* it (gaps + glass), not the reverse.
- Perxona has **no walk motion** and **no joint/pose control** (whole-body pre-recorded clips
  only). Walking must be faked with transform bob; it only reads as walking when the feet are
  hidden by an occluder.
- **Traverse reads as movement only with occlusion** ("disappearing behind something"); a bare
  slide across an open backdrop reads as floating.
- `updateCameraFOV` is **not exposed** by the shared `usePresenter`/`useAvatarSession` hooks; the
  demo calls the mounted element directly (`stageRef.current.querySelector("sv-presenter")`).
  Porting to the real app would add it to the hook.
- One avatar, many placements: reposition/resize the single card and change its z-index behind
  an occluder to move it between "rooms" without a visible cut.
- The avatar's scene serves as "the room" through the window and the final indoor shot — pick a
  plain/interior scene so it reads as an interior rather than an anime backdrop.

## A polished launch version would need

- Better house art (lighting, shadows, texture) and a real interior scene for the room.
- A smoother indoor crossfade (the current one is a fast expand + fade; polish could use a
  whip-pan or matched cut through the doorway).
- Motion/audio sync: play a greeting line during the final wave, or a door sound on the swing.
- Decide the ending framing (Luna in the room, waving hello) and lock camera/FOV easing.
- Verify WebGL2 + `backdrop-filter` on target launch hardware.

## Files

- Story math (pure, unit-tested): `src/demo/house/story.ts` + `story.test.ts`
- Scene component: `src/demo/house/HouseDemo.tsx`
- Facade/layer CSS: `src/demo/house/house.css`
- Shared demo API + UI primitives: `src/demo/api.ts`, `src/demo/ui.tsx`
- Dev-gated demo endpoints: `server/routes/catalog.mjs` (`/api/demo/*`)
