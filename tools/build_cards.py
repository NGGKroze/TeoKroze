#!/usr/bin/env python3
"""Source of truth for the card set. Run: python3 tools/build_cards.py
Writes cards/<archetype>.json, cards/all.json, docs/CATALOG.md and validates the set."""
import json, os, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPT = {"scope": "card_name", "per": "turn", "count": 1}
CARDS = []

def unit(id, name, arch, attr, race, lvl, atk, df, text="", fx=None, rarity="common",
         subtype="effect", art="", materials=None, tags=None):
    c = dict(id=id, name=name, type="unit", subtype=subtype, archetype=arch, attribute=attr,
             race=race, level=lvl, atk=atk, def_=df, rarity=rarity,
             deck="extra" if subtype == "merge" else "main",
             tags=tags or [], text=text, effects=fx or [], art_brief=art, status="draft")
    if materials: c["materials"] = materials
    CARDS.append(c)

def spell(id, name, arch, subtype, text, fx, rarity="common", art=""):
    CARDS.append(dict(id=id, name=name, type="tactic", subtype=subtype, archetype=arch,
                      rarity=rarity, deck="main", tags=[], text=text, effects=fx,
                      art_brief=art, status="draft"))

def snare(id, name, arch, subtype, text, fx, rarity="common", art=""):
    CARDS.append(dict(id=id, name=name, type="snare", subtype=subtype, archetype=arch,
                      rarity=rarity, deck="main", tags=[], text=text, effects=fx,
                      art_brief=art, status="draft"))

def flt(**k): return k
def dmg(n): return {"op": "damage", "target": "opponent", "amount": n}

# ===================== EMBERCLAW (Flame - aggro/burn) =====================
A = "emberclaw"
unit("ember_imp", "Ember Imp", A, "flame", "beast", 1, 500, 300,
     "If this card is discarded: Special Summon it.",
     [{"timing": "trigger", "trigger": "discarded", "ops": [{"op": "special_summon", "target": "self", "from": "graveyard"}]}],
     art="Tiny fire-lit imp juggling sparks, mischievous grin, cave background")
unit("emberclaw_whelp", "Emberclaw Whelp", A, "flame", "beast", 2, 600, 400,
     "If you control no units, you can Special Summon this card from your hand. Once per turn.",
     [{"timing": "summon_rule", "condition": "controller_has_no_units", "from": "hand", "limit": OPT}],
     art="Fox-sized fire cub with ember-tipped claws, leaping from ash")
unit("emberclaw_scout", "Emberclaw Scout", A, "flame", "beast", 3, 1200, 800,
     "When Normal Summoned: add 1 Emberclaw Tactic or Snare from your deck to your hand. Once per turn.",
     [{"timing": "trigger", "trigger": "normal_summoned", "limit": OPT,
       "ops": [{"op": "search", "from": "deck", "to": "hand", "filter": flt(archetype=A, type=["tactic", "snare"])}]}],
     art="Lean wildcat scout on a ridge, scanning a burning plain")
unit("cindertail_fox", "Cindertail Fox", A, "flame", "beast", 3, 1000, 1000,
     "If destroyed by battle: inflict 500 damage to your opponent.",
     [{"timing": "trigger", "trigger": "destroyed_by_battle", "ops": [dmg(500)]}],
     art="Fox whose tail trails glowing cinders as it dissolves into sparks")
unit("ashmane_lion", "Ashmane Lion", A, "flame", "beast", 4, 1700, 1200,
     "Gains 300 ATK for each other Emberclaw unit you control.",
     [{"timing": "continuous", "ops": [{"op": "modify_stat", "stat": "atk", "per": {"count": "other_units_you_control", "filter": flt(archetype=A)}, "amount": 300}]}],
     rarity="rare", art="Lion with a mane of drifting ash and glowing embers, roaring")
unit("flare_raider", "Flare Raider", A, "flame", "warrior", 4, 1700, 1000,
     "Once per turn: discard 1 card; inflict 600 damage to your opponent.",
     [{"timing": "ignition", "limit": OPT, "cost": [{"discard": 1}], "ops": [dmg(600)]}],
     art="Masked raider hurling a flaming chakram mid-sprint")
