# Companion Adventure Frame

`companion-adventure` is the SLU frame for shared-display games in which each player also owns a personal browser screen.

## Design law

> The shared display holds communal truth. A personal display holds that player's private truth.

A phone is not assumed to be a glass gamepad. Prefer contextual touch, private information, voting, inventory, role actions, puzzles, maps, hacking, dialogue and short personal excursions. Use a physical controller separately when the shared-world action needs tactile movement/combat.

## Runtime contract

`CompanionSessionManager` is host authoritative. It owns room identity, player slots, readiness, reconnect tokens, session phase, public state, per-player private state, shared/private messages and player actions.

The canonical phase grammar is:

`lobby -> together -> split -> regroup -> together ... -> results`

Games may repeat split/regroup as often as needed.

`CompanionTransport` is deliberately vendor-neutral. The Shell defines packet semantics and includes `LoopbackCompanionHub` for tests and local previews. Cross-device games should supply a relay/WebSocket/WebRTC adapter without moving game authority out of `CompanionSessionManager`.

## Privacy invariant

Never build a full state object on a phone and hide fields with UI. Use `viewFor(playerId)` so private state and targeted messages are filtered before the client view is produced. Reconnect tokens belong only to the owning player's receipt/view.

## First certification: dungeon

The first certification scenario is a Four-Swords-like dungeon:

1. Four players join and ready on personal screens.
2. The shared display establishes one public objective.
3. The party splits into four private rooms.
4. Each player receives a different sigil/clue and can submit an action from that private room.
5. No player can read another player's private state or targeted messages.
6. The party regroups on the shared display.
7. A shared encounter resolves and the run reaches results.
8. A disconnected player can reclaim the same slot through the reconnect token.

## Eight genre certifications

The same frame should be exercised through eight increasingly demanding consumers:

- Dungeon crawler — shared/private movement, regrouping, cooperative-rival scoring.
- Detective — asymmetric evidence, interviews, accusation/voting.
- Spy — secret objectives, passwords, hidden allegiance/information.
- Horror — player-specific perception and unreliable private truth.
- Heist — simultaneous specialized jobs and shared consequences.
- Starship — persistent personal stations controlling one shared world.
- Extraction — private inventory/loot decisions, risk, persistence and regroup pressure.
- Roguelike — procedural public/private state, builds, modifiers and run variation.

Dungeon is the frame-certification build. Detective is the fastest candidate for a polished standalone consumer once the transport/UI path is proven on real phones.

## Release gates for a companion game

A real-device build is not certified merely because the loopback tests pass. Validate join friction, reconnect after backgrounding/locking a phone, multiple mobile browsers, host tab suspension, packet loss/latency, portrait/landscape behavior, accessibility, controller + phone pairing where used, and privacy under devtools/network inspection.
