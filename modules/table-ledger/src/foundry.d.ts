// Foundry globals. Typed loosely on purpose: the community v13 types lag the
// runtime and the cosmere-rpg system itself works around them with `as any`.
// Keep Foundry access at the edges (apps, hooks); pure logic stays typed.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const game: any;
declare const ui: any;
declare const CONFIG: any;
declare const Hooks: any;
declare const foundry: any;
declare const ChatMessage: any;
declare const JournalEntry: any;
declare const fromUuid: (uuid: string) => Promise<any>;
declare const fromUuidSync: (uuid: string, options?: { strict?: boolean }) => any;