unit("scorchwing_hawk", "Scorchwing Hawk", A, "flame", "beast", 4, 1600, 900,
     "Piercing (inflicts the difference as damage when attacking a Defense unit).",
     [{"timing": "continuous", "keyword": "piercing"}],
     art="Hawk diving, wings trailing orange fire streaks")
unit("pyre_matriarch", "Pyre Matriarch", A, "flame", "warrior", 5, 2200, 1600,
     "When Tribute Summoned: destroy 1 Tactic or Snare your opponent controls.",
     [{"timing": "trigger", "trigger": "tribute_summoned", "target": {"controller": "opponent", "zone": "support", "count": 1},
       "ops": [{"op": "destroy", "target": "chosen"}]}],
     rarity="rare", art="Elder warrior-queen in charred armour, torch staff raised")
unit("magma_warden", "Magma Warden", A, "flame", "warrior", 6, 2500, 1800,
     "When this card destroys a unit by battle: inflict 500 damage to your opponent.",
     [{"timing": "trigger", "trigger": "destroyed_unit_by_battle", "ops": [dmg(500)]}],
     rarity="rare", art="Hulking guardian of molten rock striding through a lava river")
unit("volcarex", "Volcarex, the Ember Tyrant", A, "flame", "dragon", 8, 3000, 2200,
     "When this card destroys a unit by battle: inflict damage equal to half that unit's ATK.",
     [{"timing": "trigger", "trigger": "destroyed_unit_by_battle", "ops": [{"op": "damage", "target": "opponent", "amount": {"half_of": "destroyed_unit_atk"}}]}],
     rarity="mythic", art="Colossal volcano-dragon erupting from a crater, wings of lava", tags=["boss"])
unit("pyrovex_infernal", "Pyrovex, Infernal Merged", A, "flame", "dragon", 8, 3200, 2500,
     "Merge: 1 Emberclaw Beast + 1 Emberclaw Warrior. When Merge Summoned: inflict 1000 damage to your opponent.",
     [{"timing": "trigger", "trigger": "merge_summoned", "ops": [dmg(1000)]}],
     rarity="mythic", subtype="merge", art="Beast and warrior silhouettes fusing into a single blazing dragon",
     materials=[flt(archetype=A, race="beast"), flt(archetype=A, race="warrior")], tags=["boss"])
spell("ember_spark", "Ember Spark", A, "normal",
      "Inflict 500 damage to your opponent. If you control an Emberclaw unit, inflict 1000 instead.",
      [{"timing": "on_resolve", "ops": [{"op": "damage", "target": "opponent", "amount": {"if": {"you_control": flt(archetype=A, type="unit")}, "then": 1000, "else": 500}}]}],
      art="A single spark leaping from a palm and igniting")
spell("rekindle", "Rekindle", A, "quick",
      "Special Summon 1 Emberclaw unit from your graveyard. Its effects are negated until end of turn.",
      [{"timing": "on_resolve", "target": {"zone": "graveyard", "controller": "you", "filter": flt(archetype=A, type="unit")},
        "ops": [{"op": "special_summon", "target": "chosen", "negate_effects": "end_of_turn"}]}],
      rarity="rare", art="Phoenix-like flame rising from a pile of ash")
spell("caldera_of_claws", "Caldera of Claws", A, "field",
      "All Flame units gain 300 ATK and lose 200 DEF.",
      [{"timing": "continuous", "ops": [{"op": "modify_stat", "stat": "atk", "amount": 300, "filter": flt(attribute="flame")},
                                         {"op": "modify_stat", "stat": "def", "amount": -200, "filter": flt(attribute="flame")}]}],
      rarity="rare", art="Vast volcanic caldera arena at sunset, claw-shaped rock spires")
snare("backdraft", "Backdraft", A, "normal",
      "Activate when your opponent declares an attack: inflict 800 damage to your opponent.",
      [{"timing": "quick", "trigger": "opponent_attack_declared", "ops": [dmg(800)]}],
      art="Door blown open by a rush of flame")
snare("ash_veil", "Ash Veil", A, "normal",
      "Activate when your opponent declares an attack: negate the attack, then inflict 500 damage to your opponent.",
      [{"timing": "quick", "trigger": "opponent_attack_declared", "ops": [{"op": "negate_attack"}, dmg(500)]}],
      rarity="rare", art="Curtain of drifting ash shielding a lone warrior")

