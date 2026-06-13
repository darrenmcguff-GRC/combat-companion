# Combat Companion

A persistent tactical HUD for Foundry VTT (D&D 5e). Gives players a floating sidebar with everything they need in combat — no tab-switching required.

## Features

- **Actor Card** — HP bar, AC, temp HP, portrait
- **Action Economy** — Action, Bonus Action, Reaction trackers (click to spend)
- **Saving Throws** — All six abilities with mod + proficiency indicator (click to roll)
- **Conditions** — Active condition chips + concentration indicator
- **Weapons** — Equipped weapons with attack/damage stats, filterable by type
- **Prepared Spells** — All prepared spells, filterable by level
- **Spell Slots** — Visual dot tracker with +/- buttons
- **Initiative** — One-click roll
- **Custom Resources** — Class / race / item resources with editable values
- **Pop-out window** — Detach to a resizable floating window
- **Draggable & resizable** — Save position and size across sessions
- **Collapsible sections** — Each box remembers open/closed state
- **Scrollable weapon/spell lists** — Filters keep things tidy

## Install

**Install via manifest URL in Foundry:**
```
https://raw.githubusercontent.com/darrenmcguff-GRC/combat-companion/main/module.json
```

## Compatibility

| Foundry | D&D 5e | Status |
|---------|--------|--------|
| v11–v14 | v3.x–v4.x | ✅ Supported |

## Version History

- **v1.6.2** — Fixed resource notification spam (warning fired on every change); fixed description popup XSS via entity un-escaping (entities now decoded before tag stripping); fixed fallback roll sign bug (negative modifiers lost minus sign in ability/skill/save rolls)
- **v1.6.1** — Fixed death save gating (now shows for negative HP, not just 0 HP); XSS hardening (all user-controlled strings escaped); fixed double-plus display on spell/weapon attack bonuses; fixed resource label collision; fixed toggle popout state conflict; fixed jQuery fallback dead code
- **v1.6.0** — Action/Bonus/Reaction trackers (click to spend/restore); negative HP tracking with massive damage auto-death (HP ≤ -max = instant death, no saves); corrected weapon attack/damage and spell display to match character sheet data; added feat properties to right-click popup; fixed HP damage writing negative values
- **v1.5.9** — Fix weapon attack/damage & spell display to match character sheet data
- **v1.5.7** — Add main menu toggle button (swords icon in controls bar), popout minimizable (click header to collapse/expand), active state styling
- **v1.5.6** — Fixes: dnd5e v4 activity damage extraction, remove deprecated getAttackToHit, filter re-render with fresh data, new sidebar.html popout template, add LICENSE, fix README install URL
- **v1.5.5** — Fix: skills, abilities, and saving throws show wrong values for dnd5e v4.x data structure
- **v1.5.4** — Fix saving throw rolls — async/await for dnd5e v3
- **v1.2.7** — @mod resolution for damage formulas
- **v1.2.6** — Fixed movement bar during combat, weapon damage resolution
- **v1.0.0** — Initial release
