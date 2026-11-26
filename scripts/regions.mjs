import { MODULE_ID, list } from "./store.mjs";

/* Region behaviour "Open Datapad": when a token enters the Region, the player who moved it gets the
   datapad opened on a terminal, market, the bounty board, Salvage or the home screen.
   Registered as the module sub-type "holo-terminal.openDatapad" (see documentTypes in module.json). */

export const BEHAVIOR_TYPE = `${MODULE_ID}.openDatapad`;

/** Every place the behaviour can open, built when the config sheet renders so new terminals/markets show up. */
function targetChoices() {
  const c = {
    home: "Datapad home screen", network: "Local Net (terminals on this scene)", comms: "Comms", news: "HoloNet News",
    missions: "Missions", contacts: "Contacts", bank: "Credits", bounties: "Bounty board", shops: "Markets (all on this scene)",
    salvage: "Salvage (loot nearby)", scanner: "Pulse Scanner", galaxy: "Galaxy Map", holodock: "Starship (party ship)"
  };
  for (const t of list("terminals")) c[`terminal:${t.id}`] = `Terminal: ${t.name}`;
  for (const s of list("shops")) c[`shop:${s.id}`] = `Market: ${s.name}`;
  return c;
}

export function registerRegionBehavior(openDatapad) {
  const Base = foundry.data?.regionBehaviors?.RegionBehaviorType;
  if (!Base) return; // Foundry before v12
  const { StringField, BooleanField } = foundry.data.fields;
  const ENTER = CONST.REGION_EVENTS.TOKEN_ENTER;

  class OpenDatapadBehavior extends Base {
    static defineSchema() {
      return {
        target: new StringField({ required: true, blank: false, initial: "home", choices: targetChoices,
          label: "Open", hint: "What the datapad opens on when a token walks in." }),
        playersOnly: new BooleanField({ initial: true, label: "Players only",
          hint: "Ignore NPC tokens the GM moves, so dragging NPCs around doesn't pop the datapad. When the GM moves a player's token in, the datapad opens in test mode: you see the locks and encryption as that player would." }),
        once: new BooleanField({ initial: false, label: "Only once per player",
          hint: "Each player gets it the first time only. Clear by toggling this off and on." })
      };
    }

    static events = { [ENTER]: this.#onTokenEnter };

    static async #onTokenEnter(event) {
      const user = event.user;
      if (user !== game.user) return; // only the client of the player who moved the token reacts
      // A GM walking a player's token in is testing the trigger: open it as that player would see it.
      const actor = event.data?.token?.actor ?? null;
      const testActor = user.isGM && actor?.hasPlayerOwner ? actor : null;
      if (this.playersOnly && user.isGM && !testActor) return;
      if (this.once && !testActor) {
        // Players can't update the behaviour, so each player remembers it on their own user.
        const mine = user.getFlag(MODULE_ID, "regionsSeen") ?? [];
        if (mine.includes(this.parent.uuid)) return;
        await user.setFlag(MODULE_ID, "regionsSeen", [...mine, this.parent.uuid]);
      }
      const [view, id] = this.target.split(":");
      // a single terminal or market that has since been deleted falls back to its list
      const opts = testActor ? { testActor } : {};
      if (view === "terminal" && !list("terminals").some((t) => t.id === id)) return openDatapad("network", null, opts);
      if (view === "shop" && !list("shops").some((s) => s.id === id)) return openDatapad("shops", null, opts);
      openDatapad(view, id ?? null, opts);
    }

    _onUpdate(changed, options, userId) {
      super._onUpdate?.(changed, options, userId);
      // Toggling "once" off resets who has seen it.
      if (changed.system?.once === false && game.user.id === userId) {
        for (const u of game.users) {
          const mine = u.getFlag(MODULE_ID, "regionsSeen");
          if (mine?.includes(this.parent.uuid)) u.setFlag(MODULE_ID, "regionsSeen", mine.filter((x) => x !== this.parent.uuid));
        }
      }
    }
  }

  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = OpenDatapadBehavior;
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fas fa-tablet-screen-button";
  CONFIG.RegionBehavior.typeLabels ??= {};
  CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = `TYPES.RegionBehavior.${BEHAVIOR_TYPE}`;
}
