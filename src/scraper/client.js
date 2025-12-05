import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

let client = null;

/**
 * Create and configure the Discord client.
 * @param {string} token - Discord bot token.
 * @returns {Promise<Client>} The logged-in Discord client.
 */
export async function createClient(token) {
  if (client && client.isReady()) {
    return client;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Discord client login timed out after 30 seconds'));
    }, 30000);

    client.once('ready', () => {
      clearTimeout(timeout);
      console.log(`Logged in as ${client.user.tag}`);
      resolve(client);
    });

    client.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    client.login(token).catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Get the current client instance.
 * @returns {Client|null} The Discord client or null if not initialized.
 */
export function getClient() {
  return client;
}

/**
 * Destroy the Discord client connection.
 */
export function destroyClient() {
  if (client) {
    client.destroy();
    client = null;
  }
}

/**
 * Get a guild by ID.
 * @param {string} guildId - The Discord guild ID.
 * @returns {Promise<Guild>} The guild object.
 */
export async function getGuild(guildId) {
  if (!client || !client.isReady()) {
    throw new Error('Discord client not initialized');
  }

  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    throw new Error(`Guild not found: ${guildId}`);
  }

  return guild;
}

/**
 * Get all text channels from a guild.
 * @param {Guild} guild - The Discord guild.
 * @param {Object} options - Filter options.
 * @param {number[]} [options.excludeTypes] - Channel types to exclude.
 * @param {string[]} [options.excludeNames] - Channel names to exclude.
 * @returns {Promise<Collection<string, GuildChannel>>} Collection of text channels.
 */
export async function getTextChannels(guild, options = {}) {
  const { excludeTypes = [], excludeNames = [] } = options;

  // Default exclude voice, category, stage, directory channels
  const defaultExcludeTypes = [
    ChannelType.GuildVoice,        // 2
    ChannelType.GuildCategory,    // 4
    ChannelType.GuildStageVoice,  // 13
    ChannelType.GuildDirectory,   // 14
    ChannelType.GuildMedia,       // 16
  ];

  const excludeTypeSet = new Set([...defaultExcludeTypes, ...excludeTypes]);
  const excludeNameSet = new Set(excludeNames.map(n => n.toLowerCase()));

  const channels = await guild.channels.fetch();

  return channels.filter(channel => {
    if (!channel) return false;
    if (excludeTypeSet.has(channel.type)) return false;
    if (excludeNameSet.has(channel.name.toLowerCase())) return false;

    // Must be a text-based channel we can read messages from
    return channel.isTextBased() && !channel.isVoiceBased();
  });
}

/**
 * Check if the bot has permission to read a channel.
 * @param {GuildChannel} channel - The channel to check.
 * @returns {boolean} True if the bot can read the channel.
 */
export function canReadChannel(channel) {
  if (!client || !client.user) return false;

  const permissions = channel.permissionsFor(client.user);
  if (!permissions) return false;

  return permissions.has('ViewChannel') && permissions.has('ReadMessageHistory');
}

/**
 * Get guild info for storage.
 * @param {Guild} guild - The Discord guild.
 * @returns {Object} Guild data formatted for database.
 */
export function formatGuildData(guild) {
  return {
    id: guild.id,
    name: guild.name,
    icon_url: guild.iconURL({ size: 256 }),
    member_count: guild.memberCount,
  };
}

/**
 * Get channel info for storage.
 * @param {GuildChannel} channel - The Discord channel.
 * @returns {Object} Channel data formatted for database.
 */
export function formatChannelData(channel) {
  return {
    id: channel.id,
    guild_id: channel.guild.id,
    name: channel.name,
    type: channel.type,
    parent_id: channel.parentId || null,
    position: channel.position,
    topic: channel.topic || null,
  };
}

/**
 * Format user data for storage.
 * @param {User} user - The Discord user.
 * @returns {Object} User data formatted for database.
 */
export function formatUserData(user) {
  return {
    id: user.id,
    username: user.username,
    global_name: user.globalName || user.displayName || null,
    discriminator: user.discriminator || '0',
    avatar_url: user.avatarURL({ size: 256 }),
    is_bot: user.bot ? 1 : 0,
  };
}

export default {
  createClient,
  getClient,
  destroyClient,
  getGuild,
  getTextChannels,
  canReadChannel,
  formatGuildData,
  formatChannelData,
  formatUserData,
};