# ===================== IRON COVENANT (Stone - defense/equip) =====================
A = "iron_covenant"
unit("ironwatch_recruit", "Ironwatch Recruit", A, "stone", "warrior", 2, 500, 1200,
     "When Normal Summoned: Special Summon 1 Level 3 or lower Iron Covenant unit from your hand in Defense Position.",
     [{"timing": "trigger", "trigger": "normal_summoned", "ops": [{"op": "special_summon", "from": "hand", "position": "defense", "filter": flt(archetype=A, level_max=3)}]}],
     art="Young soldier in oversized armour holding a tower shield")
unit("bulwark_sentry", "Bulwark Sentry", A, "stone", "warrior", 3, 800, 1800,
     "While in Defense Position, your other Iron Covenant units cannot be targeted by your opponent's card effects.",
     [{"timing": "continuous", "condition": "self_in_defense", "ops": [{"op": "grant", "keyword": "untargetable", "filter": flt(archetype=A, exclude_self=True)}]}],
     art="Sentry crouched behind a wall of runed stone slabs")
unit("rune_smith", "Rune Smith", A, "stone", "mage", 3, 1000, 1200,
     "When Normal Summoned: add 1 Equip Tactic from your deck to your hand. Once per turn.",
     [{"timing": "trigger", "trigger": "normal_summoned", "limit": OPT, "ops": [{"op": "search", "from": "deck", "to": "hand", "filter": flt(type="tactic", subtype="equip")}]}],
     art="Smith carving glowing runes into a steel plate")
unit("pikewall_soldier", "Pikewall Soldier", A, "stone", "warrior", 3, 1300, 1100,
     "Gains 500 DEF while in Defense Position.",
     [{"timing": "continuous", "condition": "self_in_defense", "ops": [{"op": "modify_stat", "stat": "def", "amount": 500}]}],
     art="Rank of soldiers bracing long pikes in formation")
unit("shieldwall_captain", "Shieldwall Captain", A, "stone", "warrior", 4, 1500, 2000,
     "While in Defense Position, your opponent's units must attack this card if able.",
     [{"timing": "continuous", "condition": "self_in_defense", "ops": [{"op": "force_attack_target", "target": "self"}]}],
     rarity="rare", art="Veteran captain planting a banner-shield into the ground")
unit("gatekeeper_golem", "Gatekeeper Golem", A, "stone", "construct", 4, 1400, 2200,
     "", [], subtype="normal", art="Stone golem blocking a mountain gate, moss on its shoulders")
unit("covenant_oathkeeper", "Covenant Oathkeeper", A, "stone", "warrior", 4, 1800, 1600,
     "When an Equip Tactic is equipped to this card: draw 1 card.",
     [{"timing": "trigger", "trigger": "equipped", "ops": [{"op": "draw", "player": "you", "count": 1}]}],
     rarity="rare", art="Knight kneeling and swearing on a glowing sword")
unit("citadel_knight", "Citadel Knight", A, "stone", "warrior", 5, 2000, 2400,
     "When Tribute Summoned: equip 1 Equip Tactic from your deck to this card.",
     [{"timing": "trigger", "trigger": "tribute_summoned", "ops": [{"op": "equip_from", "from": "deck", "filter": flt(type="tactic", subtype="equip"), "to": "self"}]}],
     rarity="rare", art="Heavily armoured knight before a vast fortress gate")
unit("warden_last_wall", "Warden of the Last Wall", A, "stone", "warrior", 6, 2200, 2800,
     "Once per turn, when another Iron Covenant unit would be destroyed by battle or effect, you can destroy this card instead.",
     [{"timing": "replacement", "limit": OPT, "replaces": "destroy_other_ally", "filter": flt(archetype=A), "ops": [{"op": "destroy", "target": "self"}]}],
     rarity="epic", art="Towering warden holding a crumbling wall together with its own body")
unit("ironclad_colossus", "Ironclad Colossus", A, "stone", "construct", 7, 2600, 3000,
     "This card can attack while in Defense Position; use its DEF for damage calculation.",
     [{"timing": "continuous", "keyword": "defense_attacker"}],
     rarity="epic", art="Giant iron construct raising a fist the size of a house")
