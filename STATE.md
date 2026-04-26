# Combat Companion — Module State & Roadmap

## Overview
Persistent tactical HUD for Foundry VTT (D&D 5e). Replaces the character-sheet tab switching with an always-visible sidebar / popout window.

---

## Current Version: v1.3.0

### File Layout
```
/root/foundry-modules/combat-companion/
├── module.json
├── scripts/main.js         (737 lines)
├── styles/combat-companion.css (304 lines)
├── README.md
├── languages/en.json
├── combat-companion.zip    (distribution)
```

### Live Hosting
- **Manifest:** https://combat-companion.loca.lt/module.json
- **ZIP:** https://combat-companion.loca.lt/combat-companion.zip
- **Local HTTP:** http://localhost:8765 (mapped via localtunnel)

---

## Features (v1.3.0)

| Section | Description |
|---------|-------------|
| **Actor Card** | Portrait, AC, HP bar with colour by percentage, temp HP |
| **Reaction Tracker** | Single-button 🛡️ Available / 🛡️⛔ Spent. Auto-clears on new combat round. Auto-detects when reaction spells/features are used via `dnd5e.useItem` and `dnd5e.rollAttack` hooks. Manual toggle supported outside combat. |
| **Saving Throws** | All six abilities with modifier + proficiency dot. Click to roll. |
| **Conditions** | Active condition chips + concentration indicator chip |
| **Weapons** | Equipped weapons with resolved attack bonus + damage string. Filterable by type (finesse, two-handed, etc.). |
| **Prepared Spells** | Prepared spells only. Filterable by spell level (Cantrip–Lv 9). |
| **Spell Slots** | Visual dot tracker per level + Pact Magic. +/- buttons or dot clicks. |
| **Initiative** | One-click initiative roll with modifier displayed |
| **Custom Resources** | Class/race resources with editable values |
| **Pop-out window** | Detach to a separate resizable window |
| **Draggable & resizable** | Position and size saved per-client |
| **Collapsible sections** | Each box remembers open/closed state |
| **Token HUD button** | Sword icon in token HUD (left column) |

---

## Reaction Tracker Logic (v1.3.0-hotfix change)

**Auto-detection triggers:**
- `dnd5e.useItem` → if item activation type contains "reaction" → flag reaction spent
- `dnd5e.rollAttack` → same detection for reaction attacks
- `updateCombat` → turn changes → clears `reactionUsedRound` and `reactionSpentManual` flags
- dnd5e v3 `system.uses.actions.reaction` checked for native support

**Manual toggle:** Click the reaction button to force the opposite state. Uses `reactionSpentManual` flag when combat is not active.

**Styling:** Two CSS classes — `.cc-reaction-avail` (green) and `.cc-reaction-spent` (red) with border + background glow on hover.

---

## Compatibility

| Foundry | D&D 5e | Status |
|---------|--------|--------|
| v11–v14 | v3.x–v4.x (with flag-based reaction fallback) | ✅ Supported |

---

## Open Work / Wishlist

- [ ] **Action / Bonus Action tracking** — v1.3.0 removed the three-button row to focus on reaction. Could reinstate for comprehensive action economy tracking.
- [ ] **Movement tracker** — Bar moved when combat started; removed in v1.3.0. Can be restored with per-combat state.
- [ ] **Target indicator** — Show current target(s) of the selected token
- [ ] **Inspiration button** — Quick toggle for Bardic Inspiration / Heroism
- [ ] **Death saves** — Visual tracker when character drops to 0 HP
- [ ] **Concentration DC display** — Show "DC 10 or half damage" prompt when taking damage while concentrating
- [ ] **Short Rest / Long Rest buttons** — One-click hit-die roll or full reset
- [ ] **Custom CSS theming** — Light mode, colour blindness accessibility
- [ ] **Settings panel** — Toggle which sections appear, default collapsed state, UI scale
- [ ] **GM view** — See all combatants' HUDs at once (party summary mode)

---

## Recent Changelog

- **v1.3.0** — Removed movement section; replaced Action/Bonus Action/Reaction row with single reaction tracker; added weapon/spirit filter, saving throws section; auto-detect reaction use; auto-restore on round change.
- **v1.2.7** — @mod resolution for damage formulas
- **v1.2.6** — Fixed movement bar during combat, weapon damage resolution
- **v1.0.0** — Initial release

---

## Known Issues

1. Popout window uses an empty template (`sidebar.html`) — content is injected dynamically. If the popout is closed and reopened too quickly, it can render before DOM is ready. Mitigated by `setTimeout(refresh, 50)`.
2. `_weaponStats` fallback for damage formula resolution can be noisy in console for non-denominator strings. Usually safe.
3. `reactionUsedRound` flag persists across combats if the module is unloaded mid-combat. Harmless — will clear on next `updateCombat`.
