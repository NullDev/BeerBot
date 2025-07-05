import { CommandInteraction, CommandInteractionOptionResolver } from "discord.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

export type CommandInteractionWithOptions = CommandInteraction & {
    options: CommandInteractionOptionResolver;
};