unit("aegis_paragon", "Aegis Paragon, Sovereign of the Seal", A, "stone", "warrior", 8, 3000, 3200,
     "Merge: 2 Iron Covenant units. Once per turn, this card cannot be destroyed by card effects.",
     [{"timing": "continuous", "limit": OPT, "ops": [{"op": "grant", "keyword": "indestructible_by_effect"}]}],
     rarity="mythic", subtype="merge", art="Radiant armoured sovereign merged from knight and golem, shield of light",
     materials=[flt(archetype=A), flt(archetype=A)], tags=["boss"])
spell("forged_oath", "Forged Oath", A, "normal",
      "Draw 2 cards, then discard 1 card.",
      [{"timing": "on_resolve", "ops": [{"op": "draw", "player": "you", "count": 2}, {"op": "discard", "player": "you", "count": 1}]}],
      art="Two hands clasped over a glowing anvil")
spell("rune_plate", "Rune-Etched Plate", A, "equip",
      "Equip to an Iron Covenant unit. It gains 600 DEF.",
      [{"timing": "continuous", "equip_filter": flt(archetype=A, type="unit"), "ops": [{"op": "modify_stat", "stat": "def", "amount": 600}]}],
      art="Steel breastplate covered in blue glowing runes")
spell("bastion_field", "Bastion Field", A, "field",
      "All Stone units gain 400 DEF.",
      [{"timing": "continuous", "ops": [{"op": "modify_stat", "stat": "def", "amount": 400, "filter": flt(attribute="stone")}]}],
      rarity="rare", art="Wide mountain fortress courtyard under grey sky, banners snapping")
snare("iron_reprisal", "Iron Reprisal", A, "normal",
      "Activate when your Iron Covenant unit is destroyed by battle: destroy the unit that destroyed it.",
      [{"timing": "quick", "trigger": "ally_destroyed_by_battle", "filter": flt(archetype=A), "ops": [{"op": "destroy", "target": "battle_opponent"}]}],
      art="Fallen shield with a vengeful sword plunged beside it")
snare("bulwark_call", "Bulwark Call", A, "normal",
      "Activate when your opponent declares an attack on your Iron Covenant unit: negate the attack, then change that unit to Defense Position.",
      [{"timing": "quick", "trigger": "opponent_attack_declared_on_ally", "filter": flt(archetype=A),
        "ops": [{"op": "negate_attack"}, {"op": "set_position", "target": "attacked_unit", "position": "defense"}]}],
      rarity="rare", art="Horn blown from a tower, soldiers locking shields in response")

# ===================== ASTRAL WEAVERS (Radiance - merge/combo) =====================
A = "astral_weavers"
unit("thread_apprentice", "Thread Apprentice", A, "radiance", "mage", 1, 300, 300,
     "If this card is sent to the graveyard: add 1 Astral Weavers Tactic from your deck to your hand.",
     [{"timing": "trigger", "trigger": "sent_to_graveyard", "ops": [{"op": "search", "from": "deck", "to": "hand", "filter": flt(archetype=A, type="tactic")}]}],
     art="Child mage holding a spool of glowing starlight thread")
unit("loom_sprite", "Loom Sprite", A, "radiance", "spirit", 2, 500, 700,
     "If you control an Astral Weavers unit, you can Special Summon this card from your hand. Once per turn.",
     [{"timing": "summon_rule", "condition": "controller_controls", "filter": flt(archetype=A, type="unit"), "from": "hand", "limit": OPT}],
     art="Tiny sprite made of woven light riding a shuttle")
unit("star_spinner_adept", "Star-Spinner Adept", A, "radiance", "mage", 3, 1000, 1000,
     "When Normal Summoned: send 1 Astral Weavers unit from your deck to the graveyard. Once per turn.",
     [{"timing": "trigger", "trigger": "normal_summoned", "limit": OPT, "ops": [{"op": "send", "from": "deck", "to": "graveyard", "filter": flt(archetype=A, type="unit")}]}],
     art="Adept spinning a thread of starlight between two fingers")
unit("constellation_seer", "Constellation Seer", A, "radiance", "mage", 4, 1600, 1200,
     "Once per turn: reveal the top card of your deck. If it is an Astral Weavers card, draw 1 card; otherwise shuffle it into the deck.",
     [{"timing": "ignition", "limit": OPT, "ops": [{"op": "reveal_top", "count": 1, "then": {"if": flt(archetype=A), "do": {"op": "draw", "count": 1}, "else": {"op": "shuffle_in"}}}]}],
     rarity="rare", art="Seer under a dome of stars tracing constellations in the air")
