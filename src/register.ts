/**
 * One-off: push the slash command definitions to your guild. Runs in Node, not
 * in the Worker — `npm run register`, with DISCORD_* set in .env.
 */
import 'dotenv/config';

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APP_ID;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !appId || !guildId) {
  throw new Error('Set DISCORD_TOKEN, DISCORD_APP_ID and DISCORD_GUILD_ID in .env');
}

const STRING = 3;
const SUBCOMMAND = 1;

interface Option {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  options?: Option[];
}
interface Command {
  name: string;
  description: string;
  type?: number;
  options?: Option[];
}

const body: Command[] = [
  {
    name: 'snack',
    description: 'Office snack list',
    options: [
      {
        name: 'add',
        description: 'Add a snack by Amazon link, or search the catalog',
        type: SUBCOMMAND,
        options: [
          {
            name: 'query',
            description: 'An Amazon link, or a keyword to search the catalog',
            type: STRING,
            required: true,
          },
          {
            name: 'price',
            description: 'Price in dollars, if the lookup can’t read it (e.g. 4.99)',
            type: STRING,
            required: false,
          },
        ],
      },
      { name: 'list', description: 'Show the current list and the budget line', type: SUBCOMMAND },
      { name: 'catalog', description: 'List every snack in the catalog', type: SUBCOMMAND },
      {
        name: 'forget',
        description: 'Snack buyer: remove a product from the catalog',
        type: SUBCOMMAND,
        options: [
          { name: 'item', description: 'Part of the product’s name', type: STRING, required: true },
        ],
      },
      {
        name: 'flag',
        description: 'Add an allergen warning to an item on the current list',
        type: SUBCOMMAND,
        options: [
          { name: 'item', description: 'Part of the item’s name', type: STRING, required: true },
          {
            name: 'allergens',
            description: 'Comma separated, e.g. peanuts, milk',
            type: STRING,
            required: true,
          },
        ],
      },
      { name: 'help', description: 'What this bot does and how to use it', type: SUBCOMMAND },
      {
        name: 'budget',
        description: 'Show or change the weekly budget',
        type: SUBCOMMAND,
        options: [
          { name: 'amount', description: 'Dollars per week, e.g. 75', type: STRING, required: false },
        ],
      },
      {
        name: 'rate',
        description: 'Rate last week’s order, so scores show next time',
        type: SUBCOMMAND,
      },
      {
        name: 'unavailable',
        description: 'Snack buyer: record that an ordered item couldn’t be bought',
        type: SUBCOMMAND,
        options: [
          { name: 'item', description: 'Part of the item’s name', type: STRING, required: true },
        ],
      },
      {
        name: 'substitute',
        description: 'Snack buyer: record that you bought something else instead',
        type: SUBCOMMAND,
        options: [
          { name: 'item', description: 'Part of the original item’s name', type: STRING, required: true },
          { name: 'url', description: 'Amazon link to what you actually bought', type: STRING, required: true },
        ],
      },
      {
        name: 'repeat',
        description: 'Copy last week’s ordered list into this week',
        type: SUBCOMMAND,
      },
      { name: 'digest', description: 'Run the weekly digest now', type: SUBCOMMAND },
    ],
  },
];

// A message context menu entry: right-click a message -> Apps -> Add as snack.
const MESSAGE_COMMAND = 3;
body.push({ name: 'Add as snack', type: MESSAGE_COMMAND, description: '', options: [] });

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`, {
  method: 'PUT',
  headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const names = body.flatMap((c) =>
  c.options?.length ? c.options.map((o) => `/${c.name} ${o.name}`) : [`“${c.name}”`],
);
console.log(`registered ${names.join(', ')}`);
