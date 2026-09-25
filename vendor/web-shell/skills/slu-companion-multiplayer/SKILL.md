# SLU Companion Multiplayer

Use this skill when building a shared-screen game with one personal phone/browser screen per player.

## Invariants

- Shared display = communal truth. Personal display = that player's private truth.
- Keep the host authoritative for gameplay state and outcomes.
- Never broadcast all private state and rely on CSS/UI to conceal it. Filter before serialization/delivery.
- Preserve reconnect identity across normal mobile interruptions such as backgrounding and brief disconnects.
- Treat the phone as a contextual personal interface first, not a simulated controller. If precise action play needs tactile controls, pair a physical controller with the player's companion identity.
- Keep network transport behind `CompanionTransport`; game rules target `CompanionSessionManager`, not a vendor SDK.
- Player-facing join copy should be minimal: room code/QR, name when useful, ready state, connection health.

## Build sequence

1. Define what is public and what is private for every major state object.
2. Establish host session, room code, slots and reconnect behavior.
3. Make join/ready work on the supported phone browsers.
4. Build the `together -> split -> regroup` gameplay loop before adding content breadth.
5. Add player-specific actions/messages through semantic types rather than direct DOM/network coupling.
6. Prove private information cannot leak to another player's view.
7. Test background/foreground, reconnect, host pause/blur and network degradation on real devices.
8. Only then add QR polish, matchmaking/relay scaling, analytics or service-specific optimizations.

## Genre certification

Use Dungeon to certify the base frame. Then exercise Detective, Spy, Horror, Heist, Starship, Extraction and Roguelike to force different companion-screen capabilities without forking the core protocol.