unit("celestial_seamstress", "Celestial Seamstress", A, "radiance", "spirit", 4, 1500, 1500,
     "Once per turn: Special Summon 1 Level 3 or lower Astral Weavers unit from your graveyard.",
     [{"timing": "ignition", "limit": OPT, "ops": [{"op": "special_summon", "from": "graveyard", "filter": flt(archetype=A, type="unit", level_max=3)}]}],
     art="Spirit stitching glowing figures out of a sky of thread")
unit("star_cartographer", "Star Cartographer", A, "radiance", "mage", 4, 1300, 1600,
     "When this card is used as Merge material: draw 1 card.",
     [{"timing": "trigger", "trigger": "used_as_merge_material", "ops": [{"op": "draw", "player": "you", "count": 1}]}],
     art="Scholar unrolling a star map across a floating desk")
unit("moonthread_oracle", "Moonthread Oracle", A, "radiance", "mage", 5, 2000, 1800,
     "When Tribute Summoned: add 1 Astral Weavers Tactic from your deck or graveyard to your hand.",
     [{"timing": "trigger", "trigger": "tribute_summoned", "ops": [{"op": "search", "from": ["deck", "graveyard"], "to": "hand", "filter": flt(archetype=A, type="tactic")}]}],
     rarity="rare", art="Hooded oracle weaving a moonbeam into a rope")
unit("dawn_tailor", "Dawn Tailor", A, "radiance", "spirit", 6, 2400, 2000,
     "While you control a Merge unit, this card gains 500 ATK.",
     [{"timing": "continuous", "condition": {"you_control": flt(subtype="merge")}, "ops": [{"op": "modify_stat", "stat": "atk", "amount": 500}]}],
     rarity="epic", art="Radiant spirit-tailor stitching a sunrise into the sky")
unit("nebula_warden", "Nebula Warden", A, "radiance", "spirit", 6, 2300, 1800,
     "Merge: 2 Astral Weavers units. When Merge Summoned: draw 1 card.",
     [{"timing": "trigger", "trigger": "merge_summoned", "ops": [{"op": "draw", "player": "you", "count": 1}]}],
     rarity="epic", subtype="merge", art="Guardian made of swirling nebula clouds and threads of light",
     materials=[flt(archetype=A), flt(archetype=A)])
unit("starloom_archon", "Starloom Archon", A, "radiance", "spirit", 8, 3000, 2500,
     "Merge: 1 Astral Weavers Merge unit + 1 Level 4 or higher Astral Weavers unit. Once per turn: negate the activation of 1 Tactic your opponent activates.",
     [{"timing": "quick", "trigger": "opponent_activates_tactic", "limit": OPT, "ops": [{"op": "negate_activation"}]}],
     rarity="mythic", subtype="merge", art="Colossal being of woven starlight, loom frame as halo",
     materials=[flt(archetype=A, subtype="merge"), flt(archetype=A, level_min=4)], tags=["boss"])
spell("weave_together", "Weave Together", A, "normal",
      "Merge Summon 1 Astral Weavers Merge unit from your Extra Deck, using materials from your hand, field, or graveyard (banish graveyard materials).",
      [{"timing": "on_resolve", "ops": [{"op": "merge_summon", "filter": flt(archetype=A), "material_zones": ["hand", "field", "graveyard"], "graveyard_materials": "banish"}]}],
      rarity="rare", art="Hands pulling two glowing threads into a single bright knot")
spell("loom_of_fate", "Loom of Fate", A, "field",
      "Merge units gain 500 ATK. Once per turn, when you Merge Summon: draw 1 card.",
      [{"timing": "continuous", "ops": [{"op": "modify_stat", "stat": "atk", "amount": 500, "filter": flt(subtype="merge")}]},
       {"timing": "trigger", "trigger": "you_merge_summon", "limit": OPT, "ops": [{"op": "draw", "player": "you", "count": 1}]}],
      rarity="epic", art="Immense cosmic loom hanging in a starry void")
spell("spool_return", "Spool Return", A, "normal",
      "Add 2 Astral Weavers units from your graveyard to your hand, then discard 1 card.",
      [{"timing": "on_resolve", "target": {"zone": "graveyard", "count": 2, "filter": flt(archetype=A, type="unit")},
        "ops": [{"op": "add_to_hand", "target": "chosen"}, {"op": "discard", "player": "you", "count": 1}]}],
      art="Thread spool rolling back across a table, pulling cards with it")
