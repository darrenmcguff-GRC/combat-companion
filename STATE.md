# Combat Companion — Module State & Roadmap

## Overview
Persistent tactical HUD for Foundry VTT (D&D 5e). Replaces the character-sheet tab switching with an always-visible sidebar / popout window.

---

## Current Version: v1.6.4

### File Layout
```
combat-companion/
├── module.json
├── scripts/main.js         (~1470 lines)
├── styles/combat-companion.css (~630 lines)
├── sidebar.html            (popout template)
├── README.md
├── LICENSE.txt
├── languages/en.json
├── combat-companion.zip    (distribution)
├── STATE.md
```

### Live Hosting
- **Manifest:** https://raw.githubusercontent.com/darrenmcguff-GRC/combat-companion/main/module.json
- **ZIP:** https://raw.githubusercontent.com/darrenmcguff-GRC/combat-companion/main/combat-companion.zip
- **Repo:** https://github.com/darrenmcguff-GRC/combat-companion

---

## Features (v1.6.4)

| Section | Description |
|---------|-------------|
| **Actor Card** | Portrait, AC, HP bar with colour by percentage, temp HP, ability scores (click to roll) |
| **Death Saves** | Visual dot tracker (fails/passes), auto-shows for dying/negative HP/massive death, +/- buttons, reset |
| **HP Controls** | Heal, damage (temp HP absorbs first), temp HP add/clear, massive damage auto-death |
| **Action Economy** | Action, Bonus Action, Reaction trackers (click to spend/restore). Auto-clears reaction on new combat round. Auto-detects reaction use via `dnd5e.useItem` and `dnd5e.rollAttack` hooks. Legacy flag-based fallback for all three types. |
| **Saving Throws** | All six abilities with modifier + proficiency indicator. Click to roll. |
| **Skills** | All 18 skills with total modifier, ability abbreviation, proficiency icon. Click to roll. |
| **Conditions** | Active condition chips + concentration indicator chip |
| **Weapons** | Equipped weapons with resolved attack bonus + damage string. Filterable by type. Right-click for description popup. |
| **Features & Abilities** | All feats with action type badges (A/B/R/P/O), uses/recharge info. Filterable by action type. Right-click for description popup. |
| **Prepared Spells** | Prepared spells only with action type badges, attack/DC/damage info. Filterable by spell level. Right-click for description popup. |
| **Spell Slots** | Visual dot tracker per level + Pact Magic. +/- buttons. |
| **Initiative** | One-click initiative roll with modifier displayed |
| **Custom Resources** | Class/race resources with editable values, label-based matching |
| **Pop-out window** | Detach to a separate resizable, minimizable window |
| **Draggable & resizable** | Position and size saved per-client (awaited settings save) |
| **Collapsible sections** | Each box remembers open/closed state (awaited settings save) |
| **Token HUD button** | Sword icon in token HUD (left column) |
| **Main menu toggle** | Sword icon in controls bar, active state styling |
| **XSS hardening** | All user-controlled strings HTML-escaped via `_esc()` helper |

---

## Compatibility

| Foundry | D&D 5e | Status |
|---------|--------|--------|
| v11–v14 | v3.x–v4.x (with flag-based reaction fallback) | ✅ Supported |

---

## Recent Changelog

- **v1.6.4** — Fixed feat popup double Action display; fixed spell popup showing both attack and DC unconditionally (now mirrors _spellsBox logic); fixed weapon damage null-safety in popup; fixed unawaited collapsed-box settings save; removed dead CSS (reaction-btn, reaction-avail, reaction-spent, react-items); fixed save regex to match "save" not just "saving"; added action/bonus legacy flag-based fallback; extracted shared _computeWeaponAttack helper (eliminated ~40 lines of duplication); expanded spell damage fallback strategies in popup
- **v1.6.3** — Removed dead code (reactionItems, shortDesc, labels, isNPC); fixed unawaited settings save (drag/resize position now persists reliably); fixed popout/sidebar state inconsistency (hudOpen set false when popout opens); deduplicated menu button HTML; normalized variable naming (sgn→sign) and damage formatting (spell bonus now matches weapon style); hardened spell attack detection for dnd5e v4.x key-based types (rwak, mwak, etc.)
- **v1.6.2** — Fixed resource notification spam (warning fired on every change); fixed description popup XSS via entity un-escaping (entities now decoded before tag stripping); fixed fallback roll sign bug (negative modifiers lost minus sign in ability/skill/save rolls)
- **v1.6.1** — Fixed death save gating (now shows for negative HP, not just 0 HP); XSS hardening (all user-controlled strings escaped); fixed double-plus display on spell/weapon attack bonuses; fixed resource label collision; fixed toggle popout state conflict; fixed jQuery fallback dead code
- **v1.6.0** — Action/Bonus/Reaction trackers (click to spend/restore); negative HP tracking with massive damage auto-death (HP ≤ -max = instant death, no saves); corrected weapon attack/damage and spell display to match character sheet data; added feat properties to right-click popup; fixed HP damage writing negative values
- **v1.5.9** — Fix weapon attack/damage & spell display to match character sheet data
- **v1.5.7** — Add main menu toggle button (swords icon in controls bar), popout minimizable (click header to collapse/expand), active state styling
- **v1.5.6** — Fixes: dnd5e v4 activity damage extraction, remove deprecated getAttackToHit, filter re-render with fresh data, new sidebar.html popout template, add LICENSE, fix README install URL
- **v1.5.5** — Fix: skills, abilities, and saving throws show wrong values for dnd5e v4.x data structure
- **v1.5.4** — Fix saving throw rolls — async/await for dnd5e v3
- **v1.3.0** — Removed movement section; replaced Action/Bonus Action/Reaction row with single reaction tracker; added weapon/spell filter, saving throws section; auto-detect reaction use; auto-restore on round change.
- **v1.2.7** — @mod resolution for damage formulas
- **v1.2.6** — Fixed movement bar during combat, weapon damage resolution
- **v1.0.0** — Initial release

---

## Open Work / Wishlist

- [ ] **Movement tracker** — Bar moved when combat started; removed in v1.3.0. Can be restored with per-combat state.
- [ ] **Target indicator** — Show current target(s) of the selected token
- [ ] **Inspiration button** — Quick toggle for Bardic Inspiration / Heroism
- [ ] **Concentration DC display** — Show "DC 10 or half damage" prompt when taking damage while concentrating
- [ ] **Short Rest / Long Rest buttons** — One-click hit-die roll or full reset
- [ ] **Custom CSS theming** — Light mode, colour blindness accessibility
- [ ] **Settings panel** — Toggle which sections appear, default collapsed state, UI scale
- [ ] **GM view** — See all combatants' HUDs at once (party summary mode)

---

## Known Issues

1. Popout window uses an empty template (`sidebar.html`) — content is injected dynamically. If the popout is closed and reopened too quickly, it can render before DOM is ready. Mitigated by `setTimeout(refresh, 50)`.
2. `_weaponStats` fallback for damage formula resolution can be noisy in console for non-denominator strings. Usually safe.
3. `reactionUsedRound` flag persists across combats if the module is unloaded mid-combat. Harmless — will clear on next `updateCombat`.