spell("moonlit_study", "Moonlit Study", A, "normal",
      "Add 1 \"Weave Together\" or \"Loom of Fate\" from your deck to your hand.",
      [{"timing": "on_resolve", "ops": [{"op": "search", "from": "deck", "to": "hand", "filter": flt(id=["weave_together", "loom_of_fate"])}]}],
      art="Open book glowing under a moonlit window")
snare("frayed_reality", "Frayed Reality", A, "counter",
      "Activate when your opponent activates a Tactic: negate the activation and destroy it.",
      [{"timing": "quick", "trigger": "opponent_activates_tactic", "ops": [{"op": "negate_activation"}, {"op": "destroy", "target": "activated_card"}]}],
      rarity="rare", art="A tapestry unravelling mid-air, thread by thread")
snare("mirror_veil", "Mirror Veil", A, "normal",
      "Activate when your opponent declares an attack: negate the attack, then Special Summon 1 Level 4 or lower Astral Weavers unit from your hand.",
      [{"timing": "quick", "trigger": "opponent_attack_declared",
        "ops": [{"op": "negate_attack"}, {"op": "special_summon", "from": "hand", "filter": flt(archetype=A, type="unit", level_max=4)}]}],
      art="Shimmering mirror-curtain reflecting a sword strike")

# ===================== NEUTRAL (any deck) =====================
A = "neutral"
unit("wandering_mercenary", "Wandering Mercenary", A, "stone", "warrior", 4, 1700, 1000, "", [],
     subtype="normal", art="Travel-worn sellsword on a dusty road")
unit("guild_courier", "Guild Courier", A, "gale", "warrior", 2, 700, 500,
     "If this card is sent to the graveyard: draw 1 card.",
     [{"timing": "trigger", "trigger": "sent_to_graveyard", "ops": [{"op": "draw", "player": "you", "count": 1}]}],
     art="Courier mid-sprint clutching a sealed letter")
unit("bell_toller_monk", "Bell-Toller Monk", A, "radiance", "spirit", 3, 800, 1500,
     "When Normal Summoned: gain 800 LP.",
     [{"timing": "trigger", "trigger": "normal_summoned", "ops": [{"op": "gain_lp", "player": "you", "amount": 800}]}],
     art="Monk ringing a huge bronze bell, light rippling out")
unit("hollow_sentinel", "Hollow Sentinel", A, "umbra", "construct", 5, 2100, 1700, "", [],
     subtype="normal", rarity="common", art="Empty suit of armour standing guard in a dark hall")
spell("forge_of_unity", "Forge of Unity", A, "normal",
      "Merge Summon 1 Merge unit from your Extra Deck, using materials listed on it from your hand or field.",
      [{"timing": "on_resolve", "ops": [{"op": "merge_summon", "material_zones": ["hand", "field"]}]}],
      rarity="rare", art="Two silhouettes dissolving into a single bright figure over a forge")
spell("scholars_gambit", "Scholar's Gambit", A, "normal",
      "Draw 2 cards, then discard 1 card.",
      [{"timing": "on_resolve", "ops": [{"op": "draw", "player": "you", "count": 2}, {"op": "discard", "player": "you", "count": 1}]}],
      art="Scholar sliding a stack of cards across a table")
spell("shatter_strike", "Shatter Strike", A, "normal",
      "Destroy 1 unit your opponent controls.",
      [{"timing": "on_resolve", "target": {"controller": "opponent", "zone": "units", "count": 1}, "ops": [{"op": "destroy", "target": "chosen"}]}],
      art="Lightning bolt cracking a stone statue")
spell("cleansing_gale", "Cleansing Gale", A, "quick",
      "Destroy 1 Tactic or Snare on the field.",
      [{"timing": "on_resolve", "target": {"zone": "support", "count": 1}, "ops": [{"op": "destroy", "target": "chosen"}]}],
      art="Gust of wind scattering banners and charms")
spell("grave_call", "Grave Call", A, "normal",
      "Special Summon 1 Level 4 or lower unit from your graveyard.",
      [{"timing": "on_resolve", "target": {"zone": "graveyard", "controller": "you", "filter": flt(type="unit", level_max=4)}, "ops": [{"op": "special_summon", "target": "chosen"}]}],
      art="Hand reaching out of a grave holding a lantern")
snare("hollow_ward", "Hollow Ward", A, "normal",
      "Activate when your opponent declares an attack: negate the attack.",
      [{"timing": "quick", "trigger": "opponent_attack_declared", "ops": [{"op": "negate_attack"}]}],
      art="Glowing ward-circle hastily drawn in dust")
snare("counterweight", "Counterweight", A, "counter",
      "Activate when your opponent Summons a unit: negate the Summon and destroy it.",
      [{"timing": "quick", "trigger": "opponent_summons", "ops": [{"op": "negate_summon"}, {"op": "destroy", "target": "summoned_unit"}]}],
      rarity="rare", art="Heavy iron weight dropping onto a portal")
snare("giants_fall", "Giant's Fall", A, "normal",
      "Activate when your opponent declares an attack with a unit with 2000 or more ATK: destroy that unit.",
      [{"timing": "quick", "trigger": "opponent_attack_declared", "condition": {"attacker_atk_min": 2000}, "ops": [{"op": "destroy", "target": "attacker"}]}],
      rarity="rare", art="Collapsing rope trap bringing down a huge shadow")

# ===================== VALIDATION & OUTPUT =====================
def validate():
    errs, warns = [], []
    ids = [c["id"] for c in CARDS]
    for d in [i for i, n in collections.Counter(ids).items() if n > 1]:
        errs.append(f"duplicate id {d}")
    for c in CARDS:
        i = c["id"]
        if c["rarity"] not in ("common", "rare", "epic", "mythic"): errs.append(f"{i}: rarity")
        if c["type"] == "unit":
            if not 1 <= c["level"] <= 8: errs.append(f"{i}: level")
            if c["atk"] % 100 or c["def_"] % 100: errs.append(f"{i}: stats not multiple of 100")
            if c["subtype"] == "merge" and not c.get("materials"): errs.append(f"{i}: merge without materials")
            budget = c["level"] * 400 + 400
            total = (c["atk"] + c["def_"]) / 2
            if total > budget + 600: warns.append(f"{i}: strong for level ({c['atk']}/{c['def_']} L{c['level']})")
            if c["subtype"] != "normal" and not c["effects"] and not c["text"]: errs.append(f"{i}: effect unit w/o text")
        for e in c["effects"]:
            if "timing" not in e: errs.append(f"{i}: effect without timing")
    return errs, warns

def md_catalog():
    out = ["# Каталог на картите (генериран от tools/build_cards.py)\n",
           f"Общо карти: **{len(CARDS)}**\n"]
    for arch in dict.fromkeys(c["archetype"] for c in CARDS):
        cs = [c for c in CARDS if c["archetype"] == arch]
        out.append(f"\n## {arch.replace('_', ' ').title()} ({len(cs)})\n")
        out.append("| Карта | Тип | Ниво | ATK/DEF | Рядкост | Текст |\n|---|---|---|---|---|---|")
        for c in cs:
            st = f"{c['atk']}/{c['def_']}" if c["type"] == "unit" else "-"
            lv = c.get("level", "-")
            out.append(f"| {c['name']} | {c['type']}/{c['subtype']} | {lv} | {st} | {c['rarity']} | {c['text']} |")
    return "\n".join(out) + "\n"

if __name__ == "__main__":
    errs, warns = validate()
    for w in warns: print("WARN", w)
    for e in errs: print("ERROR", e)
    if errs: sys.exit(1)
    os.makedirs(os.path.join(ROOT, "cards"), exist_ok=True)
    def clean(c):
        c = dict(c)
        if "def_" in c: c["def"] = c.pop("def_")
        return c
    by = collections.defaultdict(list)
    for c in CARDS: by[c["archetype"]].append(clean(c))
    for k, v in by.items():
        json.dump(v, open(os.path.join(ROOT, "cards", f"{k}.json"), "w"), indent=2, ensure_ascii=False)
    json.dump([clean(c) for c in CARDS], open(os.path.join(ROOT, "cards", "all.json"), "w"), indent=1, ensure_ascii=False)
    open(os.path.join(ROOT, "docs", "CATALOG.md"), "w").write(md_catalog())
    cnt = collections.Counter((c["archetype"]) for c in CARDS)
    print("OK", len(CARDS), "cards", dict(cnt))
